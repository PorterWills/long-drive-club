# Long Drive Club — longdriveclub.com

The application-gated front door for Long Drive Club. A static site:
no build step, no framework — just `index.html`, `styles.css`, `app.js`,
and the images in `assets/`.

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

The entry sheet POSTs each application to a deployed Google Apps Script
web app (the `APPS_SCRIPT_URL` near the top of `app.js`). The script
saves the submission to a Google Sheet and sends the applicant a
confirmation email. Because Apps Script web apps don't return CORS
headers, the form posts with `mode: "no-cors"` and a plain-text body and
treats a resolved request as success. To point the form at a different
deployment, update `APPS_SCRIPT_URL`.

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

## Imagery

`assets/hero.webp` (hero, portrait) and `assets/lawn.webp` (first
drive, landscape) came from the original design. Swap the files to
change the photography; keep the warm, low-saturation, golden-hour mood.
