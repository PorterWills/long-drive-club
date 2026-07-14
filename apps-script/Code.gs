/* Long Drive Club — application backend.
 *
 * Receives entry-form submissions from longdriveclub.com and keeps each one in
 * a Google Sheet. The form is a two-step flow, so submissions arrive in stages:
 *
 *   stage "step1"  -> email, the car and the handicap. Upserts the lead (keyed
 *                     on email) at status "step1_complete" and mints a recovery
 *                     token. A real, contactable lead even if step two never
 *                     arrives.
 *   stage "step2"  -> name, phone, the golf and the day. Merges into the same row,
 *                     marks it "complete", and sends the "received" email.
 *   (no stage)     -> a whole-form submission, kept for backwards compatibility.
 *
 * A lead left at "step1_complete" past a delay gets a recovery email (see
 * sendRecoveryEmails); reaching "complete" cancels it. The recovery email links
 * back to /?recover=TOKEN, and the site reads the step-one data back through the
 * doGet "recover" endpoint so the applicant lands in step two with no re-entry.
 *
 * It also reacts to the owner editing the sheet: typing a word in the
 * "status" column triggers the matching email:
 *   approved  -> unique car-based password + "You're in" email
 *   paid      -> "Place confirmed" email
 *   declined  -> "Not this time" email
 *   waitlist  -> "Not yet" email; nudges pause until the row is approved
 * And an hourly timer nudges approved-but-unpaid applicants at 4h / 24h / 48h.
 *
 * Set the three values in Script Properties (File ▸ Project Settings ▸
 * Script Properties), NOT inline — that keeps the Resend key out of the code:
 *   SHEET_ID         the spreadsheet id (from its URL)
 *   RESEND_API_KEY   your Resend API key (starts re_...)
 *   FROM             the from line, e.g.  Long Drive Club <hello@longdriveclub.com>
 *
 * One-time setup after pasting: run setupColumns, installApprovalTrigger,
 * installNudgeTrigger, and installRecoveryTrigger once each. Re-deploy (Deploy
 * ▸ Manage deployments) after editing doGet/doPost.
 */

var SHEET_TAB = 'Applications';

// Where the recovery email's "Finish the sheet" link points.
var SITE_URL = 'https://longdriveclub.com';

// Recovery email timing, in hours from the step-one submit. First nudge, then a
// second and final one if the lead is still partial.
var RECOVERY_DELAY_1_HOURS = 1;
var RECOVERY_DELAY_2_HOURS = 72;

// Where the unsubscribe link in the email points. A mailto keeps it dependency-free.
var UNSUBSCRIBE_URL = 'mailto:hello@longdriveclub.com?subject=Unsubscribe';

// A recovery link found after this long is treated as expired: the recover
// endpoint stops returning the lead's data (name/email/phone/car) for it.
// Comfortably past RECOVERY_DELAY_2_HOURS so the legitimate nudge emails
// always still work; just stops a stale or leaked link from prefilling PII
// indefinitely.
var RECOVERY_TOKEN_MAX_AGE_DAYS = 30;

// Column order written to fresh sheets. Existing sheets keep their order; any
// columns below that they're missing get appended (see ensureColumns). All
// reads and writes go through the header map, never fixed indexes, so order
// never matters at runtime. The block after nudge3_at is new for the two-step
// flow and will be appended to the live sheet on the right.
var COLUMNS = ['timestamp', 'name', 'email', 'phone', 'work', 'car', 'play', 'party', 'days', 'consent',
               'status', 'password', 'approved_at', 'paid_at', 'declined_at', 'waitlisted_at',
               'nudge1_at', 'nudge2_at', 'nudge3_at',
               'make', 'model', 'handicap', 'base', 'city',
               'token', 'step1_at', 'completed_at', 'recovery_sent',
               'terms_accepted_at', 'terms_version', 'marketing_optin'];

// The actual submission logic, shared by both entry points below. Returns a
// plain {ok:true} / {ok:false, error} object rather than writing the
// response itself, since doPost answers via plain JSON and doGet's ?submit=
// path (see doGet) answers as JSONP.
function handleSubmission(data) {
  // Honeypot: "company" is a hidden field real applicants never see or fill.
  // A bot that fills every field trips it. Report success but write nothing,
  // so the bot has no signal the field is a trap.
  if (data.hp) return { ok: true };

  // Per-email throttle. Apps Script doesn't expose the caller's IP, so this
  // is the best available key. Generous enough that a real applicant retrying
  // a failed submit never hits it; tight enough to blunt a script hammering
  // the endpoint directly (it's a public URL, reachable without the site).
  var rlEmail = String(data.email || '').trim().toLowerCase();
  if (rlEmail && !rateLimitOk('rl_post_' + rlEmail, 8, 3600)) {
    return { ok: false, error: 'rate_limited' };
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // serialise the read-then-write upsert
  } catch (lockErr) {
    return { ok: false, error: 'busy' };
  }
  try {
    var stage = String(data.stage || '').toLowerCase();
    if (stage === 'step1') {
      upsertStep1(data);
    } else if (stage === 'step2') {
      mergeStep2(data);
    } else {
      saveFullSubmission(data); // legacy single-submit
    }
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

// Legacy entry point for form submissions (kept so an old cached copy of the
// site keeps working), plus the calendar sync: a POST whose JSON body carries
// igsync writes the IG Calendar tab — see igSyncAction. Sync is a POST (not
// JSONP) because it's called by a script, not a browser page, and the payload
// is bigger than a query string should carry.
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    return jsonOut({ ok: false, error: 'bad request' });
  }
  if (data && data.igsync) return jsonOut(igSyncAction(data));
  return jsonOut(handleSubmission(data));
}

// Handles eight things, all JSONP (a <script src> the site loads, whose
// response calls back into the page) since Apps Script can't send CORS
// headers a normal fetch could read:
//  - ?submit=JSON&callback=YYY  a step1/step2 application submission. The
//    current site uses this (not doPost) so it can see a real ok/error back
//    rather than assuming success.
//  - ?accept=JSON&callback=YYY  the welcome page's terms-acceptance record,
//    written the moment a ticked member presses the pay button — see
//    recordAcceptance.
//  - ?recover=TOKEN&callback=YYY  the site asking for the step-one data behind
//    a recovery token, so it can prefill step two.
//  - ?password=XXX&callback=YYY  the gate asking if a password is valid; a
//    match also returns the applicant's name/make/model for the welcome
//    page's masthead.
//  - ?dashboard=PASSWORD&callback=YYY  the dashboard's data feed.
//  - ?action=JSON&callback=YYY  the dashboard's Approve / Decline / Mark paid
//    buttons — see dashboardAction.
//  - ?ig=PASSWORD&callback=YYY  the dashboard's Instagram + content calendar
//    feed — see igPayload. Same password as ?dashboard.
//  - ?meta=1&callback=YYY  public, non-sensitive display settings.
//  - no params: a plain liveness check, handy in a browser.
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.submit) {
    var data;
    try {
      data = JSON.parse(params.submit);
    } catch (parseErr) {
      return jsonpOrJson({ ok: false, error: 'bad request' }, params.callback);
    }
    return jsonpOrJson(handleSubmission(data), params.callback);
  }
  if (params.accept) {
    var acceptData;
    try {
      acceptData = JSON.parse(params.accept);
    } catch (parseErr) {
      return jsonpOrJson({ ok: false, error: 'bad request' }, params.callback);
    }
    return jsonpOrJson(recordAcceptance(acceptData), params.callback);
  }
  if (params.recover) {
    var lead = leadByToken(params.recover);
    var payload = { ok: false };
    if (lead && !recoveryTokenExpired(lead)) {
      payload = { ok: true, name: lead.name, email: lead.email, phone: lead.phone,
                  make: lead.make, model: lead.model, car: lead.car };
    }
    return jsonpOrJson(payload, params.callback);
  }
  if (params.password) {
    return jsonpOrJson(gateCheck(params.password), params.callback);
  }
  if (params.dashboard) {
    return jsonpOrJson(dashboardPayload(params.dashboard), params.callback);
  }
  if (params.action) {
    var actionData;
    try {
      actionData = JSON.parse(params.action);
    } catch (parseErr) {
      return jsonpOrJson({ ok: false, error: 'bad request' }, params.callback);
    }
    return jsonpOrJson(dashboardAction(actionData), params.callback);
  }
  if (params.ig) {
    return jsonpOrJson(igPayload(params.ig), params.callback);
  }
  if (params.meta) {
    return jsonpOrJson(publicMeta(), params.callback);
  }
  return jsonOut({ ok: true, service: 'ldc-applications' });
}

/* ---- Dashboard feed -----------------------------------------------------
   The private signup dashboard (dashboard.html on the site) reads the whole
   applications table through here, behind a short allow-list of passwords
   held in Script Properties (DASHBOARD_PASSWORD) — NOT in the static page, so
   the applicant PII never ships in the public file. The property holds one or
   more passwords separated by commas (e.g. "ABC123, DEF456"), so each viewer
   can keep their own; the check is case-insensitive. A wrong or missing
   password returns { ok:false } and no rows. Only the columns in
   DASHBOARD_FIELDS are exposed: the recovery token and the generated gate
   password stay private. */

