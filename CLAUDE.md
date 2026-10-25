# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Long Drive Club website (longdriveclub.com). It is a static site served by GitHub Pages from the root of `main`. There is no build step, framework, package.json, linter or test suite: edit the HTML, CSS and JS files directly. To preview, serve the root with any static server, for example `python3 -m http.server`. The README covers setup and operations in depth, so read it before you change any flow.

Other scripts:
- `node build-car-data.js` regenerates `car-makes-models.json` (the car picker) from the NHTSA vPIC API. It needs Node 18+. Hand-correct European makes afterwards.
- `tools/sync-ig-calendar.py` (stdlib only) pushes the founders' markdown content calendar to the sheet. It is meant to run from their Cowork folder, not from this repo.

## Architecture

**Backend = one Google Apps Script web app** (`apps-script/Code.gs`, plus the `email_*.html` templates) over a Google Sheet. It is deployed by hand, not from this repo. Any edit to `Code.gs` needs a new deployment version in Apps Script before it goes live. One-off installers (`setupColumns` and the `install*Trigger` functions) are run by hand. Secrets live in Script Properties (`DASHBOARD_PASSWORD`, `IG_SYNC_SECRET`, `IG_REMINDER_EMAIL`, etc.), never in the repo.

**Front end ↔ Apps Script.** Apps Script sends no CORS headers, so:
- reads go over JSONP (`<script src=URL?x=...&callback=cb>`), and `doGet` dispatches on the query param: `password`, `recover`, `submit`, `meta`, `ig`, or the dashboard feed;
- writes use `fetch(..., {mode: "no-cors"})` with a plain-text body, and a resolved request counts as success (`doPost`, including `igsync` and `accept`).

The deployment URL lives once, in `config.js` (`window.LDC_CONFIG.APPS_SCRIPT_URL`). Load `config.js` before `app.js`, `dashboard.js` and `members.js`. The README still says the URL lives in `app.js` and the dashboard `CONFIG`; `config.js` is the real source.

**Page flow and gating:**
- `index.html` + `app.js`: hero carousel (`IMAGES`), the two-step entry form (step 1 saves a `step1_complete` lead keyed on email, step 2 merges and marks it `complete`), `?recover=TOKEN` resumption, and the password gate. The gate checks per-applicant passwords server-side, then sets `sessionStorage` `ldc-gate=open`.
- `welcome.html` + `welcome.js`: post-gate page, animated SVG route over `assets/basemap-2.jpg` (viewBox tied to the image's pixel size), and the reserve/clickwrap step that records acceptance via `?accept=` before the Stripe handoff.
- `members.html` + `members.js`: post-payment page with reveal countdowns derived from `event_date` (from the sheet via `?meta`, with a hardcoded fallback) and offsets in `members.js`.
- `dashboard.html` + `dashboard.js`/`dashboard-ig.js`/`dashboard.css`: Signups / Instagram / Calendar tabs. This is the only **real** auth: data is returned only when the password matches `DASHBOARD_PASSWORD`, and only the `DASHBOARD_FIELDS` columns are sent. Its `Dashboard` sheet tab overrides the `CONFIG` defaults via `applySettings()`.
- The welcome/members guards are deterrents only; never put real secrets behind them.

**Styling:** `styles.css` ("The Livery") is shared by every page; the dashboard reuses its tokens and components.

**Consent:** `consent.js` loads on every public page. Trackers (Meta Pixel, Clarity) load only inside `loadTrackers()` after consent. Add new trackers there, never directly in a page.

## Rules that are easy to break

- The clickwrap notice and checkbox wording in `welcome.html` are verbatim from the solicitor's document. Don't edit them without legal sign-off.
- The terms version on `terms.html` must move in lockstep with `TERMS_VERSION` in `welcome.js`.
- The sheet owns IG Calendar `Status`. The sync must never overwrite it, and the Post Log is upsert-only (an empty value never blanks a cell, nothing is deleted).
- Don't ship facts that aren't public yet (price, venue) in repo content. They live in the private sheet.
- All user-facing copy should go through the `ldc-copywriter` skill (`.claude/skills/`).
