import * as THREE from 'three';
import type { World } from './world';

export const PLAYER_HW = 0.3;
export const PLAYER_H = 1.75;
export const EYE = 1.6;

const GRAVITY = 24;
const JUMP = 7.5;
const RUN = 5.4;
const WALK = 2.8;

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  health = 100;
  alive = true;
  onGround = false;
  armor = 0;
  maxHealth = 100;
  speedMul = 1; // class
  jumpMul = 1; // class
  regen = 0; // hp/s after a few seconds without being hurt
  moveScale = 1; // temporary slowdown, e.g. while scoped
  sensScale = 1; // mouse sensitivity scale, shrinks when zoomed in
  private sinceHurt = 99;
  frozen = false; // buy-time: can look but not move
  hurt = 0; // 0..1 red-screen flash, decays in main
  deathT = 0;
  shake = 0; // camera shake from explosions, 0..1
  private keys = new Set<string>();

  constructor(private world: World, readonly camera: THREE.PerspectiveCamera) {
    camera.rotation.order = 'YXZ';
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get horizSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  eyePos(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + EYE, this.pos.z);
  }

  look(dx: number, dy: number) {
    if (!this.alive) return;
    this.yaw -= dx * 0.0022 * this.sensScale;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * 0.0022 * this.sensScale));
  }

  takeDamage(amount: number) {
    if (!this.alive) return;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.5);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.health -= amount;
    this.hurt = 1;
    this.sinceHurt = 0;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deathT = 0;
      this.vel.set(0, 0, 0);
    }
  }

  respawn(at: THREE.Vector3) {
    this.pos.copy(at);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth;
    this.alive = true;
    this.frozen = false;
    this.sinceHurt = 99;
    this.yaw = Math.atan2(at.x, at.z); // face the map centre
    this.pitch = 0;
    this.camera.rotation.z = 0;
  }

  setClass(c: { health: number; speed: number; jump: number; regen: number }) {
    this.maxHealth = c.health;
    this.speedMul = c.speed;
    this.jumpMul = c.jump;
    this.regen = c.regen;
  }

  heal(n: number) {
    if (this.alive) this.health = Math.min(this.maxHealth, this.health + n);
  }

  update(dt: number) {
    if (this.alive) {
      this.sinceHurt += dt;
      if (this.regen > 0 && this.sinceHurt > 4) this.heal(this.regen * dt);
      this.move(dt);
    }
    else this.deathT += dt;
    this.shake = Math.max(0, this.shake - dt * 2);
    this.applyCamera();
  }

  private move(dt: number) {
    const k = this.frozen ? new Set<string>() : this.keys;
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = -sin * f + cos * s;
    let wz = -cos * f - sin * s;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? WALK : RUN) * this.speedMul * this.moveScale;
    const accel = this.onGround ? 55 : 9;
    const stepX = accel * dt;
    this.vel.x += Math.max(-stepX, Math.min(stepX, wx * speed - this.vel.x));
    this.vel.z += Math.max(-stepX, Math.min(stepX, wz * speed - this.vel.z));

    if (this.onGround && k.has('Space')) {
      this.vel.y = JUMP * this.jumpMul;
      this.onGround = false;
    }

    const steps = Math.max(1, Math.ceil(dt / 0.01));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel.y = Math.max(-30, this.vel.y - GRAVITY * h);
      if (this.world.moveAxis(this.pos, PLAYER_HW, PLAYER_H, 'x', this.vel.x * h)) this.vel.x = 0;
      if (this.world.moveAxis(this.pos, PLAYER_HW, PLAYER_H, 'z', this.vel.z * h)) this.vel.z = 0;
      this.onGround = false;
      if (this.world.moveAxis(this.pos, PLAYER_HW, PLAYER_H, 'y', this.vel.y * h)) {
        if (this.vel.y < 0) this.onGround = true;
        this.vel.y = 0;
      }
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        if (this.vel.y < 0) this.vel.y = 0;
        this.onGround = true;
      }
    }
  }

  private applyCamera() {
    const drop = this.alive ? 0 : Math.min(1.3, this.deathT * 3);
    this.camera.position.set(this.pos.x, this.pos.y + EYE - drop, this.pos.z);
    this.camera.rotation.y = this.yaw + (Math.random() - 0.5) * 0.06 * this.shake;
    this.camera.rotation.x = this.pitch + (Math.random() - 0.5) * 0.06 * this.shake;
    this.camera.rotation.z = this.alive ? 0 : Math.min(1.2, this.deathT * 2);
  }
}