var DASHBOARD_FIELDS = ['timestamp', 'name', 'email', 'phone', 'work', 'car',
  'play', 'party', 'days', 'consent', 'status', 'approved_at', 'paid_at',
  'declined_at', 'waitlisted_at', 'nudge1_at', 'nudge2_at', 'nudge3_at', 'make', 'model',
  'handicap', 'base', 'city', 'step1_at', 'completed_at', 'recovery_sent'];

// A simple settings tab (key in column A, value in column B) the owners can
// edit by hand — follower count, event name, etc. — so those don't live in
// code. Created and pre-filled automatically the first time it's read.
var SETTINGS_TAB = 'Dashboard';

// Shared by the dashboard data feed and the approve/decline/paid action
// endpoint below — same password, same 15-wrong-guesses-per-10-minutes
// lockout either way, since both expose or change applicant data.
function dashboardPasswordValid(guess) {
  var raw = PropertiesService.getScriptProperties().getProperty('DASHBOARD_PASSWORD');
  if (!raw) return false;
  var g = String(guess || '').trim().toUpperCase();
  if (!g) return false;
  if (!rateLimitPeek('dash_guess', 15)) return false;
  var allowed = raw.split(/[,\s]+/).map(function (p) { return p.trim().toUpperCase(); })
                   .filter(function (p) { return p; });
  if (allowed.indexOf(g) >= 0) return true;
  rateLimitBump('dash_guess', 600);
  return false;
}

function dashboardPayload(guess) {
  if (!dashboardPasswordValid(guess)) return { ok: false };

  var sheet = getSheet();
  var headers = headerMap(sheet);
  var last = sheet.getLastRow();
  var rows = [];
  if (last >= 2) {
    var width = sheet.getLastColumn();
    var values = sheet.getRange(2, 1, last - 1, width).getValues();
    for (var i = 0; i < values.length; i++) {
      var raw = values[i];
      var rec = {};
      var any = false;
      DASHBOARD_FIELDS.forEach(function (field) {
        var col = headers[field];
        if (!col) return;
        var v = raw[col - 1];
        if (v instanceof Date) v = v.toISOString();
        rec[field] = v;
        if (v !== '' && v != null) any = true;
      });
      if (any) rows.push(rec);
    }
  }
  var settings = {};
  try { settings = readSettings(); } catch (e) { settings = {}; }
  return { ok: true, updatedAt: new Date().toISOString(), rows: rows, settings: settings };
}

// Reads the Dashboard settings tab into a { key: value } map (keys lower-cased).
// Creates the tab, pre-filled with sensible defaults, the first time it's
// missing — so the owners get an editable tab in their sheet without any setup.
function readSettings() {
  var ss = SpreadsheetApp.openById(props_('SHEET_ID'));
  var sheet = ss.getSheetByName(SETTINGS_TAB);
  if (!sheet) sheet = seedSettingsTab(ss);
  if (!sheet) return {};
  var last = sheet.getLastRow();
  if (last < 1) return {};
  var vals = sheet.getRange(1, 1, last, 2).getValues();
  var out = {};
  for (var i = 0; i < vals.length; i++) {
    var k = String(vals[i][0] || '').trim().toLowerCase();
    if (!k || k === 'setting' || k === 'key') continue; // skip a header row
    out[k] = vals[i][1];
  }
  return out;
}

// Public, non-sensitive display settings — safe to serve without a password
// and with no applicant data. The members page reads drive day (event_date)
// from here so the date lives in one place (the sheet) for both pages; the
// welcome masthead reads event_date and places_target for its metadata line.
function publicMeta() {
  var s = {};
  try { s = readSettings(); } catch (e) { s = {}; }
  return {
    ok: true,
    event_name: s.event_name || '',
    event_date: s.event_date || '',
    places_target: s.places_target || ''
  };
}

function seedSettingsTab(ss) {
  var sheet;
  try {
    sheet = ss.insertSheet(SETTINGS_TAB);
  } catch (e) {
    return ss.getSheetByName(SETTINGS_TAB); // lost a race; use the existing one
  }
  sheet.getRange(1, 1, 1, 2).setValues([['setting', 'value']]).setFontWeight('bold');
  sheet.getRange(2, 1, 7, 2).setValues([
    ['event_name', 'THE FIRST DRIVE'],
    ['event_date', '2026-08-20 07:00'],
    ['places_target', 20],
    ['ig_show', 'yes'],
    ['ig_followers', 21],
    ['ig_change', ''],
    ['ig_reach', '']
  ]);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 2);
  return sheet;
}

function jsonpOrJson(obj, callback) {
  var body = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + body + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

/* ---- Writing the lead -------------------------------------------------- */

// Step one: create or update the lead, keyed on email. Never downgrades a row
// that's already further along (e.g. complete/approved); just refreshes the
// contact details and the car.
function upsertStep1(data) {
  var sheet = getSheet();
  var headers = headerMap(sheet);
  var email = String(data.email || '').trim();
  if (!email) throw new Error('step1 without an email');

  var row = findRowByEmail(sheet, headers, email);
  // Name and phone are collected in step two now, so step one never carries them.
  // The handicap moved up into step one, so it lands with the lead.
  var fields = {
    email: email,
    make: data.make || '',
    model: data.model || '',
    car: data.car || '',
    handicap: data.handicap || ''
  };

  if (row) {
    var status = String(readCell(sheet, row, headers, 'status') || '').toLowerCase();
    if (!status || status === 'step1_complete') {
      fields.status = 'step1_complete';
    }
    if (!readCell(sheet, row, headers, 'token')) fields.token = Utilities.getUuid();
    if (!readCell(sheet, row, headers, 'step1_at')) fields.step1_at = new Date();
    writeFields(sheet, row, headers, fields);
  } else {
    fields.timestamp = new Date();
    fields.status = 'step1_complete';
    fields.token = Utilities.getUuid();
    fields.step1_at = new Date();
    fields.recovery_sent = '';
    writeFields(sheet, newRow(sheet), headers, fields);
  }
  // No email at step one — the recovery email is the only step-one message.
}

// Step two: merge the golf/day fields into the lead, mark it complete, cancel
// the recovery email (status != step1_complete means the sweep skips it), and
// send the "application received" confirmation.
function mergeStep2(data) {
  var sheet = getSheet();
  var headers = headerMap(sheet);
  var email = String(data.email || '').trim();

  var row = (data.token && findRowByToken(sheet, headers, data.token)) ||
            (email && findRowByEmail(sheet, headers, email)) || null;

  var fields = {
    name: data.name || '',
    phone: data.phone || '',
    work: data.work || '',
    base: data.base || '',
    city: data.baseCity || '',
    play: data.play || '',
    party: data.party || '',
    days: Array.isArray(data.days) ? data.days.join(', ') : (data.days || ''),
    consent: data.consent ? 'yes' : 'no',
    status: 'complete',
    completed_at: new Date()
  };

  if (row) {
    writeFields(sheet, row, headers, fields);
    email = String(readCell(sheet, row, headers, 'email') || email).trim();
  } else {
    // No step-one row to merge into (rare). Keep the data rather than drop it.
    fields.timestamp = new Date();
    fields.email = email;
    writeFields(sheet, newRow(sheet), headers, fields);
  }

  if (email) sendApplicationReceived({ email: email });
}

// Legacy whole-form submission (kept so an older cached page still works).
function saveFullSubmission(data) {
  var sheet = getSheet();
  var headers = headerMap(sheet);
  var email = String(data.email || '').trim();
  var fields = {
    timestamp: new Date(),
    name: data.name || '',
    email: email,
    phone: data.phone || '',
    make: data.make || '',
    model: data.model || '',
    car: data.car || '',
    work: data.work || '',
    handicap: data.handicap || '',
    play: data.play || '',
    party: data.party || '',
    base: data.base || '',
    city: data.baseCity || '',
    days: Array.isArray(data.days) ? data.days.join(', ') : (data.days || ''),
    consent: data.consent ? 'yes' : 'no',
    status: 'complete',
    completed_at: new Date()
  };
  writeFields(sheet, newRow(sheet), headers, fields);
  if (email) sendApplicationReceived({ email: email });
}

/* ---- Sheet helpers ----------------------------------------------------- */

function getSheet() {
  var id = props_('SHEET_ID');
  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheetByName(SHEET_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TAB);
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
  }
  ensureColumns(sheet);
  return sheet;
}

// Run this once by hand (select setupColumns ▸ Run) to add any new columns to
// an existing sheet without touching the rows.
function setupColumns() {
  ensureColumns(getSheet());
}

// Adds any COLUMNS that aren't already in the header row, on the end. Leaves
// existing columns and their order untouched.
function ensureColumns(sheet) {
  var have = headerMap(sheet);
  var missing = COLUMNS.filter(function (c) { return !have[c]; });
  if (missing.length) {
    var start = sheet.getLastColumn() + 1;
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
    sheet.setFrozenRows(1);
  }
}

