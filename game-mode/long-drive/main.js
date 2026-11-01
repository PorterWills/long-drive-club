// The long drive: a floodlit strip at night, one driver, hold and release. Spec: ../LONG-DRIVE.md
import * as THREE from 'three';
import { DRIVE } from './sounds.js';
import { simulate, launchFor, speedFor, strike, CARS, CAR_TYPES, carBox, GRID, YD, MPH, BALL, BOUNCES, v } from './physics.js';

const $ = id => document.getElementById(id);
const QS = new URLSearchParams(location.search);
const RECORD = 515;

// ---------- renderer, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true }); // owner: the lit ground flickered in flight. The grass, strip, grid and lines are stacked a few mm apart and fought for depth once the camera was far out
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x070b09, 0.0021);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 3000);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const rng = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(20261031);
const END = GRID.endYd * YD, LEN = END + 60; // strip runs a little past the last board

// ---------- sky: night, a faint glow on the horizon, stars ----------
scene.add(new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `varying vec3 p; void main(){
    float h = max(p.y, 0.);
    vec3 c = mix(vec3(.075,.095,.08), vec3(.012,.018,.022), pow(h, .45));
    c += vec3(.16,.13,.09) * exp(-abs(p.y) * 28.) * .5;
    gl_FragColor = vec4(c, 1.); }`,
})));
{ const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = rng() * 6.283, e = .08 + Math.pow(rng(), .7) * 1.4; pos.set([Math.cos(a) * Math.cos(e) * 1800, Math.sin(e) * 1800, Math.sin(a) * Math.cos(e) * 1800], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfc9bb, size: 1.6, sizeAttenuation: false, transparent: true, opacity: .55, fog: false }))); }
// distant lights on the horizon: warm, a few Redline
{ const n = 260, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rng() * 6.283, d = 900 + rng() * 500;
    pos.set([Math.cos(a) * d, 1 + rng() * 6, LEN / 2 + Math.sin(a) * d], i * 3);
    const red = rng() < .06; col.set(red ? [.76, .07, .12] : [.95, .89, .77].map(x => x * (.5 + rng() * .5)), i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false }))); }

// ---------- ground and strip ----------
function noiseTex(base, amp, size = 256, rep = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const im = g.getImageData(0, 0, size, size), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const k = (rng() - .5) * amp; d[i] += k; d[i + 1] += k; d[i + 2] += k; }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const grassTex = noiseTex('#16211a', 26, 256); grassTex.repeat.set(160, 160);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: .95 }));
grass.rotation.x = -Math.PI / 2; grass.position.set(0, -.06, LEN / 2); scene.add(grass);
const tarTex = noiseTex('#2a2824', 34, 256); tarTex.repeat.set(10, 80);
const strip = new THREE.Mesh(new THREE.PlaneGeometry(68, LEN + 40), new THREE.MeshStandardMaterial({ map: tarTex, roughness: .42, metalness: .05 }));
strip.rotation.x = -Math.PI / 2; strip.position.set(0, -.03, LEN / 2 - 20); scene.add(strip);
// the grid: a finer, short grass surface laid inside the lines
const gridTex = noiseTex('#24302a', 18, 256); gridTex.repeat.set(4, 60);
const gridSurf = new THREE.Mesh(new THREE.PlaneGeometry(GRID.half * 2, END), new THREE.MeshStandardMaterial({ map: gridTex, roughness: .8 }));
gridSurf.rotation.x = -Math.PI / 2; gridSurf.position.set(0, -.005, END / 2); scene.add(gridSurf);
// painted lines
const lineMat = new THREE.MeshBasicMaterial({ color: 0xede9df, transparent: true, opacity: .75 });
const line = (x, z, w, l, o = 1) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), o === 1 ? lineMat : new THREE.MeshBasicMaterial({ color: 0xede9df, transparent: true, opacity: o })); m.rotation.x = -Math.PI / 2; m.position.set(x, .006, z); scene.add(m); };
line(GRID.half, END / 2, .15, END); line(-GRID.half, END / 2, .15, END);
for (let yd = 25; yd <= GRID.endYd; yd += 25) line(0, yd * YD, GRID.half * 2, yd % 100 ? .08 : .14, yd % 100 ? .4 : .75);
for (let z = 8; z < END; z += 9) line(0, z, .08, 3.5, .25);


