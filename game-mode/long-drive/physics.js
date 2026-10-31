// Long drive physics: the course game's air model (gravity, drag, Magnus lift, RK4 at 1/120 s),
// plus a flat strip and box cars. Pure functions, no three.js, so node can test it (test.mjs).
export const G = 9.81, DT = 1 / 120, YD = 0.9144, MPH = 0.44704;
export const BALL = { m: 0.04593, r: 0.021335 };
const AREA = Math.PI * BALL.r * BALL.r, RHO = 1.225;
export const v = (x, y, z) => ({ x, y, z });
const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z), sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, k) => v(a.x * k, a.y * k, a.z * k), len = a => Math.hypot(a.x, a.y, a.z);
const norm = a => { const l = len(a) || 1; return mul(a, 1 / l); };
const cross = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// the strip: +z is down the grid from the tee, x is across. The grid is 40 m wide (x within ±20)
export const GRID = { half: 20, endYd: 525 };
export const ROOF = { bounce: .55, keep: .8 }; // hard and springy: a clean landing gives about +20-30 yd
const GROUND = { bounce: .38, keep: .58, roll: .14, grip: .55 }; // the course game's fairway (SURF.fairway), so landings and roll-outs match it

// cars: heading 0 = parked along the strip. Body to `belt`, cabin from belt to h (roof inset by `rake` front and back)
export const CAR_TYPES = {
  van:    { name: 'Box van', l: 5.4, w: 2.05, h: 2.65, belt: 1.1, roofL: 4.1, roofW: 1.95, rake: .4 },
  pickup: { name: 'Pickup', l: 5.3, w: 1.95, h: 1.85, belt: 1.2, roofL: 1.4, roofW: 1.45, rake: .35, bed: 1.9 },
  estate: { name: 'Estate', l: 4.8, w: 1.85, h: 1.5, belt: .95, roofL: 2.3, roofW: 1.25, rake: .55 },
  saloon: { name: 'Saloon', l: 4.7, w: 1.85, h: 1.45, belt: .95, roofL: 1.45, roofW: 1.25, rake: .7 },
  suv:    { name: 'SUV', l: 4.8, w: 1.95, h: 1.8, belt: 1.15, roofL: 2.1, roofW: 1.4, rake: .5 },
  coupe:  { name: 'Coupe', l: 4.5, w: 1.9, h: 1.22, belt: .8, roofL: 1.05, roofW: 1.15, rake: .85 },
};
// placement by where each tier's drives land (carry, not total): Good 234-264 yd, Great 285-319,
// Monster 345-376, Perfect 401-419. Easy roofs near, small ones far, two where Perfect drives land (yards, metres across)
export const CARS = [
  { type: 'van', yd: 238, x: -7 }, { type: 'pickup', yd: 258, x: 8 }, { type: 'estate', yd: 292, x: -3 },
  { type: 'saloon', yd: 314, x: 6 }, { type: 'suv', yd: 360, x: -9 },
  { type: 'estate', yd: 405, x: 5 }, { type: 'coupe', yd: 417, x: -3 },
];
export const carBox = c => { const t = CAR_TYPES[c.type]; return { ...t, type: c.type, cx: c.x, cz: c.yd * YD }; };

function accel(vel, spin, wind) {
  const rel = sub(vel, wind), s = len(rel);
  if (s < 1e-6) return v(0, -G, 0);
  const w = len(spin), ratio = clamp(w * BALL.r / s, 0, .5);
  const cd = clamp(.17 + .33 * ratio, .16, .45), cl = Math.min(.33, .6 * Math.pow(ratio, .55));
  const q = .5 * RHO * AREA * s * s / BALL.m;
  let a = add(v(0, -G, 0), mul(rel, -cd * q / s));
  if (w > 1e-6) a = add(a, mul(norm(cross(spin, rel)), cl * q));
  return a;
}
function rk4(p, vel, spin, wind) {
  const k1v = accel(vel, spin, wind), v2 = add(vel, mul(k1v, DT / 2)), k2v = accel(v2, spin, wind);
  const v3 = add(vel, mul(k2v, DT / 2)), k3v = accel(v3, spin, wind), v4 = add(vel, mul(k3v, DT)), k4v = accel(v4, spin, wind);
  return [add(p, mul(add(add(vel, mul(v2, 2)), add(mul(v3, 2), v4)), DT / 6)),
          add(vel, mul(add(add(k1v, mul(k2v, 2)), add(mul(k3v, 2), k4v)), DT / 6))];
}

// launch: ball speed (m/s), launch angle, backspin (rpm) and spin-axis tilt (deg, + curves right)
// aim (deg, + to the right of the strip, which is -x) turns the whole launch
export function launchFor(speed, tiltDeg = 0, launchDeg = 11, rpm = 1800, aimDeg = 0) {
  const la = launchDeg * Math.PI / 180, w = rpm * 2 * Math.PI / 60, t = tiltDeg * Math.PI / 180, a = -aimDeg * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), turn = q => v(q.x * ca + q.z * sa, q.y, -q.x * sa + q.z * ca);
  return { vel: turn(v(0, speed * Math.sin(la), speed * Math.cos(la))), spin: turn(v(-w * Math.cos(t), -w * Math.sin(t), 0)) };
}