// Maps lower-cased header name -> 1-based column number.
function headerMap(sheet) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var row = sheet.getRange(1, 1, 1, width).getValues()[0];
  var map = {};
  row.forEach(function (name, i) {
    if (name) map[String(name).trim().toLowerCase()] = i + 1;
  });
  return map;
}

// The 1-based index of the next empty row (writing a cell there extends the sheet).
function newRow(sheet) {
  return sheet.getLastRow() + 1;
}

// Writes only the provided fields, each into its named column. Unknown headers
// are skipped silently.
function writeFields(sheet, row, headers, obj) {
  Object.keys(obj).forEach(function (key) {
    var col = headers[key];
    if (col) sheet.getRange(row, col).setValue(obj[key]);
  });
}

function readCell(sheet, row, headers, name) {
  var col = headers[name];
  return col ? sheet.getRange(row, col).getValue() : '';
}

function findRowByEmail(sheet, headers, email) {
  return findRowByColumn(sheet, headers, 'email', email, true);
}

function findRowByToken(sheet, headers, token) {
  return findRowByColumn(sheet, headers, 'token', token, false);
}

// Returns the 1-based row whose column matches, or null. Scans bottom-up so the
// most recent match wins. Case-insensitive when asked (emails).
function findRowByColumn(sheet, headers, name, value, ci) {
  var col = headers[name];
  var needle = String(value || '').trim();
  if (!col || !needle) return null;
  if (ci) needle = needle.toLowerCase();
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var values = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var cell = String(values[i][0]).trim();
    if (ci) cell = cell.toLowerCase();
    if (cell && cell === needle) return i + 2;
  }
  return null;
}

// True once a lead's step1_at is older than RECOVERY_TOKEN_MAX_AGE_DAYS, or if
// step1_at is missing/unreadable (fail closed rather than treat it as fresh).
function recoveryTokenExpired(lead) {
  var startedAt = lead.step1_at;
  var started = (startedAt instanceof Date) ? startedAt.getTime() : NaN;
  if (isNaN(started)) return true;
  var ageDays = (Date.now() - started) / 86400000;
  return ageDays > RECOVERY_TOKEN_MAX_AGE_DAYS;
}

// Reads a whole lead row into an object keyed by header name.
function leadByToken(token) {
  var sheet = getSheet();
  var headers = headerMap(sheet);
  var row = findRowByToken(sheet, headers, token);
  if (!row) return null;
  var lead = {};
  Object.keys(headers).forEach(function (name) {
    lead[name] = sheet.getRange(row, headers[name]).getValue();
  });
  return lead;
}

/* ---- Recovery email ----------------------------------------------------
   Time-driven sweep. For every lead still at step1_complete, sends the first
   nudge once it's older than RECOVERY_DELAY_1_HOURS and the second once it's
   older than RECOVERY_DELAY_2_HOURS. recovery_sent ('', '1', '2') makes each
   fire exactly once; a lead that has reached "complete" is skipped entirely.
   (Separate from the approval nudges below: those act on approved-but-unpaid
   rows, this acts on step1_complete rows — the two never overlap.) */

// Run once by hand to schedule the sweep.
function installRecoveryTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendRecoveryEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendRecoveryEmails').timeBased().everyMinutes(30).create();
}

function sendRecoveryEmails() {
  var sheet = getSheet();
  var headers = headerMap(sheet);
  var last = sheet.getLastRow();
  if (last < 2) return;
  var now = new Date().getTime();

  for (var row = 2; row <= last; row++) {
    var status = String(readCell(sheet, row, headers, 'status') || '').toLowerCase();
    if (status !== 'step1_complete') continue;

    var token = String(readCell(sheet, row, headers, 'token') || '');
    var email = String(readCell(sheet, row, headers, 'email') || '').trim();
    if (!token || !email) continue;

    var startedAt = readCell(sheet, row, headers, 'step1_at');
    var started = (startedAt instanceof Date) ? startedAt.getTime() : NaN;
    if (isNaN(started)) continue;
    var ageHours = (now - started) / 3600000;

    var sent = String(readCell(sheet, row, headers, 'recovery_sent') || '');

    if (sent === '' && ageHours >= RECOVERY_DELAY_1_HOURS) {
      sendRecoveryEmail(email, token);
      writeFields(sheet, row, headers, { recovery_sent: '1' });
    } else if (sent === '1' && ageHours >= RECOVERY_DELAY_2_HOURS) {
      sendRecoveryEmail(email, token);
      writeFields(sheet, row, headers, { recovery_sent: '2' });
    }
  }
}

function sendRecoveryEmail(email, token) {
  var finishUrl = SITE_URL + '/?recover=' + encodeURIComponent(token) + '#apply';
  var html = renderEmail('email_recovery', {
    finish_url: finishUrl,
    unsubscribe_url: UNSUBSCRIBE_URL
  });
  sendViaResend({
    to: email,
    subject: "The car's down. The sheet isn't finished.",
    html: html
  });
}

/* ---- Gate -------------------------------------------------------------- */

// True/false the guess matches a generated password in the sheet, plus —
// when it matches — the applicant's name and car. A password only exists
// once a row is approved, so a match means an approved applicant. The gate
// is the only place a visitor's identity is established, so this doubles as
// the welcome page masthead's personalisation source (see welcome.js).
// Case-insensitive, so "bmw6291" works as well as "BMW6291".
function gateCheck(guess) {
  var g = String(guess || '').trim().toUpperCase();
  if (!g) return { ok: false };
  // 30 wrong guesses per 10 minutes, shared across all guessers — Apps Script
  // can't key this per caller, but it's enough to make brute-forcing the
  // ~10,000-combination generated passwords impractical. Only wrong guesses
  // count against the budget, so a wave of real applicants unlocking the
  // gate correctly can never lock each other out.
  if (!rateLimitPeek('gate_guess', 30)) return { ok: false };
  var sheet = getSheet();
  var headers = headerMap(sheet);
  var col = headers['password'];
  if (!col) return { ok: false };
  var last = sheet.getLastRow();
  if (last < 2) { rateLimitBump('gate_guess', 600); return { ok: false }; }
  var width = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, last - 1, width).getValues();
  for (var i = 0; i < values.length; i++) {
    var stored = String(values[i][col - 1]).trim().toUpperCase();
    if (stored && stored === g) {
      return {
        ok: true,
        name: headers['name'] ? String(values[i][headers['name'] - 1] || '').trim() : '',
        make: headers['make'] ? String(values[i][headers['make'] - 1] || '').trim() : '',
        model: headers['model'] ? String(values[i][headers['model'] - 1] || '').trim() : '',
        // The welcome page hands this on to the terms-acceptance log (see
        // recordAcceptance), which keys on it to stamp the applicant's row.
        email: headers['email'] ? String(values[i][headers['email'] - 1] || '').trim() : ''
      };
    }
  }
  rateLimitBump('gate_guess', 600);
  return { ok: false };
}

/* ---- Terms acceptance -------------------------------------------------
   The clickwrap evidence trail. When a member ticks the terms box and
   presses the pay button, the welcome page sends the full record here:
   when, on what page, which version of the Terms, the exact checkbox and
   button wording rendered at the time, and the marketing choice.

   Two writes, deliberately:
   1. An append-only row on the 'Terms acceptances' tab. Rows there are
      never edited afterwards, so a re-acceptance adds a row instead of
      overwriting history — that tab is the evidence.
   2. Convenience columns stamped on the applicant's row in Applications
      (terms_accepted_at / terms_version / marketing_optin), so acceptance
      is visible where the rest of their record lives.
   The endpoint is public like ?submit= is, so it carries the same style of
   per-caller throttle. A missing email still logs (write the evidence,
   flag the gap) but can't stamp an applicant row. */

var ACCEPT_TAB = 'Terms acceptances';
var ACCEPT_COLUMNS = ['accepted_at', 'email', 'name', 'terms_version', 'page',
                      'checkbox_text', 'button_text', 'notice_text',
                      'marketing_optin', 'marketing_text'];