// ---------- tee: a low slab, chalk lines, one Redline edge ----------
const slab = new THREE.Mesh(new THREE.BoxGeometry(4, .3, 4), new THREE.MeshStandardMaterial({ color: 0x24221e, roughness: .7 }));
slab.position.set(0, -.15, -1.1); scene.add(slab);
const edge = new THREE.Mesh(new THREE.BoxGeometry(4, .3, .06), new THREE.MeshStandardMaterial({ color: 0xc1121f, roughness: .6 }));
edge.position.set(0, -.15, .93); scene.add(edge);
const tee = new THREE.Mesh(new THREE.CylinderGeometry(.004, .002, .03, 8), new THREE.MeshStandardMaterial({ color: 0xcfc9bb }));
tee.position.set(0, .015, 0); scene.add(tee);

// ---------- yardage boards ----------
function board(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#1b1916'; g.fillRect(0, 0, 256, 128); g.strokeStyle = 'rgba(237,233,223,.5)'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 120);
  g.fillStyle = '#ede9df'; g.font = '800 64px Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const grp = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: t, roughness: .6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: .35 }));
  face.position.y = 1.9; face.rotation.y = Math.PI; grp.add(face);
  const post = new THREE.Mesh(new THREE.BoxGeometry(.08, 1.3, .08), new THREE.MeshStandardMaterial({ color: 0x3a3631 })); post.position.y = .65; grp.add(post);
  return grp;
}
const boardsToDraw = () => { for (let yd = 50; yd <= GRID.endYd; yd += 25) for (const s of yd % 50 ? [1] : [1, -1]) { const b = board(String(yd)); b.position.set(s * (GRID.half + 2.2), 0, yd * YD); scene.add(b); } };
document.fonts.ready.then(boardsToDraw);

// ---------- floodlights: towers down both sides, pools of light, dark gaps ----------
scene.add(new THREE.HemisphereLight(0x2a3a44, 0x0a0c0a, .5));
const towerMat = new THREE.MeshStandardMaterial({ color: 0x2e2b26, roughness: .8 });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6e4 });
const TOWERS = []; for (let z = 10, i = 0; z < END + 30; z += 62, i++) TOWERS.push([i % 2 ? 40 : -40, z]);
const SPOTS = [];
for (const [x, z] of TOWERS) {
  const H = 30, pole = new THREE.Mesh(new THREE.CylinderGeometry(.25, .45, H, 8), towerMat); pole.position.set(x, H / 2, z); scene.add(pole);
  const head = new THREE.Mesh(new THREE.BoxGeometry(5, 1.4, .4), headMat); head.position.set(x, H + .6, z); head.lookAt(0, 0, z + 8); scene.add(head);
  const sp = new THREE.SpotLight(0xffeccc, 4200, 170, .62, .75, 1.6); sp.position.set(x, H, z); sp.target.position.set(x * .15, 0, z + 14); scene.add(sp, sp.target); SPOTS.push(sp);
}
// runway edge lights
{ const n = Math.ceil(LEN / 20) * 2, g = new THREE.SphereGeometry(.09, 8, 6), m = new THREE.MeshBasicMaterial({ color: 0xf2e4c4 }), inst = new THREE.InstancedMesh(g, m, n), M = new THREE.Matrix4(); let k = 0;
  for (let z = 0; z < LEN; z += 20) for (const x of [-34, 34]) { M.makeTranslation(x, .12, z); inst.setMatrixAt(k++, M); }
  scene.add(inst); }

