# Long Drive Club — longdriveclub.com

The application-gated front door for Long Drive Club. A static site:
no build step, no framework — just `index.html`, `styles.css`, `app.js`,
and the images in `assets/`.

Once an applicant enters a valid password at the gate (`#gate` on
`index.html`), `app.js` sends them to `welcome.html` — the "You're in"
page that lays out the drive, the map, the day, the price and the
reservation. Its behaviour (reveal-on-scroll and the reserve step)
lives in `welcome.js`; its styles are the `welcome.html` section of
`styles.css`.

The reserve step is a clickwrap gate: an unticked, mandatory checkbox
(plus a separate optional marketing one) sits directly above the pay
button, which stays disabled until the terms box is ticked. The notice
and checkbox wording are verbatim from the solicitor's gate-language
document — don't edit them without legal sign-off. The full standing
Terms live on `/terms` (linked from the checkbox, never shown inline)
and carry a version stamp that must move in lockstep with
`TERMS_VERSION` in `welcome.js`. On the pay click, `welcome.js` writes
the acceptance record — timestamp, page, terms version, the exact
rendered wording, the marketing choice — to the Apps Script `?accept=`
endpoint before the Stripe handoff: an append-only row on the
**Terms acceptances** tab (the evidence), plus convenience columns on
the applicant's row (see `recordAcceptance` in `apps-script/Code.gs`).
`/cookies` is a stub pending a real Cookie Notice.

## Going live (GitHub Pages)

This repo is the whole website; the files sit at the root on purpose.