function recordAcceptance(data) {
  var email = String(data.email || '').trim();
  if (!rateLimitOk('rl_accept_' + (email || 'anon').toLowerCase(), 10, 3600)) {
    return { ok: false, error: 'rate_limited' };
  }

  var clip = function (v) { return String(v || '').trim().slice(0, 2000); };
  var record = {
    accepted_at: new Date(),
    email: email,
    name: clip(data.name),
    terms_version: clip(data.terms_version),
    page: clip(data.page),
    checkbox_text: clip(data.checkbox_text),
    button_text: clip(data.button_text),
    notice_text: clip(data.notice_text),
    marketing_optin: data.marketing_optin ? 'yes' : 'no',
    marketing_text: clip(data.marketing_text)
  };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (lockErr) {
    return { ok: false, error: 'busy' };
  }
  try {
    getAcceptanceSheet().appendRow(ACCEPT_COLUMNS.map(function (c) { return record[c]; }));

    var matched = false;
    if (email) {
      var sheet = getSheet();
      var headers = headerMap(sheet);
      var row = findRowByEmail(sheet, headers, email);
      if (row) {
        writeFields(sheet, row, headers, {
          terms_accepted_at: record.accepted_at,
          terms_version: record.terms_version,
          marketing_optin: record.marketing_optin
        });
        matched = true;
      }
    }
    return { ok: true, matched: matched };
  } catch (err) {
    console.error(err);
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

function getAcceptanceSheet() {
  var ss = SpreadsheetApp.openById(props_('SHEET_ID'));
  var sheet = ss.getSheetByName(ACCEPT_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(ACCEPT_TAB);
    sheet.appendRow(ACCEPT_COLUMNS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* ---- Approval flow ----------------------------------------------------- */

// Run this ONCE by hand (select installApprovalTrigger ▸ Run) to wire the
// on-edit trigger. This project is standalone (not bound to the sheet), so
// the Triggers UI doesn't offer "From spreadsheet" — we create it in code
// instead. Safe to re-run: it clears old copies first.
function installApprovalTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onApprovalEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onApprovalEdit')
    .forSpreadsheet(SpreadsheetApp.openById(props_('SHEET_ID')))
    .onEdit()
    .create();
}

// Installable "On edit" trigger. Fires whenever the sheet is edited; we only
// act when the edited cell is the status column. (Programmatic status writes —
// step1_complete / complete — don't fire this, so they never send an email.)
function onApprovalEdit(e) {
  var range = e.range;
  var sheet = range.getSheet();
  if (sheet.getName() !== SHEET_TAB) return;
  if (range.getRow() === 1) return; // header

  var headers = headerMap(sheet);
  var statusCol = headers['status'];
  if (!statusCol || range.getColumn() !== statusCol) return;

  var value = String(e.value || '').trim().toLowerCase();
  var row = range.getRow();

  if (value === 'approved') {
    handleApproved(sheet, row, headers);
  } else if (value === 'paid') {
    handlePaid(sheet, row, headers);
  } else if (value === 'declined') {
    handleDeclined(sheet, row, headers);
  } else if (value === 'waitlist' || value === 'waitlisted') {
    handleWaitlisted(sheet, row, headers);
  }
}

function handleApproved(sheet, row, headers) {
  writeFields(sheet, row, headers, { status: 'approved' });

  var approvedCell = sheet.getRange(row, headers['approved_at']);
  if (approvedCell.getValue()) return; // already sent

  var email = String(sheet.getRange(row, headers['email']).getValue()).trim();
  if (!email) return;

  var car = sheet.getRange(row, headers['car']).getValue();
  var password = makePassword(car);
  sheet.getRange(row, headers['password']).setValue(password);

  var html = renderEmail('email_application_approved', {
    password: password,
    unsubscribe_url: UNSUBSCRIBE_URL
  });
  sendViaResend({ to: email, subject: "You're in", html: html });

  approvedCell.setValue(new Date());
}

function handlePaid(sheet, row, headers) {
  writeFields(sheet, row, headers, { status: 'paid' });

  var cell = sheet.getRange(row, headers['paid_at']);
  if (cell.getValue()) return; // already sent

  var email = String(sheet.getRange(row, headers['email']).getValue()).trim();
  if (!email) return;

  var html = renderEmail('email_place_confirmed', { unsubscribe_url: UNSUBSCRIBE_URL });
  sendViaResend({ to: email, subject: "That's you confirmed", html: html });

  cell.setValue(new Date());
}

function handleDeclined(sheet, row, headers) {
  writeFields(sheet, row, headers, { status: 'declined' });

  var cell = sheet.getRange(row, headers['declined_at']);
  if (cell.getValue()) return; // already sent

  var email = String(sheet.getRange(row, headers['email']).getValue()).trim();
  if (!email) return;

  var html = renderEmail('email_declined', { unsubscribe_url: UNSUBSCRIBE_URL });
  sendViaResend({ to: email, subject: 'Not this time', html: html });

  cell.setValue(new Date());
}

// Waitlist: the "not yet" state. Writes the status word explicitly so the
// dashboard action path (which edits no cell by hand) still leaves the row
// reading "waitlist"; promotion is the normal approve flow, which restores
// the status word above.
function handleWaitlisted(sheet, row, headers) {
  writeFields(sheet, row, headers, { status: 'waitlist' });

  var cell = sheet.getRange(row, headers['waitlisted_at']);
  if (cell.getValue()) return; // already sent

  var email = String(sheet.getRange(row, headers['email']).getValue()).trim();
  if (!email) return;

  var html = renderEmail('email_waitlisted', { unsubscribe_url: UNSUBSCRIBE_URL });
  sendViaResend({ to: email, subject: 'Not yet', html: html });

  cell.setValue(new Date());
}

/* ---- Dashboard actions --------------------------------------------------
   Approve / Decline / Mark paid / Waitlist, triggered from a button on the
   dashboard instead of by hand-editing the status column. Reuses the exact
   same handler functions the sheet-edit trigger
   calls, so the result — email sent, timestamp stamped — is identical either
   way, and each stays idempotent (a repeat call, e.g. a double-click, is a
   no-op because the timestamp cell is already set). */
function dashboardAction(payload) {
  if (!dashboardPasswordValid(payload.password)) return { ok: false, error: 'denied' };

  var email = String(payload.email || '').trim();
  var action = String(payload.action || '').trim().toLowerCase();
  if (!email || ['approve', 'decline', 'paid', 'waitlist'].indexOf(action) < 0) {
    return { ok: false, error: 'bad request' };
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (lockErr) {
    return { ok: false, error: 'busy' };
  }
  try {
    var sheet = getSheet();
    var headers = headerMap(sheet);
    var row = findRowByEmail(sheet, headers, email);
    if (!row) return { ok: false, error: 'not_found' };

    if (action === 'approve') handleApproved(sheet, row, headers);
    else if (action === 'decline') handleDeclined(sheet, row, headers);
    else if (action === 'paid') handlePaid(sheet, row, headers);
    else if (action === 'waitlist') handleWaitlisted(sheet, row, headers);

    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

/* ---- Instagram tracker + content calendar -------------------------------
   The dashboard's Instagram and Calendar tabs read three sheet tabs through
   here, behind the same DASHBOARD_PASSWORD gate as the applicant feed:

     IG Post Log   one row per published post, raw numbers from IG insights.
                   Derived metrics (engagement, rates) are computed by the
                   dashboard, so the owners only ever log what IG shows them.
     IG Weekly     one row each Sunday: follower count + 7-day account stats.
     IG Calendar   the content plan, one row per planned post — format, theme,
                   feeling, the asset to produce, the confirm gate and the
                   final copy. The dashboard's calendar view renders this.

   Each tab is created and seeded on first read (same pattern as the
   Dashboard settings tab): the log gets the account's real history to date,
   the calendar gets the 4-week plan. After that the sheet is the source of
   truth — edit rows there, the dashboard follows. */

var IG_POSTS_TAB = 'IG Post Log';
var IG_WEEKLY_TAB = 'IG Weekly';
var IG_CALENDAR_TAB = 'IG Calendar';

/* Posting windows. Held here as config, not sheet schema: the dashboard
   reads them from the feed and the reminder emails quote them. If a per-post
   override is ever needed, add a "Post window" column to IG Calendar (and
   IG_CALENDAR_HEADER, and the sync script's KNOWN_KEYS as post_window) —
   the dashboard already checks a row's post_window before falling back to
   these. Format "HH:MM-HH:MM". The window is a hypothesis under test, which
   is what the Posted time column in the Post Log is for. */
var IG_TZ = 'Europe/London';
var IG_WINDOW_WEEKDAY = '07:00-08:00';
var IG_WINDOW_WEEKEND = '08:00-09:00';

function igWindowFor(d) {
  var dow = Utilities.formatDate(d, IG_TZ, 'u'); // 1 = Monday .. 7 = Sunday
  return (dow === '6' || dow === '7') ? IG_WINDOW_WEEKEND : IG_WINDOW_WEEKDAY;
}

function igPayload(guess) {
  if (!dashboardPasswordValid(guess)) return { ok: false };
  var ss = SpreadsheetApp.openById(props_('SHEET_ID'));
  igEnsurePostedTime(ss);
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    windows: { weekday: IG_WINDOW_WEEKDAY, weekend: IG_WINDOW_WEEKEND, tz: IG_TZ },
    posts: igTabObjects(ss, IG_POSTS_TAB, IG_POSTS_HEADER, IG_POSTS_SEED),
    weekly: igTabObjects(ss, IG_WEEKLY_TAB, IG_WEEKLY_HEADER, IG_WEEKLY_SEED),
    calendar: igTabObjects(ss, IG_CALENDAR_TAB, IG_CALENDAR_HEADER, IG_CALENDAR_SEED)
  };
}

// Columns added to the Post Log after launch (Posted time tests the window,
// Reposts is the strongest share signal IG surfaces). Existing sheets get
// missing ones appended on the next read; fresh sheets seed with them.
function igEnsurePostedTime(ss) {
  var sheet = ss.getSheetByName(IG_POSTS_TAB);
  if (!sheet) return;
  ['Posted time', 'Reposts'].forEach(function (name) {
    var width = Math.max(sheet.getLastColumn(), 1);
    var head = sheet.getRange(1, 1, 1, width).getValues()[0].map(igSlug);
    if (head.indexOf(igSlug(name)) < 0) {
      sheet.getRange(1, width + 1).setValue(name).setFontWeight('bold');
    }
  });
}

// Reads a whole tab into [{key: value}] keyed on slugged headers
// ("Profile visits" -> profile_visits). Creates + seeds the tab when missing.
function igTabObjects(ss, tabName, header, seed) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) sheet = igSeedTab(ss, tabName, header, seed);
  if (!sheet) return [];
  var last = sheet.getLastRow();
  var width = sheet.getLastColumn();
  if (last < 2 || width < 1) return [];
  var head = sheet.getRange(1, 1, 1, width).getValues()[0].map(igSlug);
  var values = sheet.getRange(2, 1, last - 1, width).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var rec = {};
    var any = false;
    for (var c = 0; c < width; c++) {
      if (!head[c]) continue;
      var v = values[i][c];
      if (v instanceof Date) v = v.toISOString();
      rec[head[c]] = v;
      if (v !== '' && v != null) any = true;
    }
    if (any) rows.push(rec);
  }
  return rows;
}

function igSlug(name) {
  return String(name || '').trim().toLowerCase()
    .replace(/\(s\)/g, '_s').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function igSeedTab(ss, tabName, header, seed) {
  var sheet;
  try {
    sheet = ss.insertSheet(tabName);
  } catch (e) {
    return ss.getSheetByName(tabName); // lost a race; use the existing one
  }
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (seed.length) {
    // Seed rows may be narrower than the header (columns added later);
    // right-pad with blanks so setValues gets a uniform grid.
    var padded = seed.map(function (r) {
      var row = r.slice();
      while (row.length < header.length) row.push('');
      return row;
    });
    sheet.getRange(2, 1, padded.length, header.length).setValues(padded);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

/* ---- Posting reminders ---------------------------------------------------
   A dashboard has to be opened; an email arrives on its own. Two time-driven
   sweeps, both in the project timezone (set it to Europe/London in Project
   Settings or these fire an hour off):

     ~18:00  evening preview — tomorrow's post(s): theme, window, caption and
             asset brief, so scheduling the evening before is the default.
     ~06:45  post-day nudge — only if today's row is not already Posted,
             Logged, Scheduled or Skipped.

   Run installIgReminderTriggers once by hand to schedule both. Recipient is
   the IG_REMINDER_EMAIL Script Property, falling back to the script owner.
   Set Script Property IG_REMINDERS to "off" to silence both without
   uninstalling. Sent with MailApp (the owner's Gmail quota, no API key). */

function installIgReminderTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'sendIgEveningPreview' || fn === 'sendIgMorningNudge') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendIgEveningPreview').timeBased().everyDays(1).atHour(18).create();
  ScriptApp.newTrigger('sendIgMorningNudge').timeBased().everyDays(1).atHour(6).nearMinute(45).create();
}

function igRemindersOn() {
  var flag = PropertiesService.getScriptProperties().getProperty('IG_REMINDERS');
  return String(flag || 'on').toLowerCase() !== 'off';
}

function igReminderRecipient() {
  var to = PropertiesService.getScriptProperties().getProperty('IG_REMINDER_EMAIL');
  if (to) return to;
  try { return Session.getEffectiveUser().getEmail(); } catch (e) { return ''; }
}

// All IG Calendar rows whose date is the given yyyy-MM-dd key.
function igCalendarRowsFor(dateKey) {
  var ss = SpreadsheetApp.openById(props_('SHEET_ID'));
  var sheet = ss.getSheetByName(IG_CALENDAR_TAB);
  if (!sheet) return [];
  var last = sheet.getLastRow();
  var width = sheet.getLastColumn();
  if (last < 2) return [];
  var head = sheet.getRange(1, 1, 1, width).getValues()[0].map(igSlug);
  var vals = sheet.getRange(2, 1, last - 1, width).getValues();
  var out = [];
  vals.forEach(function (raw) {
    var rec = {};
    head.forEach(function (h, i) { if (h) rec[h] = raw[i]; });
    if (igDateKey(rec.date) === dateKey) out.push(rec);
  });
  return out;
}

function igReminderBody(rec, d) {
  var window = String(rec.post_window || '').trim() || igWindowFor(d);
  return [
    Utilities.formatDate(d, IG_TZ, 'EEEE d MMMM') + ' · window ' + window.replace('-', ' to '),
    '',
    'Theme: ' + (rec.theme || '') + ' (' + (rec.format || '') + ')',
    rec.peg_milestone ? 'Peg: ' + rec.peg_milestone : null,
    rec.feeling ? 'Feeling: ' + rec.feeling : null,
    '',
    'Asset: ' + (rec.asset_to_produce || ''),
    '',
    rec.final_copy ? 'Caption:\n' + rec.final_copy : 'Caption first line: ' + (rec.caption_first_line || '') +
      '\n(No final copy yet. Draft through ldc-copywriter.)',
    rec.confirm_before_posting ? '\nConfirm before posting: ' + rec.confirm_before_posting : null,
    '',
    'Dashboard: https://longdriveclub.com/dashboard.html'
  ].filter(function (line) { return line !== null; }).join('\n');
}

function sendIgEveningPreview() {
  if (!igRemindersOn()) return;
  var to = igReminderRecipient();
  if (!to) return;
  var d = new Date(Date.now() + 86400000);
  var rows = igCalendarRowsFor(Utilities.formatDate(d, IG_TZ, 'yyyy-MM-dd'));
  rows.forEach(function (rec) {
    MailApp.sendEmail(to,
      'Tomorrow on LDC Instagram: ' + (rec.theme || 'scheduled post'),
      'Schedule it in IG tonight.\n\n' + igReminderBody(rec, d));
  });
}

function sendIgMorningNudge() {
  if (!igRemindersOn()) return;
  var to = igReminderRecipient();
  if (!to) return;
  var d = new Date();
  var rows = igCalendarRowsFor(Utilities.formatDate(d, IG_TZ, 'yyyy-MM-dd'));
  rows.forEach(function (rec) {
    var s = String(rec.status || '').toLowerCase();
    if (s === 'posted' || s === 'logged' || s === 'scheduled' || s === 'skipped') return;
    var window = (String(rec.post_window || '').trim() || igWindowFor(d)).replace('-', ' to ');
    MailApp.sendEmail(to,
      'Post day. Window ' + window,
      'Today\'s post is not marked Scheduled or Posted.\n\n' + igReminderBody(rec, d));
  });
}

/* ---- Calendar sync -------------------------------------------------------
   The content calendar's source of truth is a markdown file on the founders'
   machine, maintained by Claude Cowork, which keeps a machine-readable JSON
   block of the schedule at the file's foot. tools/sync-ig-calendar.py posts
   that block here after every edit and this replaces the IG Calendar rows.

   Guard rails: enabled only when the IG_SYNC_SECRET Script Property is set
   (generate a long random value), the secret must match, and the write is
   capped and confined to the IG Calendar tab. The Status column is OWNED BY
   THE SHEET: a row that survives a sync (matched on date, or on theme for
   dateless held rows) keeps the status the owners set in the sheet, so
   flipping a post to Posted is never undone by the next strategy edit. */

function igSyncAction(data) {
  var secret = PropertiesService.getScriptProperties().getProperty('IG_SYNC_SECRET');
  if (!secret) return { ok: false, error: 'sync disabled: set IG_SYNC_SECRET' };
  if (!rateLimitOk('igsync', 30, 3600)) return { ok: false, error: 'rate_limited' };
  if (String(data.secret || '') !== secret) return { ok: false, error: 'denied' };
  var rows = data.rows;
  var log = data.log;
  var hasRows = Array.isArray(rows) && rows.length > 0;
  var hasLog = Array.isArray(log) && log.length > 0;
  if ((!hasRows && !hasLog) || (hasRows && rows.length > 200) || (hasLog && log.length > 200)) {
    return { ok: false, error: 'bad request: send rows (calendar) and/or log (post log), max 200 each' };
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (lockErr) {
    return { ok: false, error: 'busy' };
  }
  try {
    var ss = SpreadsheetApp.openById(props_('SHEET_ID'));
    var logResult = null;
    if (hasLog) {
      logResult = igLogUpsert(ss, log);
      if (logResult.error) return { ok: false, error: logResult.error };
    }
    if (!hasRows) {
      return { ok: true, logAdded: logResult.added, logUpdated: logResult.updated };
    }
    var sheet = ss.getSheetByName(IG_CALENDAR_TAB);
    if (!sheet) sheet = igSeedTab(ss, IG_CALENDAR_TAB, IG_CALENDAR_HEADER, []);

    // Existing statuses, keyed the same way incoming rows will be.
    var statusByKey = {};
    var last = sheet.getLastRow();
    var width = sheet.getLastColumn();
    if (last >= 2) {
      var head = sheet.getRange(1, 1, 1, width).getValues()[0].map(igSlug);
      var vals = sheet.getRange(2, 1, last - 1, width).getValues();
      vals.forEach(function (raw) {
        var rec = {};
        head.forEach(function (h, i) { if (h) rec[h] = raw[i]; });
        var key = igRowKey(rec);
        if (key && rec.status) statusByKey[key] = String(rec.status);
      });
    }

    // Incoming rows: accept keys as sheet headers or slugs, write in header
    // order, preserve the sheet's status for matched rows. All or nothing:
    // any row that doesn't look like a calendar row rejects the whole sync
    // before a single cell is written.
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        return { ok: false, error: 'row ' + (i + 1) + ' is not an object' };
      }
      var rec = {};
      Object.keys(r).forEach(function (k) {
        var v = r[k];
        rec[igSlug(k)] = (v == null || typeof v === 'object') ? '' : String(v);
      });
      var dateRaw = String(rec.date || '').trim();
      if (dateRaw && dateRaw.toLowerCase() !== '(none)' && !igDateKey(dateRaw)) {
        return { ok: false, error: 'row ' + (i + 1) + ': date "' + dateRaw + '" is not dd/mm/yyyy, yyyy-mm-dd or empty' };
      }
      if (!String(rec.format || '').trim() || !String(rec.theme || '').trim()) {
        return { ok: false, error: 'row ' + (i + 1) + ' is missing format or theme' };
      }
      var kept = statusByKey[igRowKey(rec)];
      out.push(IG_CALENDAR_HEADER.map(function (h) {
        var slug = igSlug(h);
        var v = (slug === 'status' && kept) ? kept : rec[slug];
        return v == null ? '' : String(v).slice(0, 5000);
      }));
    }

    if (last >= 2) sheet.getRange(2, 1, last - 1, width).clearContent();
    sheet.getRange(2, 1, out.length, IG_CALENDAR_HEADER.length).setValues(out);
    var res = { ok: true, rows: out.length, statusesKept: Object.keys(statusByKey).length };
    if (logResult) { res.logAdded = logResult.added; res.logUpdated = logResult.updated; }
    return res;
  } catch (err) {
    console.error(err);
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

/* Post Log rows arriving through the sync (Michael pastes IG insights to
   Cowork, Cowork keeps a log block in the calendar doc, the sync delivers
   it). UPSERT keyed on the post number: known posts get the provided fields
   updated (an empty value never blanks an existing cell), new posts append.
   Nothing is ever deleted — the log is history. */
var IG_LOG_NUMERIC = ['views', 'reach', 'profile_visits', 'link_taps', 'follows',
  'likes', 'comments', 'saves', 'watch_time_s', 'reposts'];

function igLogUpsert(ss, rows) {
  var sheet = ss.getSheetByName(IG_POSTS_TAB);
  if (!sheet) sheet = igSeedTab(ss, IG_POSTS_TAB, IG_POSTS_HEADER, IG_POSTS_SEED);
  igEnsurePostedTime(ss);
  var width = sheet.getLastColumn();
  var head = sheet.getRange(1, 1, 1, width).getValues()[0].map(igSlug);
  var postCol = head.indexOf('post') + 1;
  if (!postCol) return { error: 'the Post Log has no Post column' };

  var last = sheet.getLastRow();
  var byNum = {};
  if (last >= 2) {
    sheet.getRange(2, postCol, last - 1, 1).getValues().forEach(function (v, i) {
      var n = Number(v[0]);
      if (n) byNum[n] = i + 2;
    });
  }

  var added = 0, updated = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: 'log row ' + (i + 1) + ' is not an object' };
    var rec = {};
    Object.keys(r).forEach(function (k) {
      var v = r[k];
      rec[igSlug(k)] = (v == null) ? '' : String(v);
    });
    var num = Number(rec.post);
    if (!num || num !== Math.floor(num)) return { error: 'log row ' + (i + 1) + ' needs a whole post number' };
    if (rec.date && !igDateKey(rec.date)) return { error: 'log row ' + (i + 1) + ': date "' + rec.date + '" is not dd/mm/yyyy or yyyy-mm-dd' };
    for (var n = 0; n < IG_LOG_NUMERIC.length; n++) {
      var key = IG_LOG_NUMERIC[n];
      if (rec[key] != null && rec[key] !== '' && isNaN(Number(rec[key]))) {
        return { error: 'log row ' + (i + 1) + ': ' + key + ' "' + rec[key] + '" is not a number' };
      }
    }
    var rowIndex = byNum[num];
    if (rowIndex) {
      Object.keys(rec).forEach(function (k) {
        var col = head.indexOf(k) + 1;
        if (col && k !== 'post' && rec[k] !== '') sheet.getRange(rowIndex, col).setValue(rec[k]);
      });
      updated++;
    } else {
      var newRowVals = head.map(function (h) { return (h && rec[h] != null) ? rec[h] : ''; });
      newRowVals[postCol - 1] = num;
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, width).setValues([newRowVals]);
      byNum[num] = sheet.getLastRow();
      added++;
    }
  }
  return { added: added, updated: updated };
}

// A row's identity across syncs: its date, or its theme when dateless (held
// milestone posts). Dates arrive as Date objects from the sheet but as
// dd/mm/yyyy or yyyy-mm-dd strings from the markdown block — normalise all
// three in the script's own timezone so July 13 is July 13 on both sides.
function igRowKey(rec) {
  var d = igDateKey(rec.date);
  if (d) return 'd:' + d;
  var theme = String(rec.theme || '').trim().toLowerCase();
  return theme ? 't:' + theme : '';
}

function igDateKey(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v || '').trim();
  if (!s || s.toLowerCase() === '(none)') return '';
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // dd/mm/yyyy
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); // yyyy-mm-dd
  if (m) return s;
  return '';
}

