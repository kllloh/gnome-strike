import * as THREE from 'three';
import { World, makeNoiseTexture } from './world';
import { createGnome } from './gnome';

// A traditional English back garden, seen from garden-gnome height: everything is roughly
// four to five times bigger than it would be for a person.

// --- palette -----------------------------------------------------------------
const GRASS = 0x5f9e3f;
const GRASS_L = 0x70b04a;
const BRICK = 0xb4573c;
const STONE = 0xa7a39a;
const STONE_L = 0xc9c5ba;
const SLAB = 0xb8b3a8;
const WOOD_F = 0xb98b55;
const WOOD_D = 0x6b4a2f;
const WOOD_L = 0xc9a06a;
const TERRA = 0xc2693e;
const TERRA_D = 0xa65532;
const WHITE = 0xf2f0e8;
const CREAM = 0xeadfc2;
const BLACK = 0x2b2b2b;
const GREY = 0x6a6d72;
const ROOF = 0x55585e;
const LEAF = 0x3f8f3a;
const LEAF_D = 0x2f6f2e;
const LEAF_L = 0x7fc24f;
const SOIL = 0x5a3d28;
const WATER = 0x4a90b8;
const PINK = 0xe86a9a;
const YELLOW = 0xf2c230;
const RED = 0xd23a32;
const ORANGE = 0xf08a24;
const PURPLE = 0x8a5ac8;
const BLUE = 0x4a6fd0;
const SKY_GLASS = 0x9fc8e8;

export const MAP_HALF = 32;

export interface MapInfo {
  spawns: THREE.Vector3[];
  south: THREE.Vector3[]; // player team
  north: THREE.Vector3[]; // enemy team
}

// deterministic decoration so the garden looks the same every load
let seed = 20260;
function rnd(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a: number, b: number) => a + rnd() * (b - a);
function pick<T>(a: T[]): T {
  return a[Math.floor(rnd() * a.length)];
}

type Side = 'n' | 's' | 'e' | 'w';

// --- flowers and plants --------------------------------------------------------

function petals(w: World, x: number, y: number, z: number, color: number, len: number, wid: number, n: number) {
  for (let k = 0; k < n; k++) {
    const m = w.box(x, y, z, len, 0.18, wid, color, false);
    m.rotation.y = (k * Math.PI) / n;
  }
}

type Bloom = 'daisy' | 'poppy' | 'sunflower' | 'tulip' | 'lavender';

function bloom(w: World, x: number, y: number, z: number, type: Bloom, s = 1) {
  switch (type) {
    case 'daisy':
      petals(w, x, y, z, WHITE, 3.4 * s, 0.8 * s, 4);
      w.box(x, y + 0.05, z, 1 * s, 0.3 * s, 1 * s, YELLOW, false);
      break;
    case 'poppy':
      petals(w, x, y, z, RED, 3 * s, 1.6 * s, 3);
      w.box(x, y + 0.1, z, 0.8 * s, 0.4 * s, 0.8 * s, BLACK, false);
      break;
    case 'sunflower':
      petals(w, x, y, z, YELLOW, 6.4 * s, 1.3 * s, 6);
      w.box(x, y + 0.05, z, 2.8 * s, 0.5 * s, 2.8 * s, SOIL, false);
      break;
    case 'tulip': {
      const c = pick([RED, PINK, YELLOW, PURPLE]);
      w.box(x, y - 0.8 * s, z, 1.5 * s, 1.7 * s, 1.5 * s, c, false);
      for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        w.box(x + dx * s, y + 0.9 * s, z + dz * s, 0.5 * s, 0.8 * s, 0.5 * s, c, false);
      }
      break;
    }
    case 'lavender':
      for (let i = 0; i < 4; i++) w.box(x, y - 0.2 + i * 0.7 * s, z, (0.9 - i * 0.12) * s, 0.7 * s, (0.9 - i * 0.12) * s, PURPLE, false);
      break;
  }
}

/** A tall stalk (solid, so it's thin cover) with leaves and a bloom on top. */
function plant(w: World, x: number, y0: number, z: number, h: number, type: Bloom, s = 1) {
  w.box(x, y0, z, 0.5, h, 0.5, LEAF);
  for (let i = 0; i < 2; i++) {
    const m = w.box(x, y0 + h * (0.3 + i * 0.25), z, 2.4, 0.15, 0.7, LEAF_L, false);
    m.rotation.y = rnd() * Math.PI;
  }
  bloom(w, x, y0 + h + 0.1, z, type, s);
}

