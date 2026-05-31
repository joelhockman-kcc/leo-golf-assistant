// scoring.js — Format-specific scoring logic for all 5 rounds
const { PAR_BY_HOLE, PLAYERS, playerById, netScore } = require('./rounds');

// ─── STABLEFORD POINTS ───────────────────────────────────────────────────────

/**
 * Calculate Stableford points for one player on one hole.
 * Uses the bumped table from rounds.js (birdie=4, eagle=6).
 */
function stablefordPoints(grossScore, holeIndex, playerId, table) {
  const par = PAR_BY_HOLE[holeIndex];
  const net = netScore(playerId, grossScore, holeIndex);
  const diff = net - par;
  if (diff <= -2) return table.eagle_or_better;
  if (diff === -1) return table.birdie;
  if (diff === 0)  return table.par;
  if (diff === 1)  return table.bogey;
  return table.double_or_worse;
}

// ─── MATCH PLAY STATUS ───────────────────────────────────────────────────────

/**
 * Given hole-by-hole gross scores for two players in a match play round,
 * return the current match status.
 *
 * scores: { [playerId]: [gross scores completed so far, 0-indexed] }
 * Returns: { leader: playerId | 'AS', margin: number, holesPlayed: number,
 *            holesRemaining: number, status: string e.g. '2UP', 'AS', 'CLOSED' }
 */
function matchPlayStatus(homeId, awayId, scores) {
  const homeScores = scores[homeId] || [];
  const awayScores = scores[awayId] || [];
  const holesPlayed = Math.min(homeScores.length, awayScores.length);

  let homeWins = 0;
  let awayWins = 0;

  for (let i = 0; i < holesPlayed; i++) {
    const homeNet = netScore(homeId, homeScores[i], i);
    const awayNet = netScore(awayId, awayScores[i], i);
    if (homeNet < awayNet) homeWins++;
    else if (awayNet < homeNet) awayWins++;
  }

  const holesRemaining = 18 - holesPlayed;
  const margin = Math.abs(homeWins - awayWins);
  const leader = homeWins > awayWins ? homeId
               : awayWins > homeWins ? awayId
               : 'AS';

  // Check if match is mathematically closed (margin > holes remaining)
  const closed = margin > holesRemaining;

  let statusStr;
  if (leader === 'AS') {
    statusStr = holesPlayed === 18 ? 'Halved' : 'All Square';
  } else {
    const leaderName = playerById(leader)?.name || leader;
    if (closed) {
      statusStr = `${leaderName} wins ${margin}&${holesRemaining}`;
    } else if (holesPlayed === 18) {
      statusStr = `${leaderName} wins ${margin} UP`;
    } else {
      statusStr = `${leaderName} ${margin} UP`;
    }
  }

  return { leader, margin, holesPlayed, holesRemaining, statusStr, closed };
}

// ─── TEAM STANDINGS FOR A ROUND ──────────────────────────────────────────────

/**
 * Master function: given a round config and all hole scores logged so far,
 * return the current team standings for that round.
 *
 * holeScores format: { [playerId]: [grossScore_h1, grossScore_h2, ...] }
 *   - For scramble: keyed by the reporting player ID, one score per group.
 *
 * Returns: {
 *   format,
 *   teamA: { points, detail },
 *   teamB: { points, detail },
 *   players: [ { id, name, team, holesPlayed, runningTotal, detail } ],
 *   matches: [ { homeId, awayId, status } ],   // match play only
 *   holesCompleted: number,                     // holes where ALL players reported
 * }
 */
