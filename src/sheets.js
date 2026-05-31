// sheets.js — Google Sheets read/write for hole-by-hole scoring
// Sheet structure:
//   Tab "Scores":  RoundId | PlayerId | Hole | GrossScore | Timestamp
//   Tab "State":   RoundId | LastBroadcastHole (tracks what's already been broadcast)

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

// ─── LOG A HOLE SCORE ─────────────────────────────────────────────────────────
/**
 * Write one player's score for one hole.
 * playerId: e.g. 'A1'
 * roundId:  e.g. 'R2'
 * hole:     1-indexed integer
 * gross:    gross strokes integer
 */
async function logHoleScore(roundId, playerId, hole, gross) {
  const sheets = await getSheetsClient();
  const timestamp = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Scores!A:E',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[roundId, playerId, hole, gross, timestamp]],
    },
  });
}

// ─── READ ALL SCORES FOR A ROUND ─────────────────────────────────────────────
/**
 * Returns hole scores keyed by player ID.
 * Format: { [playerId]: [grossH1, grossH2, ...] }   (0-indexed array, holes in order)
 * Missing holes are undefined (sparse array) — scoring.js handles this gracefully.
 */
async function getHoleScores(roundId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Scores!A:E',
  });

  const rows = (res.data.values || []).slice(1); // skip header
  const scores = {};

  rows
    .filter(row => row[0] === roundId)
    .forEach(row => {
      const [, playerId, holeStr, grossStr] = row;
      const hole = parseInt(holeStr, 10);  // 1-indexed
      const gross = parseInt(grossStr, 10);
      if (!scores[playerId]) scores[playerId] = [];
      scores[playerId][hole - 1] = gross;  // store 0-indexed
    });

  return scores;
}

// ─── TRACK BROADCAST STATE ────────────────────────────────────────────────────
/**
 * Returns the last hole number (1-indexed) that has already been broadcast
 * for a given round. Returns 0 if nothing broadcast yet.
 */
async function getLastBroadcastHole(roundId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'State!A:B',
  });

  const rows = (res.data.values || []).slice(1);
  const row = rows.find(r => r[0] === roundId);
  return row ? parseInt(row[1], 10) : 0;
}

/**
 * Update the last broadcast hole for a round.
 * If the round row exists it is updated in-place; otherwise a new row is appended.
 */
async function setLastBroadcastHole(roundId, hole) {
  const sheets = await getSheetsClient();

  // Find the row index for this roundId
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'State!A:B',
  });
  const rows = (res.data.values || []);
  const rowIndex = rows.findIndex(r => r[0] === roundId);

  if (rowIndex >= 1) {
    // Update existing row (rowIndex is 0-indexed; sheet rows are 1-indexed, +1 for header)
    const sheetRow = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `State!B${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[hole]] },
    });
  } else {
    // Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'State!A:B',
      valueInputOption: 'RAW',
      requestBody: { values: [[roundId, hole]] },
    });
  }
}

// ─── CUMULATIVE ROUND RESULTS ─────────────────────────────────────────────────
/**
 * Read the completed-round results summary used for cumulative points.
 * Returns { [roundId]: { teamAPoints, teamBPoints } }
 * Tab "Results": RoundId | TeamAPoints | TeamBPoints
 */
async function getRoundResults() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Results!A:C',
  });
  const rows = (res.data.values || []).slice(1);
  const results = {};
  rows.forEach(([roundId, aPoints, bPoints]) => {
    results[roundId] = {
      teamAPoints: parseFloat(aPoints) || 0,
      teamBPoints: parseFloat(bPoints) || 0,
    };
  });
  return results;
}

/**
 * Write (or overwrite) the final team points for a completed round.
 */
async function saveRoundResult(roundId, teamAPoints, teamBPoints) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Results!A:C',
  });
  const rows = (res.data.values || []);
  const rowIndex = rows.findIndex(r => r[0] === roundId);

  if (rowIndex >= 1) {
    const sheetRow = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Results!B${sheetRow}:C${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[teamAPoints, teamBPoints]] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Results!A:C',
      valueInputOption: 'RAW',
      requestBody: { values: [[roundId, teamAPoints, teamBPoints]] },
    });
  }
}

module.exports = {
  logHoleScore,
  getHoleScores,
  getLastBroadcastHole,
  setLastBroadcastHole,
  getRoundResults,
  saveRoundResult,
};
