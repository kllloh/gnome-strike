import * as THREE from 'three';
import type { World } from './world';
import type { Effects } from './fx';
import type { Sound } from './audio';
import type { Bot, Team } from './bots';
import type { Critter } from './critters';
import type { Player } from './player';

export type GrenadeKind = 'frag' | 'smoke';
export interface Thrower { team: Team; name: string; isPlayer: boolean }

const GRAVITY = 20;
const FRAG_FUSE = 2.0;
const SMOKE_FUSE = 1.5;
const FRAG_RADIUS = 7;
const FRAG_DAMAGE = 130;
const ROCKET_SPEED = 30;
const ROCKET_RADIUS = 8.5;
const ROCKET_DAMAGE = 230;
const SMOKE_RADIUS = 3.6; // sight-blocking radius
const SMOKE_LIFE = 15;

interface Live { kind: GrenadeKind; mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; fuse: number; thrower: Thrower }
interface Cloud {
  pos: THREE.Vector3;
  age: number;
  cubes: { mesh: THREE.Mesh; size: number }[];
  mats: THREE.MeshBasicMaterial[];
}
interface Blast { mesh: THREE.Mesh; age: number; size: number }
interface Rocket { obj: THREE.Group; pos: THREE.Vector3; vel: THREE.Vector3; life: number; thrower: Thrower }

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Grenades {
  private live: Live[] = [];
  private clouds: Cloud[] = [];
  private blasts: Blast[] = [];
  private rockets: Rocket[] = [];
  /** Live pests, set by the game so explosions can squash them. */
  critters: Critter[] = [];
  private fragGeo = new THREE.BoxGeometry(0.16, 0.2, 0.16);
  private fragMat = new THREE.MeshLambertMaterial({ color: 0x3a5a2a });
  private smokeMat = new THREE.MeshLambertMaterial({ color: 0xb8b8b8 });
  private cubeGeo = new THREE.BoxGeometry(1, 1, 1);

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private fx: Effects,
    private sound: Sound,
    private bots: Bot[],
    private player: Player,
    private onBotKilled: (t: Thrower, b: Bot) => void,
  ) {}

  /** Throw with an explicit velocity. `from` is where the grenade leaves the hand. */
  throw(kind: GrenadeKind, from: THREE.Vector3, vel: THREE.Vector3, thrower: Thrower) {
    const mesh = new THREE.Mesh(this.fragGeo, kind === 'frag' ? this.fragMat : this.smokeMat);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const pos = from.clone();
    pos.y -= 0.1;
    this.live.push({ kind, mesh, pos, vel: vel.clone(), fuse: kind === 'frag' ? FRAG_FUSE : SMOKE_FUSE, thrower });
    this.sound.whoosh();
  }

  /** Lob a grenade so it lands near `target` (used by bots). */
  throwAt(kind: GrenadeKind, from: THREE.Vector3, target: THREE.Vector3, thrower: Thrower) {
    const d = tmp.subVectors(target, from);
    const hd = Math.hypot(d.x, d.z);
    const T = Math.min(1.6, Math.max(0.6, hd / 14));
    const vel = new THREE.Vector3(d.x / T, d.y / T + 0.5 * GRAVITY * T, d.z / T);
    this.throw(kind, from, vel, thrower);
  }

  clear() {
    for (const g of this.live) this.scene.remove(g.mesh);
    this.live.length = 0;
    for (const c of this.clouds) this.removeCloud(c);
    this.clouds.length = 0;
    for (const b of this.blasts) this.disposeBlast(b);
    this.blasts.length = 0;
    for (const r of this.rockets) this.scene.remove(r.obj);
    this.rockets.length = 0;
  }

  /** True if the segment a->b passes through a smoke cloud. */
  blocks(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (const c of this.clouds) {
      if (c.age < 0.5) continue;
      const ab = tmp.subVectors(b, a);
      const len2 = ab.lengthSq() || 1;
      const t = Math.max(0, Math.min(1, tmp2.subVectors(c.pos, a).dot(ab) / len2));
      tmp.multiplyScalar(t).add(a); // closest point on the segment
      if (tmp.distanceToSquared(c.pos) < SMOKE_RADIUS * SMOKE_RADIUS) return true;
    }
    return false;
  }

  /** Launch a rocket along `dir`. It flies straight until it hits something, then goes off. */
  rocket(from: THREE.Vector3, dir: THREE.Vector3, thrower: Thrower) {
    const obj = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.7), new THREE.MeshLambertMaterial({ color: 0x6a6f55 }));
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.22), new THREE.MeshLambertMaterial({ color: 0xc03030 }));
    tip.position.z = 0.46;
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.4), new THREE.MeshBasicMaterial({ color: 0xff9a20 }));
    flame.position.z = -0.5;
    obj.add(body, tip, flame);
    obj.position.copy(from);
    obj.lookAt(from.clone().add(dir));
    this.scene.add(obj);
    this.rockets.push({ obj, pos: from.clone(), vel: dir.clone().normalize().multiplyScalar(ROCKET_SPEED), life: 4, thrower });
    this.sound.rocket(0.8, 0);
  }

  /** Fire a rocket at `target` (used by bots), with a little inaccuracy. */
  rocketAt(from: THREE.Vector3, target: THREE.Vector3, thrower: Thrower) {
    const d = tmp.subVectors(target, from).normalize();
    d.x += (Math.random() - 0.5) * 0.05;
    d.y += (Math.random() - 0.5) * 0.03;
    d.z += (Math.random() - 0.5) * 0.05;
    this.rocket(from, d.normalize(), thrower);
  }

  private updateRockets(dt: number) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      const step = ROCKET_SPEED * dt + 0.2;
      const dir = tmp.copy(r.vel).normalize();
      let hitT = this.world.raycast(r.pos, dir, step);
      if (!(hitT < step)) hitT = Infinity;
      for (const b of this.bots) {
        if (b.dead || b.team === r.thrower.team) continue;
        const h = b.rayHit(r.pos, dir);
        if (h && h.t < Math.min(hitT, step)) hitT = h.t;
      }
      for (const k of this.critters) {
        if (k.dead) continue;
        const ct = k.rayHit(r.pos, dir);
        if (ct !== null && ct < Math.min(hitT, step)) hitT = ct;
      }
      if (r.thrower.team !== 0 && this.player.alive) {
        // enemy rockets can hit the player: closest approach of the ray to the player's chest
        const to = tmp2.set(this.player.pos.x - r.pos.x, this.player.pos.y + 1 - r.pos.y, this.player.pos.z - r.pos.z);
        const along = to.dot(dir);
        if (along > 0 && along < step && to.addScaledVector(dir, -along).length() < 0.7) hitT = Math.min(hitT, along);
      }
      if (hitT < Infinity || r.life <= 0) {
        const point = r.pos.clone().addScaledVector(dir, hitT < Infinity ? hitT : 0);
        this.scene.remove(r.obj);
        this.rockets.splice(i, 1);
        this.blast(point, r.thrower, ROCKET_RADIUS, ROCKET_DAMAGE, true);
        continue;
      }
      r.pos.addScaledVector(r.vel, dt);
      r.obj.position.copy(r.pos);
      this.fx.burst(r.pos, 0x9a9a9a, 1, 0.8, 2.4);
      if (Math.random() < 0.6) this.fx.burst(r.pos, 0xff9a20, 1, 1.2, 1.6);
    }
  }

  update(dt: number) {
    this.updateRockets(dt);
    const steps = Math.max(1, Math.ceil(dt / 0.01));
    const h = dt / steps;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.fuse -= dt;
      for (let s = 0; s < steps; s++) this.step(g, h);
      g.mesh.position.set(g.pos.x, g.pos.y + 0.1, g.pos.z);
      g.mesh.rotation.y += dt * 6;
      if (g.fuse <= 0) {
        this.scene.remove(g.mesh);
        this.live.splice(i, 1);
        if (g.kind === 'frag') this.explode(g);
        else this.pop(g);
      }
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.age += dt;
      const k = b.age / 0.3;
      b.mesh.scale.setScalar(1 + k * 9 * b.size);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - k));
      if (k >= 1) { this.disposeBlast(b); this.blasts.splice(i, 1); }
    }
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.age += dt;
      const grow = Math.min(1, c.age / 0.8);
      const fade = Math.min(1, (SMOKE_LIFE - c.age) / 3);
      for (const m of c.mats) m.opacity = 0.96 * Math.max(0, fade);
      for (const cube of c.cubes) cube.mesh.scale.setScalar(cube.size * grow);
      if (c.age >= SMOKE_LIFE) { this.removeCloud(c); this.clouds.splice(i, 1); }
    }
  }

  private step(g: Live, h: number) {
    const v = g.vel;
    v.y -= GRAVITY * h;
    for (const axis of ['x', 'y', 'z'] as const) {
      if (this.world.moveAxis(g.pos, 0.1, 0.2, axis, v[axis] * h)) {
        v[axis] *= -0.4;
        if (axis === 'y') { v.x *= 0.75; v.z *= 0.75; }
      }
    }
    if (g.pos.y <= 0) {
      g.pos.y = 0;
      if (v.y < 0) v.y = Math.abs(v.y) > 1.5 ? -v.y * 0.4 : 0;
      v.x *= 1 - 3 * h;
      v.z *= 1 - 3 * h;
    }
  }

  private explode(g: Live) {
    this.blast(new THREE.Vector3(g.pos.x, g.pos.y + 0.3, g.pos.z), g.thrower, FRAG_RADIUS, FRAG_DAMAGE, false);
  }

  /** An explosion: sound, fireball, wrecked scenery, hurt fighters and a shaken camera. */
  private blast(c: THREE.Vector3, thrower: Thrower, radius: number, maxDmg: number, selfHurt: boolean) {
    const scale = radius / FRAG_RADIUS;
    const { vol, pan } = this.sound.spatial(c.x, c.z);
    this.sound.boom(Math.max(0.35, vol), pan);
    this.world.explode(c, radius, maxDmg * 2); // the blast breaks props, walls and glass too

    // visuals: expanding fireball + debris
    const mesh = new THREE.Mesh(
      this.cubeGeo,
      new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.8 }),
    );
    mesh.position.copy(c);
    this.scene.add(mesh);
    this.blasts.push({ mesh, age: 0, size: scale });
    this.fx.burst(c, 0xff8020, Math.round(16 * scale), 8, 1);
    this.fx.burst(c, 0x555555, Math.round(10 * scale), 6, 1);

    const hits = (target: THREE.Vector3): number => {
      const d = c.distanceTo(target);
      if (d >= radius) return 0;
      tmp.subVectors(target, c).divideScalar(d || 1);
      if (d > 0.3 && this.world.raycast(c, tmp, d) < d - 0.3) return 0; // wall in the way
      return maxDmg * (1 - d / radius);
    };

    for (const b of this.bots) {
      if (b.dead || b.team === thrower.team) continue;
      b.hear(c);
      const dmg = hits(tmp2.set(b.pos.x, b.pos.y + 0.8, b.pos.z));
      if (dmg > 0 && b.damage(dmg, c, 'explosion')) this.onBotKilled(thrower, b);
    }
    for (const k of this.critters) {
      if (k.dead) continue;
      const dmg = hits(tmp2.set(k.pos.x, k.pos.y + k.centreY, k.pos.z));
      if (dmg > 0) k.damage(dmg * 1.2, c, 'explosion');
    }
    if (this.player.alive) {
      const dmg = hits(tmp2.set(this.player.pos.x, this.player.pos.y + 1, this.player.pos.z));
      if (dmg > 0 && thrower.team !== 0) this.player.takeDamage(dmg);
      else if (dmg > 0 && selfHurt && thrower.isPlayer) this.player.takeDamage(dmg * 0.5); // your own rocket hurts a bit
      const d = c.distanceTo(this.player.pos);
      this.player.shake = Math.max(this.player.shake, Math.max(0, 1 - d / (22 * scale)));
    }
  }

  private pop(g: Live) {
    const pos = new THREE.Vector3(g.pos.x, Math.max(0, g.pos.y) + 1.7, g.pos.z);
    const { vol, pan } = this.sound.spatial(pos.x, pos.z);
    this.sound.smokePop(Math.max(0.3, vol), pan);
    const mats = [0xd8d8d8, 0xc4c4c4, 0xb0b0b0].map(
      (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.96, side: THREE.DoubleSide }),
    );
    const cubes: Cloud['cubes'] = [];
    for (let i = 0; i < 36; i++) {
      const r = 2.9 * Math.cbrt(Math.random());
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const off = new THREE.Vector3(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7, r * Math.sin(ph) * Math.sin(th));
      off.y = Math.max(off.y, -1.4);
      const mesh = new THREE.Mesh(this.cubeGeo, mats[i % 3]);
      mesh.position.copy(pos).add(off);
      mesh.rotation.y = Math.random() * Math.PI;
      mesh.scale.setScalar(0.01);
      this.scene.add(mesh);
      cubes.push({ mesh, size: 1.6 + Math.random() * 1.0 });
    }
    this.clouds.push({ pos, age: 0, cubes, mats });
    // gnomes nearby look over, curious
    for (const b of this.bots) if (!b.dead && b.team !== g.thrower.team && b.pos.distanceTo(pos) < 25) b.hear(pos);
  }

  private removeCloud(c: Cloud) {
    for (const cube of c.cubes) this.scene.remove(cube.mesh);
    for (const m of c.mats) m.dispose();
  }

  private disposeBlast(b: Blast) {
    this.scene.remove(b.mesh);
    (b.mesh.material as THREE.Material).dispose();
  }
}
