# 2026 Family Vacation Golf Tracker — Setup Guide

## Files in this repo

```
src/
  index.js      — Express webhook, SMS router, broadcast trigger
  rounds.js     — PLAYERS, PAR_BY_HOLE, round configs, pairings
  scoring.js    — Per-format scoring logic (scramble, net stroke, Stableford, match play)
  sheets.js     — Google Sheets read/write
  broadcast.js  — Assembles and sends SMS to all 10 players
package.json
```

---

## Before the trip — two things to fill in

### 1. Players + handicaps → `src/rounds.js`

Replace the TBD entries in the `PLAYERS` array:
```js
{ id: 'A1', name: 'Mike', team: 'A', handicap: 8, phone: '+12145550001' },
```
- `id`: A1–A5 (lowest → highest hcp on Team A), B1–B5 for Team B
- `phone`: E.164 format (+1XXXXXXXXXX)
- `handicap`: course handicap index (used for net stroke and match play)

### 2. Course pars → `src/rounds.js`

Replace `PAR_BY_HOLE` with the actual scorecard:
```js
const PAR_BY_HOLE = [4,3,5,4,4,3,4,5,4, 4,3,5,4,3,4,5,4,4];
//                   1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18
```

### 3. Pairings (optional refinement)

The `groups` arrays in each round use placeholder pairings. Replace them with
the optimised pairings from the 2026 Family Vacation PDF once confirmed.

---

## Google Sheets setup

Create a new Google Sheet with **four tabs**:

| Tab name | Columns |
|----------|---------|
| `Scores` | RoundId · PlayerId · Hole · GrossScore · Timestamp |
| `State`  | RoundId · LastBroadcastHole |
| `Results`| RoundId · TeamAPoints · TeamBPoints |
| `Players`| (optional reference — app uses rounds.js, not this tab) |

Add a header row to each tab. Share the sheet with your Google Service Account email (Editor access).

---

## Environment variables (Railway)

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
ANTHROPIC_API_KEY=sk-ant-...           # reserved for future Claude features
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
SPREADSHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
PUBLIC_URL=https://your-app.railway.app
```

**Never commit these to GitHub.** Set them in Railway's Variables tab.

---

## Twilio setup

1. Buy a toll-free number (+1-8XX-XXX-XXXX)
2. Set the SMS webhook URL to: `https://your-app.railway.app/sms`  (HTTP POST)
3. Submit toll-free verification (use case: "private group notifications, golf scoring app")
4. Have each player text **JOIN** to the number to opt in (Twilio compliance)

---

## How scoring works

### Texting in a score
Players text: `H7 4`  (hole 7, score 4)
Also accepted: `7 4`

The app replies immediately:
> ✓ Mike H7: 4 (par)

### Broadcast trigger
After **all 10 players** have reported hole N, the app sends a broadcast SMS to everyone.

### Broadcast format
```
⛳ Round 3 — Match Play
After hole 9 · 9 to go
─────────────────
Team A leads — Team A: 4 pts · Team B: 2 pts

Match results:
  Mike vs Dave: Mike 2 UP
  Chris vs Tom: All Square
  ...
─────────────────
OVERALL STANDINGS
Team A leads 9–6 pts
(10 pts still to play)
```

### Formats by round
| Round | Date | Format | Points |
|-------|------|--------|--------|
| R1 | Jun 11 PM | 2-person scramble | Standalone ($200 pot) |
| R2 | Jun 12 AM | Net stroke | 3 pts to winning team |
| R3 | Jun 12 PM | Match play (5×1v1) | 10 pts (2/win, 1/halve) |
| R4 | Jun 13 AM | Stableford | 3 pts to winning team |
| R5 | Jun 13 PM | Match play (5×1v1) | 10 pts |

**Total points available: 26**

### Stableford points table
| Score | Points |
|-------|--------|
| Eagle or better | 6 |
| Birdie | 4 |
| Par | 2 |
| Bogey | 1 |
| Double bogey+ | 0 |

---

## Admin SMS commands

Send from any registered phone to the Twilio number:

| Command | Action |
|---------|--------|
| `SCORES` | Get current round standings |
| `ROUND` | Show active round info |
| `SETROUND R3` | Force-set the active round |
| `BROADCAST <msg>` | Send a message to all 10 players |

---

## Railway deploy

1. Push this repo to GitHub
2. Create a new Railway project → connect the GitHub repo
3. Add all env vars in Railway's Variables tab
4. Railway auto-deploys on every push
5. Copy the Railway URL → paste into Twilio webhook field

---

## Handicap stroke allocation

Currently uses a simple "1 stroke on holes ranked ≤ handicap" approximation.
To use the course's official stroke index, add a `STROKE_INDEX` array to `rounds.js`:
```js
const STROKE_INDEX = [1, 15, 7, 11, 3, 17, 5, 13, 9, 2, 16, 8, 12, 4, 18, 6, 14, 10];
```
Then update `netScore()` in `rounds.js` to allocate strokes by stroke index rank.
