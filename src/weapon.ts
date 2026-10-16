import * as THREE from 'three';

export interface WeaponDef {
  id: 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'rpg' | 'chainsaw';
  name: string;
  slot: 'primary' | 'secondary' | 'melee';
  price: number;
  mag: number;
  reserve: number;
  interval: number; // seconds between shots
  auto: boolean;
  body: number;
  head: number;
  reload: number; // seconds
  spread: number; // multiplier on the base spread
  recoil: number; // radians of upward kick per shot
  pellets?: number; // >1 for shotguns: rays per shot
  pelletSpread?: number; // extra cone (radians) per pellet
  scope?: number; // field of view (degrees) while scoped; present only on scoped weapons
  melee?: number; // reach in metres; melee weapons need no ammo
  projectile?: 'rocket'; // fires a rocket instead of a hitscan bullet
}

export const WEAPONS: Record<WeaponDef['id'], WeaponDef> = {
  pistol: { id: 'pistol', name: 'Pistol', slot: 'secondary', price: 0, mag: 12, reserve: 48, interval: 0.2, auto: false, body: 22, head: 62, reload: 1.3, spread: 0.7, recoil: 0.016 },
  smg: { id: 'smg', name: 'SMG', slot: 'primary', price: 1200, mag: 25, reserve: 100, interval: 0.07, auto: true, body: 17, head: 42, reload: 1.6, spread: 1.4, recoil: 0.007 },
  shotgun: { id: 'shotgun', name: 'Shotgun', slot: 'primary', price: 1800, mag: 6, reserve: 30, interval: 0.85, auto: false, body: 14, head: 28, reload: 2.4, spread: 0.6, recoil: 0.05, pellets: 8, pelletSpread: 0.05 },
  sniper: { id: 'sniper', name: 'Sniper', slot: 'primary', price: 3200, mag: 5, reserve: 25, interval: 1.3, auto: false, body: 100, head: 250, reload: 2.6, spread: 10, recoil: 0.04, scope: 22 },
  rpg: { id: 'rpg', name: 'RPG', slot: 'primary', price: 3600, mag: 1, reserve: 4, interval: 1.2, auto: false, body: 0, head: 0, reload: 2.6, spread: 0.2, recoil: 0.09, projectile: 'rocket' },
  chainsaw: { id: 'chainsaw', name: 'Chainsaw', slot: 'melee', price: 1500, mag: 999, reserve: 0, interval: 0.07, auto: true, body: 11, head: 17, reload: 0, spread: 0, recoil: 0, melee: 2.6 },
  rifle: { id: 'rifle', name: 'Rifle', slot: 'primary', price: 2700, mag: 30, reserve: 90, interval: 0.09, auto: true, body: 26, head: 70, reload: 1.9, spread: 1, recoil: 0.010 },
};

/** Gun state plus its blocky first-person viewmodel. */
export class Weapon {
  readonly model = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  ammo: number;
  reserve: number;
  reloading = false;
  heat = 0; // sustained-fire inaccuracy, 0..1
  revving = false; // chainsaw: trigger held
  private teeth: THREE.Mesh[] = [];
  private chainT = 0;

  private reloadT = 0;
  private cool = 0;
  private kick = 0;
  private flashT = 0;
  private flash: THREE.Mesh;
  private bobT = 0;
  private readonly base = new THREE.Vector3(0.22, -0.23, -0.42);

