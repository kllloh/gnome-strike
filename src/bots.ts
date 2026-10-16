import * as THREE from 'three';
import { rayAABB, type World } from './world';
import type { NavGrid } from './nav';
import type { Player } from './player';
import type { Effects } from './fx';
import type { Sound } from './audio';
import type { Grenades } from './grenades';
import type { Critter } from './critters';
import { createFighter, GNOME_SCALE as S, type Faction, type GnomeModel } from './gnome';
import { CLASSES, type ClassId } from './classes';

/** Team 0 = the player's side, team 1 = the enemy. Which faction each is (gnomes/goblins) is chosen by the player. */
export type Team = 0 | 1;

export interface BotContext {
  world: World;
  nav: NavGrid;
  player: Player;
  fx: Effects;
  sound: Sound;
  bots: Bot[];
  grenades: Grenades;
  critters: Critter[];
  onKill: (killer: string, victim: string, victimTeam: Team) => void;
}

export type Zone = 'head' | 'body' | 'hat';
export type BotEvent = 'hit' | 'death' | 'kill' | 'spot' | 'idle' | 'throw' | 'hat' | 'fart' | 'sneeze' | 'bug' | 'rpg';
/** What dealt the damage; big ones (and explosions) turn fighters into confetti. */
export type DamageKind = 'bullet' | 'shotgun' | 'explosion' | 'melee' | 'critter';

interface Target {
  pos: THREE.Vector3;
  centreY: number;
  speed: number;
  bot: Bot | null; // null => the human player (or a critter)
  critter?: Critter | null;
}

/** A spot beside an obstacle. `low` means it only hides a crouched gnome. */
interface Cover { x: number; z: number; low: boolean }

/**
 * What a bot is currently doing:
 *  patrol / advance - bounding from one piece of cover to the next (never a straight dash)
 *  hold             - stopped in cover, scanning
 *  toCover          - running for cover because an enemy can see us
 *  hidden           - behind cover, waiting out of sight
 *  peek             - stepping out sideways to get a line of sight
 *  expose           - out in the open for a moment, shooting
 */
type Tac = 'patrol' | 'advance' | 'hold' | 'toCover' | 'hidden' | 'peek' | 'expose';

/** How each class fights. Snipers see far and take slow, heavy shots; heavies are shotgun-style brawlers. */
const PROFILE: Record<ClassId, {
  sight: number; react: number; burst: number; short: number; longLo: number; longHi: number;
  dmgLo: number; dmgHi: number; accBase: number; accPerM: number; accMin: number; accMax: number;
}> = {
  assault: { sight: 34, react: 0.45, burst: 4, short: 0.14, longLo: 0.7, longHi: 1.3, dmgLo: 6, dmgHi: 11, accBase: 0.8, accPerM: 0.02, accMin: 0.15, accMax: 0.65 },
  scout: { sight: 34, react: 0.4, burst: 5, short: 0.1, longLo: 0.5, longHi: 0.9, dmgLo: 4, dmgHi: 8, accBase: 0.75, accPerM: 0.02, accMin: 0.12, accMax: 0.6 },
  heavy: { sight: 30, react: 0.5, burst: 2, short: 0.55, longLo: 0.9, longHi: 1.4, dmgLo: 12, dmgHi: 20, accBase: 0.95, accPerM: 0.05, accMin: 0.05, accMax: 0.85 },
  sniper: { sight: 55, react: 0.8, burst: 1, short: 2.4, longLo: 2.2, longHi: 3.2, dmgLo: 55, dmgHi: 75, accBase: 0.8, accPerM: 0.008, accMin: 0.25, accMax: 0.65 },
  medic: { sight: 34, react: 0.45, burst: 3, short: 0.13, longLo: 0.8, longHi: 1.4, dmgLo: 5, dmgHi: 9, accBase: 0.8, accPerM: 0.02, accMin: 0.15, accMax: 0.6 },
};

