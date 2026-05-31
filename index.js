// index.js — Main Express server for the Leo Golf Assistant
// Receives inbound SMS via Twilio webhook, parses hole scores,
// writes to Google Sheets, and broadcasts after each hole completes.

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const {
  playerByPhone,
  activeRound,
  expectedPlayers,
  ROUNDS,
  PAR_BY_HOLE,
} = require('./rounds');
const {
  logHoleScore,
  getHoleScores,
  getLastBroadcastHole,
  setLastBroadcastHole,
  saveRoundResult,
} = require('./sheets');
const { computeStandings } = require('./scoring');
const { broadcastHoleComplete, broadcastRaw, buildCumulativeFooterAsync } = require('./broadcast');

const app = express();
app.use(express.urlencoded({ extended: false }));

// ─── TWILIO SIGNATURE VALIDATION ──────────────────────────────────────────────
app.use('/sms', (req, res, next) => {
  if (process.env.NODE_ENV === 'development') return next();
  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    req.headers['x-twilio-signature'],
    `${process.env.PUBLIC_URL}/sms`,
    req.body
  );
  if (!valid) return res.status(403).send('Forbidden');
  next();
});

// ─── SMS WEBHOOK ──────────────────────────────────────────────────────────────
app.post('/sms', async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const twiml = new twilio.twiml.MessagingResponse();

  // Helper: reply and end
  const reply = (msg) => { twiml.message(msg); res.type('text/xml').send(twiml.toString()); };

  try {
    // ── JOIN handler (opt-in required by Twilio) ──────────────────────────────
    if (/^join$/i.test(body)) {
      return reply('Welcome to the Leo Golf Assistant! 🏌️ You\'re all set. Text your hole scores as "H<hole> <score>", e.g. "H7 4".');
    }

    // ── STOP / HELP passthrough ───────────────────────────────────────────────
    if (/^(stop|help|info)$/i.test(body)) {
      return reply('Commands: "H<hole> <score>" to log a score (e.g. H7 4). "SCORES" for current standings. "ROUND" for active round info.');
    }

    // ── SCORES command ────────────────────────────────────────────────────────
    if (/^scores$/i.test(body)) {
      const round = activeRound();
      const holeScores = await getHoleScores(round.id);
      const standings = computeStandings(round, holeScores);
      const holesIn = standings.holesCompleted || 0;
      return reply(formatStandingsReply(round, standings, holesIn));
    }

    // ── ROUND command ─────────────────────────────────────────────────────────
    if (/^round$/i.test(body)) {
      const round = activeRound();
      return reply(`Active: ${round.label}\nFormat: ${round.format.replace('_', ' ')}\nDate: ${round.date} ${round.session}`);
    }

    // ── ADMIN: SETROUND <R1-R5> ───────────────────────────────────────────────
    const setRoundMatch = body.match(/^setround\s+(R[1-5])$/i);
    if (setRoundMatch) {
      process.env.ACTIVE_ROUND = setRoundMatch[1].toUpperCase();
      return reply(`Active round set to ${process.env.ACTIVE_ROUND}.`);
    }

    // ── ADMIN: BROADCAST <message> ────────────────────────────────────────────
    const broadcastMatch = body.match(/^broadcast\s+(.+)$/i);
    if (broadcastMatch) {
      await broadcastRaw(broadcastMatch[1]);
      return reply('Broadcast sent to all players.');
    }

    // ── SCORE SUBMISSION: H<hole> <score>  or  <hole> <score> ────────────────
    const scoreMatch = body.match(/^[Hh]?(\d{1,2})\s+(\d{1,2})$/);
    if (!scoreMatch) {
      return reply('Format: H<hole> <score>  e.g. H7 4\nOr text SCORES for current standings.');
    }

    const hole = parseInt(scoreMatch[1], 10);
    const gross = parseInt(scoreMatch[2], 10);

    // Validate hole number
    if (hole < 1 || hole > 18) {
      return reply(`Hole must be 1–18. Got: ${hole}`);
    }

    // Validate gross score (sanity check — 1–15 per hole is reasonable)
    if (gross < 1 || gross > 15) {
      return reply(`Score looks off (${gross}). Double-check and resend.`);
    }

    // Identify player
    const player = playerByPhone(from);
    if (!player) {
      return reply('Your number isn\'t registered. Contact the commissioner to get added.');
    }

    // Identify active round
    const round = activeRound();

    // Check this player is expected this round
    const expected = expectedPlayers(round);
    if (!expected.includes(player.id)) {
      return reply(`You're not in the reporter list for ${round.label}. Contact the commissioner if this is wrong.`);
    }

    // Write to Sheets
    await logHoleScore(round.id, player.id, hole, gross);

    // Acknowledge
    const par = PAR_BY_HOLE[hole - 1];
    const diff = gross - par;
    const vsParStr = diff === 0 ? 'par' : diff === 1 ? 'bogey' : diff === -1 ? 'birdie' : diff < -1 ? `${Math.abs(diff)} under` : `${diff} over`;
    reply(`✓ ${player.name} H${hole}: ${gross} (${vsParStr})`);

    // ── Check if this hole is now complete for all expected players ───────────
    setImmediate(async () => {
      try {
        await checkAndBroadcast(round, hole);
      } catch (err) {
        console.error('Broadcast check error:', err);
      }
    });

  } catch (err) {
    console.error('Webhook error:', err);
    reply('Something went wrong. Try again or text SCORES to check status.');
  }
});