  constructor(readonly def: WeaponDef, skin = 0xf0c8a0, sleeve = 0x2f5fb0) {
    this.ammo = def.mag;
    this.reserve = def.reserve;
    const mk = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
      m.position.set(x, y, z);
      this.model.add(m);
      return m;
    };
    mk(0.075, 0.1, 0.5, 0, 0, 0, 0x333333); // receiver
    mk(0.04, 0.04, 0.28, 0, 0.01, -0.38, 0x1e1e1e); // barrel
    mk(0.06, 0.13, 0.2, 0, -0.02, 0.33, 0x6b4a2f); // stock
    mk(0.05, 0.16, 0.08, 0, -0.12, 0.04, 0x222222); // magazine
    mk(0.02, 0.04, 0.02, 0, 0.07, -0.2, 0x111111); // front sight
    mk(0.09, 0.09, 0.09, 0, -0.07, -0.18, skin); // front hand
    mk(0.09, 0.09, 0.09, 0, -0.1, 0.14, skin); // rear hand
    mk(0.11, 0.11, 0.3, 0.03, -0.14, 0.31, sleeve); // sleeve
    if (def.id === 'sniper') {
      mk(0.04, 0.04, 0.4, 0, 0.01, -0.75, 0x1e1e1e); // long barrel
      mk(0.06, 0.06, 0.26, 0, 0.1, -0.08, 0x161616); // scope tube
      mk(0.075, 0.075, 0.03, 0, 0.1, -0.22, 0x4aa8d8); // front lens
      mk(0.03, 0.05, 0.03, 0, 0.065, -0.08, 0x161616); // scope mount
    }
    this.muzzle.position.set(0, 0.01, def.id === 'sniper' ? -0.96 : -0.55);
    this.model.add(this.muzzle);
    this.flash = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffd060 }),
    );
    this.flash.position.set(0, 0.01, def.id === 'sniper' ? -1.0 : -0.6);
    this.flash.visible = false;
    this.model.add(this.flash);

    if (def.id === 'rpg' || def.id === 'chainsaw') {
      this.model.clear(); // these two look nothing like a rifle
      this.model.add(this.muzzle, this.flash);
      if (def.id === 'rpg') {
        mk(0.17, 0.17, 1.0, 0, 0.03, -0.2, 0x4a5a3a); // launch tube
        mk(0.23, 0.23, 0.12, 0, 0.03, 0.36, 0x2e2e2e); // rear flare
        mk(0.23, 0.23, 0.22, 0, 0.03, -0.78, 0xb03030); // warhead
        mk(0.14, 0.14, 0.14, 0, 0.03, -0.95, 0xb03030);
        mk(0.07, 0.15, 0.07, 0, -0.1, 0.02, 0x222222); // grip
        mk(0.09, 0.09, 0.09, 0, -0.06, -0.06, skin);
        mk(0.09, 0.09, 0.09, 0, -0.06, -0.38, skin);
        mk(0.11, 0.11, 0.3, 0.03, -0.12, 0.34, sleeve);
        this.muzzle.position.set(0, 0.03, -1.05);
        this.flash.position.set(0, 0.03, -1.1);
      } else {
        mk(0.2, 0.22, 0.42, 0, 0, 0.05, 0xe0731a); // engine block
        mk(0.07, 0.14, 0.07, 0, 0.17, 0.12, 0x222222); // handle
        mk(0.07, 0.07, 0.26, 0, 0.25, 0.12, 0x222222);
        mk(0.07, 0.12, 0.85, 0, 0, -0.6, 0x9aa0a6); // guide bar
        mk(0.09, 0.09, 0.09, 0, 0.1, 0.14, skin);
        mk(0.09, 0.09, 0.09, 0, -0.08, -0.12, skin);
        mk(0.11, 0.11, 0.3, 0.03, -0.14, 0.3, sleeve);
        for (let i = 0; i < 14; i++) {
          const top = mk(0.09, 0.04, 0.05, 0, 0.08, 0, 0x2a2a2a);
          const bot = mk(0.09, 0.04, 0.05, 0, -0.08, 0, 0x2a2a2a);
          this.teeth.push(top, bot);
        }
        this.muzzle.position.set(0, 0, -1.0);
      }
    }

    if (def.id === 'shotgun') {
      mk(0.07, 0.07, 0.22, 0, -0.06, -0.3, 0x6b4a2f); // pump
      mk(0.05, 0.05, 0.3, 0, -0.025, -0.38, 0x1e1e1e); // second barrel
    }

    // size/position variants of the same blocky gun
    if (def.id === 'shotgun') this.model.scale.set(1.15, 1.05, 0.95);
    if (def.id === 'sniper') this.base.set(0.2, -0.22, -0.4);
    if (def.id === 'rpg') this.base.set(0.18, -0.2, -0.45);
    if (def.id === 'chainsaw') this.base.set(0.2, -0.22, -0.4);
    if (def.id === 'smg') this.model.scale.set(1, 1, 0.78);
    if (def.id === 'pistol') {
      this.model.scale.set(0.9, 0.9, 0.5);
      this.base.set(0.2, -0.2, -0.4);
    }
    this.model.position.copy(this.base);
  }

  get canFire(): boolean {
    return !this.reloading && this.ammo > 0 && this.cool <= 0;
  }

  /** Try to fire one round. Returns true if a round left the barrel. */
  tryFire(): boolean {
    if (this.def.melee) {
      if (this.cool > 0) return false;
      this.cool = this.def.interval;
      this.kick = 0.6;
      return true;
    }
    if (this.reloading || this.cool > 0) return false;
    if (this.ammo <= 0) {
      this.startReload();
      return false;
    }
    this.ammo--;
    this.cool = this.def.interval;
    this.kick = 1;
    this.flashT = 0.04;
    this.heat = Math.min(1, this.heat + 0.1);
    return true;
  }

  startReload(): boolean {
    if (this.def.melee) return false;
    if (this.reloading || this.ammo === this.def.mag || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadT = 0;
    return true;
  }

  cancelReload() {
    this.reloading = false;
  }

  refill() {
    this.ammo = this.def.mag;
    this.reserve = this.def.reserve;
    this.reloading = false;
    this.heat = 0;
  }

  /** Spread (radians) given how the player is moving. */
  spread(horizSpeed: number, onGround: boolean, scoped = false): number {
    if (scoped && this.def.scope) return 0.0004 + (horizSpeed / 5.4) * 0.01 + (onGround ? 0 : 0.06);
    return (0.0015 + this.heat * 0.012 + (horizSpeed / 5.4) * 0.014 + (onGround ? 0 : 0.05)) * this.def.spread;
  }

  update(dt: number, horizSpeed: number) {
    this.cool -= dt;
    this.heat = Math.max(0, this.heat - dt * 1.6);
    this.kick = Math.max(0, this.kick - dt * 12);
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;

    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadT >= this.def.reload) {
        const take = Math.min(this.def.mag - this.ammo, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = false;
      }
    }
    const rp = this.reloading ? Math.sin(Math.min(1, this.reloadT / this.def.reload) * Math.PI) : 0;

    this.bobT += dt * horizSpeed * 2.2;
    const bobAmt = Math.min(1, horizSpeed / 5.4);
    this.model.position.set(
      this.base.x + Math.sin(this.bobT) * 0.008 * bobAmt,
      this.base.y + Math.abs(Math.cos(this.bobT)) * 0.008 * bobAmt - rp * 0.14,
      this.base.z + this.kick * 0.05,
    );
    this.model.rotation.set(this.kick * 0.05 - rp * 0.5, 0, rp * 0.5);

    if (this.teeth.length) {
      // the chain runs round the bar, and the whole saw shakes while it cuts
      this.chainT += dt * (this.revving ? 3.2 : 0.6);
      const n = this.teeth.length / 2;
      for (let i = 0; i < n; i++) {
        const u = (i / n + this.chainT) % 1;
        this.teeth[i * 2].position.z = -0.2 - u * 0.8;
        this.teeth[i * 2 + 1].position.z = -0.2 - ((1 - u) % 1) * 0.8;
      }
      if (this.revving) {
        this.model.position.x += (Math.random() - 0.5) * 0.012;
        this.model.position.y += (Math.random() - 0.5) * 0.012;
      }
    }
  }
}
