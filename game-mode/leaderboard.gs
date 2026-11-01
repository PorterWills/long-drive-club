// Long Drive Club golf leaderboard: paste into the LDC Google Sheet (Extensions → Apps Script) and deploy as a web app.
// It only ever touches its own tab, created on first use. Emails are stored but never sent back to the game.
// Hidden column: tick it to take a row off the board. Rows that look too good arrive already ticked, for you to check.
const TAB = 'Golf scores';
const HEAD = ['Date', 'Name', 'Score', 'To par', 'Email', 'Holes', 'Hidden'];
const PARS = [4, 5, 4, 3, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 5, 3, 4, 4];
const PAR = PARS.reduce((a, b) => a + b, 0);
const REVIEW_BELOW = -12;    // rounds better than this (e.g. -13) go on hidden until you untick them
const PER_EMAIL_PER_DAY = 5; // submissions allowed per email address in 24 hours
const BOARD_SECONDS = 60;    // the board is cached this long, so a rush never touches the Sheet
// lowercase, no spaces; checked inside the name after removing spaces, dots and number-for-letter swaps. Add your own.
const BLOCK = ['fuck', 'shit', 'cunt', 'wank', 'twat', 'bollock', 'prick', 'dick', 'cock', 'pussy', 'bitch', 'bastard',
  'slag', 'whore', 'nazi', 'hitler', 'rape', 'nonce', 'penis', 'vagina', 'anal', 'porn', 'sex'];

function tab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TAB);
  if (!sh) { sh = ss.insertSheet(TAB); sh.appendRow(HEAD); sh.setFrozenRows(1); }
  if (sh.getRange(1, 7).getValue() !== 'Hidden') sh.getRange(1, 7).setValue('Hidden'); // older tab: add the column
  return sh;
}
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const cache_ = () => CacheService.getScriptCache();
const rude_ = name => {
  const s = name.toLowerCase().replace(/[0@4]/g, m => ({ 0: 'o', '@': 'a', 4: 'a' })[m]).replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e').replace(/5|\$/g, 's').replace(/7/g, 't').replace(/[^a-z]/g, '');
  return BLOCK.some(w => s.includes(w));
};

// the game posts { name, email, holes: [18 scores] }; the score and to-par are worked out here, not trusted from the page
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  const name = String(d.name || '').replace(/[<>=+@]/g, '').trim().slice(0, 24); // no formulas or markup into the sheet
  const email = String(d.email || '').trim().toLowerCase().slice(0, 120);
  const holes = d.holes;
  if (!name) return json_({ ok: false, error: 'name needed' });
  if (rude_(name)) return json_({ ok: false, error: 'pick another name' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json_({ ok: false, error: 'email looks wrong' });
  // per hole: an ace on a par 3, an albatross (2) on a par 5, nothing below 2 on a par 4; 15 is the most
  if (!Array.isArray(holes) || holes.length !== 18 ||
      !holes.every((n, i) => Number.isInteger(n) && n <= 15 && n >= (PARS[i] === 3 ? 1 : 2))) return json_({ ok: false, error: 'scores look wrong' });
  const score = holes.reduce((a, b) => a + b, 0), toPar = score - PAR;

  // limits: per email per day, and the same name and score twice in 10 minutes is a double tap
  const c = cache_(), ek = email && 'e:' + email, dk = 'd:' + name.toLowerCase() + ':' + score;
  if (c.get(dk)) return json_({ ok: false, error: 'already handed in' });
  const used = ek ? Number(c.get(ek) || 0) : 0;
  if (used >= PER_EMAIL_PER_DAY) return json_({ ok: false, error: 'that email has handed in enough cards today' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy, try again in a moment' });
  try { tab_().appendRow([new Date(), name, score, toPar, email, holes.join(' '), toPar < REVIEW_BELOW]); }
  finally { lock.releaseLock(); }
  if (ek) c.put(ek, String(used + 1), 21600); // Google's cache keeps things 6 hours at most, so "a day" is really 6 hours
  c.put(dk, '1', 600);
  c.remove('board'); // the next load shows the new card
  return json_({ ok: true, score, toPar });
}

// the best 50 rounds, lowest first (ties: earliest first); no emails, no hidden rows. Cached for BOARD_SECONDS.
function doGet() {
  const c = cache_(), hit = c.get('board');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const rows = tab_().getDataRange().getValues().slice(1).filter(r => r[1] && r[2] && r[6] !== true);
  rows.sort((a, b) => a[2] - b[2] || new Date(a[0]) - new Date(b[0]));
  const out = JSON.stringify({ ok: true, rows: rows.slice(0, 50).map(r =>
    ({ date: new Date(r[0]).toISOString().slice(0, 10), name: r[1], score: r[2], toPar: r[3] })) });
  c.put('board', out, BOARD_SECONDS);
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

// run this once from the editor after ticking or unticking Hidden, if you want the board to update straight away
function refreshBoard() { cache_().remove('board'); }