function pot(w: World, x: number, z: number, size = 4.4, h = 3.4, type: Bloom | null = null, stalk = 4) {
  w.box(x, 0, z, size * 0.78, h - 0.5, size * 0.78, TERRA, true);
  w.box(x, h - 0.5, z, size, 0.5, size, TERRA_D, true);
  w.box(x, h - 0.15, z, size - 0.6, 0.2, size - 0.6, SOIL, false);
  if (type) plant(w, x, h, z, stalk, type, 1.1);
}

// --- walls, sheds and glasshouse -------------------------------------------------

function wallX(w: World, x0: number, x1: number, zc: number, h: number, color: number, door: boolean, doorH: number, t: number, kind: 'wood' | 'brick') {
  const mid = (x0 + x1) / 2;
  if (!door) {
    w.box(mid, 0, zc, x1 - x0, h, t, color, true, kind);
    return;
  }
  const a = mid - 1.7;
  const b = mid + 1.7;
  w.box((x0 + a) / 2, 0, zc, a - x0, h, t, color, true, kind);
  w.box((b + x1) / 2, 0, zc, x1 - b, h, t, color, true, kind);
  w.box(mid, doorH, zc, 3.4, h - doorH, t, color, true, kind);
}

function wallZ(w: World, z0: number, z1: number, xc: number, h: number, color: number, door: boolean, doorH: number, t: number, kind: 'wood' | 'brick') {
  const mid = (z0 + z1) / 2;
  if (!door) {
    w.box(xc, 0, mid, t, h, z1 - z0, color, true, kind);
    return;
  }
  const a = mid - 1.7;
  const b = mid + 1.7;
  w.box(xc, 0, (z0 + a) / 2, t, h, a - z0, color, true, kind);
  w.box(xc, 0, (b + z1) / 2, t, h, z1 - b, color, true, kind);
  w.box(xc, doorH, mid, t, h - doorH, 3.4, color, true, kind);
}

function shed(w: World, cx: number, cz: number, sw: number, sd: number, h: number, doors: Side[]) {
  const t = 0.6;
  const doorH = 5;
  const x0 = cx - sw / 2, x1 = cx + sw / 2, z0 = cz - sd / 2, z1 = cz + sd / 2;
  wallX(w, x0, x1, z0 + t / 2, h, WOOD_L, doors.includes('n'), doorH, t, 'wood');
  wallX(w, x0, x1, z1 - t / 2, h, WOOD_L, doors.includes('s'), doorH, t, 'wood');
  wallZ(w, z0 + t, z1 - t, x1 - t / 2, h, WOOD_L, doors.includes('e'), doorH, t, 'wood');
  wallZ(w, z0 + t, z1 - t, x0 + t / 2, h, WOOD_L, doors.includes('w'), doorH, t, 'wood');
  // felt roof with an overhang
  w.box(cx, h, cz, sw + 1.6, 0.5, sd + 1.6, ROOF, true);
  w.box(cx, h + 0.5, cz, sw + 1.6, 0.5, 1.2, GREY, false);
  // window panes on the walls without doors
  const win = (x: number, z: number, alongX: boolean) =>
    alongX ? w.box(x, 3.2, z, 3, 2.4, 0.15, SKY_GLASS, false) : w.box(x, 3.2, z, 0.15, 2.4, 3, SKY_GLASS, false);
  if (!doors.includes('n')) win(cx, z0 - 0.05, true);
  if (!doors.includes('s')) win(cx, z1 + 0.05, true);
  if (!doors.includes('e')) win(x1 + 0.05, cz, false);
  if (!doors.includes('w')) win(x0 - 0.05, cz, false);
  // contents: shelf along the back, paint tins, a sack
  w.box(cx, 0, cz - sd / 2 + 1.7, sw - 3, 2.6, 1.4, WOOD_D, true, 'wood');
  for (let i = 0; i < 4; i++) w.box(cx - 3 + i * 2, 2.6, cz - sd / 2 + 1.7, 1, 1.1, 1, pick([RED, BLUE, YELLOW, LEAF]), false);
  w.box(cx + sw / 2 - 1.8, 0, cz + sd / 2 - 1.8, 2.4, 2.4, 2, CREAM);
}

