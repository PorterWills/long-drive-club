/* Long Drive Club — application backend.
 *
 * Receives entry-form submissions from longdriveclub.com and keeps each one in
 * a Google Sheet. The form is a two-step flow, so submissions arrive in stages:
 *
 *   stage "step1"  -> name, email and the car. Upserts the lead (keyed on
 *                     email) at status "step1_complete" and mints a recovery
 *                     token. A real, contactable lead even if step two never
 *                     arrives.
 *   stage "step2"  -> phone, the golf and the day. Merges into the same row,
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

// Column order written to fresh sheets. Existing sheets keep their order; any
// columns below that they're missing get appended (see ensureColumns). All
// reads and writes go through the header map, never fixed indexes, so order
// never matters at runtime. The block after nudge3_at is new for the two-step
// flow and will be appended to the live sheet on the right.
var COLUMNS = ['timestamp', 'name', 'email', 'phone', 'work', 'car', 'play', 'party', 'days', 'consent',
               'status', 'password', 'approved_at', 'paid_at', 'declined_at',
               'nudge1_at', 'nudge2_at', 'nudge3_at',
               'make', 'model', 'handicap', 'base', 'city',
               'token', 'step1_at', 'completed_at', 'recovery_sent'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // serialise the read-then-write upsert
  } catch (lockErr) {
    return jsonOut({ ok: false, error: 'busy' });
  }
  try {
    var data = JSON.parse(e.postData.contents);
    var stage = String(data.stage || '').toLowerCase();
    if (stage === 'step1') {
      upsertStep1(data);
    } else if (stage === 'step2') {
      mergeStep2(data);
    } else {
      saveFullSubmission(data); // legacy single-submit
    }
    return jsonOut({ ok: true });
  } catch (err) {
    console.error(err);
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Handles three things:
//  - ?recover=TOKEN&callback=YYY  the site asking for the step-one data behind
//    a recovery token, so it can prefill step two. Replies as JSONP.
//  - ?password=XXX&callback=YYY  the gate asking if a password is valid.
//  - no params: a plain liveness check, handy in a browser.
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.recover) {
    var lead = leadByToken(params.recover);
    var payload = lead
      ? { ok: true, name: lead.name, email: lead.email, phone: lead.phone,
          make: lead.make, model: lead.model, car: lead.car }
      : { ok: false };
    return jsonpOrJson(payload, params.callback);
  }
  if (params.password) {
    return jsonpOrJson({ ok: passwordValid(params.password) }, params.callback);
  }
  if (params.dashboard) {
    return jsonpOrJson(dashboardPayload(params.dashboard), params.callback);
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
  'declined_at', 'nudge1_at', 'nudge2_at', 'nudge3_at', 'make', 'model',
  'handicap', 'base', 'city', 'step1_at', 'completed_at', 'recovery_sent'];

// A simple settings tab (key in column A, value in column B) the owners can
// edit by hand — follower count, event name, etc. — so those don't live in
// code. Created and pre-filled automatically the first time it's read.
var SETTINGS_TAB = 'Dashboard';

function dashboardPayload(guess) {
  var raw = PropertiesService.getScriptProperties().getProperty('DASHBOARD_PASSWORD');
  if (!raw) return { ok: false };
  var g = String(guess || '').trim().toUpperCase();
  if (!g) return { ok: false };
  var allowed = raw.split(/[,\s]+/).map(function (p) { return p.trim().toUpperCase(); })
                   .filter(function (p) { return p; });
  if (allowed.indexOf(g) < 0) return { ok: false };

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
    ['event_date', '2026-09-05 07:00'],
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
  // Phone is collected in step two now, so step one never carries it.
  var fields = {
    name: data.name || '',
    email: email,
    make: data.make || '',
    model: data.model || '',
    car: data.car || ''
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
    phone: data.phone || '',
    work: data.work || '',
    handicap: data.handicap || '',
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
    subject: "Your name's down. The sheet isn't finished.",
    html: html
  });
}

/* ---- Gate -------------------------------------------------------------- */

// True when the guess matches a generated password in the sheet. A password
// only exists once a row is approved, so a match means an approved applicant.
// Case-insensitive, so "bmw6291" works as well as "BMW6291".
function passwordValid(guess) {
  var g = String(guess || '').trim().toUpperCase();
  if (!g) return false;
  var sheet = getSheet();
  var col = headerMap(sheet)['password'];
  if (!col) return false;
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var values = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var stored = String(values[i][0]).trim().toUpperCase();
    if (stored && stored === g) return true;
  }
  return false;
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
  }
}

function handleApproved(sheet, row, headers) {
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
  var cell = sheet.getRange(row, headers['paid_at']);
  if (cell.getValue()) return; // already sent

  var email = String(sheet.getRange(row, headers['email']).getValue()).trim();
  if (!email) return;

  var html = renderEmail('email_place_confirmed', { unsubscribe_url: UNSUBSCRIBE_URL });
  sendViaResend({ to: email, subject: "That's you confirmed", html: html });

  cell.setValue(new Date());
}

function handleDeclined(sheet, row, headers) {
  var cell = sheet.getRange(row, headers['declined_at']);
  if (cell.getValue()) return; // already sent

  var email = String(sheet.getRange(row, headers['email']).getValue()).trim();
  if (!email) return;

  var html = renderEmail('email_declined', { unsubscribe_url: UNSUBSCRIBE_URL });
  sendViaResend({ to: email, subject: 'Not this time', html: html });

  cell.setValue(new Date());
}

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
// the row is paid or declined. Each nudge sends once, and only the current
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
