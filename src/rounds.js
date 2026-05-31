// rounds.js — Single source of truth for the Leo Golf Tournament

// ─── PLAYERS ────────────────────────────────────────────────────────────────
// Ranked lowest → highest handicap.
// Fill in:
//   team:  'A' or 'B'  after the draft
//   phone: '+1XXXXXXXXXX'  before the trip
//
// The rest of the app (scoring, broadcast, groups, matches) works off `id`,
// so you can change names, handicaps, or swap players without touching anything
// else — just keep the list sorted low → high handicap so match play rank-
// matching stays correct.

const PLAYERS = [
  { id: 'P1',  name: 'Benfield', team: 'TBD', handicap: 6,  phone: '+1XXXXXXXXXX' },
  { id: 'P2',  name: 'Jon',      team: 'TBD', handicap: 10, phone: '+1XXXXXXXXXX' },
  { id: 'P3',  name: 'Doug',     team: 'TBD', handicap: 13, phone: '+1XXXXXXXXXX' },
  { id: 'P4',  name: 'Capell',   team: 'TBD', handicap: 16, phone: '+1XXXXXXXXXX' },
  { id: 'P5',  name: 'Joel',     team: 'TBD', handicap: 16, phone: '+1XXXXXXXXXX' },
  { id: 'P6',  name: 'Jud',      team: 'TBD', handicap: 17, phone: '+1XXXXXXXXXX' },
  { id: 'P7',  name: 'Matt J',   team: 'TBD', handicap: 19, phone: '+1XXXXXXXXXX' },
  { id: 'P8',  name: 'Kramer',   team: 'TBD', handicap: 19, phone: '+1XXXXXXXXXX' },
  { id: 'P9',  name: 'Jordy',    team: 'TBD', handicap: 19, phone: '+1XXXXXXXXXX' },
  { id: 'P10', name: 'Travis',   team: 'TBD', handicap: 32, phone: '+1XXXXXXXXXX' },
];

// ─── AFTER THE DRAFT ────────────────────────────────────────────────────────
// 1. Set team: 'A' or 'B' on each player above.
// 2. Add phone numbers.
// 3. Update the groups + matches in ROUNDS below to reflect real pairings.
//    The helpers teamA() / teamB() and rankMatchedPairs() at the bottom of
//    this file make that one-liner easy.

// ─── PAR BY HOLE ─────────────────────────────────────────────────────────────
// Replace with actual pars from the course scorecard.
// Index 0 = hole 1, index 17 = hole 18.
const PAR_BY_HOLE = [4,4,3,5,4,3,4,5,4, 4,3,5,4,4,3,5,4,4];
//                   1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18

const COURSE_PAR = PAR_BY_HOLE.reduce((a, b) => a + b, 0);

// ─── ROUNDS ──────────────────────────────────────────────────────────────────
// Groups and matches use P1–P10 IDs (rank order) for now.
// After the draft replace with real A/B group splits and rank-matched pairs.
// Use the rankMatchedPairs() helper at the bottom to generate matches quickly.