function greenhouse(w: World, cx: number, cz: number, gw: number, gd: number) {
  const x0 = cx - gw / 2, x1 = cx + gw / 2, z0 = cz - gd / 2, z1 = cz + gd / 2;
  const BASE = 1.4, H = 8, T = 0.5, DOOR = 3.4;

  const line = (alongX: boolean, a: number, b: number, fixed: number, door: boolean) => {
    const mid = (a + b) / 2;
    const segs: [number, number][] = door ? [[a, mid - DOOR / 2], [mid + DOOR / 2, b]] : [[a, b]];
    for (const [s0, s1] of segs) {
      const c = (s0 + s1) / 2;
      const len = s1 - s0;
      w.begin(260);
      if (alongX) w.box(c, 0, fixed, len, BASE, T, BRICK, true, 'brick');
      else w.box(fixed, 0, c, T, BASE, len, BRICK, true, 'brick');
      w.end();
      w.begin(10);
      if (alongX) w.glass(c, BASE, fixed, len, H - BASE, 0.2);
      else w.glass(fixed, BASE, c, 0.2, H - BASE, len);
      w.end();
    }
    if (door) {
      w.begin(10);
      if (alongX) w.glass(mid, 3.6, fixed, DOOR, H - 3.6, 0.2);
      else w.glass(fixed, 3.6, mid, 0.2, H - 3.6, DOOR);
      w.end();
    }
    const n = Math.max(1, Math.round((b - a) / 3.6));
    for (let i = 0; i <= n; i++) {
      const p = a + ((b - a) * i) / n;
      if (door && Math.abs(p - mid) < DOOR / 2 + 0.2) continue;
      w.begin(140);
      if (alongX) w.box(p, 0, fixed, 0.5, H, 0.5, WHITE);
      else w.box(fixed, 0, p, 0.5, H, 0.5, WHITE);
      w.end();
    }
  };
  line(true, x0, x1, z0, true); // north face, door
  line(true, x0, x1, z1, false);
  line(false, z0, z1, x0, false);
  line(false, z0, z1, x1, true); // east face, door

  w.begin(10);
  w.glass(cx, H, cz, gw, 0.3, gd);
  w.box(cx, H + 0.3, cz, gw + 0.6, 0.5, 0.7, WHITE, false);
  w.end();

  // potting benches with plants
  w.begin(160);
  w.box(cx, 0, z1 - 1.3, gw - 4, 2.2, 1.6, WOOD_L, true, 'wood');
  w.box(x0 + 1.3, 0, cz, 1.6, 2.2, gd - 5, WOOD_L, true, 'wood');
  for (let i = 0; i < 6; i++) {
    const px = cx - (gw - 6) / 2 + i * ((gw - 6) / 5);
    w.box(px, 2.2, z1 - 1.3, 1.3, 1.1, 1.3, TERRA, false);
    w.box(px, 3.3, z1 - 1.3, 0.3, 1.8 + rnd() * 1.2, 0.3, LEAF, false);
    w.box(px + 0.3, 3.9, z1 - 1.3, 0.6, 0.6, 0.6, RED, false);
  }
  w.end();
  // a tomato plant in the middle
  w.begin(60);
  w.box(cx + 1, 0, cz, 2.2, 1.4, 2.2, TERRA, true);
  w.box(cx + 1, 1.4, cz, 0.3, 5.5, 0.3, WOOD_D, false);
  for (let i = 0; i < 5; i++) w.box(cx + 1 + between(-0.6, 0.6), 2 + i * 0.9, cz + between(-0.6, 0.6), 0.7, 0.7, 0.7, i % 2 ? RED : LEAF, false);
  w.end();
}

// --- furniture and clutter ---------------------------------------------------------

function chair(w: World, x: number, z: number, back: Side) {
  for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) w.box(x + dx, 0, z + dz, 0.4, 2, 0.4, WHITE);
  w.box(x, 2, z, 3.2, 0.4, 3.2, WHITE);
  if (back === 'n') w.box(x, 2.4, z - 1.4, 3.2, 2.8, 0.4, WHITE);
  if (back === 's') w.box(x, 2.4, z + 1.4, 3.2, 2.8, 0.4, WHITE);
  if (back === 'w') w.box(x - 1.4, 2.4, z, 0.4, 2.8, 3.2, WHITE);
  if (back === 'e') w.box(x + 1.4, 2.4, z, 0.4, 2.8, 3.2, WHITE);
}

