# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Applicants and members.** UK car enthusiasts who also play golf. For them the drive and the round are the same escape, so they belong in one day. The car comes first and golf is the shared ground. Visitors arrive from Instagram, TikTok, Substack or a direct link, apply on the entry sheet, and if accepted get a password, see the day and pay to hold a place.
- **Founders (the committee).** They use the private dashboard (`dashboard.html`) to read and approve applications, track places against the target, and run the Instagram content plan and stats.

## Product Purpose

Long Drive Club is a members' club built around a single day: a drive worth the long way round, then 18 holes at a top 100 course at the end of it. The site is the club's front door, by application only. It covers the pitch, the application, the gated welcome page with the reservation and payment handoff, the members' event page, and the founders' dashboard. Success means filling the 20 places with the right people, and those people paying and turning up.

## Positioning

The club treats the drive and the round as one day instead of two. The gate is narrow (a committee, an application, 20 places, and a genuine no), but it filters on what you love and how seriously you take it, never on background. It is blind to class, and confidence comes from the cars and the specifics (06:30, a yardage), not from heritage. LDC is the new arrival, not the custodian of anything.

## Operating Context

- First drive: spring 2027, South East UK, 20 places. The plan is three drives a year. Do not claim any have run until they have.
- Flow: two-step entry sheet → committee review → a per-applicant password by email → welcome page (the day, the map, the price, clickwrap terms, Stripe) → place-confirmed email → members page with timed reveals (course about 6 weeks out, meeting point about 2 weeks out, route 7 days out) and the garage roster.
- A held place lasts 48 hours, then passes to the next name on the list.
- Facts not yet public (price, venue, course name, route) appear only behind the gate or in the private sheet.

## Capabilities and Constraints

- A static site on GitHub Pages: no build step and no framework. The backend is a Google Apps Script web app over a Google Sheet (see `CLAUDE.md`).
- The welcome and members page guards are deterrents, not security. Only the dashboard is really gated.
- The clickwrap notice and checkbox wording are the solicitor's verbatim text. Don't change them without legal sign-off.
- Trackers load only after cookie consent, via `consent.js`.

## Brand Commitments

- Name: Long Drive Club (LDC). Tagline idea: "The long way round."
- The voice is set by the `ldc-copywriter` skill (`.claude/skills/ldc-copywriter`). It must be literally true, say only what LDC could say, and never perform. It performs no class, up or down. All copy goes through it.
- British English.

## Evidence on Hand

- Live channels: Instagram (@longdrive.club), Substack (longdriveclub.substack.com) and TikTok (@longdriveclub).
- Photography in `assets/` is sourced or staged imagery, not footage of an LDC drive.
- None yet: no past events, testimonials, member counts, press or named partners. Never fabricate them.

## Product Principles

1. The drive and the round are one day. Every surface should hold both halves.
2. The gate is narrow on passion and blind to background.
3. Only state what is true now. Reveals are earned by stage (applicant, accepted, member).
4. Specifics over atmosphere.
5. Founders run everything from the sheet. Operational surfaces stay fast to scan and need no code changes.

## Accessibility & Inclusion

Best effort with no formal standard. Keep the existing semantic and ARIA work (for example the handicap slider and the live regions) intact.