function computeStandings(round, holeScores) {
  const { format } = round;

  switch (format) {
    case 'scramble':     return scrambleStandings(round, holeScores);
    case 'net_stroke':   return netStrokeStandings(round, holeScores);
    case 'stableford':   return stablefordStandings(round, holeScores);
    case 'match_play':   return matchPlayStandings(round, holeScores);
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

// ── Scramble ─────────────────────────────────────────────────────────────────
function scrambleStandings(round, holeScores) {
  // Each group has one shared score. Reporter is groups[n][0].
  const groupResults = round.groups.map((group, i) => {
    const reporterId = group[0];
    const scores = holeScores[reporterId] || [];
    const gross = scores.reduce((a, b) => a + b, 0);
    const parSoFar = scores.map((_, idx) => PAR_BY_HOLE[idx]).reduce((a, b) => a + b, 0);
    const vspar = gross - parSoFar;
    return {
      group,
      holesPlayed: scores.length,
      gross,
      vspar,
      label: group.join('/'),
    };
  });

  // No team points for R1 — just rank groups by gross
  const ranked = [...groupResults].sort((a, b) => a.gross - b.gross);

  return {
    format: 'scramble',
    teamA: null,
    teamB: null,
    groups: ranked,
    holesCompleted: Math.min(...groupResults.map(g => g.holesPlayed)),
  };
}

// ── Net Stroke ────────────────────────────────────────────────────────────────
function netStrokeStandings(round, holeScores) {
  const playerRows = PLAYERS.map(p => {
    const scores = holeScores[p.id] || [];
    let netTotal = 0;
    scores.forEach((gross, idx) => { netTotal += netScore(p.id, gross, idx); });
    return { ...p, holesPlayed: scores.length, netTotal };
  });

  const teamA = playerRows.filter(p => p.team === 'A');
  const teamB = playerRows.filter(p => p.team === 'B');
  const sumA = teamA.reduce((a, p) => a + p.netTotal, 0);
  const sumB = teamB.reduce((a, p) => a + p.netTotal, 0);

  // Low total wins — leading team has lower sum
  const aLeading = sumA < sumB;
  const margin = Math.abs(sumA - sumB);

  return {
    format: 'net_stroke',
    teamA: { netTotal: sumA, players: teamA },
    teamB: { netTotal: sumB, players: teamB },
    leader: aLeading ? 'A' : sumB < sumA ? 'B' : 'TIE',
    margin,
    holesCompleted: minHolesAllPlayers(holeScores),
  };
}

// ── Stableford ────────────────────────────────────────────────────────────────
function stablefordStandings(round, holeScores) {
  const table = round.stablefordTable;
  const playerRows = PLAYERS.map(p => {
    const scores = holeScores[p.id] || [];
    let stablefordTotal = 0;
    scores.forEach((gross, idx) => {
      stablefordTotal += stablefordPoints(gross, idx, p.id, table);
    });
    return { ...p, holesPlayed: scores.length, stablefordTotal };
  });

  const teamA = playerRows.filter(p => p.team === 'A');
  const teamB = playerRows.filter(p => p.team === 'B');
  const sumA = teamA.reduce((a, p) => a + p.stablefordTotal, 0);
  const sumB = teamB.reduce((a, p) => a + p.stablefordTotal, 0);

  return {
    format: 'stableford',
    teamA: { stablefordTotal: sumA, players: teamA },
    teamB: { stablefordTotal: sumB, players: teamB },
    leader: sumA > sumB ? 'A' : sumB > sumA ? 'B' : 'TIE',
    margin: Math.abs(sumA - sumB),
    holesCompleted: minHolesAllPlayers(holeScores),
  };
}

// ── Match Play ────────────────────────────────────────────────────────────────
function matchPlayStandings(round, holeScores) {
  const matchResults = round.matches.map(({ home, away }) => {
    const status = matchPlayStatus(home, away, holeScores);
    return { homeId: home, awayId: away, ...status };
  });

  // Team points: 2 per win, 1 per halve
  let teamAPoints = 0;
  let teamBPoints = 0;
  matchResults.forEach(m => {
    if (!m.closed && m.holesPlayed < 18) return; // still in progress
    if (m.leader === 'AS') {
      teamAPoints += 1;
      teamBPoints += 1;
    } else {
      const winnerTeam = playerById(m.leader)?.team;
      if (winnerTeam === 'A') teamAPoints += 2;
      else teamBPoints += 2;
    }
  });

  return {
    format: 'match_play',
    teamA: { matchPoints: teamAPoints },
    teamB: { matchPoints: teamBPoints },
    leader: teamAPoints > teamBPoints ? 'A' : teamBPoints > teamAPoints ? 'B' : 'TIE',
    matches: matchResults,
    holesCompleted: minHolesAllPlayers(holeScores),
  };
}

// ─── CUMULATIVE TEAM POINTS ───────────────────────────────────────────────────

/**
 * Total team points across all completed rounds.
 * standingsMap: { [roundId]: computeStandings() result }
 * roundConfigs: ROUNDS array
 */
function cumulativePoints(roundConfigs, standingsMap) {
  let teamATotal = 0;
  let teamBTotal = 0;

  roundConfigs.forEach(round => {
    if (!round.teamPoints) return;
    const s = standingsMap[round.id];
    if (!s) return;

    if (round.format === 'net_stroke' || round.format === 'stableford') {
      if (s.leader === 'A') teamATotal += round.pointsAvailable;
      else if (s.leader === 'B') teamBTotal += round.pointsAvailable;
      else { teamATotal += round.pointsAvailable / 2; teamBTotal += round.pointsAvailable / 2; }
    } else if (round.format === 'match_play') {
      teamATotal += s.teamA.matchPoints || 0;
      teamBTotal += s.teamB.matchPoints || 0;
    }
  });

  const maxRemaining = roundConfigs
    .filter(r => r.teamPoints && !standingsMap[r.id])
    .reduce((a, r) => a + r.pointsAvailable, 0);

  return {
    teamA: teamATotal,
    teamB: teamBTotal,
    leader: teamATotal > teamBTotal ? 'A' : teamBTotal > teamATotal ? 'B' : 'TIE',
    margin: Math.abs(teamATotal - teamBTotal),
    maxRemaining,
  };
}

// ─── HELPER ───────────────────────────────────────────────────────────────────
function minHolesAllPlayers(holeScores) {
  if (!Object.keys(holeScores).length) return 0;
  return Math.min(...PLAYERS.map(p => (holeScores[p.id] || []).length));
}

module.exports = {
  computeStandings,
  cumulativePoints,
  stablefordPoints,
  matchPlayStatus,
};
