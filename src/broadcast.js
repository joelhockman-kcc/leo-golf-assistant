// broadcast.js — Assemble and send hole-completion SMS broadcasts
// Triggered when all players have reported a given hole.

const twilio = require('twilio');
const { PLAYERS, playerById, PAR_BY_HOLE } = require('./rounds');
const { computeStandings, cumulativePoints } = require('./scoring');
const { getRoundResults } = require('./sheets');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const FROM = process.env.TWILIO_PHONE_NUMBER;

// ─── MAIN BROADCAST ───────────────────────────────────────────────────────────
/**
 * Build and send the hole-completion broadcast to all 10 players.
 *
 * round:      round config object from rounds.js
 * holeScores: { [playerId]: [grossScore, ...] }   (0-indexed arrays)
 * holeNumber: 1-indexed hole that just completed
 * allRounds:  full ROUNDS array (for cumulative points context)
 */
async function broadcastHoleComplete(round, holeScores, holeNumber, allRounds) {
  const standings = computeStandings(round, holeScores);
  const message = buildMessage(round, standings, holeNumber, allRounds, holeScores);

  const sends = PLAYERS.map(player =>
    client.messages.create({
      body: message,
      from: FROM,
      to: player.phone,
    }).catch(err => console.error(`Failed to send to ${player.name}:`, err.message))
  );

  await Promise.all(sends);
  console.log(`Broadcast sent for ${round.id} hole ${holeNumber}`);
}

// ─── MESSAGE BUILDER ──────────────────────────────────────────────────────────
function buildMessage(round, standings, holeNumber, allRounds, holeScores) {
  const lines = [];
  const holesLeft = 18 - holeNumber;
  const parSoFar = PAR_BY_HOLE.slice(0, holeNumber).reduce((a, b) => a + b, 0);

  // Header
  lines.push(`⛳ ${round.label}`);
  lines.push(`After hole ${holeNumber}${holesLeft > 0 ? ` · ${holesLeft} to go` : ' · FINAL'}`);
  lines.push('─────────────────');

  if (round.format === 'scramble') {
    lines.push(...buildScrambleMessage(standings));
  } else if (round.format === 'net_stroke') {
    lines.push(...buildNetStrokeMessage(standings, parSoFar));
  } else if (round.format === 'stableford') {
    lines.push(...buildStablefordMessage(standings));
  } else if (round.format === 'match_play') {
    lines.push(...buildMatchPlayMessage(standings));
  }

  // Cumulative points footer (only for team-points rounds)
  if (round.teamPoints && allRounds) {
    lines.push('─────────────────');
    lines.push(...buildCumulativeFooter(round, standings, allRounds));
  }

  return lines.join('\n');
}

// ── Scramble message ──────────────────────────────────────────────────────────
function buildScrambleMessage(standings) {
  const lines = ['🏌️ SCRAMBLE LEADERBOARD'];
  standings.groups.forEach((g, i) => {
    const sign = g.vspar === 0 ? 'E' : g.vspar > 0 ? `+${g.vspar}` : `${g.vspar}`;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
    lines.push(`${medal} ${g.label}: ${sign} (${g.gross} gross)`);
  });
  return lines;
}

// ── Net Stroke message ────────────────────────────────────────────────────────
function buildNetStrokeMessage(standings, parSoFar) {
  const lines = [];
  const { teamA, teamB, leader, margin } = standings;

  // Team summary
  const aVsPar = teamA.netTotal - parSoFar * 5;
  const bVsPar = teamB.netTotal - parSoFar * 5;
  const aSign = aVsPar === 0 ? 'E' : aVsPar > 0 ? `+${aVsPar}` : `${aVsPar}`;
  const bSign = bVsPar === 0 ? 'E' : bVsPar > 0 ? `+${bVsPar}` : `${bVsPar}`;

  if (leader === 'TIE') {
    lines.push(`🤝 TIED — Team A ${aSign} · Team B ${bSign}`);
  } else {
    const leadSign = leader === 'A' ? aSign : bSign;
    const trailSign = leader === 'A' ? bSign : aSign;
    lines.push(`Team ${leader} leads by ${margin} · (${leadSign} vs ${trailSign})`);
  }
  lines.push('');

  // Individual net scores
  lines.push('Team A (net):');
  teamA.players
    .sort((a, b) => a.netTotal - b.netTotal)
    .forEach(p => {
      const diff = p.netTotal - (parSoFar);
      const sign = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
      lines.push(`  ${p.name}: ${sign} (${p.netTotal})`);
    });

  lines.push('Team B (net):');
  teamB.players
    .sort((a, b) => a.netTotal - b.netTotal)
    .forEach(p => {
      const diff = p.netTotal - (parSoFar);
      const sign = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
      lines.push(`  ${p.name}: ${sign} (${p.netTotal})`);
    });

  return lines;
}