// ---------- cars, built from the car sheet ----------
const PAINT = { van: 0xb9b7b0, pickup: 0x4a463f, estate: 0x1e4a33, saloon: 0x3a3d40, suv: 0xe4e0d5, coupe: 0xc1121f };
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0b1113, roughness: .08, metalness: .2, clearcoat: 1 });
const tyreMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: .9 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0a0f, emissive: 0xc1121f, emissiveIntensity: 1.4 });
function cabinGeo(c) { // a box whose top is pulled in to the roof: the raked glass
  const g = new THREE.BoxGeometry(c.w - .08, c.h - c.belt, c.roofL + 2 * c.rake), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setZ(i, Math.sign(p.getZ(i)) * c.roofL / 2); p.setX(i, Math.sign(p.getX(i)) * (c.roofW / 2 + .05)); }
  g.computeVertexNormals(); return g;
}
const CAR_BOXES = CARS.map(carBox);
for (const c of CAR_BOXES) {
  const paint = new THREE.MeshPhysicalMaterial({ color: PAINT[c.type], roughness: .32, metalness: .55, clearcoat: .8, clearcoatRoughness: .2 });
  const g = new THREE.Group(); g.position.set(c.cx, 0, c.cz);
  const clr = .2, body = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.belt - clr, c.l), paint); body.position.y = clr + (c.belt - clr) / 2; g.add(body);
  if (c.type === 'van') { const box = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h - c.belt, c.roofL), paint); box.position.set(0, c.belt + (c.h - c.belt) / 2, -.2); g.add(box);
    const ws = new THREE.Mesh(new THREE.BoxGeometry(c.w - .1, (c.h - c.belt) * .55, .05), glassMat); ws.position.set(0, c.belt + (c.h - c.belt) * .55, c.roofL / 2 - .17); g.add(ws); }
  else { const cab = new THREE.Mesh(cabinGeo(c), glassMat); cab.position.y = c.belt + (c.h - c.belt) / 2; g.add(cab); }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(c.roofW, .04, c.roofL), paint); roof.position.set(0, c.h - .02, c.type === 'van' ? -.2 : 0); g.add(roof);
  if (c.bed) { const bed = new THREE.Mesh(new THREE.BoxGeometry(c.w - .2, .05, c.bed), tyreMat); bed.position.set(0, c.belt * .45, -c.l / 2 + c.bed / 2 + .05); g.add(bed); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .24, 18), tyreMat); w.rotation.z = Math.PI / 2; w.position.set(sx * (c.w / 2 - .1), .34, sz * (c.l / 2 - .85)); g.add(w); }
  for (const sx of [-1, 1]) { const t = new THREE.Mesh(new THREE.BoxGeometry(.4, .1, .04), tailMat); t.position.set(sx * (c.w / 2 - .3), c.belt - .15, -c.l / 2 - .01); g.add(t); }
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(c.w * 1.3, c.l * 1.15), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .55, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = .004; g.add(sh);
  scene.add(g);
}

// ---------- ball and trail ----------
const DRAWN = .07; // drawn radius: the real ball is a speck at this range, so it's drawn bigger (as on the course)
const ball = new THREE.Mesh(new THREE.SphereGeometry(DRAWN, 24, 16), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: .35, emissive: 0x333333 }));
scene.add(ball);
const ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,248,232,.9)'); r.addColorStop(1, 'rgba(255,248,232,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(ballGlow);
// Perfect only (owner, 1 Nov 2026): no glow on ordinary shots. A Perfect strike sends out a ring at impact, then the ball glows and pulses, shedding a ring every .5 s
const ringTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 40, 64, 64, 62);
  r.addColorStop(0, 'rgba(156,203,174,0)'); r.addColorStop(.7, 'rgba(225,240,230,.9)'); r.addColorStop(1, 'rgba(156,203,174,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
const RINGS = Array.from({ length: 6 }, () => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); m.visible = false; scene.add(m); return { m, t0: 0, size: 1 }; });
let ringNext = 0;
function ring(pos, size, now) { const r = RINGS.find(r => !r.m.visible) || RINGS[0]; r.m.position.copy(pos); r.t0 = now; r.size = size; r.m.visible = true; }
let perfectT0 = 0; // when the Perfect strike happened; 0 = not a Perfect
const TRAIL_N = 6000, trailPos = new Float32Array(TRAIL_N * 3), trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3)); trailGeo.setDrawRange(0, 0);
scene.add(new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xf4f1ea, transparent: true, opacity: .55 })));

