import * as THREE from 'three';
import type { World } from './world';

/** 1m grid over the map. Cells blocked by anything a gnome can't walk through. */
export class NavGrid {
  readonly origin = -33;
  readonly n = 66;
  private blocked: Uint8Array;
  /** Walkable cells right next to an obstacle: candidate places to take cover. */
  readonly cover: { x: number; z: number }[] = [];

  private readonly radius: number;

  constructor(world: World, radius = 0.45) {
    this.radius = radius;
    this.blocked = new Uint8Array(this.n * this.n);
    this.build(world);
  }

  /** Recompute blocked cells and cover spots, e.g. after something was destroyed. */
  rebuild(world: World) {
    this.build(world);
  }

  private build(world: World) {
    const n = this.n;
    const radius = this.radius;
    this.blocked.fill(0);
    this.cover.length = 0;
    for (const b of world.colliders) {
      if (b.min.y >= 1.7 || b.max.y <= 0.35) continue; // overhead or ankle-high
      const cx0 = Math.max(0, Math.floor(b.min.x - radius - this.origin) - 1);
      const cx1 = Math.min(n - 1, Math.ceil(b.max.x + radius - this.origin) + 1);
      const cz0 = Math.max(0, Math.floor(b.min.z - radius - this.origin) - 1);
      const cz1 = Math.min(n - 1, Math.ceil(b.max.z + radius - this.origin) + 1);
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const x = cx + this.origin + 0.5;
          const z = cz + this.origin + 0.5;
          if (x > b.min.x - radius && x < b.max.x + radius && z > b.min.z - radius && z < b.max.z + radius) {
            this.blocked[cz * n + cx] = 1;
          }
        }
      }
    }
    for (let cz = 1; cz < n - 1; cz++) {
      for (let cx = 1; cx < n - 1; cx++) {
        if (this.blocked[cz * n + cx]) continue;
        const next =
          this.blocked[cz * n + cx - 1] || this.blocked[cz * n + cx + 1] ||
          this.blocked[(cz - 1) * n + cx] || this.blocked[(cz + 1) * n + cx];
        if (next) this.cover.push({ x: cx + this.origin + 0.5, z: cz + this.origin + 0.5 });
      }
    }
  }

  /** Walkable cell centres within radius r of (x, z). */
  freeCellsNear(x: number, z: number, r: number): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const c0x = this.cellOf(x - r);
    const c1x = this.cellOf(x + r);
    const c0z = this.cellOf(z - r);
    const c1z = this.cellOf(z + r);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        if (!this.isFree(cx, cz)) continue;
        const px = cx + this.origin + 0.5;
        const pz = cz + this.origin + 0.5;
        if (Math.hypot(px - x, pz - z) <= r) out.push({ x: px, z: pz });
      }
    }
    return out;
  }

  private cellOf(v: number): number {
    return Math.floor(v - this.origin);
  }

  isFree(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.n && cz < this.n && this.blocked[cz * this.n + cx] === 0;
  }

  isFreeAt(x: number, z: number): boolean {
    return this.isFree(this.cellOf(x), this.cellOf(z));
  }

  private nearestFree(x: number, z: number): [number, number] | null {
    const cx = this.cellOf(x);
    const cz = this.cellOf(z);
    if (this.isFree(cx, cz)) return [cx, cz];
    for (let r = 1; r < 8; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.isFree(cx + dx, cz + dz)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = [cx + dx, cz + dz]; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Random walkable point, optionally limited to |x|,|z| <= maxAbs. */
  randomFreePoint(maxAbs = 33): THREE.Vector3 {
    for (let i = 0; i < 300; i++) {
      const cx = Math.floor(Math.random() * this.n);
      const cz = Math.floor(Math.random() * this.n);
      if (!this.isFree(cx, cz)) continue;
      const x = cx + this.origin + 0.5;
      const z = cz + this.origin + 0.5;
      if (Math.abs(x) <= maxAbs && Math.abs(z) <= maxAbs) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(0, 0, 10);
  }

  private lineClear(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const steps = Math.ceil(Math.hypot(dx, dz) / 0.3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.isFreeAt(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  /** A* over the grid with greedy line-of-sight smoothing. Returns waypoints (excluding the start). */
  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const s = this.nearestFree(from.x, from.z);
    const g = this.nearestFree(to.x, to.z);
    if (!s || !g) return null;
    const n = this.n;
    const start = s[1] * n + s[0];
    const goal = g[1] * n + g[0];

    const gScore = new Float32Array(n * n).fill(Infinity);
    const fScore = new Float32Array(n * n).fill(Infinity);
    const came = new Int32Array(n * n).fill(-1);
    const closed = new Uint8Array(n * n);
    const open: number[] = [start];
    gScore[start] = 0;
    const h = (i: number) => {
      const dx = Math.abs((i % n) - g[0]);
      const dz = Math.abs(Math.floor(i / n) - g[1]);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    fScore[start] = h(start);

    let found = false;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === goal) { found = true; break; }
      closed[cur] = 1;
      const cx = cur % n;
      const cz = Math.floor(cur / n);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.isFree(nx, nz)) continue;
          if (dx && dz && (!this.isFree(cx + dx, cz) || !this.isFree(cx, cz + dz))) continue;
          const ni = nz * n + nx;
          if (closed[ni]) continue;
          const tg = gScore[cur] + (dx && dz ? 1.414 : 1);
          if (tg < gScore[ni]) {
            came[ni] = cur;
            gScore[ni] = tg;
            fScore[ni] = tg + h(ni);
            if (!open.includes(ni)) open.push(ni);
          }
        }
      }
    }
    if (!found) return null;

    const cells: THREE.Vector3[] = [];
    for (let c = goal; c !== -1; c = came[c]) {
      cells.push(new THREE.Vector3((c % n) + this.origin + 0.5, 0, Math.floor(c / n) + this.origin + 0.5));
    }
    cells.reverse();
    // use the real destination if it's walkable
    if (this.isFreeAt(to.x, to.z)) cells[cells.length - 1] = new THREE.Vector3(to.x, 0, to.z);

    // greedy smoothing
    const out: THREE.Vector3[] = [];
    let ax = from.x;
    let az = from.z;
    let i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.lineClear(ax, az, cells[j].x, cells[j].z)) j--;
      out.push(cells[j]);
      ax = cells[j].x;
      az = cells[j].z;
      i = j + 1;
    }
    return out;
  }
}