/* The account's real history to 12/07/2026, from the social tracker.
   Raw numbers only — the dashboard derives engagement and the rates. */
var IG_POSTS_HEADER = ['Post', 'Date', 'Format', 'Content type', 'Car / subject', 'CTA',
  'Feeling', 'Views', 'Reach', 'Profile visits', 'Link taps', 'Follows',
  'Likes', 'Comments', 'Saves', 'Watch time (s)', 'Posted time', 'Reposts'];
var IG_POSTS_SEED = [
  [1,  '2026-06-15', 'Image',    'Car on course',           'Ferrari 360',             'Soft',                    'Longing',      24,  9,   3,  '', 0, 2, 2, '', ''],
  [2,  '2026-06-15', 'Image',    'Car on course',           'Porsche 911',             'None',                    'Recognition',  24,  9,   0,  '', 0, 1, 0, '', ''],
  [3,  '2026-06-15', 'Image',    'Car on course',           'BMW M2',                  'Application mention',     'Curiosity',    37,  15,  12, 1,  0, 2, 0, '', ''],
  [4,  '2026-06-15', 'Image',    'Car on course',           'Lamborghini Urus',        'None',                    'Vindication',  39,  18,  1,  0,  0, 4, 0, '', ''],
  [5,  '2026-06-15', 'Image',    'Car on course',           'Alpine A110',             'Product mention',         'Recognition',  46,  18,  0,  0,  0, 2, 0, '', ''],
  [6,  '2026-06-15', 'Image',    'Car on course',           'Audi R8',                 'Link in bio',             'None',         35,  14,  1,  0,  0, 2, 0, '', ''],
  [7,  '2026-06-15', 'Image',    'Car on course',           'Porsche 911 (991)',       'Link in bio',             'None',         29,  12,  1,  0,  0, 2, 0, '', ''],
  [8,  '2026-06-15', 'Image',    'Car on course',           'McLaren Senna',           'None',                    'Recognition',  28,  13,  '', 0,  0, 2, 0, '', ''],
  [9,  '2026-06-15', 'Image',    'Car on course',           'Mercedes AMG GT',         'Link in bio',             'Vindication',  32,  16,  '', 0,  0, 2, 0, '', ''],
  [10, '2026-06-15', 'Image',    'Car on course',           'Porsche 911 GTS',         'None',                    'Longing',      44,  19,  2,  0,  0, 3, 0, '', ''],
  [11, '2026-06-15', 'Image',    'Car on course',           'Audi RS6',                'None',                    'Longing',      44,  19,  2,  0,  0, 3, 0, '', ''],
  [12, '2026-06-15', 'Image',    'Aerial drive-by',         'Red coupe',               'Link in bio',             'Awe',          74,  28,  3,  0,  0, 6, 0, '', ''],
  [13, '2026-06-27', 'Image',    'Car on course',           'Bentley Continental',     'Applications open',       'Vindication',  63,  21,  14, 0,  0, 2, 1, '', ''],
  [14, '2026-06-28', 'Image',    'Car on course',           'Lotus Emira',             'None',                    'Recognition',  47,  17,  2,  0,  0, 2, 0, '', ''],
  [15, '2026-06-29', 'Image',    'Aerial drive-by',         'Blue coupe',              'Applications open',       'Awe',          41,  13,  2,  0,  0, 1, 2, '', ''],
  [16, '2026-07-01', 'Image',    'Car on course',           'Aston Martin V8 Vantage', 'None',                    'Longing',      35,  18,  1,  0,  0, 1, 0, '', ''],
  [17, '2026-07-02', 'Image',    'Car on course',           'Audi RS6',                'None',                    'Recognition',  46,  18,  4,  0,  0, 1, 1, '', ''],
  [18, '2026-07-03', 'Image',    'Aerial drive-by',         'McLaren 720S',            'None',                    'Curiosity',    35,  17,  1,  0,  0, 1, 0, 1,  ''],
  [19, '2026-07-04', 'Image',    'Car on course',           'Jaguar F-Type',           'Soft',                    'Recognition',  41,  16,  4,  0,  0, 4, 4, 1,  ''],
  [20, '2026-07-05', 'Image',    'Car on course',           'Audi TT RS',              'None',                    'Longing',      40,  17,  0,  0,  0, 2, 0, 0,  ''],
  [21, '2026-07-06', 'Image',    'Car on course + graphic', 'Lamborghini Aventador',   'None',                    'Curiosity',    52,  19,  13, 1,  0, 1, 2, 0,  ''],
  [22, '2026-07-07', 'Reel',     'Brand slideshow',         'Mixed',                   'Link in bio',             'None',         120, 106, 0,  0,  0, 1, 2, 0,  7],
  [23, '2026-07-08', 'Carousel', 'Car + info graphic',      'BMW M3 E46',              'None',                    'Curiosity',    34,  11,  4,  3,  0, 1, 0, 0,  ''],
  [24, '2026-07-09', 'Carousel', 'Editorial: 9 roads',      'None',                    'Engagement ask',          'Disagreement', 23,  5,   1,  0,  0, 1, 0, 1,  ''],
  [25, '2026-07-10', 'Reel',     'Brand video',             'Mixed',                   'Request a place',         'None',         120, 105, 0,  0,  0, 2, 0, 1,  6.5],
  [26, '2026-07-11', 'Reel',     'Editorial: 7 arrivals',   'None',                    'Link in bio + share ask', 'Disagreement', 113, 105, 3,  0,  0, 1, 0, 1,  2.3],
  [27, '2026-07-12', 'Reel',     'Editorial: Goodwood 9',   'None',                    'Share ask',               'Disagreement', 31,  26,  0,  0,  0, 1, 0, 1,  2.7]
];