function patioSet(w: World, x: number, z: number) {
  w.box(x, 3.4, z, 8, 0.5, 8, WHITE); // tabletop, gnomes walk underneath
  for (const [dx, dz] of [[-3.4, -3.4], [3.4, -3.4], [-3.4, 3.4], [3.4, 3.4]]) w.box(x + dx, 0, z + dz, 0.6, 3.4, 0.6, WHITE);
  w.box(x, 0, z, 0.5, 11, 0.5, WOOD_D); // parasol pole
  w.box(x, 11, z, 14, 0.5, 14, RED, false);
  w.box(x, 11.5, z, 8, 0.4, 8, WHITE, false);
  w.box(x, 11.9, z, 2, 0.4, 2, RED, false);
  chair(w, x - 6, z, 'w');
  chair(w, x + 6, z, 'e');
  chair(w, x, z + 6, 's');
}

function bbq(w: World, x: number, z: number) {
  for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) w.box(x + dx, 0, z + dz, 0.4, 3.4, 0.4, BLACK);
  w.box(x, 3.4, z, 5.4, 2, 5.4, BLACK);
  w.box(x, 5.4, z, 4.6, 1.4, 4.6, GREY);
  w.box(x, 6.8, z, 0.6, 0.8, 0.6, RED, false);
  w.box(x + 3.6, 3.4, z, 1.8, 0.3, 3.6, WOOD_D, false); // side shelf
}

function birdBath(w: World, x: number, z: number) {
  w.box(x, 0, z, 3.4, 0.8, 3.4, STONE);
  w.box(x, 0.8, z, 1.6, 3.3, 1.6, STONE_L);
  w.box(x, 4.1, z, 6, 0.7, 6, STONE);
  w.box(x, 4.8, z - 2.7, 6, 0.5, 0.6, STONE, true); // rim edges
  w.box(x, 4.8, z + 2.7, 6, 0.5, 0.6, STONE, true);
  w.box(x - 2.7, 4.8, z, 0.6, 0.5, 5, STONE, true);
  w.box(x + 2.7, 4.8, z, 0.6, 0.5, 5, STONE, true);
  w.box(x, 4.8, z, 4.8, 0.15, 4.8, WATER, false);
  w.box(x + 1, 5.0, z - 0.5, 0.9, 0.9, 1.4, 0x4a3a2a, false); // a visiting sparrow
}

function pond(w: World, cx: number, cz: number) {
  w.box(cx, 0, cz, 12, 0.6, 6, WATER, true);
  const stones: [number, number][] = [];
  for (let x = cx - 7; x <= cx + 7; x += 2) { stones.push([x, cz - 4]); stones.push([x, cz + 4]); }
  for (let z = cz - 2; z <= cz + 2; z += 2) { stones.push([cx - 7, z]); stones.push([cx + 7, z]); }
  for (const [x, z] of stones) {
    w.begin(220);
    w.box(x, 0, z, 2, between(0.9, 1.5), 2, pick([STONE, STONE_L, 0x8e8a82]));
    w.end();
  }
  for (let i = 0; i < 6; i++) w.box(cx + between(-4.5, 4.5), 0.6, cz + between(-2, 2), 1.8, 0.07, 1.8, pick([LEAF, LEAF_L]), false);
  w.box(cx + 1.5, 0.6, cz - 0.8, 0.9, 0.5, 0.9, PINK, false); // lotus
}

function statue(w: World, x: number, z: number, scale: number, shirt: number) {
  const g = createGnome(shirt);
  g.root.scale.setScalar(scale);
  g.root.position.set(x, 0, z);
  g.root.rotation.y = Math.atan2(x, z);
  w.adopt(g.root);
  const hw = 0.4 * scale;
  w.addCollider(new THREE.Vector3(x - hw, 0, z - hw), new THREE.Vector3(x + hw, 2.3 * scale, z + hw));
  w.box(x, 0, z, hw * 2.8, 0.01, hw * 2.8, STONE, false);
}