// ── Stableford message ────────────────────────────────────────────────────────
function buildStablefordMessage(standings) {
  const lines = [];
  const { teamA, teamB, leader, margin } = standings;

  if (leader === 'TIE') {
    lines.push(`🤝 TIED — Team A ${teamA.stablefordTotal} pts · Team B ${teamB.stablefordTotal} pts`);
  } else {
    const leadPts = leader === 'A' ? teamA.stablefordTotal : teamB.stablefordTotal;
    const trailPts = leader === 'A' ? teamB.stablefordTotal : teamA.stablefordTotal;
    lines.push(`Team ${leader} leads ${leadPts}–${trailPts} pts (+${margin})`);
  }
  lines.push('');

  lines.push('Team A:');
  teamA.players
    .sort((a, b) => b.stablefordTotal - a.stablefordTotal)
    .forEach(p => lines.push(`  ${p.name}: ${p.stablefordTotal} pts`));

  lines.push('Team B:');
  teamB.players
    .sort((a, b) => b.stablefordTotal - a.stablefordTotal)
    .forEach(p => lines.push(`  ${p.name}: ${p.stablefordTotal} pts`));

  return lines;
}

// ── Match Play message ────────────────────────────────────────────────────────
function buildMatchPlayMessage(standings) {
  const lines = [];
  const { teamA, teamB, leader, matches } = standings;

  // Team points summary
  const aStr = `Team A: ${teamA.matchPoints} pts`;
  const bStr = `Team B: ${teamB.matchPoints} pts`;
  if (leader === 'TIE') {
    lines.push(`🤝 Matches: ${aStr} · ${bStr}`);
  } else {
    lines.push(`Team ${leader} leads — ${aStr} · ${bStr}`);
  }
  lines.push('');

  // Individual match statuses
  lines.push('Match results:');
  matches.forEach(m => {
    const homeName = playerById(m.homeId)?.name || m.homeId;
    const awayName = playerById(m.awayId)?.name || m.awayId;
    lines.push(`  ${homeName} vs ${awayName}: ${m.statusStr}`);
  });

  return lines;
}

// ── Cumulative points footer ──────────────────────────────────────────────────
async function buildCumulativeFooterAsync(round, standings, allRounds) {
  // Fetch completed round results from Sheets for accurate cumulative tally
  const results = await getRoundResults();

  // Inject current round's in-progress points if it's the active one
  if (round.format === 'net_stroke' || round.format === 'stableford') {
    const aWin = standings.leader === 'A';
    const bWin = standings.leader === 'B';
    results[round.id] = {
      teamAPoints: aWin ? round.pointsAvailable : bWin ? 0 : round.pointsAvailable / 2,
      teamBPoints: bWin ? round.pointsAvailable : aWin ? 0 : round.pointsAvailable / 2,
    };
  } else if (round.format === 'match_play') {
    results[round.id] = {
      teamAPoints: standings.teamA.matchPoints,
      teamBPoints: standings.teamB.matchPoints,
    };
  }

  const standingsMap = {};
  Object.entries(results).forEach(([rid, r]) => {
    standingsMap[rid] = {
      teamA: { matchPoints: r.teamAPoints, netTotal: 0, stablefordTotal: 0 },
      teamB: { matchPoints: r.teamBPoints, netTotal: 0, stablefordTotal: 0 },
      leader: r.teamAPoints > r.teamBPoints ? 'A' : r.teamBPoints > r.teamAPoints ? 'B' : 'TIE',
    };
  });

  const cumul = cumulativePoints(allRounds, standingsMap);
  const lines = [];
  lines.push('OVERALL STANDINGS');
  if (cumul.leader === 'TIE') {
    lines.push(`🤝 Tied ${cumul.teamA}–${cumul.teamB} pts`);
  } else {
    lines.push(`Team ${cumul.leader} leads ${Math.max(cumul.teamA, cumul.teamB)}–${Math.min(cumul.teamA, cumul.teamB)} pts`);
  }
  if (cumul.maxRemaining > 0) {
    lines.push(`(${cumul.maxRemaining} pts still to play)`);
  }
  return lines;
}

// Synchronous wrapper used in buildMessage — resolves to a placeholder if async not awaited
function buildCumulativeFooter(round, standings, allRounds) {
  // Returns placeholder lines — caller should use broadcastHoleComplete which is fully async
  return ['[Overall standings loading...]'];
}

// ─── ADMIN / MANUAL BROADCAST ────────────────────────────────────────────────
/**
 * Send a plain text message to all players (for admin announcements).
 */
async function broadcastRaw(message) {
  const sends = PLAYERS.map(player =>
    client.messages.create({ body: message, from: FROM, to: player.phone })
      .catch(err => console.error(`Failed to send to ${player.name}:`, err.message))
  );
  await Promise.all(sends);
}

module.exports = {
  broadcastHoleComplete,
  broadcastRaw,
  buildCumulativeFooterAsync,
};