/* One row each Sunday, from IG insights. */
var IG_WEEKLY_HEADER = ['Date', 'Followers', 'Reach (7 days)', 'Profile visits (7 days)', 'Link taps (7 days)', 'Notes'];
var IG_WEEKLY_SEED = [
  ['2026-07-04', 23, 728, '', '', 'Baseline'],
  ['2026-07-12', 54, '',  '', '', 'From profile. Reach and visits to fill from IG insights']
];

/* The 4-week plan, 13/07 to 09/08. Final copy is a draft: every caption still
   goes through the ldc-copywriter gates and the Confirm column before it
   posts. An empty Final copy means the calendar says to draft nearer the
   time. Facts that are not yet public (price, venue, dates beyond what the
   site shows) stay out of this file on purpose — hold them in the sheet. */
var IG_CALENDAR_HEADER = ['Date', 'Format', 'Theme', 'Peg / milestone', 'Concept', 'Asset to produce',
  'Feeling', 'The remark', 'Caption first line', 'Final copy', 'Confirm before posting', 'Status'];
var IG_CALENDAR_SEED = [
  ['2026-07-13', 'Reel', 'Announcement', 'Public announcement. PR exclusive same day',
   '3 beat launch reel: the road, the course, the people. Pin to grid through 09/08.',
   'Claude Design vertical video, 20s, strongest existing stills plus the 2 LDC graphics. Overlays: August 2026 / 60 miles, then 18 holes / 20 places. Strongest collision image in the first 2 seconds, never a logo card.',
   'Vindication', 'this exists now',
   'Applications are open for the first drive. August 2026. 60 miles, then 18 holes. 20 places.',
   'Applications are open for the first drive. August 2026. 60 miles, then 18 holes. 20 places.\nA committee reads every application. Link in bio.\n\n#longdriveclub #carsandgolf #golf',
   'Broadcast channel update goes out same day', 'Planned'],
  ['2026-07-15', 'Image', 'Recognition', '',
   'Single car, early light, the morning the member already does alone.',
   'Generate via ChatGPT: single car, dawn light, open boot with clubs visible, empty road or club car park. Style per the prompt examples doc.',
   'Recognition', 'this is you',
   'The alarm is set for 05:45. Clubs in the boot, 60 miles in front of you.',
   'The alarm is set for 05:45. Clubs in the boot, 60 miles in front of you.\nThe drive there is half of it. The round is the other half.\nApplications are open. Link in bio.\n\n#longdriveclub #carsandgolf #golf #drivingclub',
   '', 'Planned'],
  ['2026-07-16', 'Image', 'Arrivals franchise', 'The Open, Royal Birkdale, day 1',
   'Birkdale did not make our 7 arrivals, judged on the road in. Posts on day 1 of the event, never after it.',
   'Curated stock, real place: the actual coastal approach to Birkdale. Same sourcing as the 7 arrivals reel.',
   'Disagreement', 'they left Birkdale out',
   'The Open is at Birkdale this week. Birkdale did not make our 7 arrivals. The road in is why.',
   'The Open is at Birkdale this week. Birkdale did not make our 7 arrivals. The road in is why.\nJudged on the drive in, not the golf. The full 7 are on the grid.\n\n#longdriveclub #carsandgolf #golf',
   '', 'Planned'],
  ['2026-07-18', 'Carousel', 'Utility', '',
   'The order of the day. The proven link tap format (post 23).',
   'Card 1 generated car image, card 2 timings graphic in Claude Design: breakfast, waves, tee block, lunch, the photograph. No clock times unless they match the live site.',
   'Longing', 'look at this day',
   'The order of the day.',
   'The order of the day.\nBreakfast, the drive in waves, the tee block, lunch, the photograph. 60 miles, then 18 holes.\nLink in bio.\n\n#longdriveclub #carsandgolf #golf',
   'Wording against the live site before posting', 'Planned'],
  ['2026-07-20', 'Image', 'Mechanism', 'Close week',
   'The committee and the 20 places. The account\'s best profile visit copy.',
   'Generate via ChatGPT: single car, formal composition, still light.',
   'Curiosity', 'you have to apply. there\'s a committee',
   'A committee reads every application. 20 places.',
   'A committee reads every application. 20 places.\nFirst drive August 2026. 60 miles, then 18 holes. Link in bio.\n\n#longdriveclub #carsandgolf #golf',
   'If Michael confirms the close date is public, lead with it instead. That version converts harder. Do not use it without confirmation.', 'Planned'],
  ['2026-07-21', 'Image', 'Utility', 'Applications close',
   'What the day holds. Plain list, matches the live site\'s included list.',
   'Generate via ChatGPT: breakfast table at first light or a wide course shot, no people\'s faces.',
   'Longing', 'look what\'s in it',
   'The road. Breakfast. 18 holes. Lunch. The photograph.',
   'The road. Breakfast. 18 holes. Lunch. The photograph.\nFirst drive August 2026. 20 places. Link in bio.\n\n#longdriveclub #carsandgolf #golf #drivingclub',
   'The price appears only if it is on the live site', 'Planned'],
  ['2026-07-23', 'Reel', 'Arrivals franchise', 'Senior Open, Gleneagles, day 1',
   'We already ranked the Gleneagles arrival. Cut it down, tie it to the live event.',
   '15s recut of the existing arrivals reel in Claude Design, Gleneagles first. Stock of the real approach, already sourced.',
   'Disagreement', 'they rank courses by the road in',
   'Gleneagles week. We ranked the drive in before the golf. Which arrival beats it? Wrong answers welcome.',
   'Gleneagles week. We ranked the drive in before the golf. Which arrival beats it? Wrong answers welcome.\nThe full 7 arrivals are on the grid.\n\n#longdriveclub #carsandgolf #golf',
   '', 'Planned'],
  ['2026-07-25', 'Image', 'Recognition', 'BRDC Classic, Silverstone',
   'Classic car weekend. Our angle: the classic still driven properly.',
   'Generate via ChatGPT: a classic (E30, 964, Escort era) parked on or beside the course, believably worn, not showroom.',
   'Vindication', 'finally. driven, not stored',
   'A 30 year old classic somebody still drives properly.',
   'A 30 year old classic somebody still drives properly.\nSilverstone has a field of them this weekend. The application does not ask for a year.\n\n#longdriveclub #carsandgolf #golf',
   '', 'Planned'],
  ['2026-07-27', 'Image', 'Mechanism', 'Offers and 48 hour holds go out',
   'Offers out, the 48 hour hold stated as fact.',
   'Generate via ChatGPT: quiet single car, early evening light.',
   'Curiosity', 'it really is 20 places',
   'Offers are out. Held for 48 hours, then the next name on the list.',
   'Offers are out. Held for 48 hours, then the next name on the list.\n20 places. A committee read every application.\n\n#longdriveclub #carsandgolf #golf',
   'Offers actually sent before this posts', 'Planned'],
  ['2026-07-29', 'Carousel', 'Substack repurpose', 'AIG Women\'s Open, Royal Lytham, day 1',
   'Article 007: we pick the field the way you\'d pick a fourball. Selection is happening this exact week.',
   '5 cards in Claude Design: hook card on a generated image, 3 fact cards on how selection works, sign off card.',
   'Vindication', 'this is how clubs should pick people',
   'We pick the field the way you\'d pick a fourball.',
   'We pick the field the way you\'d pick a fourball.\nHow the committee fills 20 places. The full piece is on the Substack. Link in bio.\n\n#longdriveclub #carsandgolf #golf',
   '', 'Planned'],
  ['2026-08-01', 'Image', 'Recognition', '',
   'Aerial image, the account\'s best performing image pattern (post 12). Push the composition further: the whoa image, road and course in 1 frame from above.',
   'Generate via ChatGPT: aerial, road and course in 1 frame, the post 12 and 15 register.',
   'Awe', 'look at this',
   'Draft nearer the time.',
   '',
   'Copy drafts nearer the time through ldc-copywriter. No reuse of June lines.', 'Planned'],
  ['2026-08-04', 'Image', 'Behind the scenes', '',
   'The decal. Until the physical decal exists, the asset is the actual decal artwork presented as a design. Article 009 carries the angle.',
   'The decal artwork on a clean ground, laid out in Claude Design. A real photograph replaces it if founders have the physical decal by this date.',
   'Curiosity', 'you can\'t buy it. you have to be in',
   'You can buy any badge you like. You cannot buy this one.',
   'You can buy any badge you like. You cannot buy this one.\nThe members\' decal, 1 per car. The design is finished, the print is next.\n\n#longdriveclub #carsandgolf #golf #drivingclub',
   'Decal design signed off by founders. Caption must not imply the sticker is printed if it is not.', 'Planned'],
  ['2026-08-06', 'Image', 'Utility', 'Meet point reveals on site',
   'The site reveals the meet point today. The post follows the site, same day.',
   '1 image, road register, no location identifiers beyond what the site states.',
   'Anticipation', 'it\'s actually happening',
   'The meet point is live.',
   'The meet point is live.\nOn the site now. The route follows.\n\n#longdriveclub #carsandgolf #golf',
   'Site reveal fired. Exact point confirmed by founders.', 'Planned'],
  ['2026-08-08', 'Image', 'Live event', 'PistonHeads Annual Service, Bicester Motion',
   'Founders attending. The first day LDC can capture anything real. Stories carry the day live; the grid gets 1 image only if a frame holds up beside the generated grid.',
   'Founder phone photography on the day.',
   'Recognition', 'they were at Bicester',
   'Draft on the day from what is actually there.',
   '',
   'Grid post only if a frame genuinely holds up. Otherwise stories only.', 'Planned'],
  ['2026-08-09', 'Reel', 'Waitlist and Drive Two seed', '',
   'The month in 20 seconds. Strongest images first, watch time is the metric. Seeds the waitlist as the story turns from applications to the drive itself.',
   'Claude Design vertical video, 20s recap from the month\'s published assets.',
   'Anticipation', 'missed it. there\'s a Drive Two',
   'Draft from the month\'s numbers. Nothing unconfirmed.',
   '',
   'Any field, sales or application numbers signed off by founders.', 'Planned']
];

