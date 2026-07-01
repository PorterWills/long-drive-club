# Long Drive Club — longdriveclub.com

The application-gated front door for Long Drive Club. A static site:
no build step, no framework — just `index.html`, `styles.css`, `app.js`,
and the images in `assets/`.

Once an applicant enters a valid password at the gate (`#gate` on
`index.html`), `app.js` sends them to `welcome.html` — the "You're in"
page that lays out the drive, the map, the day, the price and the
reservation. Its behaviour (reveal-on-scroll and the reserve / T&C step)
lives in `welcome.js`; its styles are the `welcome.html` section of
`styles.css`.

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
