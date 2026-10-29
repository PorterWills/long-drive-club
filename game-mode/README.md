# Long Drive Club: Golf Game Prototype

A browser golf game for the Long Drive Club website. It plays like golfslate.com (whose mechanics were reverse engineered with REA on 28 Oct 2026). Cars are parked on the course, and it's branded with the LDC Design System.

**Status (29 Oct 2026):** all **18 holes** are built and playable: a full round with a printed-style scorecard (front nine, back nine, Out / In / Total, birdie and bogey marks), practice mode, and a global leaderboard. Live at **longdriveclub.com/game-mode/** (tab title *National Course*), promoted from the home page. Par 72, 7,555 yd (Out 3,775, In 3,780).

Stroke index follows the owner's official card (29 Oct 2026). Yards are the game's own, measured tee to pin. Five holes differ from the card (1: 445 vs 455, 2: 585 vs 575, 11: 520 vs 505, 13: 545 vs 510, 15: 550 vs 530), and the owner chose to keep them (29 Oct 2026), so don't move tees to match.

| Hole | Name | Par | Yards | SI |
|---|---|---|---|---|
| 1 | Tee Tree | 4 | 445 | 9 |
| 2 | Red Catbranch | 5 | 585 | 1 |
| 3 | Wilting Mango | 4 | 350 | 13 |
| 4 | Blossoming Shrimp Pear | 3 | 240 | 15 |
| 5 | Violet | 4 | 495 | 5 |
| 6 | Saturn | 3 | 180 | 17 |
| 7 | Pompei | 4 | 450 | 11 |
| 8 | Blue Steele | 5 | 570 | 3 |
| 9 | Texan Tangerine | 4 | 460 | 7 |
| 10 | Jamelia | 4 | 495 | 6 |
| 11 | Grey Catree | 4 | 520 | 8 |
| 12 | Silver Cymbal | 3 | 155 | 16 |
| 13 | Bulgaria | 5 | 545 | 4 |
| 14 | Shenzhen Silk | 4 | 440 | 12 |
| 15 | Icepick | 5 | 550 | 2 |
| 16 | Greenpetal | 3 | 170 | 18 |
| 17 | Mamdani | 4 | 440 | 14 |
| 18 | Polly | 4 | 465 | 10 |

Holes 1 and 2 are modelled on Augusta's 1st and 2nd. Hole 3–5 aerial scales: 0.224, 0.172 (back tee) and 0.319 m/px (back tee).

- **Round and practice:** with no `?hole`, the game opens the round's next unplayed hole. Scores are kept in the browser (`localStorage` key `ldc.round`). Any other hole (`?hole=N`, or picked from the **Holes** card) is **practice** and never counts. The Holes card shows par, yards, SI, round scores, the running total, *Back to round* and *New round*. A round hole can't be replayed; after the last hole the scorecard opens. Confirmations sit inside the card, not in `confirm()`, which some embedded browsers block (it silently answers no).
- **Leaderboard:** after a full round, *Submit score* sends a name and score to the LDC Google Sheet through an Apps Script web app (`LB_URL` in `index.html`; the script, `leaderboard.gs`, isn't in this repo). The global 18-hole board sits beside the scorecard. An empty `LB_URL` hides the leaderboard buttons.

### Log
- **29 Oct 2026 (session 5, controls and menus):** power bar redesigned as a rev counter (solid Redline, ticks, yardage-led readout, no text selection on drag); bottom livery stripe removed; *Ambiance* renamed *Mood*; Scorecard moved to its own top-bar button; Holes card closes with ×; stock yardage on the club button; on phones a lower ball, narrower controls, and wind/aim under the yardage. PRs #116–#121.
- **29 Oct 2026 (session 4, website and polish):** moved the game from `/gamer/` to `/game-mode/` (`/gamer/` is now a redirect page that keeps `?hole` etc.), tab title *National Course*, and the LDC roundel links to the home page. Added the home page band (see the site README). Replaced the two top panels with **one translucent bar** (HUD v2). On phones the mini map hides behind a **Map** button. Wind is colour-coded, and holes 8 and 15 were made windier so red shows. The bars slide off during ball flight. The putt line is capped at 10 ft. *How to play* gained a close button. All the owner's calls are under *Decisions*.
- **28 Oct 2026 (session 2):** holes 3–5 built from aerials. Added the Holes panel, the round scorecard and practice mode (owner's rules: play in order by default, practise any hole, practice never counts, leaving a round pauses it). Fixed the card's buttons doing nothing (`confirm()` blocked, unchanged `location.search` not reloading). Shaped every green and bunker: organic outlines, a bunker floor, face and lip with shading and rake lines, two seeded mounds per green, a cross-mown pattern and a collar, and a half-metre terrain grid. All holes pass `?test`, and the page loads in about 1.1 s. Only hole 4's green and bunkers have been looked at up close; the others still need a look in play.

- Game: [index.html](index.html), one self-contained file (Three.js 0.160 from jsDelivr, fonts from Google Fonts)
- Original research and plan: `golf-car-game-blueprint.md`, kept in the owner's local project folder (not in this repo). Where it disagrees with this README, **this README wins**.
- Brand source: the "LDC Design System" artifact, https://claude.ai/artifact/P2yhCjwbg5yavpyZ4fdHtL

---

- **28 Oct 2026 (session 3):** mobile pass. Fixed the top panels colliding on phones (the Holes button was hidden), moved the shot stats above the controls on phones, and widened the portrait field of view (up to 80°; landscape and desktop keep 55°). Checked in a 375×812 phone view. Not yet tried on a real phone. Shot stats moved into the top-right yardage panel as two lines (carry, total; putts: roll, left); tap them for the full list. Owner's call: nothing sits over the lower part of the course.

## Run it
- **Play:** double-click `index.html` (needs internet for Three.js and fonts).
- **Self-checks:** open with `?test` on the end of the address. The tab title shows `TEST PASS` or `TEST FAIL`, and the results go to the console (`window.__test`). It checks driver carry, headwind, crosswind, the ball coming to rest, putt distance (uphill aware), and firm short putts dropping.
  - `?test` doesn't survive a `file://` preview. Serve the file over http instead.
  - **macOS blocks local servers from reading `~/Documents`**, so copy `index.html` to the session scratchpad and serve it from there (a tiny Node server works; Python's `http.server` fails on `getcwd`).
- **Claude's browser pane can't reload a `file://` tab**, so *Next hole* and the Holes card do nothing there. In the pane, play from an http address instead (same Node server as above).
- **Fast syntax check before reloading:** extract the `<script type="module">` block to a `.mjs` file and run `node --check` on it.

## How the file is organised
| Section in `index.html` | What it holds |
|---|---|
| `// vectors` | maths helpers, `rng(seed)` |
| `// hole (our own format)` | `HOLE` (the course data), `materialAt`, `heightAt`, `TREES` |
| `// physics` | ball, surface and lie tables, `CLUBS`, `accel`/`rk4`, collisions (cars and tree trunks), `strike`, `simulate` |
| `// self-check` | the `?test` checks |
| `// state` | pin, wind, the simulated carry table `carryAt` |
| `// 3D` | terrain mesh, trees, look-alike cars, flag, green contours and animated slope arrows, lines |
| `// UI` | club suggestion, auto-aim, power presets, HUD, shot stats, result card, input |
| `// loop` | animation and the camera |

---

## Building a new hole
The game holds a `HOLES` array; `?hole=N` picks one (default 1). To add a hole, append an object. All 18 are in place (see the table at the top). The terrain mesh, `outOfBounds()` and tree lines now size themselves from the hole data. For the start screen and scorecard, see *Next steps*.

```js
const HOLE = {
  name: 'Tee Tree', par: 4,
  tee: [0, 0], pin: [-55, 403],          // [x, z] metres; +x = player's LEFT, z = tee → green
  wind: { mph: 6, toward_deg: 200 },      // fixed per hole; 19+ mph shows red in the HUD
  fairway: { half_width: 15, line: [[0,0],[112,-8],[197,2],[265,-8],[333,-29],[408,-56]] }, // [z, x] centreline, smoothly joined
  elevation: [[0,3],[90,1.2],[200,-1],[280,0.5],[345,4],[400,6.5],[460,7.5]],             // [z, height m]
  green: { at: [-56, 405], r: 15 },
  bunkers: [{ at: [-23, 232], r: 5 }],    // circles; overlap several for long shapes
  water: [],                              // circles, same shape as bunkers
  trees: [[1, 82, 392, 24, 16]],          // tree lines: [side +1 left / -1 right, z from, z to, inner offset from centreline, depth]
  treeClusters: [{ at: [-48, 60], r: 16 }],
  cars: [{ at: [9, -14], heading: 20, colour: '#C1121F', kind: 'hyper' }], // kind: 'hyper' | 'gt'
};
```

**Turning an aerial image into a hole** (the method used for Tee Tree):
1. Mark the tee and the green centre in image pixels. Scale = real tee-to-pin metres ÷ pixel distance (Tee Tree: 407 m over about 1,200 px, so 0.34 m/px).
2. `x = -(px - teePx) × scale` (image right = player's right = −x), and `z = (teeY - py) × scale`.
3. Trace 5–7 centreline points, the bunkers and the green, then set the pin so the yardage is exact (yd = m ÷ 0.9144).
4. Check: the HUD at the tee shows the yards to the pin. Run `?test`.

Adding a hole is now just appending to `HOLES`. The terrain mesh, `outOfBounds()`, tree lines and `FW_END` all size themselves from the hole data. Still shared by every hole:
- the green's base slope in `heightAt` (strong back to front). On top of it, each hole gets two seeded mounds or hollows (`MOUNDS`, seeded by hole number). Bunker and green outlines are wobbled circles (`blobD`), also seeded, so the data stays as circles.
- the `TREES` seed (1934), so a tree line's random scatter differs per hole only because the data differs

Lessons from hole 2:
- Trace the centreline down the middle of the corridor between the tree lines, not the painted fairway.
- On a sharp dogleg, the default pin aim points over the corner trees. That's intended: high shots can clear the trees, and shots into the branches drop.
- Clusters on the inside of a dogleg (`treeClusters`) give it its teeth.
- Check from the tee with `?hole=N&test`: the HUD yardage must match the card, and the title must read TEST PASS.

**Naming rule:** never use Augusta National, the Masters or real hole names ("Tea Olive" and so on) on the site. They're protected trademarks. The owner is researching how close the site's own wording can go: the home page says "the most famous course in the world" and the tab says *National Course*, both flagged for that check. Recreating a layout is fine. Tee Tree is LDC's name for its hole modelled on Augusta's 1st.

---

## Decisions the owner made (don't undo them)
**Mechanics**
- **Wind:** fixed per hole in the hole data (`wind: { mph, toward_deg }`, 5–20 mph; holes 8 and 15 are 19 and 20 mph so the red band appears). Some holes `swirl`. It changes drag and spin via airflow relative to the ball. **Auto-aim ignores the wind**: aiming into it is the core skill.
- **Aim:** dragging the mouse right swings the aim **left**, at 0.0011 rad per pixel. Arrow keys work but aren't shown on screen. No ◀ ▶ buttons and no "drag to aim" label (the hint reads "Set the power · swing").
- **Aim readout:** "At pin aim", or e.g. "2.4° L aim". Always shown (owner's call).
- **Wind display:** the speed, "mph" and arrow are coloured by strength: **under 10 mph chalk, 10–18 amber (`#E8A33D`), 19+ red (`#F0444E`)**. No ring around the arrow (owner: it added nothing).
- **Power:** **no penalty for full power from the tee, fairway or fringe.** Only rough and sand add seeded wobble.
- **Power (changed 28 Oct 2026):** the game suggests the club; **full shots always start at 100%**; the **putter starts at the flat distance to the pin** (5 ft away → bar reads 5 FT), with no allowance for slope. The player judges the power, the wind and the break.
- **Distance units:** golf standard: yards to the pin, feet only once the ball is on the green.
- **Cup:** drops a ball moving under 3 m/s, with a 6.6–7.4 cm catch radius, checked along the ball's path (Golf Slate's rule).
- **Trees:** trunks block shots, and canopies (shaped like the drawn cone or ball) soak up 10% of the ball's speed every 1/120 s, so a few metres of branches knocks a drive down.

**Lines and putting**
- **Full-shot aim line:** a short 14 m pointer, straight, ignoring wind.
- **Putt preview:** the real predicted roll, curving with the slope, drawn for the **first 30%** only, and **never more than 10 ft** (owner, 29 Oct: the line made long putts too easy).
- **Greens:** chalk contour lines plus arrowheads that **point downhill**, drift and fade on a loop (faster on steeper slopes). They show when putting or within 40 m.
- **Sky:** every hole is golden hour, dawn or evening, picked daily (UTC) with the sun's direction; low sun (11–17°), shader sky with drifting clouds and two hazy forest ridgelines painted round the horizon (no geometry) so high shots have a backdrop. Preview with `?sky=dawn` or `?sky=evening`.
- **Flag:** at full mast, hinged on the pole, rippling with the wind, Redline with the LDC roundel printed readably on both faces. The stick is solid above the lip (from 10 cm up), so putts can still drop with the pin in.
- **Ball and cup:** the ball eases from oversized at 40 m from the pin to **true size** at 20 m, and the cup is drawn true size (4.25 in, 4 in deep). Owner's call: what you see is exactly what drops. Don't draw either bigger again, or balls will visibly cross the hole and not drop. Green arrows are half size on a 3.4 m grid. The flagstick is a real 3/4 in thick, and there's no ring marker under the ball.

**HUD (v2, 29 Oct 2026; phone and desktop)**
- **One bar across the top:** LDC roundel (links to `/`), big hole number, hole name (always shown), "Par N · N strokes", yards (+ "to pin" on desktop), wind, aim, then icon buttons: Holes, Info (how to play), Scorecard, and Map on phones only. Phones wrap it to two rows: the buttons go left on the second row so wind and aim sit right, under the yardage (owner: desktop already has them together). The owner wants boxes consistent in height and shape.
- **Practice** is a Redline strip along the top edge of the bar, not the word.
- **Side card** under the bar on the right: shot stats (after a shot) and, on desktop, the mini map. On phones it only appears when there are stats.
- **Map on phones:** hidden behind the Map button, opens nearly full screen. It opens by itself on the first hole of each visit (`sessionStorage` `ldc.map`), and closes on Swing.
- **Ball flight:** the top bar and side card slide up, and the club, Swing and power controls slide down, both fading out (0.45 s eased). They return as the ball settles (`body.flying`). Reduced motion gets a fade.
- **Holes card:** × top right (no Close button); *Mood* (was *Ambiance*) opens the dawn/day/dusk picker. The scorecard has its own top-bar button, not a Holes card button.
- **Club button:** shows the club's **stock yardage** (full power from the fairway, fixed per club; none for the putter), e.g. *DRIVER 286 YD*. The bag grid's yardages still follow the current lie.
- **Power bar (v2, rev counter):** one solid Redline fill with a Chalk needle at its edge and tick marks (major every 10%, minor every 2%) on a Tarmac track. Readout: **yardage large on the right** (feet for putts), percentage small on the left (owner: yardage matters more). Text can't be selected while dragging.
- **Phones:** the controls have 32px either side (same height), and the picture is shifted (`camera.setViewOffset`, 12% of the height) so the ball sits lower with grass between it and the controls. Aiming is unaffected.
- **Parked (owner, 29 Oct):** joining yards, wind and aim into one strip, and moving Map under the logo on phones. Both need a desktop design too.
- **How to play:** × in the corner, Esc closes it, and the button reads *Back to game* when opened from Info (*Play* on the first visit).

**Camera**
- **One framing for aiming, flight and settling.** It follows the ball at the same distance (10 m back, 3.8 m up; putting 3.2 m / 1.3 m, moved in by the owner once ball and cup went true size), looks just past the ball so the ball sits above the controls, and keeps the line you hit until the next shot.
- Once the ball stops, the camera stays on it, then turns to face the next shot. (Bugs fixed: zooming out and back in on every shot; flying back to the tee after the ball stopped.)

**Brand (LDC Design System)**
- **Colours:** Racing Green `#0E2A1C`, Tarmac `#1B1916`, Chalk `#EDE9DF`, Redline `#C1121F` (about 3%). Never pure black or pure white.
- **Type:** Archivo Expanded 800 in caps for names and numbers, 11px tracked eyebrows, Source Serif 4 italic for the club's voice only. Minimum text size 11px.
- **Surfaces and devices:** Tarmac panels with square corners (3px on controls), no shadows or gradients. **Exception (owner, 29 Oct):** the top bar and side card are 82% Tarmac with a 10px backdrop blur so the sky shows through. A livery stripe at the **top only** (owner removed the bottom one, 29 Oct), the LDC roundel, a solid Redline power bar.
- **Copy:** sentence case, no exclamation marks, a dry line on the result card.
- **Cars:** GTA-style **look-alikes, never real brands**. On-palette liveries, with one Redline car.

---

## Next steps (agreed direction)
1. **Done:** all 18 holes, the scorecard and a global 18-hole leaderboard (Google Sheet). The owner wants **brand fun, not lead capture**.
2. **Leaderboard hardening (open):** scores are trusted as sent. To reject faked scores, send the seed and each shot's inputs so the server can rerun the round.
3. **Live page (29 Oct 2026):** the game is live at **longdriveclub.com/game-mode/** (was `/gamer/`, which now redirects). It lives in the `game-mode/` folder of github.com/PorterWills/long-drive-club, served by GitHub Pages from `main`, and that folder is now the copy that's edited. Keep the `noindex` line. **Never upload to the repo root**: on 28 Oct an upload there replaced the home page for about 15 minutes before it was reverted.
4. **Polish still open:**
   - hiding the slope arrows nearest the low putting camera, if they distract
   - a golfer character (currently just the ball; the old ring marker was removed at the owner's request)
   - better car placement (the owner says "fine for now")
   - a test option that forces a strong wind
   - checking the result card's layout in a browser

## Working with the owner
- **Never give time estimates in days or weeks.** Describe scope and complexity instead.
- **If an automated attempt fails, ask for help instead of retrying.** The owner is happy to record a video or open their own Dia.
  - To drive their real browser: `open -a Dia --args --remote-debugging-port=9222`, then use the private browsing context created over CDP.
