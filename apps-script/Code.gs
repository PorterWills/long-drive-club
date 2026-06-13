/* Long Drive Club — application backend.
 *
 * Receives entry-form submissions from longdriveclub.com, appends every one
 * to a Google Sheet, then sends the applicant the "application received"
 * email through Resend.
 *
 * It also reacts to the owner editing the sheet: typing a word in the
 * "status" column triggers the matching email. Currently wired:
 *   approved  -> generates a unique, car-based password and sends the
 *                "You're in" email (email_application_approved).
 * (paid / declined / the nudges come next.)
 *
 * Set the three values in Script Properties (File ▸ Project Settings ▸
 * Script Properties), NOT inline — that keeps the Resend key out of the code:
 *   SHEET_ID         the spreadsheet id (from its URL)
 *   RESEND_API_KEY   your Resend API key (starts re_...)
 *   FROM             the from line, e.g.  Long Drive Club <hello@longdriveclub.com>
 *
 * Re-deploy (Deploy ▸ Manage deployments ▸ edit ▸ Version: New) after any edit.
 */

var SHEET_TAB = 'Applications';

// Where the unsubscribe link in the email points. A mailto keeps it dependency-free.
var UNSUBSCRIBE_URL = 'mailto:hello@longdriveclub.com?subject=Unsubscribe';

// Column order written to the sheet. The header row is created automatically.
// The first ten are filled by the form; the last three are filled by the
// owner / the approval flow.
var COLUMNS = ['timestamp', 'name', 'email', 'phone', 'work', 'car', 'play', 'party', 'days', 'consent',
               'status', 'password', 'approved_at'];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    saveRow(data);
    sendApplicationReceived(data);
    return jsonOut({ ok: true });
  } catch (err) {
    // Surface the error to the execution log so a failed submit is debuggable.
    console.error(err);
    return jsonOut({ ok: false, error: String(err) });
  }
}

// Handles two things:
//  - ?password=XXX&callback=YYY  the site gate asking if a password is valid.
//    Replies as JSONP (YYY({"ok":true})) so a static page can read it without
//    CORS. ok:true when the password matches an approved applicant.
//  - no params: a plain liveness check, handy in a browser.
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.password) {
    var body = JSON.stringify({ ok: passwordValid(params.password) });
    if (params.callback) {
      return ContentService
        .createTextOutput(params.callback + '(' + body + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
  }
  return jsonOut({ ok: true, service: 'ldc-applications' });
}

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

// Run this once by hand (select setupColumns ▸ Run) to add the status,
// password and approved_at columns to an existing sheet.
function setupColumns() {
  ensureColumns(getSheet());
}

function saveRow(data) {
  var sheet = getSheet();
  var days = Array.isArray(data.days) ? data.days.join(', ') : (data.days || '');
  sheet.appendRow([
    new Date(),
    data.name || '',
    data.email || '',
    data.phone || '',
    data.work || '',
    data.car || '',
    data.play || '',
    data.party || '',
    days,
    data.consent ? 'yes' : 'no'
  ]);
}

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

// Adds any COLUMNS that aren't already in the header row, on the end.
// Leaves existing columns and their order untouched.
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

// Installable "On edit" trigger (created by installApprovalTrigger, NOT named
// onEdit — a simple trigger can't call Resend). Fires whenever the sheet is
// edited; we only act when the edited cell is the status column.
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
  }
  // 'paid' and 'declined' will be wired here next.
}

function handleApproved(sheet, row, headers) {
  // Already sent? Don't send a second password.
  var approvedCell = sheet.getRange(row, headers['approved_at']);
  if (approvedCell.getValue()) return;

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

// A unique password with a nod to their car, e.g. "Porsche 911" -> PORSCHE4827.
// Falls back to DRIVER#### when no car was given.
function makePassword(car) {
  var brand = String(car || '').trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!brand) brand = 'DRIVER';
  var digits = String(Math.floor(1000 + Math.random() * 9000));
  return brand + digits;
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
