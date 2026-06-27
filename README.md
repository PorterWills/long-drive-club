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

## Imagery

`assets/hero.webp` (hero, portrait) and `assets/lawn.webp` (first
drive, landscape) came from the original design. Swap the files to
change the photography; keep the warm, low-saturation, golden-hour mood.

The "You're in" page uses two images: `assets/welcome-map.jpg` (the
route, drawn in redline over a regional road map — the hero asset) and
`assets/welcome-lineup.jpg` (the lineup on the grass beside the drive
copy). Swap either by replacing the file (keep the name, or update the
`<img src>` in `welcome.html`) — they sit in plain `<img>` slots.