// ---------- sound (WebAudio, made in code) ----------
let AC; const ac = () => (AC = AC || new (window.AudioContext || window.webkitAudioContext)());
function tone(type, freq, dur, gain, at = 0) { const a = ac(), o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(gain, a.currentTime + at); g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + at + dur); o.connect(g).connect(a.destination); o.start(a.currentTime + at); o.stop(a.currentTime + at + dur); }
function noise(dur, gain, lp, at = 0) { const a = ac(), b = a.createBuffer(1, a.sampleRate * dur, a.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); s.buffer = b; f.type = 'lowpass'; f.frequency.value = lp; g.gain.value = gain; s.connect(f).connect(g).connect(a.destination); s.start(a.currentTime + at); }
// the driver strike: the course game's recorded clip. Pure strikes play it full and crisp; mishits lower and duller
let driveBuf = null, driveLoad = null;
const loadDrive = () => driveLoad = driveLoad || ac().decodeAudioData(Uint8Array.from(atob(DRIVE), c => c.charCodeAt(0)).buffer).then(b => driveBuf = b).catch(() => {});
function playDrive(q) {
  const a = ac(), src = a.createBufferSource(), g = a.createGain();
  src.buffer = driveBuf; src.playbackRate.value = (.9 + .1 * q) * (.98 + Math.random() * .04); g.gain.value = .9 + .9 * q;
  src.connect(g).connect(a.destination); src.start();
}
const SND = {
  strike: q => { if (driveBuf) return playDrive(q); loadDrive().then(() => driveBuf ? playDrive(q) : (noise(.12, .9, 6000 + q * 4000), tone('triangle', 1100 + q * 500, .09, .25))); },
  // owner: the old glass crash was terrible. Metal: a short, damped tonk off a car panel. Glass or sides: a dull thud
  roof: () => { tone('sine', 410, .22, .12); tone('sine', 1150, .08, .04); noise(.04, .25, 2200); },
  glass: () => { tone('sine', 140, .18, .2); noise(.07, .3, 900); },
  land: s => noise(.08, Math.min(.5, s / 30), 1400),
};

