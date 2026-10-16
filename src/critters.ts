import * as THREE from 'three';
import type { World } from './world';
import { rayAABB } from './world';
import type { NavGrid } from './nav';
import type { Player } from './player';
import type { Effects } from './fx';
import type { Sound } from './audio';
import type { Bot } from './bots';

/** Garden pests that attack gnomes and goblins alike. */
export type CritterKind = 'spider' | 'beetle' | 'wasp';

interface KindDef {
  name: string;
  hp: number;
  speed: number;
  bite: number; // damage per bite
  biteCool: number;
  reach: number; // metres
  hw: number; // hit box half-width
  h: number; // hit box height
  fly: number; // hover height (0 = walks)
  blood: number;
  gibs: number[];
}

const KINDS: Record<CritterKind, KindDef> = {
  spider: { name: 'spider', hp: 45, speed: 4.6, bite: 14, biteCool: 0.9, reach: 1.4, hw: 0.7, h: 0.7, fly: 0, blood: 0x6fa820, gibs: [0x1b1b1f, 0x6fa820, 0xb02020] },
  beetle: { name: 'beetle', hp: 120, speed: 2.1, bite: 22, biteCool: 1.2, reach: 1.6, hw: 0.75, h: 0.8, fly: 0, blood: 0xc9b020, gibs: [0x2a5a8a, 0x1a2a4a, 0xc9b020] },
  wasp: { name: 'wasp', hp: 22, speed: 5.5, bite: 8, biteCool: 0.6, reach: 1.6, hw: 0.45, h: 0.5, fly: 1.4, blood: 0xe0c030, gibs: [0xe8c020, 0x222222, 0xffffff] },
};

export interface CritterContext {
  world: World;
  nav: NavGrid;
  player: Player;
  bots: Bot[];
  /** A critter killed a fighter. */
  onKill: (critterName: string, victimName: string, victimWasEnemyOfPlayer: boolean) => void;
}

export type CritterDamage = 'bullet' | 'shotgun' | 'explosion' | 'melee' | 'critter';

const tmp = new THREE.Vector3();

export class Critter {
  static fx: Effects | null = null;
  static sound: Sound | null = null;

  readonly pos = new THREE.Vector3();
  readonly group = new THREE.Group();
  yaw = 0;
  hp: number;
  dead = false;
  gone = false; // finished rotting away: remove from the world
  gibbed = false;
  speedNow = 0;
  readonly def: KindDef;
  readonly scale: number;
  readonly displayName: string;

  private legs: THREE.Group[] = [];
  private wings: THREE.Mesh[] = [];
  private body = new THREE.Group();
  private phase = Math.random() * 10;
  private deadT = 0;
  private biteT = 0;
  private lunge = 0;
  private leapCool = 1 + Math.random() * 2;
  private leapVel: THREE.Vector3 | null = null;
  private retargetT = 0;
  private tgt: { pos: THREE.Vector3; bot: Bot | null } | null = null;
  private wander: THREE.Vector3 | null = null;
  private path: THREE.Vector3[] = [];
  private pathIdx = 0;
  private pathGoal = new THREE.Vector3(1e9, 0, 1e9);
  private repathT = 0;
  private stuckT = 0;
  private soundT = Math.random() * 2;
  private hover = Math.random() * 6;

  constructor(scene: THREE.Scene, readonly kind: CritterKind, big = false) {
    this.def = KINDS[kind];
    this.scale = big ? 2.4 : 1;
    this.hp = this.def.hp * (big ? 8 : 1);
    this.displayName = big ? 'the Spider Queen' : `a ${this.def.name}`;
    this.group.add(this.body);
    this.build();
    this.group.scale.setScalar(this.scale);
    scene.add(this.group);
  }

