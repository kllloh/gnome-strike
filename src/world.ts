import * as THREE from 'three';

export interface AABB {
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** Blocks movement but not bullets or sight (glass). */
  clear?: boolean;
  /** The destructible this block belongs to, if it can be broken. */
  group?: Destructible;
}

/** A prop (or one wall of a building) that can be shot or blown apart as a unit. */
export interface Destructible {
  hp: number;
  maxHp: number;
  objects: THREE.Object3D[];
  colliders: AABB[];
  bounds: THREE.Box3;
  dead: boolean;
  tinted: boolean;
  originals: Map<THREE.Mesh, THREE.Material>;
}

export type Kind = 'plain' | 'brick' | 'wood' | 'grass';

type Axis = 'x' | 'y' | 'z';

const TILE = 2; // metres covered by one texture tile (16px => 12.5cm "pixels")
const EPS = 0.001;

export function makeNoiseTexture(size = 16, lo = 205): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = lo + Math.floor(Math.random() * (255 - lo));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 16x16 pixel pattern; blocks tint it with their colour. */
export function makePatternTexture(kind: Kind): THREE.CanvasTexture {
  const size = 16;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v: number;
      if (kind === 'brick') {
        const off = (y >> 2) & 1 ? 4 : 0;
        const mortar = (y & 3) === 3 || ((x + off) & 7) === 7;
        v = mortar ? 252 : 168 + Math.floor(Math.random() * 45);
      } else if (kind === 'wood') {
        const edge = (x & 3) === 3;
        v = edge ? 140 : 205 + Math.floor(Math.random() * 40) - ((y * 7 + x * 3) % 5 === 0 ? 18 : 0);
      } else if (kind === 'grass') {
        v = 150 + Math.floor(Math.random() * 105);
      } else {
        v = 205 + Math.floor(Math.random() * 50);
      }
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Distance along the ray to the box, or Infinity if missed. */
export function rayAABB(o: THREE.Vector3, d: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3): number {
  let tmin = 0;
  let tmax = Infinity;
  for (const a of ['x', 'y', 'z'] as const) {
    if (d[a] === 0) {
      if (o[a] < min[a] || o[a] > max[a]) return Infinity;
      continue;
    }
    const inv = 1 / d[a];
    let t1 = (min[a] - o[a]) * inv;
    let t2 = (max[a] - o[a]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

export class World {
  readonly colliders: AABB[] = [];
  readonly group = new THREE.Group();
  readonly groups = new Set<Destructible>(); // destructibles still standing
  private all: Destructible[] = []; // every destructible, so a round can reset them
  /** Called when something takes a hit (not destroyed) / is destroyed. */
  onHit: ((g: Destructible, at: THREE.Vector3) => void) | null = null;
  onDestroyed: ((g: Destructible) => void) | null = null;
  private cur: Destructible | null = null;
  private depth = 0;
  private mats = new Map<string, THREE.MeshLambertMaterial>();
  private texs = new Map<Kind, THREE.CanvasTexture>();

  private mat(color: number, kind: Kind = 'plain'): THREE.MeshLambertMaterial {
    const j = Math.floor(Math.random() * 3);
    const key = `${kind}:${color}:${j}`;
    let tex = this.texs.get(kind);
    if (!tex) {
      tex = makePatternTexture(kind);
      this.texs.set(kind, tex);
    }
    let m = this.mats.get(key);
    if (!m) {
      const c = new THREE.Color(color);
      c.offsetHSL(0, 0, (j - 1) * 0.025);
      m = new THREE.MeshLambertMaterial({ color: c, map: tex });
      this.mats.set(key, m);
    }
    return m;
  }

  /**
   * Everything built between begin(hp) and end() becomes one destructible with that much HP
   * (decorative parts included, so a flower falls with its stalk). Nested calls join the outer one.
   */
  begin(hp: number) {
    if (this.depth++ === 0) {
      this.cur = { hp, maxHp: hp, objects: [], colliders: [], bounds: new THREE.Box3(), dead: false, tinted: false, originals: new Map() };
    }
  }

  end() {
    if (--this.depth === 0 && this.cur) {
      if (this.cur.objects.length || this.cur.colliders.length) {
        this.groups.add(this.cur);
        this.all.push(this.cur);
      }
      this.cur = null;
    }
  }

  private track(obj: THREE.Object3D, collider?: AABB) {
    if (!this.cur) return;
    this.cur.objects.push(obj);
    this.cur.bounds.expandByObject(obj);
    if (collider) {
      collider.group = this.cur;
      this.cur.colliders.push(collider);
    }
  }

  /** Add a ready-made model (e.g. a statue) to the world and to the current destructible. */
  adopt(obj: THREE.Object3D) {
    this.group.add(obj);
    this.track(obj);
  }

  addCollider(min: THREE.Vector3, max: THREE.Vector3) {
    const c: AABB = { min, max };
    this.colliders.push(c);
    if (this.cur) {
      c.group = this.cur;
      this.cur.colliders.push(c);
    }
  }

  /** Axis-aligned block. (cx, cz) is the footprint centre, y0 is the base height. */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, color: number, solid = true, kind: Kind = 'plain'): THREE.Mesh {
    const g = new THREE.BoxGeometry(w, h, d);
    // Scale UVs so texture pixels stay the same size on every block.
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, (uv.getX(i) * dims[f][0]) / TILE, (uv.getY(i) * dims[f][1]) / TILE);
      }
    }
    const mesh = new THREE.Mesh(g, this.mat(color, kind));
    mesh.position.set(cx, y0 + h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    let collider: AABB | undefined;
    if (solid) {
      collider = {
        min: new THREE.Vector3(cx - w / 2, y0, cz - d / 2),
        max: new THREE.Vector3(cx + w / 2, y0 + h, cz + d / 2),
      };
      this.colliders.push(collider);
    }
    this.track(mesh, collider);
    return mesh;
  }

  /** Translucent pane: stops movement, but bullets and sight pass straight through. */
  glass(cx: number, y0: number, cz: number, w: number, h: number, d: number, color = 0xbfe6ff, opacity = 0.28): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false }),
    );
    mesh.position.set(cx, y0 + h / 2, cz);
    this.group.add(mesh);
    const collider: AABB = {
      min: new THREE.Vector3(cx - w / 2, y0, cz - d / 2),
      max: new THREE.Vector3(cx + w / 2, y0 + h, cz + d / 2),
      clear: true,
    };
    this.colliders.push(collider);
    this.track(mesh, collider);
    return mesh;
  }

  // --- damage ----------------------------------------------------------------

  private colorOf(g: Destructible): number {
    let hex = 0xaaaaaa;
    for (const o of g.objects) {
      let found = false;
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!found && m.isMesh) {
          const mat = m.material as THREE.MeshLambertMaterial;
          if (mat.color) { hex = (g.originals.get(m) as THREE.MeshLambertMaterial | undefined)?.color.getHex() ?? mat.color.getHex(); found = true; }
        }
      });
      if (found) break;
    }
    return hex;
  }

  colour(g: Destructible): number {
    return this.colorOf(g);
  }

  /** Hurt a destructible. Darkens it as it weakens and removes it when it runs out of HP. */
  damage(g: Destructible, amount: number, at?: THREE.Vector3) {
    if (g.dead) return;
    g.hp -= amount;
    if (g.hp <= 0) {
      this.destroy(g);
      return;
    }
    const f = 0.5 + 0.5 * Math.max(0, g.hp / g.maxHp);
    for (const o of g.objects) {
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh || (m.material as THREE.Material & { transparent?: boolean }).transparent) return;
        if (!g.originals.has(m)) {
          g.originals.set(m, m.material as THREE.Material);
          m.material = (m.material as THREE.Material).clone();
        }
        const base = (g.originals.get(m) as THREE.MeshLambertMaterial).color;
        (m.material as THREE.MeshLambertMaterial).color.copy(base).multiplyScalar(f);
      });
    }
    g.tinted = true;
    this.onHit?.(g, at ?? g.bounds.getCenter(new THREE.Vector3()));
  }

  private destroy(g: Destructible) {
    g.dead = true;
    this.groups.delete(g);
    for (const c of g.colliders) {
      const i = this.colliders.indexOf(c);
      if (i >= 0) this.colliders.splice(i, 1);
    }
    for (const o of g.objects) this.group.remove(o);
    this.onDestroyed?.(g);
  }

  /** Blast damage to everything within `radius`, falling off with distance. */
  explode(center: THREE.Vector3, radius: number, damage: number) {
    for (const g of [...this.groups]) {
      const d = g.bounds.distanceToPoint(center);
      if (d < radius) this.damage(g, damage * (1 - d / radius), g.bounds.clampPoint(center, new THREE.Vector3()));
    }
  }

  /** Put everything that was destroyed or damaged back, for the next round. */
  restore() {
    for (const g of this.all) {
      if (g.dead) {
        g.dead = false;
        for (const o of g.objects) this.group.add(o);
        for (const c of g.colliders) this.colliders.push(c);
        this.groups.add(g);
      }
      g.hp = g.maxHp;
      if (g.tinted) {
        for (const [m, orig] of g.originals) {
          (m.material as THREE.Material).dispose();
          m.material = orig;
        }
        g.originals.clear();
        g.tinted = false;
      }
    }
  }

  // --- queries -----------------------------------------------------------------

  /** Nearest solid hit (world blocks + ground), or Infinity. Glass is ignored. */
  raycast(o: THREE.Vector3, dir: THREE.Vector3, maxT = Infinity): number {
    return this.raycastHit(o, dir, maxT).t;
  }

  /** Like raycast, but also says which block was hit and which glass pane (if any) the ray passes first. */
  raycastHit(o: THREE.Vector3, dir: THREE.Vector3, maxT = Infinity): { t: number; collider: AABB | null; glass: AABB | null; glassT: number } {
    let best = maxT;
    let hit: AABB | null = null;
    let glass: AABB | null = null;
    let gt = Infinity;
    if (dir.y < 0) {
      const tg = -o.y / dir.y;
      if (tg > 0 && tg < best) best = tg;
    }
    for (const b of this.colliders) {
      const t = rayAABB(o, dir, b.min, b.max);
      if (t === Infinity) continue;
      if (b.clear) {
        if (t < gt) { gt = t; glass = b; }
      } else if (t < best) {
        best = t;
        hit = b;
      }
    }
    if (glass && gt >= best) glass = null;
    return { t: best === maxT && maxT !== Infinity ? Infinity : best, collider: hit, glass, glassT: gt };
  }

  /**
   * Move a box (feet-centre `pos`, half-width `hw`, height `h`) along one axis,
   * pushing it out of any block it ends up inside. Returns true on contact.
   */
  moveAxis(pos: THREE.Vector3, hw: number, h: number, axis: Axis, d: number): boolean {
    if (d === 0) return false;
    pos[axis] += d;
    let hit = false;
    for (const b of this.colliders) {
      if (
        pos.x + hw <= b.min.x || pos.x - hw >= b.max.x ||
        pos.z + hw <= b.min.z || pos.z - hw >= b.max.z ||
        pos.y + h <= b.min.y || pos.y >= b.max.y
      ) continue;
      hit = true;
      if (axis === 'y') pos.y = d > 0 ? b.min.y - h - EPS : b.max.y;
      else if (d > 0) pos[axis] = b.min[axis] - hw - EPS;
      else pos[axis] = b.max[axis] + hw + EPS;
    }
    return hit;
  }
}