// ---------- the dial: the rev counter from the owner's Claude Design canvas (Component · Rev counter), without the HOLD word ----------
// 0 to 9 round 270°. The green window is the mark, the red arc from 8 is past it, 9 is the end stop
const SVGNS = 'http://www.w3.org/2000/svg', REV = $('rev');
const ang = u => -135 + u / 9 * 270, P = (R, u) => { const a = ang(u) * Math.PI / 180; return [150 + R * Math.sin(a), 150 - R * Math.cos(a)]; };
const f2 = n => (Math.round(n * 100) / 100).toString();
const arc = (R, u1, u2) => { const a = P(R, u1), b = P(R, u2); return `M${f2(a[0])},${f2(a[1])} A${R},${R} 0 ${(u2 - u1) / 9 * 270 > 180 ? 1 : 0} 1 ${f2(b[0])},${f2(b[1])}`; };
const el = (tag, at, parent = REV) => { const e = document.createElementNS(SVGNS, tag); for (const k in at) e.setAttribute(k, at[k]); parent.append(e); return e; };
{
  const defs = el('defs', {}), fl = el('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs); el('feGaussianBlur', { stdDeviation: 3 }, fl);
  el('circle', { cx: 150, cy: 150, r: 147, fill: '#121110', stroke: 'rgba(237,233,223,0.22)', 'stroke-width': 1.5 });
  el('circle', { cx: 150, cy: 150, r: 139, fill: 'none', stroke: 'rgba(237,233,223,0.07)', 'stroke-width': 1 });
  el('path', { d: arc(134, 0, 9), stroke: 'rgba(237,233,223,0.10)', 'stroke-width': 6, fill: 'none' });
  el('path', { d: arc(134, 8, 9), stroke: '#C1121F', 'stroke-width': 9, fill: 'none', opacity: .7 });
  let ticks = '', red = '';
  for (let i = 0; i <= 36; i++) { const u = i / 4, r1 = i % 4 === 0 ? 110 : i % 2 === 0 ? 118 : 122, a = P(r1, u), b = P(128, u), d = `M${f2(a[0])},${f2(a[1])} L${f2(b[0])},${f2(b[1])} `; if (u >= 8) red += d; else ticks += d; }
  el('path', { d: ticks, stroke: 'rgba(237,233,223,0.55)', 'stroke-width': 2, fill: 'none' });
  el('path', { d: red, stroke: '#C1121F', 'stroke-width': 2, fill: 'none' });
  const s1 = P(104, 9), s2 = P(142, 9); el('path', { d: `M${f2(s1[0])},${f2(s1[1])} L${f2(s2[0])},${f2(s2[1])}`, stroke: '#EDE9DF', 'stroke-width': 4, fill: 'none' });
  for (let u = 0; u <= 9; u++) { const p = P(90, u), t = el('text', { x: f2(p[0]), y: f2(p[1] + 6), 'text-anchor': 'middle', 'font-family': 'Archivo, sans-serif', 'font-weight': 800, 'font-size': 17, fill: u >= 8 ? '#E8A2A6' : '#EDE9DF', style: 'font-variation-settings:"wdth" 122' }); t.textContent = u; }
  const t = el('text', { x: 150, y: 112, 'text-anchor': 'middle', 'font-family': 'Archivo, sans-serif', 'font-size': 9, 'letter-spacing': 2.2, fill: '#CFC9BB' }); t.textContent = '×1000 R/MIN';
}
const markGlow = el('path', { stroke: '#9CCBAE', 'stroke-width': 16, fill: 'none', opacity: 0, filter: 'url(#glow)' });
const markArc = el('path', { stroke: '#7FA88F', 'stroke-width': 9, fill: 'none' });
const LEDS = [[101, 10], [115, 10], [129, 10], [143, 14], [161, 10], [175, 10], [189, 10]].map(([x, w]) => el('rect', { x, y: 68, width: w, height: 6, fill: '#2A2723' }));
const needle = el('polygon', { points: '147.2,166 152.8,166 151,34 149,34', fill: '#EDE9DF' });
el('circle', { cx: 150, cy: 150, r: 14, fill: '#1B1916', stroke: 'rgba(237,233,223,0.34)', 'stroke-width': 1.5 });
el('circle', { cx: 150, cy: 150, r: 4, fill: '#C1121F' });
const powerTxt = el('text', { x: 150, y: 212, 'text-anchor': 'middle', 'font-family': 'Archivo, sans-serif', 'font-size': 10, 'letter-spacing': 2.6, fill: '#CFC9BB' });

const SWING = { T: 1.5, pow: 1.7, grace: .12 }; // needle reaches the end in about 1.5 s (1.3 to 1.7, new each swing), speeding up; held .12 s past the end, the swing falls apart
let MARK = .84; // as a fraction of the dial; 9 * MARK on the scale
const tAt = f => SWING.T * Math.pow(f, 1 / SWING.pow); // time the needle reaches f
function drawDial(f, limiter = false) {
  const u = 9 * Math.min(1, f), mu = 9 * MARK;
  needle.setAttribute('transform', `rotate(${f2(ang(u) + (limiter ? (Math.random() - .5) * 6 : 0))} 150 150)`);
  needle.setAttribute('fill', limiter ? '#C1121F' : '#EDE9DF');
  // shift lights fill up over the last 3.5 on the way to the mark, all lit in the window; past the red line they turn red; on the limiter they flash
  const lit = Math.max(0, Math.min(7, Math.floor((u - (mu - 3.5)) / .5)));
  const col = u >= 8 ? '#E0313D' : Math.abs(u - mu) < .2 ? '#9CCBAE' : '#7FA88F';
  LEDS.forEach((r, i) => r.setAttribute('fill', (limiter ? (i % 2 === 0) !== (Math.floor(performance.now() / 90) % 2 === 0) : i < lit) ? col : '#2A2723'));
  markGlow.setAttribute('opacity', Math.abs(u - mu) < .25 ? .9 : 0);
  powerTxt.textContent = f > 0 ? `POWER ${Math.round(Math.min(1, f) / MARK * 100)}` : '';
}
function placeMark() {
  MARK = .8 + rng() * .07; SWING.T = 1.3 + rng() * .4; // the mark (7.2 to 7.8 on the scale) and the needle's pace change each swing, so the timing can't be learnt by rote
  const w = .012; markArc.setAttribute('d', arc(134, 9 * (MARK - w), 9 * (MARK + w))); markGlow.setAttribute('d', markArc.getAttribute('d'));
}

// ---------- state ----------
const STORE = 'ldc.longdrive.v2'; // v2: distances changed on 31 Oct 2026, so bests from the first build don't carry over
const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
const save = s => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch {} };
const today = () => new Date().toISOString().slice(0, 10);
let ME = load(); if (ME.day !== today()) { ME.day = today(); ME.best = 0; save(ME); }
const showBest = () => $('best').textContent = ME.best ? `${Math.round(ME.best)} yd` : 'None yet';
showBest();