function vegBed(w: World, cx: number, cz: number, kind: 'cabbage' | 'carrot' | 'beans') {
  w.box(cx, 0, cz, 12, 1.4, 3.4, WOOD_F, true, 'wood');
  w.box(cx, 1.3, cz, 11, 0.2, 2.6, SOIL, false);
  for (let i = 0; i < 4; i++) {
    const x = cx - 4.2 + i * 2.8;
    if (kind === 'cabbage') {
      w.box(x, 1.4, cz, 2.2, 1.8, 2.2, LEAF_L, false);
      w.box(x, 3.2, cz, 1.4, 0.5, 1.4, LEAF, false);
    } else if (kind === 'carrot') {
      for (const dz of [-0.7, 0.7]) {
        w.box(x, 1.4, cz + dz, 0.5, 0.7, 0.5, ORANGE, false);
        w.box(x, 2.1, cz + dz, 1.4, 1.6, 0.4, LEAF, false);
      }
    } else {
      w.box(x, 1.4, cz, 0.25, 9, 0.25, WOOD_D);
      for (let k = 0; k < 4; k++) w.box(x + between(-0.3, 0.3), 2.5 + k * 1.6, cz + between(-0.3, 0.3), 0.9, 0.9, 0.9, LEAF, false);
      w.box(x + 0.3, 5, cz, 0.3, 1.4, 0.3, RED, false);
    }
  }
}

function wheelbarrow(w: World, x: number, z: number) {
  w.box(x, 1.5, z, 5, 1.6, 3.4, RED);
  w.box(x, 3.0, z, 4.4, 0.2, 2.8, SOIL, false);
  w.box(x + 3.4, 0, z, 2.2, 2.2, 0.6, BLACK, true);
  for (const dz of [-1.1, 1.1]) w.box(x - 3.6, 1.9, z + dz, 3.8, 0.3, 0.4, WOOD_L, false);
  for (const dz of [-1.4, 1.4]) w.box(x - 1.6, 0, z + dz, 0.3, 1.6, 0.3, GREY, false);
}

function mower(w: World, x: number, z: number) {
  w.box(x, 0.9, z, 4.6, 1.9, 3.4, ORANGE);
  for (const [dx, dz] of [[-1.7, -1.8], [1.7, -1.8], [-1.7, 1.8], [1.7, 1.8]]) w.box(x + dx, 0, z + dz, 1.4, 1.4, 0.5, BLACK, true);
  w.box(x - 3.2, 1.2, z, 1.8, 2, 2.6, GREY);
  for (const dz of [-1.2, 1.2]) w.box(x - 3.8, 2, z + dz, 0.3, 3.2, 0.3, GREY, false);
  w.box(x - 4.3, 5.0, z, 0.4, 0.4, 3, BLACK, false);
}

function compostBin(w: World, x: number, z: number) {
  w.box(x, 0, z, 5.5, 5.2, 5.5, 0x3a6b35);
  w.box(x, 5.2, z, 6, 0.6, 6, 0x2e5a2c);
  w.box(x, 2.5, z + 2.78, 3, 0.6, 0.1, 0x2a4a28, false);
}

function wateringCan(w: World, x: number, z: number) {
  w.box(x, 0, z, 3.2, 2.8, 2.4, BLUE);
  w.box(x + 2.4, 1.4, z, 2.6, 0.45, 0.45, BLUE, false);
  w.box(x + 3.8, 1.6, z, 0.9, 0.9, 1.1, GREY, false);
  w.box(x - 0.4, 2.8, z, 0.4, 1.6, 0.4, BLUE, false);
  w.box(x - 1.4, 2.8, z, 0.4, 1.0, 0.4, BLUE, false);
}

function sack(w: World, x: number, z: number) {
  w.box(x, 0, z, 3, 2.4, 2.2, CREAM);
  w.box(x, 2.4, z, 1.4, 0.6, 1.2, CREAM, false);
}

function stackedPots(w: World, x: number, z: number) {
  pot(w, x, z, 3.6, 2.4);
  w.box(x + 0.3, 2.4, z, 2.4, 1.9, 2.4, TERRA, true);
  w.box(x + 0.3, 4.3, z, 3.2, 0.5, 3.2, TERRA_D, true);
}

function logPile(w: World, x: number, z: number) {
  for (let i = 0; i < 3; i++) w.box(x, 0, z - 2.2 + i * 2.2, 6, 1.1, 1.1, WOOD_D, true, 'wood');
  for (let i = 0; i < 2; i++) w.box(x, 1.1, z - 1.1 + i * 2.2, 6, 1.1, 1.1, WOOD_L, true, 'wood');
}

function lowWall(w: World, cx: number, cz: number, len: number, alongX: boolean) {
  if (alongX) w.box(cx, 0, cz, len, 1.25, 0.8, BRICK, true, 'brick');
  else w.box(cx, 0, cz, 0.8, 1.25, len, BRICK, true, 'brick');
}