// A unique password with a nod to their car, e.g. "Porsche 911" -> PORSCHE4827.
// Falls back to DRIVER#### when no car was given.
function makePassword(car) {
  var brand = String(car || '').trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!brand) brand = 'DRIVER';
  var digits = String(Math.floor(1000 + Math.random() * 9000));
  return brand + digits;
}

/* ---- Nudges ------------------------------------------------------------ */

// Run this ONCE by hand (select installNudgeTrigger ▸ Run) to wire the hourly
// timer that sends the unpaid nudges. Safe to re-run: clears old copies first.
function installNudgeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendNudges') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendNudges').timeBased().everyHours(1).create();
}

// Runs hourly. For each approved-but-unpaid applicant, sends the nudge for the
// tier their wait has reached (4h / 24h / 48h since approved_at). Stops once
// the row is paid or declined, and pauses while a row sits at "waitlist"
// (approving it again resumes the tiers that haven't sent). Each nudge sends
// once, and only the current
// tier goes out per run, so nobody gets a burst.
function sendNudges() {
  var sheet = getSheet();
  var headers = headerMap(sheet);
  var last = sheet.getLastRow();
  if (last < 2) return;

  var data = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  var now = Date.now();

  var STAMP = ['', 'nudge1_at', 'nudge2_at', 'nudge3_at'];
  var TEMPLATE = ['', 'email_nudge_password_unused', 'email_nudge_password_unused', 'email_nudge_hold_expiry'];
  var SUBJECT = ['', "Your place is still here", "Your place is still here", 'Nearly out of time'];

  for (var i = 0; i < data.length; i++) {
    var rowNum = i + 2;
    var cell = function (name) { return data[i][headers[name] - 1]; };

    var approvedAt = cell('approved_at');
    if (!approvedAt) continue;         // never approved
    if (cell('paid_at')) continue;     // paid -> stop nudging
    if (cell('declined_at')) continue; // declined -> stop nudging
    if (String(cell('status')).trim().toLowerCase() === 'waitlist') continue; // waitlisted -> pause nudging

    var email = String(cell('email')).trim();
    if (!email) continue;

    var hours = (now - new Date(approvedAt).getTime()) / 3600000;
    var tier = 0;
    if (hours >= 48) tier = 3;
    else if (hours >= 24) tier = 2;
    else if (hours >= 4) tier = 1;
    if (tier === 0) continue;          // not due yet
    if (cell(STAMP[tier])) continue;   // current tier already sent

    var html = renderEmail(TEMPLATE[tier], { unsubscribe_url: UNSUBSCRIBE_URL });
    sendViaResend({ to: email, subject: SUBJECT[tier], html: html });
    sheet.getRange(rowNum, headers[STAMP[tier]]).setValue(new Date());
  }
}