// no wind: the owner wants still air every swing (a bit of fun, not a weather test)
let aim = 0; const AIM_MAX = 4;
function setAim(a) { aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, Math.round(a * 2) / 2)); $('aimTxt').textContent = aim ? `${Math.abs(aim)}° ${aim > 0 ? 'right' : 'left'}` : 'Straight'; }
$('aimL').onclick = () => setAim(aim - .5); $('aimR').onclick = () => setAim(aim + .5);

let phase = 'ready', holdStart = 0, shot = null, play = 0, result = null;
function ready() {
  phase = 'ready'; document.body.classList.remove('flying', 'done');
  placeMark(); drawDial(0);
  ball.position.set(0, .03 + BALL.r, 0); ball.scale.setScalar(BALL.r / DRAWN * 1.0); ballGlow.visible = false; perfectT0 = 0; RINGS.forEach(r => r.m.visible = false); trailGeo.setDrawRange(0, 0);
}
function press(t) { if (phase !== 'ready') return; ac(); loadDrive(); phase = 'hold'; holdStart = t; }
function release(t, ranOut = false) {
  if (phase !== 'hold') return;
  const held = (t - holdStart) / 1000, err = ranOut ? 999 : (held - tAt(MARK)) * 1000;
  const k = strike(err, ranOut);
  const speed = speedFor(k.total, k.launch, k.rpm);
  const run = simulate(launchFor(speed, k.tilt, k.launch, k.rpm, aim), undefined, { cars: CAR_BOXES });
  const free = simulate(launchFor(speed, k.tilt, k.launch, k.rpm, aim));
  result = { k, err, speed, run, free, ranOut };
  if (QS.has('debug')) console.log('release', { held, err: Math.round(err), tier: k.tier.id, target: Math.round(k.total), total: Math.round(run.total), contacts: run.contacts });
  SND.strike(k.tier.id === 'perfect' ? 1 : k.tier.id === 'mishit' ? 0 : .5);
  phase = 'fly'; play = 0; shot = run; document.body.classList.add('flying');
  flash(k.tier.id === 'perfect' ? 'Perfect' : '');
  if (k.tier.id === 'perfect') { perfectT0 = performance.now(); ringNext = perfectT0 + 500; ring(ball.position, 3, perfectT0); }
}
let flashT; function flash(t) { clearTimeout(flashT); $('flash').textContent = t; $('flash').classList.toggle('on', !!t); if (t) flashT = setTimeout(() => $('flash').classList.remove('on'), 1600); }