const HW = 0.3;
const H = 1.8;
const EYE = 1.5;
const CROUCH_DROP = 0.38; // how much shorter a crouched gnome is

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tD = new THREE.Vector3();
const hA = new THREE.Vector3();
const hB = new THREE.Vector3();
const hD = new THREE.Vector3();
const gV = new THREE.Vector3();
const gP = new THREE.Vector3();

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class Bot {
  /** Set by the game: lets it play voice/hit sounds without bots knowing about audio details. */
  static onEvent: ((kind: BotEvent, bot: Bot) => void) | null = null;
  /** Visual effects (blood, gibs, hats), set by the game. */
  static fx: Effects | null = null;

  readonly pos = new THREE.Vector3();
  readonly group = new THREE.Group();
  yaw = 0;
  hp = 100;
  dead = false;
  readonly voicePitch: number;
  readonly voiceSeed = Math.floor(Math.random() * 997);
  hasHat = true;
  gibbed = false;
  private flying = false;
  private flyVel = new THREE.Vector3();
  private flySpin = new THREE.Vector3();
  readonly maxHp: number;
  private readonly mul: number; // class speed multiplier
  private readonly sight: number;
  private hurtSince = 99;
  hunt = false; // when true, bots seek out the nearest enemy instead of wandering
  pressure = 0; // 0..1: ramps up through a round, so bots hold and hide for less time

  private model: GnomeModel;
  private path: THREE.Vector3[] = [];
  private pathIdx = 0;
  private pathGoal = new THREE.Vector3(1e9, 0, 1e9);
  private repathT = 0;

  // tactical state
  private tac: Tac = 'hold';
  private holdT = 0.5;
  private hideT = 0;
  private exposeT = 0;
  private fruitless = 0; // peeks that found nothing
  private coverFails = 0;
  private coverSpot: Cover | null = null;
  private coverPos = new THREE.Vector3();
  private hopGoal = new THREE.Vector3();
  private peekCell = new THREE.Vector3();
  private known = new THREE.Vector3(); // where we think the enemy is
  private hasKnown = false;
  private knownT = 99; // seconds since that was confirmed
  private hurtT = 0;
  private hitFlag = false;
  private crouch = 0; // 0 standing .. 1 fully crouched
  private wantCrouch = false;
  private recheckT = 0.6;
  private lane = 0; // the side-to-side line this bot prefers to approach along

  private alert = 0;
  private react = 0;
  private cool = 0;
  private burst = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private deadT = 0;
  private flashT = 0;
  private walkPhase = 0;
  private speedNow = 0;
  private stuckT = 0;
  private aiming = false;
  private wasSeeing = false;
  private frags = 0;
  private rockets = 0;
  private fragCool = 0;
  private lastHitSnd = 0;
  private chatT = 8 + Math.random() * 15;
  private gasT = 15 + Math.random() * 40; // until the next fart (goblins) or sneeze (gnomes)
  private self: Target;

  // hitbox scratch (body / head / hat)
  private hb = [0, 1, 2].map(() => ({ min: new THREE.Vector3(), max: new THREE.Vector3() }));

  constructor(scene: THREE.Scene, readonly team: Team, readonly name: string, readonly faction: Faction, readonly cls: ClassId = 'assault') {
    this.model = createFighter(faction, cls);
    this.maxHp = CLASSES[cls].health;
    this.mul = CLASSES[cls].speed;
    this.sight = PROFILE[cls].sight;
    // gnomes squeak, goblins growl
    this.voicePitch = faction === 'gnome' ? 1.5 + Math.random() * 0.5 : 0.55 + Math.random() * 0.3;
    this.group.add(this.model.root);
    scene.add(this.group);
    this.self = { pos: this.pos, centreY: 0.8, speed: 0, bot: this };
  }

  get speed(): number {
    return this.speedNow;
  }

  spawn(at: THREE.Vector3, _goal?: THREE.Vector3) {
    this.pos.copy(at);
    this.yaw = Math.atan2(at.x, at.z); // face the map centre
    this.hp = this.maxHp;
    this.hurtSince = 99;
    this.dead = false;
    this.deadT = 0;
    this.hunt = false;
    this.pressure = 0;
    this.path = [];
    this.alert = 0;
    this.react = 0;
    this.cool = 0;
    this.burst = 0;
    this.speedNow = 0;
    this.wasSeeing = false;
    this.frags = Math.random() < 0.6 ? 1 : 0;
    this.rockets = this.cls === 'heavy' && Math.random() < 0.7 ? 1 : 0;
    this.fragCool = 4 + Math.random() * 8;
    this.gasT = 12 + Math.random() * 45;
    this.tac = 'hold';
    this.holdT = 1.5 + Math.random() * 3.5; // settle in, scan, don't sprint off
    this.lane = (Math.random() * 2 - 1) * 22;
    this.coverSpot = null;
    this.hasKnown = false;
    this.knownT = 99;
    this.fruitless = 0;
    this.coverFails = 0;
    this.hurtT = 0;
    this.hitFlag = false;
    this.crouch = 0;
    this.wantCrouch = false;
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
    this.flying = false;
    this.gibbed = false;
    this.restoreHat();
    for (const m of this.model.mats) m.emissive.setHex(0x000000);
    this.applyCrouch();
    this.sync();
  }

  private get k(): number {
    return 1 - CROUCH_DROP * this.crouch;
  }

  /** Ray vs this fighter. Returns distance + which zone was hit. */
  rayHit(o: THREE.Vector3, d: THREE.Vector3): { t: number; zone: Zone } | null {
    if (this.dead) return null;
    const p = this.pos;
    const k = this.k;
    const set = (i: number, half: number, y0: number, y1: number) => {
      this.hb[i].min.set(p.x - half, p.y + y0 * k, p.z - half);
      this.hb[i].max.set(p.x + half, p.y + y1 * k, p.z + half);
    };
    const m = this.model;
    set(0, 0.35 * S, 0, 1.0 * S);
    set(1, m.headHalf * S, 1.0 * S, m.headTop * S);
    const hatOn = this.hasHat && m.hatTop > m.headTop; // shoot it off and that part of the target is just air
    if (hatOn) set(2, m.hatHalf * S, m.headTop * S, m.hatTop * S);
    let best: { t: number; zone: Zone } | null = null;
    const zones: Zone[] = ['body', 'head', 'hat'];
    for (let i = 0; i < (hatOn ? 3 : 2); i++) {
      const t = rayAABB(o, d, this.hb[i].min, this.hb[i].max);
      if (t < Infinity && (!best || t < best.t)) best = { t, zone: zones[i] };
    }
    return best;
  }

  /** Returns true if this hit killed the bot. */
  damage(amount: number, from: THREE.Vector3, how: DamageKind = 'bullet'): boolean {
    if (this.dead) return false;
    this.hp -= amount;
    this.hurtSince = 0;
    this.flashT = 0.12;
    this.alert = 6;
    this.hurtT = 0.8;
    this.hitFlag = true;
    this.known.set(from.x, 0, from.z);
    this.hasKnown = true;
    this.knownT = 0;

    // blood sprays away from whatever hit us
    const fx = Bot.fx;
    gV.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    const away = gV.length() || 1;
    gV.divideScalar(away);
    if (fx) {
      gP.set(this.pos.x, this.pos.y + 0.9 * this.k, this.pos.z);
      fx.blood(gP, gV.set(gV.x, 0.3, gV.z), this.blood, Math.min(14, 3 + Math.round(amount / 10)), how === 'explosion' ? 7 : 4);
      gV.set(gV.x, 0, gV.z);
    }

    if (this.hp <= 0) {
      const over = -this.hp;
      this.dead = true;
      this.deadT = 0;
      this.aiming = false;
      for (const m of this.model.mats) m.emissive.setHex(0x000000);
      Bot.onEvent?.('death', this);
      this.knockHat(gV, 1.4); // the hat always goes flying
      const gib = how === 'explosion' || how === 'melee' || over >= 70 || (how === 'shotgun' && over >= 10);
      if (gib) {
        this.gib(gV, how === 'explosion' ? 9 : 6);
      } else {
        fx?.splat(this.pos, this.blood, 1.6);
        if (how === 'shotgun' || over >= 35) this.launch(gV, how === 'shotgun' ? 8 : 6);
      }
      return true;
    }
    const now = performance.now();
    if (now - this.lastHitSnd > 160) {
      this.lastHitSnd = now;
      Bot.onEvent?.('hit', this);
    }
    return false;
  }

  get blood(): number {
    return this.faction === 'goblin' ? 0x7cd13a : 0xb01818;
  }

  /** Shoot the hat off: no damage, it just flies away. Returns false if there was no hat to knock off. */
  knockHat(dir: THREE.Vector3, power = 1): boolean {
    if (!this.hasHat || this.gibbed) return false;
    const parent = this.group.parent;
    if (!parent) return false;
    this.hasHat = false;
    const hat = this.model.hat;
    parent.attach(hat); // keeps its position in the world while leaving the body
    Bot.fx?.addProp(
      hat,
      new THREE.Vector3(dir.x * (2 + Math.random() * 3) * power, (6 + Math.random() * 3) * power, dir.z * (2 + Math.random() * 3) * power),
      new THREE.Vector3(Math.random() * 12 - 6, Math.random() * 10 - 5, Math.random() * 12 - 6),
      0.35,
    );
    return true;
  }

  private restoreHat() {
    if (this.hasHat) return;
    Bot.fx?.dropProp(this.model.hat);
    const h = this.model.hat;
    this.model.root.add(h);
    h.position.set(0, this.model.hatHeight, 0);
    h.rotation.set(0, 0, 0);
    h.scale.set(1, 1, 1);
    this.hasHat = true;
  }

  /** Burst into chunks. */
  private gib(dir: THREE.Vector3, power: number) {
    this.gibbed = true;
    this.group.visible = false;
    const cols = this.model.mats.map((m) => m.color.getHex());
    gP.set(this.pos.x, this.pos.y + 0.8, this.pos.z);
    Bot.fx?.gibs(gP, cols, 14, power, this.blood, dir);
    Bot.fx?.splat(this.pos, this.blood, 2.4);
  }

  /** Corpse sent tumbling through the air. */
  private launch(dir: THREE.Vector3, power: number) {
    this.flying = true;
    this.flyVel.set(dir.x * power, 5 + power * 0.5, dir.z * power);
    this.flySpin.set((Math.random() - 0.5) * 14, 0, (Math.random() - 0.5) * 14);
  }

  private flyStep(dt: number, c: BotContext) {
    const v = this.flyVel;
    v.y -= 22 * dt;
    if (c.world.moveAxis(this.pos, HW, 0.8, 'x', v.x * dt)) v.x *= -0.4;
    if (c.world.moveAxis(this.pos, HW, 0.8, 'z', v.z * dt)) v.z *= -0.4;
    this.pos.y += v.y * dt;
    this.group.rotation.x += this.flySpin.x * dt;
    this.group.rotation.z += this.flySpin.z * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      c.fx.splat(this.pos, this.blood, 0.9);
      if (v.y < -4) {
        v.y *= -0.3;
        v.x *= 0.6;
        v.z *= 0.6;
        this.flySpin.multiplyScalar(0.5);
      } else {
        this.flying = false;
        this.group.rotation.set(-Math.PI / 2, this.group.rotation.y, 0);
      }
    }
    this.group.position.copy(this.pos);
  }

  heal(n: number) {
    if (!this.dead) this.hp = Math.min(this.maxHp, this.hp + n);
  }

  /** A gunshot, explosion or teammate callout somewhere near us. */
  hear(at: THREE.Vector3) {
    if (this.dead) return;
    const inFight = (this.tac === 'toCover' || this.tac === 'hidden' || this.tac === 'peek' || this.tac === 'expose') && this.knownT < 4;
    if (inFight) return;
    if (!this.hasKnown || this.knownT > 5 || Math.random() < 0.4) {
      this.known.set(at.x + (Math.random() - 0.5) * 6, 0, at.z + (Math.random() - 0.5) * 6);
      this.hasKnown = true;
      this.knownT = 0;
      if (this.tac === 'patrol' || this.tac === 'hold') {
        this.wantCrouch = false;
        this.tac = 'advance';
        this.holdT = 0;
        this.path = [];
        this.pickHop(false);
      }
    }
  }

  private enemies(c: BotContext): Target[] {
    const out: Target[] = [];
    for (const o of c.bots) {
      if (o.team !== this.team && !o.dead) {
        o.self.speed = o.speedNow;
        o.self.centreY = 0.8 * o.k;
        out.push(o.self);
      }
    }
    if (this.team === 1 && c.player.alive) {
      out.push({ pos: c.player.pos, centreY: 1.2, speed: c.player.horizSpeed, bot: null });
    }
    // bugs and spiders go for everybody
    for (const k of c.critters) {
      if (!k.dead) out.push({ pos: k.pos, centreY: k.centreY, speed: k.speedNow, bot: null, critter: k });
    }
    return out;
  }

  update(dt: number, c: BotContext) {
    if (this.dead) {
      c.fx.laserOff(this);
      this.deadT += dt;
      if (this.flying) this.flyStep(dt, c);
      else if (!this.gibbed) this.group.rotation.x = -Math.min(1, this.deadT * 3) * (Math.PI / 2);
      return;
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      const e = this.flashT > 0 ? 0x661111 : 0x000000;
      for (const m of this.model.mats) m.emissive.setHex(e);
    }
    this.alert = Math.max(0, this.alert - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.hurtSince += dt;
    this.gasT -= dt;
    if (this.gasT <= 0) {
      this.gasT = 30 + Math.random() * 60;
      Bot.onEvent?.(this.faction === 'goblin' ? 'fart' : 'sneeze', this);
    }
    const regen = CLASSES[this.cls].regen;
    if (regen > 0 && this.hurtSince > 4) this.heal(regen * dt);

    // --- perception: nearest enemy we can actually see ----------------------
    const eye = tA.set(this.pos.x, this.pos.y + EYE * this.k, this.pos.z);
    const cands = this.enemies(c)
      .map((t) => ({ t, d: Math.hypot(t.pos.x - eye.x, t.pos.z - eye.z) }))
      .sort((a, b) => a.d - b.d);
    let tgt: Target | null = null;
    let dist = 0;
    for (let i = 0; i < Math.min(3, cands.length); i++) {
      const t = cands[i].t;
      const to = tC.set(t.pos.x - eye.x, t.pos.y + t.centreY - eye.y, t.pos.z - eye.z);
      const d3 = to.length();
      if (d3 > this.sight) continue;
      const hd = Math.hypot(to.x, to.z) || 1;
      const dot = (to.x * -Math.sin(this.yaw) + to.z * -Math.cos(this.yaw)) / hd;
      if (dot > 0.3 || this.alert > 0 || d3 < 6) {
        to.divideScalar(d3);
        if (c.world.raycast(eye, to, d3) >= d3 - 0.4 && !c.grenades.blocks(eye, tD.set(t.pos.x, t.pos.y + t.centreY, t.pos.z))) {
          tgt = t;
          dist = d3;
          break;
        }
      }
    }

    this.aiming = false;
    this.speedNow = 0;
    this.knownT += dt;

    if (tgt && !this.wasSeeing) {
      if (tgt.critter) {
        if (Math.random() < 0.5) Bot.onEvent?.('bug', this);
      } else {
        if (!tgt.bot && Math.random() < 0.4) Bot.onEvent?.('spot', this);
        // call it out: nearby teammates start moving toward the contact (carefully)
        for (const o of c.bots) {
          if (o !== this && !o.dead && o.team === this.team && o.pos.distanceTo(this.pos) < 50 && Math.random() < 0.7) o.hear(tgt.pos);
        }
      }
    }
    this.wasSeeing = !!tgt;

    if (tgt) this.onSeen(c, tgt, dist, dt);
    else this.onUnseen(c, dt);

    // crouch smoothly (behind low cover) and keep the body in sync
    const target = this.wantCrouch ? 1 : 0;
    this.crouch += Math.max(-dt * 6, Math.min(dt * 6, target - this.crouch));
    this.applyCrouch();

    this.separate(dt, c);
    this.animate(dt);
    this.sync();
  }

  // --- contact: an enemy is in view ------------------------------------------------

  private onSeen(c: BotContext, tgt: Target, dist: number, dt: number) {
    const tp = tgt.pos;
    this.known.set(tp.x, 0, tp.z);
    this.hasKnown = true;
    this.knownT = 0;
    this.react += dt;
    this.aiming = true;
    const want = Math.atan2(-(tp.x - this.pos.x), -(tp.z - this.pos.z));
    this.turnTo(want, 9 * dt);
    this.hitFlag = false;

    // caught in the open: get behind something rather than trading shots standing there
    if ((this.tac === 'patrol' || this.tac === 'advance') && dist > this.sight * 0.76 && this.hurtT <= 0) {
      // far off and not under fire: keep bounding toward the next cover rather than hiding
      if (this.goTo(c, this.hopGoal, 3.4, dt, false)) {
        this.tac = 'hold';
        this.holdT = (0.8 + Math.random() * 1.2) * (1 - 0.6 * this.pressure);
      }
    } else if (this.tac === 'patrol' || this.tac === 'advance' || this.tac === 'hold') {
      this.coverFails = 0;
      this.startCover(c, tp, null);
    } else if (this.tac === 'hidden' || this.tac === 'peek') {
      // the enemy found us (or we found them): fight for a moment, then duck back
      this.tac = 'expose';
      this.exposeT = 1.0 + Math.random() * 0.8;
      this.wantCrouch = false;
      this.fruitless = 0;
    }

    if (this.tac === 'toCover') {
      const arrived = this.goTo(c, this.coverPos, 4.6, dt, false);
      if (arrived) {
        // we're at the spot and can still be seen: it was a bad one
        this.coverFails++;
        if (this.coverFails > 2) {
          this.coverFails = 0;
          this.tac = 'expose';
          this.exposeT = 2;
        } else {
          this.startCover(c, tp, this.coverSpot);
        }
      }
    } else if (this.tac === 'expose') {
      this.exposeT -= dt;
      if (this.hurtT > 0 && this.exposeT > 0.3) this.exposeT = 0.3; // taking fire: don't stay out
      this.strafe(c, tp, dist, dt);
      if (this.exposeT <= 0) this.startCover(c, tp, this.coverSpot);
    }

    // grenades from a distance
    this.fragCool -= dt;
    if (!tgt.critter && this.frags > 0 && this.fragCool <= 0 && dist > 10 && dist < 30 && this.react > 0.4 && Math.random() < dt * 0.5) {
      this.frags--;
      this.fragCool = 12 + Math.random() * 10;
      const from = new THREE.Vector3(this.pos.x - Math.sin(this.yaw) * 0.4, this.pos.y + 1.3, this.pos.z - Math.cos(this.yaw) * 0.4);
      c.grenades.throwAt('frag', from, new THREE.Vector3(tp.x, tp.y + 0.1, tp.z), { team: this.team, name: this.name, isPlayer: false });
      Bot.onEvent?.('throw', this);
    }

    // heavies sometimes carry an RPG
    if (!tgt.critter && this.rockets > 0 && dist > 14 && dist < 38 && this.react > 0.5 && Math.random() < dt * 0.35) {
      this.rockets--;
      const from = new THREE.Vector3(this.pos.x - Math.sin(this.yaw) * 0.6, this.pos.y + 1.1 * this.k, this.pos.z - Math.cos(this.yaw) * 0.6);
      c.grenades.rocketAt(from, new THREE.Vector3(tp.x, tp.y + tgt.centreY, tp.z), { team: this.team, name: this.name, isPlayer: false });
      Bot.onEvent?.('rpg', this);
    }

    // shooting
    this.cool -= dt;
    const aimed = Math.abs(wrapAngle(want - this.yaw)) < 0.35;
    const P = PROFILE[this.cls];
    if (this.cls === 'sniper' && this.react > 0.15) {
      // a red laser gives the sniper's aim away, so you can duck or smoke it
      tB.set(this.pos.x - Math.sin(this.yaw) * 0.6, this.pos.y + 0.95 * this.k, this.pos.z - Math.cos(this.yaw) * 0.6);
      tD.set(tp.x, tp.y + tgt.centreY, tp.z);
      c.fx.laser(this, tB, tD);
    }
    if (this.react > P.react && this.cool <= 0 && aimed) {
      this.shoot(c, dist, tgt);
      this.burst++;
      this.cool = this.burst % P.burst === 0 ? P.longLo + Math.random() * (P.longHi - P.longLo) : P.short;
    }
  }

  private strafe(c: BotContext, tp: THREE.Vector3, dist: number, dt: number) {
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      this.strafeT = 0.5 + Math.random() * 1.0;
    }
    const dx = (tp.x - this.pos.x) / (dist || 1);
    const dz = (tp.z - this.pos.z) / (dist || 1);
    let vx = -dz * this.strafeDir;
    let vz = dx * this.strafeDir;
    if (dist < 6) { vx -= dx * 0.8; vz -= dz * 0.8; }
    const vl = Math.hypot(vx, vz) || 1;
    const moved = this.walk(vx / vl, vz / vl, 1.8, dt, c); // short, slow side-steps: we're only leaning out
    if (moved < 0.2 * 1.8 * dt) this.strafeDir = -this.strafeDir;
  }

  // --- no enemy in view: hide, peek, or bound forward ---------------------------------

  private onUnseen(c: BotContext, dt: number) {
    this.react = Math.max(0, this.react - dt * 1.5);
    this.burst = 0;
    if (this.cls === 'sniper') c.fx.laserOff(this);
    this.chatT -= dt;
    if (this.chatT <= 0) {
      this.chatT = 14 + Math.random() * 20;
      Bot.onEvent?.('idle', this);
    }
    if (this.knownT > 25) this.hasKnown = false;

    // shot from somewhere unseen: take cover first, ask questions later
    if (this.hitFlag) {
      this.hitFlag = false;
      if (this.tac !== 'toCover' && this.tac !== 'hidden') this.startCover(c, this.known, null);
    }

    switch (this.tac) {
      case 'toCover':
        if (this.goTo(c, this.coverPos, 4.6, dt, false)) {
          this.tac = 'hidden';
          this.hideT = (1.2 + Math.random() * 1.8) * (1 - 0.6 * this.pressure);
          this.wantCrouch = this.coverSpot?.low ?? false;
          this.coverFails = 0;
        }
        break;

      case 'hidden':
        // cover can be shot or blown away while we wait behind it
        this.recheckT -= dt;
        if (this.recheckT <= 0) {
          this.recheckT = 0.6;
          if (this.hasKnown && this.knownT < 20 && !this.hiddenFrom(c, this.pos.x, this.pos.z, EYE * this.k, this.known)) {
            this.startCover(c, this.known, this.coverSpot);
            break;
          }
        }
        this.lookToward(this.known, dt, 2.5);
        this.hideT -= dt;
        if (this.hideT <= 0) this.doPeek(c);
        break;

      case 'peek':
        if (this.goTo(c, this.peekCell, 2.8, dt, false)) {
          this.tac = 'expose';
          this.exposeT = 0.7 + Math.random() * 0.5;
          this.react = Math.max(this.react, 0.3); // already aiming down the lane
        } else {
          this.lookToward(this.known, dt, 6);
        }
        break;

      case 'expose':
        this.lookToward(this.known, dt, 6);
        this.exposeT -= dt;
        if (this.exposeT <= 0) {
          this.fruitless++;
          this.afterExpose(c);
        }
        break;

      case 'advance':
      case 'patrol':
        if (this.goTo(c, this.hopGoal, this.tac === 'advance' ? 3.4 : 2.6, dt, true)) {
          const patrolling = this.tac === 'patrol';
          this.tac = 'hold';
          this.holdT = (patrolling ? 1.4 + Math.random() * 2 : 0.8 + Math.random() * 1.8) * (1 - 0.6 * this.pressure);
          this.wantCrouch = !!this.coverSpot?.low && this.pos.distanceTo(this.coverPos) < 1.5;
        }
        break;

      case 'hold':
        this.holdT -= dt;
        if (this.hasKnown) this.lookToward(this.known, dt, 3);
        else this.yaw += Math.sin(performance.now() / 700 + this.pos.x) * 0.5 * dt; // sweep the view
        if (this.holdT <= 0) this.nextMove(c);
        break;
    }
  }

  /** Time to move again from a held position. */
  private nextMove(c: BotContext) {
    this.wantCrouch = false;
    if (!this.hasKnown && this.hunt) {
      const es = this.enemies(c);
      if (es.length) {
        let best = es[0];
        for (const e of es) if (e.pos.distanceTo(this.pos) < best.pos.distanceTo(this.pos)) best = e;
        // we don't know exactly where, only roughly: aim for a spot near them
        this.known.set(best.pos.x + (Math.random() - 0.5) * 8, 0, best.pos.z + (Math.random() - 0.5) * 8);
        this.hasKnown = true;
        this.knownT = 0;
      }
    }
    if (this.hasKnown && this.knownT < 25) {
      const d = Math.hypot(this.known.x - this.pos.x, this.known.z - this.pos.z);
      // snipers would rather pick shots from range than close in
      const snipe = this.cls === 'sniper' && d > 14 && this.pressure < 0.8;
      if ((d < 11 && Math.random() < 0.7) || snipe) {
        const cell = this.findPeekCell(c, this.pos);
        if (cell) {
          this.peekCell.copy(cell);
          this.tac = 'peek';
          this.path = [];
          return;
        }
      }
      this.pickHop(true);
      this.tac = 'advance';
    } else {
      this.hasKnown = false;
      this.pickHop(false);
      this.tac = 'patrol';
    }
    this.path = [];
    this.repathT = 0;
  }

  /** Choose the next piece of cover to bound to. */
  private pickHop(towardKnown: boolean) {
    // the real search needs the context, so it is queued: nextHopCtx is set from update() callers
    this.hopWantsKnown = towardKnown;
    this.hopPending = true;
  }
  private hopWantsKnown = false;
  private hopPending = false;

  private resolveHop(c: BotContext) {
    this.hopPending = false;
    this.coverSpot = null;
    if (this.hopWantsKnown && this.hasKnown) {
      const spot = this.findCover(c, this.known, 'advance', null);
      if (spot) {
        this.coverSpot = spot;
        this.coverPos.set(spot.x, 0, spot.z);
        this.hopGoal.copy(this.coverPos);
        return;
      }
      this.hopGoal.copy(this.partialGoal(c, this.known, 9));
      return;
    }
    const spot = this.findPatrolCover(c);
    if (spot) {
      this.coverSpot = spot;
      this.coverPos.set(spot.x, 0, spot.z);
      this.hopGoal.copy(this.coverPos);
    } else {
      this.hopGoal.copy(c.nav.randomFreePoint(22));
    }
  }

  private lookToward(p: THREE.Vector3, dt: number, rate: number) {
    this.turnTo(Math.atan2(-(p.x - this.pos.x), -(p.z - this.pos.z)), rate * dt);
  }

  /** Run for a spot that breaks line of sight to the threat. */
  private startCover(c: BotContext, threat: THREE.Vector3, avoid: Cover | null) {
    const spot = this.findCover(c, threat, 'defend', avoid);
    this.hopPending = false;
    this.wantCrouch = false;
    this.path = [];
    this.repathT = 0;
    if (spot) {
      this.coverSpot = spot;
      this.coverPos.set(spot.x, 0, spot.z);
      this.tac = 'toCover';
    } else {
      // nothing nearby hides us: stand and fight
      this.tac = 'expose';
      this.exposeT = 1.2 + Math.random();
    }
  }

  /** After waiting in cover: lean out for a look. */
  private doPeek(c: BotContext) {
    if (!this.hasKnown || this.knownT > 20) {
      this.nextMove(c);
      return;
    }
    const dKnown = Math.hypot(this.known.x - this.pos.x, this.known.z - this.pos.z);
    if (dKnown > 24 || (this.pressure > 0.6 && dKnown > 14)) {
      // too far to hit anything from here: bound closer instead of peeking
      this.nextMove(c);
      return;
    }
    if (this.coverSpot?.low) {
      // behind a low wall: just pop up
      this.wantCrouch = false;
      this.tac = 'expose';
      this.exposeT = 1.0 + Math.random() * 0.6;
      this.react = Math.max(this.react, 0.3);
      return;
    }
    const cell = this.findPeekCell(c, this.coverSpot ? this.coverPos : this.pos);
    if (cell) {
      this.peekCell.copy(cell);
      this.tac = 'peek';
      this.path = [];
      this.repathT = 0;
    } else {
      this.nextMove(c);
    }
  }

  /** A peek found nothing: go back to cover and wait again, or move on after a couple of tries. */
  private afterExpose(c: BotContext) {
    if (this.coverSpot && this.fruitless < (this.cls === 'sniper' ? 4 : 2) && this.hasKnown) {
      this.tac = 'toCover';
      this.path = [];
      this.repathT = 0;
      return;
    }
    this.fruitless = 0;
    this.nextMove(c);
  }

  // --- finding cover ---------------------------------------------------------------

  /** True if standing at (x, z) with eyes at eyeH is hidden from the threat on every side. */
  private hiddenFrom(c: BotContext, x: number, z: number, eyeH: number, threat: THREE.Vector3): boolean {
    const dx = x - threat.x;
    const dz = z - threat.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * 0.28;
    const pz = (dx / len) * 0.28;
    hA.set(threat.x, threat.y + 1.4, threat.z);
    for (const k of [0, -1, 1]) {
      hB.set(x + px * k, eyeH, z + pz * k);
      hD.subVectors(hB, hA);
      const d = hD.length();
      hD.divideScalar(d);
      const t = c.world.raycast(hA, hD, d);
      const blocked = t < d - 0.15 || c.grenades.blocks(hA, hB);
      if (!blocked) return false;
    }
    return true;
  }

  private findCover(c: BotContext, threat: THREE.Vector3, mode: 'defend' | 'advance', avoid: Cover | null): Cover | null {
    const maxR = mode === 'defend' ? 14 : 15;
    const near: { x: number; z: number; d: number }[] = [];
    for (const s of c.nav.cover) {
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
      if (d < maxR) near.push({ x: s.x, z: s.z, d });
    }
    near.sort((a, b) => a.d - b.d);
    const botToThreat = Math.hypot(threat.x - this.pos.x, threat.z - this.pos.z);

    let best: Cover | null = null;
    let bestScore = Infinity;
    for (const s of near.slice(0, 70)) {
      const toThreat = Math.hypot(s.x - threat.x, s.z - threat.z);
      if (toThreat < 5) continue;
      if (mode === 'advance' && toThreat > botToThreat - (3 - 1.5 * this.pressure)) continue;
      if (avoid && Math.hypot(s.x - avoid.x, s.z - avoid.z) < 1.6) continue;
      const standing = this.hiddenFrom(c, s.x, s.z, EYE, threat);
      const crouched = standing || this.hiddenFrom(c, s.x, s.z, EYE * (1 - CROUCH_DROP), threat);
      if (!crouched) continue;

      let crowd = 0;
      for (const o of c.bots) {
        if (o === this || o.dead || o.team !== this.team) continue;
        if (Math.hypot(o.pos.x - s.x, o.pos.z - s.z) < 2.5) crowd += 6;
        if (o.coverSpot && Math.hypot(o.coverSpot.x - s.x, o.coverSpot.z - s.z) < 2.5) crowd += 6;
      }
      const score =
        s.d +
        (mode === 'defend' ? Math.max(0, 10 - toThreat) * 0.5 : toThreat * 0.6) +
        crowd +
        (standing ? 0 : 2) +
        Math.random() * 2;
      if (score < bestScore) {
        bestScore = score;
        best = { x: s.x, z: s.z, low: !standing };
      }
    }
    if (best && mode === 'advance' && !c.nav.findPath(this.pos, tA.set(best.x, 0, best.z))) return null;
    return best;
  }

  /** Cover to bound to when there's no known enemy: slowly work toward the other side. */
  private findPatrolCover(c: BotContext): Cover | null {
    const near: { x: number; z: number; d: number }[] = [];
    for (const s of c.nav.cover) {
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
      if (d > 5 && d < 14) near.push({ x: s.x, z: s.z, d });
    }
    if (!near.length) return null;
    const dirZ = this.team === 0 ? -1 : 1; // team 0 starts south, team 1 north
    let best: Cover | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < 25; i++) {
      const s = near[Math.floor(Math.random() * near.length)];
      const progress = (s.z - this.pos.z) * dirZ;
      let crowd = 0;
      for (const o of c.bots) {
        if (o === this || o.dead || o.team !== this.team) continue;
        if (Math.hypot(o.pos.x - s.x, o.pos.z - s.z) < 3) crowd += 5;
      }
      // snipers hang back around their own half instead of pushing across the map
      const crossed = this.cls === 'sniper' ? Math.max(0, this.team === 0 ? 6 - s.z : s.z + 6) * 3 * (1 - this.pressure) : 0;
      const score = -progress + s.d * 0.3 + Math.abs(s.x - this.lane) * 0.25 + crowd + crossed + Math.random() * 5;
      if (score < bestScore) {
        bestScore = score;
        best = { x: s.x, z: s.z, low: false };
      }
    }
    return best;
  }

  /** A nearby cell (a step or two out from cover) with a clear view of where the enemy is. */
  private findPeekCell(c: BotContext, from: THREE.Vector3): THREE.Vector3 | null {
    const cells = c.nav.freeCellsNear(from.x, from.z, 3.6);
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    const aim = tB.set(this.known.x, 1.1, this.known.z);
    for (const s of cells) {
      const d = Math.hypot(s.x - from.x, s.z - from.z);
      if (d < 0.7 || d >= bestD) continue;
      hA.set(s.x, EYE, s.z);
      hD.subVectors(aim, hA);
      const len = hD.length();
      if (len < 3) continue;
      hD.divideScalar(len);
      if (c.world.raycast(hA, hD, len) < len - 0.4) continue;
      if (c.grenades.blocks(hA, aim)) continue;
      bestD = d;
      best = new THREE.Vector3(s.x, 0, s.z);
    }
    return best;
  }

  /** A point roughly `maxLen` metres along the walking route to `target`. */
  private partialGoal(c: BotContext, target: THREE.Vector3, maxLen: number): THREE.Vector3 {
    const path = c.nav.findPath(this.pos, target);
    if (!path || !path.length) return new THREE.Vector3(target.x, 0, target.z);
    let acc = 0;
    let prev = this.pos;
    for (const p of path) {
      const seg = Math.hypot(p.x - prev.x, p.z - prev.z);
      if (acc + seg >= maxLen) {
        const f = (maxLen - acc) / (seg || 1);
        return new THREE.Vector3(prev.x + (p.x - prev.x) * f, 0, prev.z + (p.z - prev.z) * f);
      }
      acc += seg;
      prev = p;
    }
    return path[path.length - 1].clone();
  }

  // --- shooting, movement, animation ------------------------------------------------

  private shoot(c: BotContext, dist: number, t: Target) {
    const P = PROFILE[this.cls];
    let chance = Math.max(P.accMin, Math.min(P.accMax, P.accBase - dist * P.accPerM - t.speed * 0.03));
    if (this.cls === 'sniper' && dist < 8) chance *= 0.5; // too close to use the scope
    const hit = Math.random() < chance;
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const muzzle = tB.set(this.pos.x + fwdX * 0.6, this.pos.y + 0.95 * this.k, this.pos.z + fwdZ * 0.6);
    const end = new THREE.Vector3(t.pos.x, t.pos.y + t.centreY + 0.1, t.pos.z);
    if (!hit) end.add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3));
    c.fx.tracer(muzzle, end, this.cls === 'sniper' ? 0xff4040 : this.team === 1 ? 0xff9a60 : 0x80c0ff);
    const sp = c.sound.spatial(this.pos.x, this.pos.z);
    c.sound.shot(Math.max(0.05, sp.vol) * 0.6, sp.pan, this.cls === 'sniper' || this.cls === 'heavy');
    if (!hit) return;
    let dmg = P.dmgLo + Math.random() * (P.dmgHi - P.dmgLo);
    if (this.cls === 'sniper' && Math.random() < 0.1) dmg *= 2.8; // the occasional headshot
    if (t.critter) {
      t.critter.damage(dmg * 1.3, this.pos, 'bullet');
      return;
    }
    if (t.bot) {
      if (t.bot.damage(dmg, this.pos)) {
        c.onKill(this.name, t.bot.name, t.bot.team);
        Bot.onEvent?.('kill', this);
      }
    } else {
      const was = c.player.alive;
      c.player.takeDamage(dmg);
      if (was && !c.player.alive) Bot.onEvent?.('kill', this);
    }
  }

  private turnTo(target: number, maxStep: number) {
    const diff = wrapAngle(target - this.yaw);
    this.yaw += Math.max(-maxStep, Math.min(maxStep, diff));
  }

  /** Follow an A* path toward `target`. Returns true once there (or no route). */
  private goTo(c: BotContext, target: THREE.Vector3, speed: number, dt: number, face: boolean): boolean {
    if (this.hopPending && (this.tac === 'advance' || this.tac === 'patrol')) this.resolveHop(c);
    this.repathT -= dt;
    if (this.path.length === 0 || this.repathT <= 0 || this.pathGoal.distanceTo(target) > 3) {
      this.path = c.nav.findPath(this.pos, target) ?? [];
      this.pathIdx = 0;
      this.pathGoal.copy(target);
      this.repathT = 0.8 + Math.random() * 0.4;
      if (this.path.length === 0) return true;
    }
    if (Math.hypot(target.x - this.pos.x, target.z - this.pos.z) < 0.8) return true;
    const wp = this.path[this.pathIdx];
    if (!wp) return true;
    const dx = wp.x - this.pos.x;
    const dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) {
      this.pathIdx++;
      return this.pathIdx >= this.path.length;
    }
    if (face) this.turnTo(Math.atan2(-dx, -dz), 8 * dt);
    const moved = this.walk(dx / d, dz / d, speed, dt, c);
    if (moved < 0.25 * speed * dt) {
      this.stuckT += dt;
      if (this.stuckT > 0.6) {
        this.stuckT = 0;
        this.path = [];
        if (this.tac === 'advance' || this.tac === 'patrol') {
          this.tac = 'hold';
          this.holdT = 0.3;
        }
      }
    } else {
      this.stuckT = 0;
    }
    return false;
  }

  private walk(vx: number, vz: number, speed: number, dt: number, c: BotContext): number {
    const bx = this.pos.x;
    const bz = this.pos.z;
    c.world.moveAxis(this.pos, HW, H, 'x', vx * speed * this.mul * dt);
    c.world.moveAxis(this.pos, HW, H, 'z', vz * speed * this.mul * dt);
    const moved = Math.hypot(this.pos.x - bx, this.pos.z - bz);
    this.speedNow = moved / dt;
    return moved;
  }

  private separate(dt: number, c: BotContext) {
    for (const o of c.bots) {
      if (o === this || o.dead) continue;
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.8 && d > 0.001) {
        const push = (0.8 - d) * 3 * dt;
        c.world.moveAxis(this.pos, HW, H, 'x', (dx / d) * push);
        c.world.moveAxis(this.pos, HW, H, 'z', (dz / d) * push);
      }
    }
  }

  private applyCrouch() {
    this.model.root.scale.y = S * this.k;
  }

  private animate(dt: number) {
    this.walkPhase += this.speedNow * dt * 2.4;
    const swing = Math.sin(this.walkPhase) * Math.min(1, this.speedNow / 3) * 0.9;
    this.model.legL.rotation.x = swing;
    this.model.legR.rotation.x = -swing;
    if (this.aiming) {
      this.model.armR.rotation.x = 1.5;
      this.model.armL.rotation.x = 1.35;
    } else {
      this.model.armR.rotation.x = 1.0;
      this.model.armL.rotation.x = 0.7 - swing * 0.5;
    }
  }

  private sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }
}
