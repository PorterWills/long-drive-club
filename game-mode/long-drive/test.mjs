// Self-check for the long drive physics: node game-mode/long-drive/test.mjs
import * as P from './physics.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
// every tier lands in its range in still air, straight
for (const T of P.TIERS) for (const q of [0, 1]) {
  const e = T.id === 'perfect' ? q * T.win : T.id === 'mishit' ? 181 + q * 300 : -(P.TIERS[P.TIERS.indexOf(T) - 1].win + 1 + q * (T.win - P.TIERS[P.TIERS.indexOf(T) - 1].win - 2));
  const k = P.strike(e), r = P.simulate(P.launchFor(P.speedFor(k.total, k.launch, k.rpm), k.tilt, k.launch, k.rpm));
  ok(k.tier.id === T.id && r.total >= T.lo - 3 && r.total <= T.hi + 3, `${T.name} (err ${Math.round(e)} ms): ${Math.round(r.total)} yd, ${T.lo}-${T.hi}`);
}
// Perfect ball speed stays believable (World Long Drive range)
const sp = P.speedFor(505, 11, 1800) / P.MPH; ok(sp > 215 && sp < 245, `Perfect ball speed ${Math.round(sp)} mph`);
// a clean roof landing adds about 20-30 yd: aim the roof's centre on the near cars
const cars = P.CARS.map(P.carBox);
for (const c of cars.slice(0, 3)) {
  let got = null;
  for (let tot = 250; tot <= 470 && !got; tot += .5) {
    const s = P.speedFor(tot, 11, 1800), base = P.simulate(P.launchFor(s, 0, 11, 1800));
    const dz = base.landing.z - c.cz; if (dz < -1 || dz > 6) continue; // the roof is met a few metres before the ground
    const aim = -Math.atan2(c.cx, base.landing.z) * 180 / Math.PI;
    const r = P.simulate(P.launchFor(s, 0, 11, 1800, aim), undefined, { cars }), f = P.simulate(P.launchFor(s, 0, 11, 1800, aim));
    if (r.contacts[0]?.part === 'roof') got = r.total - f.total;
  }
  ok(got !== null && got >= 15 && got <= 32, `roof bonus off the ${c.name.toLowerCase()}: ${got === null ? 'no hit' : '+' + Math.round(got) + ' yd'}`);
}
process.exit(fail ? 1 : 0);
