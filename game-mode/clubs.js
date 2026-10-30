// The club set: four clubs built from the owner's reference sheet (Claude Design, "The Club Set", Rev A, Oct 2026).
// Sizes are the sheet's, in inches. Each club is built with the ground datum (where the shaft axis meets the sole line)
// at the origin, the face looking down +z (the target), the toe out to +x and the shaft leaning up to -x (right-handed:
// the player stands on the left of the ball, looking from behind). No logos, text or paint fill anywhere.
import * as THREE from 'three';

const IN = 0.0254, rad = d => d * Math.PI / 180;

// four finishes; the sheet gives metal/roughness starting points
const FINISH = {
  chrome: { color: '#C8CCD0', metalness: 1, roughness: .3 },
  satin:  { color: '#1C1B19', metalness: .6, roughness: .45 },
  steel:  { color: '#B9BEC3', metalness: 1, roughness: .18 },
  rubber: { color: '#111111', metalness: 0, roughness: .85 },
};

// one head per kind; length, loft and lie per club in the bag (the 5, 7 and 9 irons share a head, as do the two wedges)
export const CLUB_KIT = {
  dr: { kind: 'driver', length: 45.5, loft: 10.5, lie: 58 },
  '3w': { kind: 'driver', length: 43, loft: 15, lie: 58.5, head: .8 }, // the driver's head, smaller
  '5i': { kind: 'iron', length: 38, loft: 27, lie: 61.5 },
  '7i': { kind: 'iron', length: 37, loft: 34, lie: 62.5 },
  '9i': { kind: 'iron', length: 36, loft: 42, lie: 63.5 },
  pw: { kind: 'wedge', length: 35.75, loft: 46, lie: 63.5 },
  sw: { kind: 'wedge', length: 35.5, loft: 56, lie: 64 },
  pt: { kind: 'putter', length: 34, loft: 3, lie: 70 },
};

// iron and wedge blade: the face outline, heel at x=0, sole at y=0 (inches)
function blade(heelToe, toeH, heelH) {
  const s = new THREE.Shape();
  s.moveTo(0, .05); s.lineTo(heelToe - .5, 0);                                     // straight leading edge along the sole
  s.quadraticCurveTo(heelToe + .05, .05, heelToe, toeH * .55);                     // rounded toe
  s.quadraticCurveTo(heelToe - .1, toeH, heelToe - .9, toeH * .97);
  s.lineTo(.15, heelH);                                                            // thin top line falling to the heel
  s.lineTo(0, heelH * .8);
  return s;
}

function head(kind, m, size = 1) {
  const g = new THREE.Group();
  if (kind === 'driver') { // pear-shaped from above, deep face, chrome body under a dark satin crown
    const w = 4.9 * size, d = 4.6 * size, h = 2.4 * size;
    const body = new THREE.Mesh(new THREE.SphereGeometry(.5, 32, 20), m.chrome);
    body.scale.set(w, h, d); body.position.set(w * .55, h * .5, -d * .45);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(.5, 32, 12, 0, Math.PI * 2, 0, Math.PI * .42), m.satin);
    crown.scale.set(w * 1.005, h * 1.02, d * 1.005); crown.position.copy(body.position);
    g.add(body, crown);
    g.userData.face = new THREE.Vector3(w * .55, h * .45, 0);
  } else if (kind === 'iron' || kind === 'wedge') { // classic blade; the wedge taller, rounder at the toe, wider soled
    const wedge = kind === 'wedge', ht = wedge ? 3.35 : 3.4, th = wedge ? 2.35 : 2, sole = wedge ? 1.05 : .75;
    const geo = new THREE.ExtrudeGeometry(blade(ht, th, th * .45), { depth: sole, bevelEnabled: true, bevelThickness: .06, bevelSize: .06, bevelSegments: 2, curveSegments: 12 });
    geo.translate(0, 0, -sole); // face on z=0, the back of the blade behind it
    g.add(new THREE.Mesh(geo, m.chrome));
    g.userData.face = new THREE.Vector3(ht * .5, th * .4, 0);
  } else { // putter: a low, wide, deep mallet that steps down behind the face, with a milled face insert
    const w = 4.4, d = 3.85, h = .95;
    const front = new THREE.Mesh(new THREE.BoxGeometry(w, h, d * .45), m.chrome); front.position.set(w / 2, h / 2, -d * .225);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(w * .5, w * .5, h * .6, 40, 1, false, Math.PI / 2, Math.PI), m.chrome);
    back.scale.set(1, 1, (d * .55) / (w * .5)); back.position.set(w / 2, h * .3, -d * .45);
    const insert = new THREE.Mesh(new THREE.BoxGeometry(3.6, .6, .04), m.steel); insert.position.set(w / 2, h / 2, .01);
    g.add(front, back, insert);
    g.userData.face = new THREE.Vector3(w / 2, h * .45, 0);
  }
  return g;
}

