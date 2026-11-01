# Long Drive: design spec

A long drive mini game for the Long Drive Club site. One driver, one strip, as far as you can hit it. A perfect drive earns Long Drive Club status. Agreed with the owner on 31 Oct 2026. **v1 built 31 Oct 2026** at `/game-mode/long-drive/` (not yet linked from the site).

It reuses the course game's air model (drag, Magnus lift, RK4 at 1/120 s) and the same three.js version, fonts and palette.

**Files:** `long-drive/index.html` (page and HUD), `long-drive/sounds.js` (the course game's recorded driver strike, `CLIPS.drive`, played full for a pure strike and lower and duller for a mishit), `long-drive/main.js` (scene, dial, flight, result), `long-drive/physics.js` (pure physics, no three.js), `long-drive/test.mjs` (self-check: `node game-mode/long-drive/test.mjs`). Switches: `?debug` logs each release, `?fps` shows a frame meter.

**Gameplay locked by the owner (1 Nov 2026):** the swing, strike tiers, distances, landing and roll, cars, roof bonus and strike sound below are signed off. Don't retune them without asking.

**Built differently from the plan (31 Oct 2026):**
- **Aim added** (arrow keys or the buttons, 0.5° steps, 4° either way). Without it the cars, parked off centre, could only be hit by accident.
- **Cars sit where drives land, not where they finish.** Totals include about 35 yd of roll, so a car placed by total only ever met a rolling ball. Placed by carry: Good 234 to 264 yd, Great 285 to 319, Monster 345 to 376, Perfect 433 to 452. The two far cars (estate at 437, Redline coupe at 449) are the Perfect targets.
- **Landing and roll match the course game (owner, 31 Oct 2026):** the grid uses the course's fairway surface exactly (`SURF.fairway`: bounce .38, keeps 58%, roll friction .14, spin grip .55) and plays back at the course's 1.15x with no fast roll. The first build had a firmer, faster surface and a 4x roll that looked nothing like the course. With shorter roll, the original distances needed 253 to 266 mph, so the owner chose to scale every tier down by 10% to keep real ball speeds: Perfect now leaves at 224 to 234 mph, Monster at 193 to 209. A Perfect drive plus a roof bonus tops out near 485 yd, so the 515 yd record line no longer comes up in play.
- **Daily best is per browser for now** (`localStorage` key `ldc.longdrive`, which also keeps the status date). A shared daily board needs a new sheet and endpoint in the Apps Script.
- **No beam haze cones.** They read as hard triangles across the sky; the pools of light on the strip carry the look.
- **The dial mark moves** a little each swing (80% to 90% of the dial), and the needle's pace changes too (1.3 to 1.7 s to the end), so the timing can't be learnt by rote.
- **Perfect tightened to ±8 ms** (owner, 31 Oct 2026: ±1 frame was fairly easy). Monster is ±45 ms.
- **No wind (owner, 31 Oct 2026):** it's a bit of fun, not a weather test, so every swing is in still air. (A wind trial ran briefly: up to 18 mph, with the card showing what it added or took.) 
- **Perfect lifted to 470 to 490 yd (owner, 31 Oct 2026)** so the record is reachable without wind. Perfect ball speed shows 243 to 256 mph, above real life, accepted as part of the fun. The far cars moved to 437 yd (estate) and 449 yd (Redline coupe). Only the coupe's roof can carry a drive past 515 (best seen 522); the estate tops out near 510. Stored bests use `ldc.longdrive.v2`, so the first build's longer distances don't linger.

## Look and tone

- **Calm, not loud.** It should have the same quiet, premium feel as the course game: understated copy, a Chalk/Tarmac/Moss palette and Redline used sparingly. No racing language: no "boost", "redline", "limiter", "over-rev" or "shift".
- **Real 3D, not cartoon.** It's built in the same engine and materials as the course, with the same soft shadows, haze and sky shader. The Claude Design canvas (*Long Drive Club: Night Drive*) is a layout and composition reference only. Don't copy its flat 2D style or its copy.
- **Sky (owner, 1 Nov 2026): first light.** The sun sits just under the skyline ahead and a little left, throwing a warm halo along the horizon; overhead is still deep blue and the last stars are fading. A cool sky light and a low warm light off the horizon lift the strip; the floodlights stay on.
- **Setting:** night, on a long, straight strip of tarmac (runway or racetrack), with floodlight towers down both sides throwing pools of light, and dark gaps between them. Cars are parked on the strip. Distant hazy lights sit on the horizon, and the far end fades to dark. There is no Augusta theming or naming.
- **The grid:** a 40 m wide landing zone with fine painted lines, and quiet yardage boards every 25 yd out to 525 yd. A ball that finishes outside the lines doesn't count.

## Controls

- **Hold Space** (or hold the swing button on a phone) to start the backswing. A dial needle climbs, faster as it rises.
- **Release** to start the downswing. How close the release is to the **mark** (the ideal point, a thin Moss band near the top of the dial) sets the strike.
- Off the mark, the ball curves: **late** releases to the right, **early** ones to the left, more the further off they are, so both risk finishing out of the grid. (The first build curved only late releases; the owner found every miss went right.) If you hold too long, the dial runs out and you get a weak mishit.
- The dial is the rev counter from the owner's Claude Design canvas (*Component · Rev counter*): 0 to 9 round 270°, shift lights, a green window (the mark, 7.2 to 7.8), a red arc from 8 and an end stop at 9. The owner loved it as designed and only wanted its HOLD word removed (1 Nov 2026). A live POWER readout shows 100 at the mark. Held past the end, the needle shakes red and the shift lights flash.
- There's no aim control in v1: you always hit straight down the grid.

## Strike quality and distance

At 60 fps one frame is about 17 ms. The windows are measured from the mark. All distances are totals: carry plus roll, before any roof bonus.

| Tier | Release | Total | Real-world equivalent |
|---|---|---|---|
| **Perfect** | within ±8 ms (half a frame) | 470–490 yd | edge of human limits |
| **Monster** | within ±45 ms | 378–410 yd | a World Long Drive winner |
| **Great** | within ±100 ms | 315–351 yd | elite tour power |
| **Good** | within ±180 ms | 261–293 yd | an average tour drive |
| **Mishit** | anything else | 198–234 yd | off-centre, high spin |

- Inside each tier, how close the release is sets where in the range you land. The gaps between tiers are deliberate, so each tier reads as a clear step up.
- The game works backwards from the target distance to the launch (ball speed, launch angle, spin), so the real flight engine produces the distance. Launch is 11° at 1,800 rpm (15° at 3,300 rpm for a mishit). Drag is a little lower than the course's (`cd` from .17).
- **Timing:** the needle takes 1.5 s to reach the end, speeding up (`(t/1.5)^1.7`). Held .12 s past the end, the swing comes apart (a mishit that hooks). Release time comes from the key or pointer event's timestamp, not the frame.

## Cars

The cars are both targets and hazards. They're built in code (like `clubs.js`) from the Claude Design car sheet, toned down to realistic proportions and finishes.

| Car | Roof (L × W) | Height | Notes |
|---|---|---|---|
| Box van | 4.10 × 1.95 m | 2.65 m | biggest flat roof, the easy target |
| Pickup | 1.40 × 1.45 m | 1.85 m | the open bed traps the ball |
| Estate | 2.30 × 1.25 m | 1.50 m | long flat roof |
| Saloon | 1.45 × 1.25 m | 1.45 m | |
| SUV | 2.10 × 1.40 m | 1.80 m | high roof |
| Coupe | 1.05 × 1.15 m | 1.22 m | smallest roof, the hero car in Redline |

- **Placement:** spread through the tiers so every level of player has something to aim at. The easy roofs sit nearer the tee and the hard ones further out, including at least two cars at 470–500 yd, where Perfect drives land.
- **Roof hit:** real bounce physics off a hard, springy roof (`ROOF`: bounce .55, keeps 80% of the forward speed), tuned so a clean hit adds about **+28 to 30 yd** (checked in `test.mjs`). A glancing hit off an edge can lose distance.
- **Bonnet and boot lid bounce too (owner, 1 Nov 2026):** a Perfect drive came down on the coupe's boot lid and died, which felt wrong. A ball landing on a flat panel now bounces forward like off a roof, a little softer (`PANEL`: bounce .45, keeps 72%): about +17 to 19 yd. Landing on the near-side bonnet usually runs the ball into the windscreen, so that one still costs distance. The card tile is now *Car bounce*.
- **Hazards:** the windscreen, rear window, sides and the pickup's bed kill the ball (about 30 to 45 yd lost).
- **Impact sounds (owner, 1 Nov 2026):** the old glass crash was harsh. A bounce off metal is a short, damped tonk; glass or a side is a dull thud.
- **The jackpot:** a Perfect drive that lands flat on the Redline coupe's roof can pass 515 yd. That's the rare way to top the day's or week's board.

## Status and boards

- **Long Drive Club status:** one **Perfect** drive that finishes inside the grid. A roof bonus isn't needed and doesn't count towards it. The game marks the moment quietly with the line "Welcome to the Long Drive Club."
- **Leaderboard (v1):** longest drive of the day, roof bonus included, and in the grid only. Week and all-time boards come later.
- **Format:** unlimited swings in v1.

## The ball

In the air the ball **is** a light (owner, 1 Nov 2026): an unlit, solid pale blue ball with only a tight bloom at its edge, not a grey ball inside a halo. A **Perfect** turns that light Moss green, pulsing between Moss and a pale Moss 1.8 times a second, until the next drive. No rings or other effects: the owner tried rings and they read as smoke rings.

## Result card

Total (large), in or out of the grid, ball speed, carry, roll, roof bonus (with the car and its distance, if any) and the strike tier. Buttons: *Drive again* and *See the board*. The copy is short and plain, in the LDC voice.

## v1 scope

**In:** the scene, the dial, the strike tiers, the cars with roof bounce and hazards, the result card, the status moment and the daily board.

**Later:** replay cameras for roof and hazard hits, week and all-time boards, aim control, cars from members' real makes, and linking status to `members.html`.