// keyboard: Space holds (key repeat ignored), arrows aim. Event timestamps, not frames, time the release
addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); if (e.repeat) return; if (phase === 'done') return void ready(); press(e.timeStamp); }
  if (phase === 'ready' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setAim(aim + (e.key === 'ArrowLeft' ? -.5 : .5)); }
});
addEventListener('keyup', e => { if (e.code === 'Space') { e.preventDefault(); release(e.timeStamp); } });
$('dial').addEventListener('pointerdown', e => { e.preventDefault(); $('dial').setPointerCapture(e.pointerId); press(e.timeStamp); });
$('dial').addEventListener('pointerup', e => release(e.timeStamp));
$('dial').addEventListener('pointercancel', e => release(e.timeStamp));
$('dial').addEventListener('keydown', e => { if (e.code === 'Enter') e.preventDefault(); });
$('again').onclick = () => ready();
if (matchMedia('(pointer: coarse)').matches) $('hint').textContent = 'Hold the dial for the backswing. Let go on the mark.';

// ---------- result ----------
const PART = { roof: 'the roof', windscreen: 'the windscreen', 'rear glass': 'the rear window', bonnet: 'the bonnet', boot: 'the boot lid', side: 'the side', bed: 'the bed' };
function finish() {
  const { k, run, free, speed, ranOut } = result;
  phase = 'done'; document.body.classList.remove('flying'); document.body.classList.add('done');
  const total = run.total, roofHit = run.contacts.find(c => BOUNCES.includes(c.part)), hazard = run.contacts.find(c => !BOUNCES.includes(c.part));
  const bonus = roofHit && !hazard ? Math.max(0, total - free.total) : 0;
  $('tier').textContent = k.tier.name; $('tier').className = 'display ' + k.tier.id;
  $('total').innerHTML = `${Math.round(total)}<small>YD</small>`;
  $('rSpeed').textContent = `${Math.round(speed / MPH)} mph`;
  $('rCarry').textContent = `${Math.round(run.carry)} yd`;
  $('rRoll').textContent = `${Math.max(0, Math.round(total - run.carry))} yd`;
  $('rRoof').textContent = bonus ? `+${Math.round(bonus)} yd` : 'None';
  const L = [];
  if (ranOut) L.push('Held too long. The swing came apart.');
  if (roofHit) L.push(`Off ${PART[roofHit.part]} of the ${roofHit.name.toLowerCase()} at ${Math.round(roofHit.z / YD)} yd.`);
  if (hazard) L.push(`Into ${PART[hazard.part]} of the ${hazard.name.toLowerCase()}.`);
  L.push(run.inGrid ? 'Inside the grid.' : 'Outside the grid. It doesn\'t count.');
  let status = false;
  if (run.inGrid) {
    if (total > (ME.best || 0)) { ME.best = total; }
    if (k.tier.id === 'perfect' && !ME.status) { ME.status = today(); status = true; }
    save(ME); showBest();
  }
  if (run.inGrid && total > RECORD) L.push('Past 515 yd. Further than the world record.');
  $('lines').innerHTML = (status ? '<div class="status voice">Welcome to the Long Drive Club.</div>' : '') +
    L.map(t => `<div class="${t.startsWith('Outside') ? 'muted' : ''}">${t}</div>`).join('');
  $('again').focus({ preventScroll: true });
}

// ---------- camera ----------
const camPos = new THREE.Vector3(0, 2.4, -8), camLook = new THREE.Vector3(0, 1, 60);
const want = new THREE.Vector3(), wantLook = new THREE.Vector3();
function frameCamera(dt) {
  const b = ball.position;
  if (phase === 'ready' || phase === 'hold') { want.set(0, 1.5, -5); wantLook.set(-aim * 1.2, .7, 40); }
  else if (phase === 'fly') { want.set(b.x * .6, Math.max(2.4, b.y * .55 + 3), b.z - 22); wantLook.set(b.x, b.y * .8 + 1, b.z + 30); }
  else { want.set(b.x + 9, 4, b.z - 14); wantLook.set(b.x, .5, b.z + 4); }
  const k = 1 - Math.exp(-dt * (phase === 'fly' ? 3.2 : 2.2));
  camPos.lerp(want, k); camLook.lerp(wantLook, k);
  camera.position.copy(camPos); camera.lookAt(camLook);
}
camPos.copy(want.set(0, 1.5, -5)); camLook.set(0, .7, 40);