/* ---- Email ------------------------------------------------------------- */

function sendApplicationReceived(data) {
  if (!data.email) return;
  var html = renderEmail('email_application_received', { unsubscribe_url: UNSUBSCRIBE_URL });
  sendViaResend({
    to: data.email,
    subject: 'Got your application',
    html: html
  });
}

// Pulls an HTML file from this Apps Script project and fills {{placeholders}}.
function renderEmail(fileName, vars) {
  var html = HtmlService.createHtmlOutputFromFile(fileName).getContent();
  Object.keys(vars || {}).forEach(function (key) {
    html = html.split('{{' + key + '}}').join(vars[key]);
  });
  return html;
}

function sendViaResend(opts) {
  var res = UrlFetchApp.fetch('https://api.resend.com/emails', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + props_('RESEND_API_KEY') },
    payload: JSON.stringify({
      from: props_('FROM'),
      to: [opts.to],
      subject: opts.subject,
      html: opts.html
    }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Resend ' + code + ': ' + res.getContentText());
  }
}

function props_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Missing Script Property: ' + key);
  return v;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---- Rate limiting ------------------------------------------------------
   Apps Script gives no caller IP, so these throttle on a shared key via
   CacheService: true if the key is still under maxHits within windowSeconds,
   and bumps the count; false (and leaves the count alone) once it's been
   hit too many times, so callers stay locked out until the window rolls.
   Used as-is for the per-email submission throttle, where every hit (success
   or not) should count.

   Password checks use the peek/bump pair instead: peek the count without
   adding to it (so a CORRECT guess can be gated on "are we already over
   budget?" without itself spending budget), and bump only on a wrong guess.
   That way a string of failed guesses locks the gate down for everyone —
   including a subsequent correct one — but a legitimate visitor's own
   successful logins (e.g. a page that re-checks an already-saved password on
   every load) can never lock themselves, or anyone else, out. */
function rateLimitOk(key, maxHits, windowSeconds) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(key);
  var count = raw ? parseInt(raw, 10) : 0;
  if (count >= maxHits) return false;
  cache.put(key, String(count + 1), windowSeconds);
  return true;
}

function rateLimitPeek(key, maxHits) {
  var raw = CacheService.getScriptCache().get(key);
  var count = raw ? parseInt(raw, 10) : 0;
  return count < maxHits;
}

function rateLimitBump(key, windowSeconds) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(key);
  var count = raw ? parseInt(raw, 10) : 0;
  cache.put(key, String(count + 1), windowSeconds);
}

// Run this once by hand (select clearLoginLockouts ▸ Run) if the gate or
// dashboard password gets refused after a burst of testing — clears the
// wrong-guess counters immediately instead of waiting out the 10-minute
// window they expire on their own.
function clearLoginLockouts() {
  var cache = CacheService.getScriptCache();
  cache.remove('gate_guess');
  cache.remove('dash_guess');
}