function appleTree(w: World, x: number, z: number) {
  w.box(x, 0, z, 2.4, 11, 2.4, WOOD_D, true, 'wood');
  w.box(x, 9, z, 16, 4, 16, LEAF, false);
  w.box(x, 13, z, 12, 3, 12, LEAF_D, false);
  w.box(x, 16, z, 7, 2.5, 7, LEAF, false);
  for (let i = 0; i < 12; i++) w.box(x + between(-6.5, 6.5), 8.2, z + between(-6.5, 6.5), 0.9, 0.9, 0.9, RED, false);
  w.box(x - 3, 0, z + 4, 1, 0.9, 1, RED, false); // windfall apples
  w.box(x + 4, 0, z - 3, 1, 0.9, 1, RED, false);
}

function washingLine(w: World, x0: number, x1: number, z: number) {
  w.box(x0, 0, z, 0.6, 12, 0.6, GREY);
  w.box(x1, 0, z, 0.6, 12, 0.6, GREY);
  w.box((x0 + x1) / 2, 11.4, z, x1 - x0, 0.15, 0.15, WHITE, false);
  const items: [number, number, number][] = [[-6, RED, 2.2], [-3.5, WHITE, 3.6], [-0.5, BLUE, 2.2], [2.5, YELLOW, 3.6], [5.5, PINK, 2.2]];
  for (const [dx, c, h] of items) w.box((x0 + x1) / 2 + dx, 11.4 - h, z, 1.6, h, 0.2, c, false);
}

function hose(w: World, pts: [number, number][]) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    if (ax === bx) w.box(ax, 0, (az + bz) / 2, 0.5, 0.4, Math.abs(bz - az) + 0.5, 0x2f8f4a, false);
    else w.box((ax + bx) / 2, 0, az, Math.abs(bx - ax) + 0.5, 0.4, 0.5, 0x2f8f4a, false);
  }
}

function houseWindow(w: World, x: number, y: number, w0: number, h0: number) {
  const z = -23.8;
  w.box(x, y - 0.5, z, w0 + 1.4, h0 + 1, 0.3, WHITE, false);
  w.box(x, y, z - 0.05, w0, h0, 0.3, SKY_GLASS, false);
  w.box(x, y, z + 0.1, 0.35, h0, 0.2, WHITE, false);
  w.box(x, y + h0 / 2, z + 0.1, w0, 0.35, 0.2, WHITE, false);
  w.box(x, y - 0.8, z + 0.3, w0 + 2, 0.4, 0.9, STONE_L, false); // sill
}

// --- the garden ---------------------------------------------------------------------