1. **Settings → Pages.**
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Set **Branch** to `main` and the folder to **/ (root)**, then **Save**.
4. Under **Custom domain**, enter `longdriveclub.com` and **Save**
   (the `CNAME` file in this repo already sets this — it'll just confirm).
5. Tick **Enforce HTTPS** once GitHub finishes issuing the certificate
   (can take a few minutes to an hour).

### DNS (at your domain registrar)

Point the domain at GitHub Pages:

- Four `A` records on the apex (`longdriveclub.com`):
  `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- One `CNAME` record for `www` → `porterwills.github.io`

Propagation is usually minutes, occasionally up to a day.

## Where applications go

The entry sheet is a two-step flow. Step one (name, email, car) POSTs to
the deployed Google Apps Script web app (`APPS_SCRIPT_URL` near the top
of `app.js`) and is saved immediately as a `step1_complete` lead, keyed
on email — so a drop-off before step two is still a contactable,
recoverable lead in the sheet. Step two (phone, the golf and the day)
POSTs again and merges into that same row, marking it `complete` and
sending the applicant the confirmation email. Because Apps Script web apps don't
return CORS headers, the form posts with `mode: "no-cors"` and a
plain-text body and treats a resolved request as success. To point the
form at a different deployment, update `APPS_SCRIPT_URL`.

### Recovery email

A lead left at `step1_complete` past a delay gets a recovery email (one
nudge at `RECOVERY_DELAY_1_HOURS`, a final one at
`RECOVERY_DELAY_2_HOURS`, both in `apps-script/Code.gs`). Reaching
`complete` cancels it. The email's **Finish the sheet** button links to
`/?recover=TOKEN`; the site reads the step-one data back through the
Apps Script `doGet` recover endpoint and drops the applicant into step
two with name, email, phone and car already loaded — no re-entry.

### Apps Script setup

After deploying `apps-script/Code.gs`, run these once each by hand
(select the function ▸ Run): `setupColumns` (adds the new columns to an
existing sheet), `installApprovalTrigger` (the status-column email
trigger), `installNudgeTrigger` (the hourly approved-but-unpaid nudges),
and `installRecoveryTrigger` (the timed recovery-email sweep). Re-running
any installer is safe — each clears its old copy first. Re-deploy a new
version after any edit.

### The dashboard's Instagram + Calendar tabs

`dashboard.html` has three tabs behind the one password: **Signups**
(the entry sheet), **Instagram** (performance) and **Calendar** (the
content plan). The last two read three tabs in the same spreadsheet —
`IG Post Log`, `IG Weekly` and `IG Calendar` — through the Apps Script
`?ig=` endpoint. The tabs are created and seeded automatically the
first time the feed is read (the log gets the account's history to
12/07/2026, the calendar gets the 4-week plan), so the only setup is
re-deploying `Code.gs`. After that the sheet is the source of truth:
log each post's numbers in `IG Post Log` within 24 hours, add an
`IG Weekly` row each Sunday, and keep `IG Calendar` rows' Status
current (`Planned` / `Ready` / `Scheduled` / `Posted` / `Logged` /
`Skipped`, plus `Held` for milestone posts that slot in on founder
confirmation — give those a row with an empty Date). Facts that are
not yet public (the price, the venue) are deliberately absent from the
seeded plan — hold them in the sheet, which is private.

### Posting windows and reminders

The posting windows (weekdays 07:00–08:00, weekends 08:00–09:00,
Europe/London) are config constants at the top of the IG section in
`Code.gs`, not sheet schema. The dashboard shows the window on every
calendar card and a state strip on post days (opens in…, open now,
missed — a late post is never blocked, just recorded). From midday the
next day's card becomes "Schedule tonight in IG". The Post Log's
`Posted time` column (HH:MM) feeds a views-by-posted-time chart so the
window can be tested rather than assumed. If a per-post window is ever
needed, add a "Post window" column to IG Calendar and the slug
`post_window` to the sync script's KNOWN_KEYS — the dashboard already
reads it.

Email reminders (the part that doesn't require opening anything): run
`installIgReminderTriggers` once by hand in Apps Script. Then, around
18:00 the evening before any scheduled post, an email goes out with
the theme, window, caption and asset brief; around 06:45 on post day a
nudge follows unless the row's Status is already Scheduled, Posted,
Logged or Skipped. Recipient is the `IG_REMINDER_EMAIL` Script
Property (defaults to the script owner); set `IG_REMINDERS` to `off`
to silence both. Make sure the project timezone is Europe/London
(Project Settings) so the triggers fire at the right hour.

### Calendar sync (markdown → sheet, automated)

The content strategy lives in a markdown calendar maintained by Claude
Cowork on the founders' machine, which keeps a machine-readable
```json block of the schedule at the file's foot.
`tools/sync-ig-calendar.py` posts that block to the Apps Script
(`igsync` in `doPost`), which replaces the `IG Calendar` rows — except
the Status column, which the sheet owns: rows matched on date (or
theme, for dateless held rows) keep whatever status was set in the
sheet, so a strategy edit never un-posts a post.

One-time setup:

1. Generate a secret (`openssl rand -hex 24`) and set it as the
   `IG_SYNC_SECRET` Script Property, then re-deploy `Code.gs`.
2. Copy `tools/sync-ig-calendar.py` into the folder that holds the
   calendar markdown, and put the same secret in a `.ldc-sync-secret`
   file next to it.
3. Tell Cowork (in that folder's README): after any change to the
   calendar's Section 7 or 7a, update the JSON block and run
   `python3 sync-ig-calendar.py`.

The script needs only the Python standard library. It fails loudly —
unknown fields, invalid JSON, missing secret — rather than writing a
guess into the sheet. Post stats and the weekly row stay manual: they
come from IG insights, sheet-ward only.

## Changing the gate password

The current password is `longway` (carried over from the prototype —
change it before you email anyone). The page stores only a SHA-256
hash, never the password itself. To set a new one, run:

```sh
echo -n "yournewpassword" | shasum -a 256
```

Put the resulting hex string into `GATE_HASH` near the top of `app.js`.
Note: the gate reveals booking details; it is presentation, not real
security, so don't put anything truly sensitive behind it.

### Stopping direct access to `welcome.html`

When the gate is passed, `app.js` sets a `sessionStorage` marker
(`ldc-gate=open`) before sending the visitor to `welcome.html`. A guard
script at the top of `welcome.html` redirects back to the gate if that
marker is missing, so a welcome URL shared with someone who didn't enter
the password lands them on the password screen instead.

This is a deterrent, not real security: `welcome.html` is a public file
on GitHub Pages, so anyone determined can still read its source or set
the marker by hand. Truly restricting access needs server-side gating —
e.g. putting the site behind Cloudflare Access / Zero Trust, a host with
built-in password protection, or a serverless function that only returns
the content after checking the password.

### Stopping direct access to `members.html`

`members.html` is the post-payment event page (the drive, the reveals,
the garage, the day sheet). A member reaches it from the **View event
details** button in the place-confirmed email, which links to
`members.html#access`. A guard at the top of the page admits a visitor
who carries that `#access` marker, already holds a member session
(`sessionStorage` key `ldc-member`), or passed the password gate this
session; everyone else is redirected to the gate. Once admitted, the
marker is stripped from the URL and the session is remembered, so the
member can move around the page and refresh without re-triggering it.

Like the welcome guard, this is a deterrent, not real security: the file
is public, so the `#access` marker is visible to anyone who reads the
email or the source. Server-side gating (as above) is the only way to
truly restrict it.

## The signup dashboard

`dashboard.html` is a private, password-gated read-out of the application
sheet — the same `Applications` tab the entry form fills. It shows places
filled against a target, the sign-up → form → approved → paid funnel, a row
of counts, and a sortable, filterable applicant list; clicking a row opens a
slide-over with the full record and a timeline. It's a faithful static build
of the Claude Design "Signup Dashboard" (`dashboard.css` and `dashboard.js`
carry the layout and logic; the colour, type and components reuse `styles.css`
— "The Livery").

Unlike the welcome/members guards, this one is **real** gating: the data
never ships in the page. `dashboard.js` asks the Apps Script web app for the
rows over JSONP, and `doGet` only returns them when the supplied password
matches the `DASHBOARD_PASSWORD` Script Property. A wrong password gets
nothing. The token and the generated gate passwords are never exposed — only
the columns in `DASHBOARD_FIELDS` (`Code.gs`) are sent.

### Setup

1. In the Apps Script project, **Project Settings ▸ Script Properties**, add
   `DASHBOARD_PASSWORD`. Set it to the password(s) the dashboard should accept,
   separated by commas — one per viewer, e.g. `ABC123, DEF456`. These can be
   the same passwords the viewers already use at the site gate. The check is
   case-insensitive. (Keep the real values here, never in the repo.)
2. **Deploy ▸ Manage deployments ▸ Edit ▸ New version** so the updated
   `doGet` goes live (the `/exec` URL stays the same).
3. Visit `https://longdriveclub.com/dashboard.html`, enter the password.

The password is held in `sessionStorage` for the tab's life, so Refresh and
reloads don't re-prompt; closing the tab clears it. The page is `noindex` and
disallowed in `robots.txt`, and isn't linked from anywhere on the site.

### Tuning it (no code)

The display values live in a **`Dashboard` tab** in the spreadsheet — a plain
two-column `setting` / `value` list. Edit a cell, hit **Refresh** on the
dashboard, done. The tab is created and pre-filled automatically the first
time the dashboard loads after deploy, so there's nothing to set up.

| setting | what it does |
| --- | --- |
| `event_name` | the heading (e.g. `THE FIRST DRIVE`) |
| `event_date` | drive day — drives the four "Counting down" clocks |
| `places_target` | capacity the "places filled" bar fills toward |
| `ig_show` | `yes`/`no` — show the Instagram strip |
| `ig_followers` | follower count shown |
| `ig_change` | optional "↑ N since last check" pill — blank hides it |
| `ig_reach` | optional "N reach this week" — blank hides it |

The **Counting down** section shows the same four reveal clocks as the members
page (drive day, the course, the meeting point, the route). They all derive
from `event_date` using the offsets in `members.js` (course −42 days, meeting
−14, route −7). The members page reads the **same** `event_date` from the sheet
(via the no-auth `?meta` endpoint in `Code.gs`, which returns only the public
display values — no applicant data), so setting drive day once in the sheet
updates both the dashboard and the members page. `members.js` keeps a hardcoded
date as an instant fallback if that fetch is slow or fails. Each clock ticks
live and reads "Revealed" once it passes.

Under the hood: `Code.gs` `readSettings()` returns this tab in the dashboard
feed, and `applySettings()` in `dashboard.js` lets any value present override
the matching default in the `CONFIG` block at the top of `dashboard.js`. So
`CONFIG` is just the fallback if a row is missing or the tab is empty.

`APPS_SCRIPT_URL` (in `CONFIG`) is the same deployment the entry form uses;
update both if you ever redeploy to a new URL.

## Imagery

`assets/hero.webp` (hero, portrait) and `assets/lawn.webp` (first
drive, landscape) came from the original design. Swap the files to
change the photography; keep the warm, low-saturation, golden-hour mood.

The "You're in" page's map section (`#map`) is `assets/basemap-2.jpg`
(a clean top-down map, no route baked in) with the route drawn on top
by an animated SVG overlay in `welcome.html` — the line, casing, ghost
line, START/FINISH chips and the gliding LDC roundel are all inline
`<path>`/`<g>` elements sized to the basemap's exact pixel dimensions
(`viewBox="0 0 2518 1558"`), animated in `welcome.js`. Swapping the
basemap for a different map requires re-tracing the route path against
the new image's pixel coordinates. `assets/welcome-lineup.jpg` (the
lineup on the grass beside the drive copy) is a plain `<img>` slot —
swap it by replacing the file.