// ---------- loop ----------
let last = performance.now(), contactsShown = 0;
const SPEED_UP = 1.15; // the course game's playback speed
function tick(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (phase === 'hold') {
    const held = (performance.now() - holdStart) / 1000;
    drawDial(Math.pow(Math.min(held, SWING.T) / SWING.T, SWING.pow), held > SWING.T);
    if (held > SWING.T + SWING.grace) release(holdStart + (SWING.T + SWING.grace) * 1000, true);
  }
  if (phase === 'fly' && shot) {
    play += dt * 120 * SPEED_UP;
    const i = Math.min(shot.pts.length - 1, Math.floor(play)), f = Math.min(1, play - i), a = shot.pts[i], b = shot.pts[Math.min(shot.pts.length - 1, i + 1)];
    ball.position.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
    const n = Math.min(TRAIL_N, i + 1); for (let j = 0; j < n; j++) { const p = shot.pts[j]; trailPos[j * 3] = p.x; trailPos[j * 3 + 1] = p.y; trailPos[j * 3 + 2] = p.z; }
    trailPos.set([ball.position.x, ball.position.y, ball.position.z], (n - 1) * 3);
    trailGeo.attributes.position.needsUpdate = true; trailGeo.setDrawRange(0, n);
    for (; contactsShown < shot.contacts.length; contactsShown++) { const c = shot.contacts[contactsShown]; if (c.at.z > ball.position.z + .5) break; BOUNCES.includes(c.part) ? SND.roof() : SND.glass(); }
    if (i >= shot.pts.length - 1) { contactsShown = 0; finish(); }
  }
  // the drawn ball grows with distance from the camera so it stays visible; true size at the tee
  const d = camera.position.distanceTo(ball.position), s = Math.max(BALL.r / DRAWN * 1.6, Math.min(2.2, d * .0042 / DRAWN * 1.0));
  ball.scale.setScalar(s);
  ballGlow.visible = !!perfectT0 && (phase === 'fly' || phase === 'done');
  if (ballGlow.visible) {
    const t = (now - perfectT0) / 1000, pulse = .5 + .5 * Math.sin(t * Math.PI * 2 * 1.8); // 1.8 pulses a second
    ballGlow.position.copy(ball.position); ballGlow.scale.setScalar(s * DRAWN * (7 + 6 * pulse)); ballGlow.material.opacity = .55 + .45 * pulse;
    if (phase === 'fly' && now >= ringNext) { ringNext = now + 500; ring(ball.position, s * DRAWN * 26, now); }
  }
  for (const r of RINGS) if (r.m.visible) { const k = (now - r.t0) / 900; if (k >= 1) { r.m.visible = false; continue; } r.m.scale.setScalar(r.size * (.3 + 1.7 * k)); r.m.material.opacity = (1 - k) * (1 - k); }
  frameCamera(dt);
  renderer.render(scene, camera);
  if (FPS) FPS(dt);
  requestAnimationFrame(tick);
}
const FPS = QS.has('fps') ? (() => { const el = Object.assign(document.createElement('div'), { id: 'fps' }); document.body.append(el); let n = 0, acc = 0; return dt => { n++; acc += dt; if (acc > .5) { el.textContent = `${Math.round(n / acc)} fps · ${renderer.info.render.calls} calls`; n = acc = 0; } }; })() : null;
if (QS.has('debug')) window.__ld = { markMs: () => tAt(MARK) * 1000, phase: () => phase };
ready();
requestAnimationFrame(tick);
