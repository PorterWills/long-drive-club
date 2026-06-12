# longdriveclub.com — the front door

Production implementation of the "LDC — The long way round" design
(Claude Design handoff, June 2026). Static site: no build step, no
framework — `index.html` + `styles.css` + `app.js`.

## Going live (one-time setup)

The site deploys to GitHub Pages via `.github/workflows/deploy-longdriveclub.yml`
whenever `longdriveclub/**` changes on the default branch
(`claude/porter-wills-os-wireframe`).

1. Merge this branch into the default branch.
2. In the repo settings → **Pages** → set **Source** to **GitHub Actions**.
3. Still in Pages settings, set **Custom domain** to `longdriveclub.com`
   and tick **Enforce HTTPS** once the certificate is issued.
4. At your domain registrar, point DNS at GitHub Pages:
   - `A` records for the apex (`longdriveclub.com`) →
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME` record for `www` → `<github-username>.github.io`

DNS can take up to a day to propagate; usually it's minutes.

## Where applications go

The entry sheet inserts into the `ldc_applications` table in the
Supabase project `yjusavyowoobgrnzhlfr` (eu-west-1). The key shipped in
`app.js` is a publishable key and the table is insert-only for the
public (RLS) — applications can only be read from the Supabase
dashboard: Table Editor → `ldc_applications`.

## Changing the gate password

The current password is `longway` (carried over from the prototype —
change it before you email anyone). The page stores only a SHA-256
hash. To set a new one:

```sh
echo -n "yournewpassword" | shasum -a 256
```

Put the resulting hex in `GATE_HASH` near the top of `app.js`.
Note the gate is presentation, not security: it reveals booking details,
it does not protect secrets.

## Imagery

`assets/hero.webp` (hero, portrait) and `assets/lawn.webp` (first drive,
landscape) came from the design handoff's image slots. Swap the files to
change the photography; keep the warm, low-saturation, golden-hour mood.
