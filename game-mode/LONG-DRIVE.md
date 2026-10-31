# Long Drive: design spec

A long drive mini game for the Long Drive Club site. One driver, one strip, as far as you can hit it. A perfect drive earns Long Drive Club status. Agreed with the owner on 31 Oct 2026. **v1 built 31 Oct 2026** at `/game-mode/long-drive/` (not yet linked from the site).

It reuses the course game's air model (drag, Magnus lift, RK4 at 1/120 s) and the same three.js version, fonts and palette.

**Files:** `long-drive/index.html` (page and HUD), `long-drive/main.js` (scene, dial, flight, result), `long-drive/physics.js` (pure physics, no three.js), `long-drive/test.mjs` (self-check: `node game-mode/long-drive/test.mjs`). Switches: `?debug` logs each release, `?fps` shows a frame meter.

**Built differently from the plan (31 Oct 2026):**
- **Aim added** (arrow keys or the buttons, 0.5° steps, 4° either way). Without it the cars, parked off centre, could only be hit by accident.
- **Cars sit where drives land, not where they finish.** Totals include 60 to 80 yd of roll, so a car at 490 yd only ever met a rolling ball. Placed by carry: Good 200 to 240 yd, Great 265 to 305, Monster 335 to 370, Perfect 400 to 425. The two far cars (estate at 404, Redline coupe at 421) are the Perfect targets.
- **Daily best is per browser for now** (`localStorage` key `ldc.longdrive`, which also keeps the status date). A shared daily board needs a new sheet and endpoint in the Apps Script.
- **No beam haze cones.** They read as hard triangles across the sky; the pools of light on the strip carry the look.
- **The dial mark moves** a little each swing (80% to 90% of the dial), so the timing can't be learnt by rote.

## Look and tone

- **Calm, not loud.** It should have the same quiet, premium feel as the course game: understated copy, a Chalk/Tarmac/Moss palette and Redline used sparingly. No racing language: no "boost", "redline", "limiter", "over-rev" or "shift".
- **Real 3D, not cartoon.** It's built in the same engine and materials as the course, with the same soft shadows, haze and sky shader. The Claude Design canvas (*Long Drive Club: Night Drive*) is a layout and composition reference only. Don't copy its flat 2D style or its copy.
- **Setting:** night, on a long, straight strip of tarmac (runway or racetrack), with floodlight towers down both sides throwing pools of light, and dark gaps between them. Cars are parked on the strip. Distant hazy lights sit on the horizon, and the far end fades to dark. There is no Augusta theming or naming.
- **The grid:** a 40 m wide landing zone with fine painted lines, and quiet yardage boards every 25 yd out to 525 yd. A ball that finishes outside the lines doesn't count.

## Controls

- **Hold Space** (or hold the swing button on a phone) to start the backswing. A dial needle climbs, faster as it rises.
- **Release** to start the downswing. How close the release is to the **mark** (the ideal point, a thin Moss band near the top of the dial) sets the strike.
- **Early** releases lose distance but fly straight. **Late** ones (past the mark) curve more offline the later they are, so they also risk finishing out of the grid. If you hold too long, the dial runs out and you get a weak mishit.
- The dial is a slim round gauge in the style of the course's power bar, with no rpm numbers or car-dash styling.
- There's no aim control in v1: you always hit straight down the grid.

## Strike quality and distance

At 60 fps one frame is about 17 ms. The windows are measured from the mark. All distances are totals: carry plus roll, before any roof bonus.

| Tier | Release | Total | Real-world equivalent |
|---|---|---|---|
| **Perfect** | within ±1 frame (about 33 ms window) | 485–505 yd | edge of human limits, just under the 515 yd record |
| **Monster** | within ±50 ms | 420–455 yd | a World Long Drive winner |
| **Great** | within ±100 ms | 350–390 yd | elite tour power |
| **Good** | within ±180 ms | 290–325 yd | an average tour drive |
| **Mishit** | anything else | 220–260 yd | off-centre, high spin |

- Inside each tier, how close the release is sets where in the range you land. The gaps between tiers are deliberate, so each tier reads as a clear step up.
- Wind nudges every drive on top of this.
- The game works backwards from the target distance to the launch (ball speed, launch angle, spin), so the real flight engine produces the distance. Launch is 11° at 1,800 rpm (15° at 3,300 rpm for a mishit). Perfect drives leave at 225 to 237 mph, Monster at about 190 to 210. Drag is a little lower than the course's (`cd` from .17) so these speeds carry like real long drive hitters.
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
- **Roof hit:** real bounce physics off a hard, springy roof (`ROOF`: bounce .55, keeps 80% of the forward speed), tuned so a clean hit adds about **+24 yd** (checked in `test.mjs`). A glancing hit off an edge can lose distance.
- **Hazards:** the windscreen, bonnet and sides kill the ball or deflect it, which costs distance.
- **The jackpot:** a Perfect drive that lands flat on a far roof can carry past 515 yd. That's the rare way to beat the record and top the day's or week's board.

## Status and boards

- **Long Drive Club status:** one **Perfect** drive that finishes inside the grid. A roof bonus isn't needed and doesn't count towards it. The game marks the moment quietly with the line "Welcome to the Long Drive Club."
- **Leaderboard (v1):** longest drive of the day, roof bonus included, and in the grid only. Week and all-time boards come later.
- **Format:** unlimited swings in v1.

## Result card

Total (large), in or out of the grid, ball speed, carry, roll, roof bonus (with the car and its distance, if any) and the strike tier. Buttons: *Drive again* and *See the board*. The copy is short and plain, in the LDC voice.

## v1 scope

**In:** the scene, the dial, the strike tiers, the cars with roof bounce and hazards, the result card, the status moment and the daily board.

**Later:** replay cameras for roof and hazard hits, week and all-time boards, aim control, cars from members' real makes, and linking status to `members.html`.