  private mk(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private build() {
    const b = this.body;
    if (this.kind === 'spider') {
      this.mk(b, 0.7, 0.55, 0.95, 0, 0.55, 0.5, 0x1b1b1f); // abdomen
      this.mk(b, 0.28, 0.1, 0.4, 0, 0.84, 0.5, 0xb02020); // red hourglass marking
      this.mk(b, 0.5, 0.42, 0.5, 0, 0.5, -0.25, 0x26262c); // head
      for (const [x, y] of [[-0.12, 0.62], [0.12, 0.62], [-0.2, 0.55], [0.2, 0.55]]) this.mk(b, 0.09, 0.09, 0.05, x, y, -0.52, 0xff2020);
      this.mk(b, 0.08, 0.2, 0.08, -0.12, 0.3, -0.5, 0xf2f0e8); // fangs
      this.mk(b, 0.08, 0.2, 0.08, 0.12, 0.3, -0.5, 0xf2f0e8);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const leg = new THREE.Group();
          leg.position.set(s * 0.3, 0.5, -0.3 + i * 0.28);
          const up = this.mk(leg, 0.8, 0.08, 0.08, s * 0.4, 0.14, 0, 0x1b1b1f);
          up.rotation.z = s * 0.45;
          const low = this.mk(leg, 0.8, 0.08, 0.08, s * 0.9, -0.2, 0, 0x26262c);
          low.rotation.z = -s * 1.0;
          b.add(leg);
          this.legs.push(leg);
        }
      }
    } else if (this.kind === 'beetle') {
      this.mk(b, 1.05, 0.62, 1.55, 0, 0.62, 0.2, 0x2a5a8a); // shell
      this.mk(b, 0.06, 0.64, 1.55, 0, 0.64, 0.2, 0x10203a); // shell split
      this.mk(b, 0.7, 0.4, 0.45, 0, 0.48, -0.72, 0x1a2a4a); // head
      const horn = this.mk(b, 0.14, 0.5, 0.14, 0, 0.8, -0.95, 0x1a1a1a);
      horn.rotation.x = 0.7;
      for (const s of [-1, 1]) this.mk(b, 0.1, 0.1, 0.06, s * 0.2, 0.58, -0.96, 0xffe040);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const leg = new THREE.Group();
          leg.position.set(s * 0.5, 0.35, -0.3 + i * 0.5);
          const l = this.mk(leg, 0.55, 0.1, 0.1, s * 0.25, -0.05, 0, 0x1a1a1a);
          l.rotation.z = -s * 0.5;
          b.add(leg);
          this.legs.push(leg);
        }
      }
    } else {
      // wasp: striped abdomen, black head, buzzing wings
      this.mk(b, 0.34, 0.34, 0.3, 0, 0, 0.5, 0xe8c020);
      this.mk(b, 0.36, 0.36, 0.22, 0, 0, 0.26, 0x222222);
      this.mk(b, 0.38, 0.38, 0.3, 0, 0, 0.02, 0xe8c020);
      this.mk(b, 0.3, 0.3, 0.3, 0, 0.02, -0.3, 0x222222);
      this.mk(b, 0.1, 0.1, 0.06, -0.1, 0.06, -0.47, 0xff2020);
      this.mk(b, 0.1, 0.1, 0.06, 0.1, 0.06, -0.47, 0xff2020);
      this.mk(b, 0.07, 0.07, 0.3, 0, -0.02, 0.8, 0x333333); // stinger
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.02, 0.32),
          new THREE.MeshLambertMaterial({ color: 0xdfefff, transparent: true, opacity: 0.55 }),
        );
        w.position.set(s * 0.5, 0.25, 0.05);
        b.add(w);
        this.wings.push(w);
      }
    }
  }

  spawn(at: THREE.Vector3) {
    this.pos.copy(at);
    if (this.def.fly) this.pos.y = this.def.fly;
    this.yaw = Math.random() * Math.PI * 2;
    this.sync();
  }

  /** Box centre (used by fighters to aim at it). */
  get centreY(): number {
    return this.def.fly ? 0 : (this.def.h * this.scale) / 2;
  }

  /** Distance along the ray if it hits, else null. */
  rayHit(o: THREE.Vector3, d: THREE.Vector3): number | null {
    if (this.dead) return null;
    const hw = this.def.hw * this.scale;
    const h = this.def.h * this.scale;
    const y0 = this.def.fly ? this.pos.y - h / 2 : this.pos.y;
    tmp.set(this.pos.x - hw, y0, this.pos.z - hw);
    const max = new THREE.Vector3(this.pos.x + hw, y0 + h, this.pos.z + hw);
    const t = rayAABB(o, d, tmp, max);
    return t === Infinity ? null : t;
  }

  /** Returns true if this killed it. */
  damage(amount: number, from: THREE.Vector3, how: CritterDamage = 'bullet'): boolean {
    if (this.dead) return false;
    if (this.kind === 'beetle' && (how === 'bullet' || how === 'shotgun')) amount *= 0.6; // hard shell
    this.hp -= amount;
    const fx = Critter.fx;
    tmp.set(this.pos.x - from.x, 0.3, this.pos.z - from.z).normalize();
    const hitPos = new THREE.Vector3(this.pos.x, this.pos.y + this.centreY, this.pos.z);
    fx?.blood(hitPos, tmp, this.def.blood, Math.min(10, 3 + Math.round(amount / 12)), 3.5);
    if (this.hp > 0) return false;

    const over = -this.hp;
    this.dead = true;
    this.deadT = 0;
    this.leapVel = null;
    Critter.sound?.squelch(0.9, 0);
    this.gibbed = how === 'explosion' || how === 'melee' || over > 40;
    if (this.gibbed) {
      this.group.visible = false;
      fx?.gibs(hitPos, this.def.gibs, 7, 5, this.def.blood, tmp.set(tmp.x, 0, tmp.z));
    }
    fx?.splat(this.pos, this.def.blood, 1.3 * this.scale);
    return true;
  }

  update(dt: number, c: CritterContext) {
    if (this.dead) {
      this.deadT += dt;
      if (!this.gibbed) {
        const f = Math.max(0.12, 1 - this.deadT * 3); // squashed flat
        this.group.scale.set(this.scale * (1 + (1 - f) * 0.6), this.scale * f, this.scale * (1 + (1 - f) * 0.6));
        if (this.def.fly && this.pos.y > 0) this.pos.y = Math.max(0, this.pos.y - 9 * dt);
        this.group.position.copy(this.pos);
      }
      if (this.deadT > 6) this.gone = true;
      return;
    }

    this.phase += dt * (5 + this.speedNow * 2.2);
    this.speedNow = 0;
    this.biteT -= dt;
    this.lunge = Math.max(0, this.lunge - dt * 4);

    // pick who to chew on: whoever is nearest, either side
    this.retargetT -= dt;
    if (this.tgt && (this.tgt.bot ? this.tgt.bot.dead : !c.player.alive)) this.tgt = null;
    if (this.retargetT <= 0 || !this.tgt) {
      this.retargetT = 0.5;
      this.tgt = null;
      let best = 45;
      if (c.player.alive) {
        const d = Math.hypot(c.player.pos.x - this.pos.x, c.player.pos.z - this.pos.z);
        if (d < best) { best = d; this.tgt = { pos: c.player.pos, bot: null }; }
      }
      for (const b of c.bots) {
        if (b.dead) continue;
        const d = Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z);
        if (d < best) { best = d; this.tgt = { pos: b.pos, bot: b }; }
      }
    }

    // creepy noises when you're close enough to hear them
    this.soundT -= dt;
    if (this.soundT <= 0 && Critter.sound) {
      this.soundT = 1 + Math.random() * 1.2;
      const sp = Critter.sound.spatial(this.pos.x, this.pos.z);
      if (this.kind === 'wasp') Critter.sound.buzz(sp.vol, sp.pan);
      else Critter.sound.skitter(sp.vol, sp.pan);
    }

    const def = this.def;
    if (this.leapVel) {
      this.leapStep(dt, c);
    } else if (this.tgt) {
      const t = this.tgt.pos;
      const dx = t.x - this.pos.x;
      const dz = t.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      this.turnTo(Math.atan2(-dx, -dz), 8 * dt);
      const reach = def.reach * this.scale;
      if (dist < reach && Math.abs((this.tgt.bot ? this.tgt.pos.y : c.player.pos.y) + 0.6 - (this.pos.y + this.centreY)) < 2.2) {
        if (this.biteT <= 0) this.bite(c);
      } else if (def.fly) {
        this.fly(dx, dz, dist, dt, c);
      } else {
        // spiders pounce from a few metres out
        this.leapCool -= dt;
        if (this.kind === 'spider' && this.leapCool <= 0 && dist > 3 && dist < 8) {
          this.leapCool = 3 + Math.random() * 2;
          this.leapVel = new THREE.Vector3((dx / dist) * 10, 6.5, (dz / dist) * 10);
        } else {
          this.goTo(c, t, def.speed, dt);
        }
      }
    } else {
      this.idle(c, dt);
    }

    this.animate(dt);
    this.sync();
  }

  private bite(c: CritterContext) {
    const def = this.def;
    const t = this.tgt!;
    this.biteT = def.biteCool;
    this.lunge = 1;
    const dmg = def.bite * (this.scale > 1 ? 1.6 : 1);
    if (t.bot) {
      if (t.bot.damage(dmg, this.pos, 'critter')) c.onKill(this.displayName, t.bot.name, t.bot.team === 1);
    } else {
      c.player.takeDamage(dmg);
    }
  }

  private turnTo(target: number, maxStep: number) {
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    this.yaw += Math.max(-maxStep, Math.min(maxStep, diff));
  }

  private step(c: CritterContext, vx: number, vz: number, speed: number, dt: number): number {
    const bx = this.pos.x;
    const bz = this.pos.z;
    c.world.moveAxis(this.pos, 0.4, 0.6, 'x', vx * speed * dt);
    c.world.moveAxis(this.pos, 0.4, 0.6, 'z', vz * speed * dt);
    const moved = Math.hypot(this.pos.x - bx, this.pos.z - bz);
    this.speedNow = moved / dt;
    return moved;
  }

  private goTo(c: CritterContext, target: THREE.Vector3, speed: number, dt: number) {
    this.repathT -= dt;
    if (this.path.length === 0 || this.repathT <= 0 || this.pathGoal.distanceTo(target) > 3) {
      this.path = c.nav.findPath(this.pos, target) ?? [];
      this.pathIdx = 0;
      this.pathGoal.copy(target);
      this.repathT = 0.8 + Math.random() * 0.4;
    }
    let vx: number;
    let vz: number;
    const wp = this.path[this.pathIdx];
    if (!wp) {
      // no route known: just scuttle straight at it
      vx = target.x - this.pos.x;
      vz = target.z - this.pos.z;
    } else {
      vx = wp.x - this.pos.x;
      vz = wp.z - this.pos.z;
      if (Math.hypot(vx, vz) < 0.45) { this.pathIdx++; return; }
    }
    const d = Math.hypot(vx, vz) || 1;
    const moved = this.step(c, vx / d, vz / d, speed, dt);
    if (moved < 0.25 * speed * dt) {
      this.stuckT += dt;
      if (this.stuckT > 0.6) { this.stuckT = 0; this.path = []; }
    } else {
      this.stuckT = 0;
    }
  }

  private leapStep(dt: number, c: CritterContext) {
    const v = this.leapVel!;
    v.y -= 20 * dt;
    c.world.moveAxis(this.pos, 0.4, 0.6, 'x', v.x * dt);
    c.world.moveAxis(this.pos, 0.4, 0.6, 'z', v.z * dt);
    this.pos.y += v.y * dt;
    this.speedNow = 6;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.leapVel = null;
    }
  }

  private fly(dx: number, dz: number, dist: number, dt: number, c: CritterContext) {
    this.hover += dt * 4;
    const wobble = Math.sin(this.hover * 1.7) * 0.6; // erratic sideways jinking
    const nx = dx / (dist || 1);
    const nz = dz / (dist || 1);
    const sp = this.def.speed;
    this.pos.x = Math.max(-30, Math.min(30, this.pos.x + (nx - nz * wobble) * sp * dt));
    this.pos.z = Math.max(-22, Math.min(29, this.pos.z + (nz + nx * wobble) * sp * dt));
    this.pos.y = this.def.fly + Math.sin(this.hover) * 0.35;
    this.speedNow = sp;
    void c;
  }

  private idle(c: CritterContext, dt: number) {
    if (!this.wander || Math.hypot(this.wander.x - this.pos.x, this.wander.z - this.pos.z) < 1) {
      this.wander = c.nav.randomFreePoint(28);
    }
    if (this.def.fly) {
      this.hover += dt * 3;
      this.pos.y = this.def.fly + Math.sin(this.hover) * 0.35;
      const dx = this.wander.x - this.pos.x;
      const dz = this.wander.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.turnTo(Math.atan2(-dx, -dz), 4 * dt);
      this.pos.x += (dx / d) * 2 * dt;
      this.pos.z += (dz / d) * 2 * dt;
      this.speedNow = 2;
    } else {
      this.goTo(c, this.wander, this.def.speed * 0.4, dt);
      this.turnTo(Math.atan2(-(this.wander.x - this.pos.x), -(this.wander.z - this.pos.z)), 4 * dt);
    }
  }

  private animate(dt: number) {
    void dt;
    const swing = Math.sin(this.phase);
    this.legs.forEach((leg, i) => {
      leg.rotation.y = Math.sin(this.phase + (i % 4) * 1.4 + (i < 4 ? 0 : Math.PI)) * 0.45 * (this.speedNow > 0.1 ? 1 : 0.2);
    });
    this.wings.forEach((w, i) => {
      w.rotation.z = (i === 0 ? -1 : 1) * Math.sin(this.phase * 9) * 0.6;
    });
    this.body.position.y = Math.abs(swing) * 0.05;
    this.body.position.z = -this.lunge * 0.5; // lunges forward when it bites
  }

  private sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }
}

/** All the pests currently in the garden. */
export class Critters {
  readonly list: Critter[] = [];

  constructor(private scene: THREE.Scene, fx: Effects, sound: Sound) {
    Critter.fx = fx;
    Critter.sound = sound;
  }

  alive(): number {
    return this.list.filter((c) => !c.dead).length;
  }

  spawn(kind: CritterKind, at: THREE.Vector3, big = false): Critter {
    const c = new Critter(this.scene, kind, big);
    c.spawn(at);
    this.list.push(c);
    return c;
  }

  update(dt: number, ctx: CritterContext) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.update(dt, ctx);
      if (c.gone) {
        this.scene.remove(c.group);
        this.list.splice(i, 1);
      }
    }
  }

  clear() {
    for (const c of this.list) this.scene.remove(c.group);
    this.list.length = 0;
  }
}