const ROUNDS = [
  {
    id: 'R1',
    label: 'Round 1 — Scramble',
    format: 'scramble',
    date: '2026-06-11',
    session: 'afternoon',
    // TODO after draft: 1 twosome + 2 foursomes mixing teams
    groups: [
      ['P9',  'P10'],
      ['P1', 'P3', 'P6', 'P8'],
      ['P2', 'P4', 'P5', 'P7'],
    ],
    teamPoints: false,
    stakes: '$200 pot',
  },
  {
    id: 'R2',
    label: 'Round 2 — Net Stroke',
    format: 'net_stroke',
    date: '2026-06-12',
    session: 'morning',
    // TODO after draft: mix teams within groups
    groups: [
      ['P1', 'P4', 'P6', 'P9'],
      ['P2', 'P5', 'P7', 'P10'],
      ['P3', 'P8'],
    ],
    teamPoints: true,
    pointsAvailable: 3,
  },
  {
    id: 'R3',
    label: 'Round 3 — Match Play',
    format: 'match_play',
    date: '2026-06-12',
    session: 'afternoon',
    groups: [
      ['P1', 'P4', 'P6', 'P9'],
      ['P2', 'P5', 'P7', 'P10'],
      ['P3', 'P8'],
    ],
    // TODO after draft: replace with rankMatchedPairs() output
    // e.g. rankMatchedPairs() returns [{home:'A1',away:'B1'}, ...]
    matches: [
      { home: 'P1', away: 'P2'  },
      { home: 'P3', away: 'P4'  },
      { home: 'P5', away: 'P6'  },
      { home: 'P7', away: 'P8'  },
      { home: 'P9', away: 'P10' },
    ],
    teamPoints: true,
    pointsAvailable: 10,
  },
  {
    id: 'R4',
    label: 'Round 4 — Stableford',
    format: 'stableford',
    date: '2026-06-13',
    session: 'morning',
    groups: [
      ['P1', 'P3', 'P7',  'P9'],
      ['P2', 'P4', 'P8',  'P10'],
      ['P5', 'P6'],
    ],
    teamPoints: true,
    pointsAvailable: 3,
    stablefordTable: {
      eagle_or_better: 6,
      birdie:          4,
      par:             2,
      bogey:           1,
      double_or_worse: 0,
    },
  },
  {
    id: 'R5',
    label: 'Round 5 — Match Play',
    format: 'match_play',
    date: '2026-06-13',
    session: 'afternoon',
    groups: [
      ['P1', 'P3', 'P7',  'P9'],
      ['P2', 'P4', 'P8',  'P10'],
      ['P5', 'P6'],
    ],
    matches: [
      { home: 'P1', away: 'P2'  },
      { home: 'P3', away: 'P4'  },
      { home: 'P5', away: 'P6'  },
      { home: 'P7', away: 'P8'  },
      { home: 'P9', away: 'P10' },
    ],
    teamPoints: true,
    pointsAvailable: 10,
  },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** All Team A players, sorted low → high handicap. */
function teamA() {
  return PLAYERS.filter(p => p.team === 'A').sort((a, b) => a.handicap - b.handicap);
}

/** All Team B players, sorted low → high handicap. */
function teamB() {
  return PLAYERS.filter(p => p.team === 'B').sort((a, b) => a.handicap - b.handicap);
}

/**
 * After the draft, call rankMatchedPairs() to generate the 5 match play pairings.
 * Paste the output into the matches arrays in R3 and R5.
 * e.g.  console.log(JSON.stringify(rankMatchedPairs(), null, 2))
 */
function rankMatchedPairs() {
  const a = teamA();
  const b = teamB();
  return a.map((player, i) => ({ home: player.id, away: b[i]?.id || 'TBD' }));
}

/** Look up a player by phone number (normalise to E.164). */
function playerByPhone(phone) {
  const norm = phone.replace(/\s+/g, '').replace(/^00/, '+');
  return PLAYERS.find(p => p.phone === norm) || null;
}

/** Look up a player by ID. */
function playerById(id) {
  return PLAYERS.find(p => p.id === id) || null;
}

/** Return the active round (env override → most recent by date). */
function activeRound() {
  if (process.env.ACTIVE_ROUND) {
    return ROUNDS.find(r => r.id === process.env.ACTIVE_ROUND) || ROUNDS[0];
  }
  const today = new Date().toISOString().slice(0, 10);
  const past = ROUNDS.filter(r => r.date <= today);
  return past.length ? past[past.length - 1] : ROUNDS[0];
}

/**
 * Player IDs expected to report scores for a given round.
 * Scramble: one reporter per group (first listed player).
 * All other formats: all 10 players.
 */
function expectedPlayers(round) {
  if (round.format === 'scramble') {
    return round.groups.map(g => g[0]);
  }
  return PLAYERS.map(p => p.id);
}

/**
 * Net score for a player on a single hole.
 * Uses simple "1 stroke on holes ranked ≤ handicap" allocation.
 * Swap in a STROKE_INDEX array here if you have the course's official index.
 */
function netScore(playerId, grossScore, holeIndex) {
  const player = playerById(playerId);
  if (!player) return grossScore;
  const strokes = player.handicap >= (holeIndex + 1) ? 1 : 0;
  return grossScore - strokes;
}

module.exports = {
  PLAYERS,
  PAR_BY_HOLE,
  COURSE_PAR,
  ROUNDS,
  teamA,
  teamB,
  rankMatchedPairs,
  playerByPhone,
  playerById,
  activeRound,
  expectedPlayers,
  netScore,
};