// build one club in metres, true size. Returns a group whose origin is the middle of the face, plus the swing pivot
// (on the shaft axis, 3 in below the grip cap: where the hands would be) and the swing-plane axis through it.
export function makeClub(id, env) {
  const k = CLUB_KIT[id], m = {};
  for (const [n, f] of Object.entries(FINISH)) m[n] = new THREE.MeshStandardMaterial({ ...f, envMap: env, envMapIntensity: 1.1 });
  const club = new THREE.Group(), lie = rad(k.lie), up = new THREE.Vector3(-Math.cos(lie), Math.sin(lie), 0); // up the shaft
  const hd = head(k.kind, m, k.head); hd.rotation.x = -rad(k.loft) * (k.kind === 'driver' ? .3 : 1); // lay the face back (the driver's round head only partly)
  club.add(hd);
  const along = (geo, from, to) => { // a cylinder from `from` to `to` inches up the shaft
    const mesh = new THREE.Mesh(geo, null); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    mesh.position.copy(up).multiplyScalar((from + to) / 2); return mesh;
  };
  const L = k.length, grip = 10.5, hosel = k.kind === 'putter' ? 4 : 2.6;
  const parts = [
    [new THREE.CylinderGeometry(.22, .24, hosel, 16), m.chrome, 0, hosel],                           // hosel
    [new THREE.CylinderGeometry(.27, .2, .5, 16), m.rubber, hosel, hosel + .5],                      // ferrule, plain black
    [new THREE.CylinderGeometry(.3, .18, L - grip - hosel - .5, 16), m.steel, hosel + .5, L - grip], // shaft, tapering to the head
    [new THREE.CylinderGeometry(k.kind === 'putter' ? .55 : .46, .34, grip, 20), m.rubber, L - grip, L], // grip; the putter's wider
  ];
  for (const [geo, mat, a, b] of parts) { const p = along(geo, a, b); p.material = mat; club.add(p); }
  club.scale.setScalar(IN);
  const face = hd.userData.face.clone().applyEuler(hd.rotation).multiplyScalar(IN);
  club.position.copy(face).negate(); // face centre to the origin
  const out = new THREE.Group(); out.add(club);
  out.userData.pivot = up.clone().multiplyScalar((L - 3) * IN).sub(face);
  out.userData.axis = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 0, 1)).normalize(); // the plane of the shaft and the target line
  out.userData.putter = k.kind === 'putter';
  return out;
}

// a soft sky-and-grass reflection for the chrome, so metal reads as metal (it renders black with nothing to reflect)
export function clubEnv(renderer, sky, ground) {
  const s = new THREE.Scene(), geo = new THREE.SphereGeometry(10, 32, 16), c = [], top = new THREE.Color(sky), bot = new THREE.Color(ground), col = new THREE.Color();
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const y = geo.attributes.position.getY(i) / 10; col.copy(bot).lerp(top, THREE.MathUtils.smoothstep(y, -.15, .25)).multiplyScalar(y > .6 ? 1.6 : 1);
    c.push(col.r, col.g, col.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(s, .02).texture; pm.dispose();
  return tex;
}