// a car hit: which part, and the ball's new velocity. Roof is hard and springy (the bonus), the rest kills the ball
function hitCars(p, np, vel, cars) {
  for (const c of cars) {
    const lx = np.x - c.cx, lz = np.z - c.cz, r = BALL.r;
    if (Math.abs(lx) > c.w / 2 + r || Math.abs(lz) > c.l / 2 + r || np.y > c.h + r) continue;
    const roofZ = c.roofL / 2, roofX = c.roofW / 2;
    if (c.bed && lz < -c.l / 2 + c.bed && np.y > c.belt * .4) return { part: 'bed', c, vel: v(0, 0, 0), stop: true, y: c.belt * .45 };
    if (p.y >= c.h - .01 && np.y <= c.h + r && Math.abs(lx) <= roofX && Math.abs(lz) <= roofZ) // landed on the roof
      return { part: 'roof', c, y: c.h + r, vel: v(vel.x * ROOF.keep, -vel.y * ROOF.bounce, vel.z * ROOF.keep) };
    if (np.y > c.belt + r) { // the cabin: glass and pillars
      const halfL = roofZ + c.rake * (c.h - np.y) / (c.h - c.belt);
      if (Math.abs(lz) > halfL || Math.abs(lx) > c.w / 2 - .1) continue;
      return { part: lz < 0 ? 'windscreen' : 'rear glass', c, vel: v(vel.x * .2 + (Math.random() - .5) * 2, Math.abs(vel.y) * .25, -vel.z * .12) };
    }
    if (p.y > c.belt + r && Math.abs(lz) < c.l / 2) return { part: lz < 0 ? 'bonnet' : 'boot', c, y: c.belt + r, vel: v(vel.x * .35, Math.abs(vel.y) * .3, vel.z * .3) };
    return { part: 'side', c, vel: v(-vel.x * .2 + (Math.random() - .5) * 2, 0, -vel.z * .15) };
  }
  return null;
}

// one drive from the tee to rest. Returns the path, carry, total, and any car contacts
export function simulate(shot, wind = v(0, 0, 0), opts = {}) {
  const cars = opts.cars || [];
  let p = v(0, .03, 0), vel = { ...shot.vel }, spin = { ...shot.spin }, t = 0, landing = null, apex = 0;
  const pts = [{ ...p }], contacts = [];
  let stopped = false, rolling = false;
  for (let i = 0; i < 40 * 120 && !stopped; i++) {
    let np, nv;
    if (!rolling) { [np, nv] = rk4(p, vel, spin, wind); spin = mul(spin, 1 - .045 * DT); }
    else { // rolling
      const s = Math.hypot(vel.x, vel.z); if (s < .08) break;
      const k = Math.max(0, s - GROUND.roll * G * DT) / s;
      nv = v(vel.x * k, 0, vel.z * k); np = add(p, mul(nv, DT)); np.y = BALL.r;
    }
    t += DT;
    const hit = cars.length && hitCars(p, np, nv, cars);
    if (hit) {
      contacts.push({ part: hit.part, type: hit.c.type, name: hit.c.name, at: { ...np }, z: hit.c.cz });
      if (hit.y !== undefined) np.y = hit.y;
      nv = hit.vel; spin = mul(spin, hit.part === 'roof' ? .5 : .1);
      if (hit.part !== 'roof') { np.x = p.x; np.z = p.z; }
      if (hit.stop) stopped = true;
    }
    apex = Math.max(apex, np.y);
    if (np.y <= BALL.r && nv.y < 0) { // ground contact
      np.y = BALL.r;
      if (!landing) landing = { ...np, t };
      const vn = -nv.y, ts = Math.hypot(nv.x, nv.z);
      const bite = clamp(len(spin) * BALL.r * .3 * GROUND.grip, 0, ts * .85), keep = Math.max(0, ts * GROUND.keep - bite);
      const k = ts > 1e-6 ? keep / ts : 0;
      nv = v(nv.x * k, vn * GROUND.bounce, nv.z * k); spin = mul(spin, .3);
      if (nv.y < .55) { nv.y = 0; rolling = true; }
    }
    p = np; vel = nv; pts.push({ ...p });
  }
  landing = landing || p;
  const yd = z => z / YD;
  return { pts, carry: yd(landing.z), total: yd(p.z), final: p, landing, apex, contacts, inGrid: Math.abs(p.x) <= GRID.half, hang: landing.t || t };
}

// the ball speed that gives this total in still air with no cars (bisection; totals rise with speed)
export function speedFor(totalYd, launchDeg, rpm) {
  let lo = 30, hi = 140;
  for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (simulate(launchFor(m, 0, launchDeg, rpm)).total < totalYd) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// the swing: release error (ms, + late) to a tier and a target total
export const TIERS = [
  { id: 'perfect', name: 'Perfect', win: 8, lo: 437, hi: 455 }, // ±8 ms: half a frame at 60 fps (owner: ±1 frame was too easy),
  { id: 'monster', name: 'Monster', win: 45, lo: 378, hi: 410 },
  { id: 'great', name: 'Great', win: 100, lo: 315, hi: 351 },
  { id: 'good', name: 'Good', win: 180, lo: 261, hi: 293 },
  { id: 'mishit', name: 'Mishit', win: Infinity, lo: 198, hi: 234 },
];
export function strike(errMs, ranOut = false) {
  const e = Math.abs(errMs);
  let i = TIERS.findIndex(t => e <= t.win); if (ranOut) i = 4;
  const T = TIERS[i], inner = i ? TIERS[i - 1].win : 0;
  const q = ranOut ? 0 : T.win === Infinity ? clamp(1 - (e - 180) / 320, 0, 1) : 1 - (e - inner) / (T.win - inner); // 1 = closest edge of the tier
  const total = T.lo + (T.hi - T.lo) * q;
  // late releases curve: the later, the more. Early ones fly straight. A run-out swing hooks
  const tilt = ranOut ? -9 : errMs > 0 ? Math.min(14, errMs * .045) : 0;
  const launch = i === 4 ? 15 : 11, rpm = i === 4 ? 3300 : 1800;
  return { tier: T, total, tilt, launch, rpm };
}