export function buildMap(world: World, scene: THREE.Scene): MapInfo {
  const w = world;
  // hit points per prop: shoot or blow things up to break them (the house and boundary walls are solid)
  const dw = <A extends unknown[]>(hp: number, fn: (ww: World, ...a: A) => void) => (ww: World, ...a: A) => {
    ww.begin(hp);
    fn(ww, ...a);
    ww.end();
  };
  const D = {
    patioSet: dw(260, patioSet), bbq: dw(170, bbq), pot: dw(150, pot), compostBin: dw(170, compostBin),
    birdBath: dw(380, birdBath), lowWall: dw(450, lowWall), statue: dw(520, statue), vegBed: dw(170, vegBed),
    shed: dw(700, shed), appleTree: dw(320, appleTree), washingLine: dw(200, washingLine),
    wheelbarrow: dw(150, wheelbarrow), mower: dw(180, mower), wateringCan: dw(90, wateringCan),
    stackedPots: dw(230, stackedPots), sack: dw(90, sack), logPile: dw(220, logPile), plant: dw(40, plant),
  };

  // lawn
  const gtex = makeNoiseTexture(16, 170);
  gtex.repeat.set(320, 320);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(640, 640),
    new THREE.MeshLambertMaterial({ color: GRASS, map: gtex }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  w.group.add(ground);
  // mowing stripes
  for (let i = 0; i < 5; i++) w.box(0, 0, -10 + i * 8, 62, 0.03, 4, GRASS_L, false, 'grass');
  // patio and stepping stones
  w.box(0, 0, -19, 58, 0.06, 10, SLAB, false);
  for (let x = -28; x <= 28; x += 7) w.box(x, 0.06, -19, 0.2, 0.02, 10, 0x9a958a, false);
  for (let z = -23; z <= -15; z += 4) w.box(0, 0.06, z, 58, 0.02, 0.2, 0x9a958a, false);
  const steps: [number, number][] = [[0, -12.5], [1.5, -9.5], [0, -6.5], [-1.5, -3.5], [14, -11], [17, -8.5], [9, -12], [-15, -12], [-17, -9.5], [-19, 14], [-14, 12], [-9, 12]];
  for (const [x, z] of steps) w.box(x, 0, z, 2.6, 0.08, 2.6, SLAB, false);

  // the house (north wall)
  w.box(0, 0, -28, 64, 20, 8, BRICK, true, 'brick');
  w.box(0, 19, -23.6, 66, 1.4, 1, WHITE, false); // fascia
  w.box(0, 20, -27, 68, 1.2, 10, ROOF, false); // eaves
  for (const x of [-24, -12, 12, 24]) houseWindow(w, x, 4.5, 7, 6);
  for (const x of [-24, -8, 8, 24]) houseWindow(w, x, 12.5, 6, 5);
  // patio doors
  w.box(0, 0, -23.8, 12, 10.4, 0.3, WHITE, false);
  w.box(-2.7, 0.5, -23.95, 5, 9, 0.3, SKY_GLASS, false);
  w.box(2.7, 0.5, -23.95, 5, 9, 0.3, SKY_GLASS, false);
  w.box(-0.4, 4, -23.6, 0.3, 2, 0.3, GREY, false);
  w.box(0.4, 4, -23.6, 0.3, 2, 0.3, GREY, false);
  w.box(0, 0, -23.2, 13, 0.4, 1.4, STONE_L, false); // door step
  // drainpipes, air bricks, cat flap, tap
  for (const x of [-30, 30]) w.box(x, 0, -23.6, 0.9, 19, 0.9, GREY, false);
  for (let x = -28; x <= 28; x += 7) w.box(x, 0.8, -23.8, 1.6, 0.8, 0.2, BLACK, false);
  w.box(7, 1, -23.7, 1.8, 1.4, 0.3, WOOD_D, false);
  w.box(-26, 0, -23.7, 0.5, 3, 0.3, BLACK, false);
  w.box(-26, 3, -23.4, 1, 0.8, 1.2, 0xc9a24a, false);

  // west fence
  w.box(-31.5, 0, 4, 1, 8.5, 56, WOOD_F, true, 'wood');
  for (let z = -23; z <= 30; z += 1) w.box(-30.85, 0, z, 0.2, 8.4 + rnd() * 0.9, 0.85, pick([WOOD_F, WOOD_L, 0xa87a48]), false);
  for (const y of [1.8, 5.6]) w.box(-30.65, y, 4, 0.3, 0.8, 56, WOOD_D, false);
  for (let z = -22; z <= 30; z += 8) w.box(-30.6, 0, z, 0.9, 9.8, 0.9, WOOD_D, false);
  // east brick wall with ivy
  w.box(31.5, 0, 4, 1, 8.5, 56, STONE, true, 'brick');
  w.box(31.5, 8.5, 4, 1.8, 0.6, 56, STONE_L, false);
  for (let i = 0; i < 46; i++) w.box(30.85, between(0.3, 7), between(-22, 29), 0.3, between(1.2, 2.8), between(1.2, 2.8), pick([LEAF, LEAF_D, LEAF_L]), false);
  // south hedge
  w.box(0, 0, 31, 64, 9, 2, LEAF_D, true, 'plain');
  for (let i = 0; i < 110; i++) {
    const s = between(1.5, 2.6);
    w.box(between(-30, 30), between(0.2, 8), 29.8, s, s, 1.2, pick([LEAF, LEAF_D, LEAF_L]), false);
  }

  // neighbouring gardens beyond the walls (seen over the top)
  w.box(-58, 0, 0, 24, 15, 60, 0xd9b48a, false);
  w.box(-58, 15, 0, 26, 4, 62, ROOF, false);
  w.box(-56, 19, -10, 3, 5, 3, BRICK, false);
  w.box(58, 0, 4, 24, 13, 60, 0xcfa37a, false);
  w.box(58, 13, 4, 26, 4, 62, ROOF, false);
  w.box(0, 0, 62, 70, 14, 22, 0xe0c9a0, false);
  w.box(0, 14, 62, 72, 4, 24, ROOF, false);
  for (const [x, z] of [[-44, 24], [44, -18], [18, 48], [-30, 46]] as [number, number][]) {
    w.box(x, 0, z, 3, 10, 3, WOOD_D, false);
    w.box(x, 9, z, 14, 8, 14, LEAF, false);
  }

  // patio furniture and plants
  D.patioSet(w, -14, -19);
  D.bbq(w, 16, -19);
  D.pot(w, -27, -19, 4.6, 3.6, 'sunflower', 6);
  D.pot(w, 27, -19, 4.6, 3.6, 'tulip', 5);
  D.pot(w, -8, -21, 4.2, 3.2, 'daisy', 4);
  D.pot(w, 8, -21, 4.2, 3.2, 'poppy', 4);
  D.compostBin(w, -28, -13);

  // centrepiece, pond and statues
  D.birdBath(w, 0, 0);
  D.lowWall(w, -7, -4, 5, true);
  D.lowWall(w, 7, 4, 5, true);
  D.lowWall(w, -4, 7, 5, false);
  D.lowWall(w, 4, -7, 5, false);
  pond(w, -17, 5);
  D.statue(w, -7, 5, 3.4, 0x2f5fb0); // the fishing gnome
  D.statue(w, 12, 10, 3, 0x3d8a3d);

  // vegetable patch
  D.vegBed(w, 21, 4, 'cabbage');
  D.vegBed(w, 21, 10, 'carrot');
  D.vegBed(w, 21, 16, 'beans');

  // outbuildings
  D.shed(w, 24, -8, 12, 10, 9, ['w', 's']);
  greenhouse(w, -22, 20, 14, 10);

  // trees and washing
  D.appleTree(w, -26, -6);
  D.washingLine(w, -10, 10, 28.5);

  // clutter that works as cover
  D.wheelbarrow(w, 7, 18);
  D.mower(w, -6, 14);
  D.wateringCan(w, 10, 13);
  D.stackedPots(w, 5, 10);
  D.stackedPots(w, -9, -10);
  D.stackedPots(w, 14, -14);
  D.sack(w, 12, 22);
  D.sack(w, 13.6, 22.6);
  D.sack(w, -11, 27);
  D.logPile(w, -9, 22);
  hose(w, [[4, 25], [9, 25], [9, 21], [14, 21], [14, 24], [18, 24]]);

  // giant flowers along the borders
  const border: [number, number, Bloom, number][] = [
    [-29.5, -17, 'daisy', 6.5], [-29.5, -10, 'poppy', 5.5], [-29.5, 2, 'sunflower', 9], [-29.5, 8, 'daisy', 6],
    [-29.5, 14, 'tulip', 5], [-29.5, 28, 'lavender', 3.5],
    [-20, 28.4, 'sunflower', 9], [-14, 28.4, 'tulip', 5.5], [14, 28.4, 'daisy', 6.5], [20, 28.4, 'poppy', 5.5],
    [27, 28.4, 'sunflower', 9.5], [29.5, 22, 'tulip', 5], [29.5, 28, 'daisy', 7],
    [29.5, -1, 'poppy', 5], [29.5, 20.8, 'lavender', 3.5],
    [-12, 2, 'daisy', 5], [10, -2, 'tulip', 5], [-3, 16, 'poppy', 5], [2, -14, 'lavender', 3],
  ];
  for (const [x, z, t, h] of border) D.plant(w, x, 0, z, h, t, t === 'sunflower' ? 1.1 : 1);

  // blades of grass and daisies on the lawn (decoration only)
  for (let i = 0; i < 150; i++) {
    const x = between(-30, 30);
    const z = between(-13, 29);
    if (Math.abs(x) < 3 && Math.abs(z) < 3) continue;
    const h = between(0.9, 1.9);
    w.box(x, 0, z, 0.22, h, 0.22, pick([LEAF, LEAF_L, GRASS_L]), false);
    if (rnd() < 0.5) w.box(x + 0.3, 0, z + 0.1, 0.18, h * 0.8, 0.18, LEAF_D, false);
  }
  for (let i = 0; i < 36; i++) {
    const x = between(-30, 30);
    const z = between(-12, 29);
    w.box(x, 0, z, 0.1, 0.7, 0.1, LEAF, false);
    petals(w, x, 0.75, z, WHITE, 0.6, 0.16, 3);
    w.box(x, 0.8, z, 0.18, 0.1, 0.18, YELLOW, false);
  }

  const row = (z: number) => [-4, -2, 0, 2, 4].map((x) => new THREE.Vector3(x, 0, z));
  const spawns = [[-14, 4], [14, 0], [0, 14], [0, -12], [-4, 22], [18, -2]].map(([x, z]) => new THREE.Vector3(x, 0, z));

  scene.add(w.group);
  return { spawns, south: row(26), north: row(-20) };
}