// ─── BROADCAST CHECK ──────────────────────────────────────────────────────────
/**
 * After any score comes in, check whether all expected players have reported
 * this hole. If yes (and we haven't broadcast it yet), fire the broadcast.
 */
async function checkAndBroadcast(round, hole) {
  const holeScores = await getHoleScores(round.id);
  const expected = expectedPlayers(round);

  // Has every expected player reported this hole?
  const allIn = expected.every(pid => {
    const scores = holeScores[pid] || [];
    return scores[hole - 1] !== undefined;
  });

  if (!allIn) return; // waiting on more players

  // Have we already broadcast this hole?
  const lastBroadcast = await getLastBroadcastHole(round.id);
  if (lastBroadcast >= hole) return; // already sent

  // Mark broadcast before sending (prevents duplicate sends on race conditions)
  await setLastBroadcastHole(round.id, hole);

  // Build and send the broadcast
  // We need the full async cumulative footer here
  const standings = computeStandings(round, holeScores);
  const cumulLines = await buildCumulativeFooterAsync(round, standings, ROUNDS);

  await broadcastHoleComplete(round, holeScores, hole, ROUNDS);

  // If this is hole 18, save final round result
  if (hole === 18 && round.teamPoints) {
    const finalStandings = computeStandings(round, holeScores);
    let aPoints = 0, bPoints = 0;
    if (round.format === 'net_stroke' || round.format === 'stableford') {
      if (finalStandings.leader === 'A') aPoints = round.pointsAvailable;
      else if (finalStandings.leader === 'B') bPoints = round.pointsAvailable;
      else { aPoints = round.pointsAvailable / 2; bPoints = round.pointsAvailable / 2; }
    } else if (round.format === 'match_play') {
      aPoints = finalStandings.teamA.matchPoints;
      bPoints = finalStandings.teamB.matchPoints;
    }
    await saveRoundResult(round.id, aPoints, bPoints);
    console.log(`Round ${round.id} complete — Team A: ${aPoints} pts, Team B: ${bPoints} pts`);
  }
}

// ─── FORMAT STANDINGS REPLY (for SCORES command) ──────────────────────────────
function formatStandingsReply(round, standings, holesIn) {
  if (holesIn === 0) return `${round.label} — No scores yet.`;
  const { format } = round;
  if (format === 'scramble') {
    const top = standings.groups[0];
    return `${round.label}\nAfter H${holesIn}\nLeading: ${top.label} (${top.vspar >= 0 ? '+' : ''}${top.vspar})`;
  }
  if (format === 'net_stroke' || format === 'stableford') {
    const { leader, margin } = standings;
    if (leader === 'TIE') return `${round.label}\nAfter H${holesIn}: All Tied`;
    return `${round.label}\nAfter H${holesIn}: Team ${leader} leads by ${margin}`;
  }
  if (format === 'match_play') {
    const { teamA, teamB, leader } = standings;
    return `${round.label}\nAfter H${holesIn}\nTeam A: ${teamA.matchPoints} pts · Team B: ${teamB.matchPoints} pts`;
  }
  return `${round.label} — in progress`;
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Golf tracker running on port ${PORT}`));

module.exports = app;
