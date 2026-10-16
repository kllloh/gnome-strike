import * as THREE from 'three';

interface Tracer { line: THREE.Line; life: number }
interface Bit { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; blood?: number }
/** A tumbling object: a knocked-off hat or a gib. */
interface Prop {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  ground: number;
  rest: boolean;
  gib: boolean;
  blood?: number;
  splatted: boolean;
}
interface Puff { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; max: number; mat: THREE.MeshBasicMaterial }

const MAX_SPLATS = 220;
const MAX_GIBS = 140;

/** Short-lived visuals: bullet tracers, debris, blood, gibs, gas clouds. */
export class Effects {
  /** Gore on/off (blood, splats and gibs). */
  goreOn = true;

  private tracers: Tracer[] = [];
  private bits: Bit[] = [];
  private props: Prop[] = [];
  private splats: THREE.Mesh[] = [];
  private puffs: Puff[] = [];
  private geo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  private splatGeo = new THREE.BoxGeometry(1, 0.02, 1);
  private mats = new Map<number, THREE.MeshBasicMaterial>();
  private lasers = new Map<object, THREE.Line>();

  constructor(private scene: THREE.Scene) {}

  private mat(color: number): THREE.MeshBasicMaterial {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      this.mats.set(color, m);
    }
    return m;
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, color = 0xffe9a0) {
    const g = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  /** A thin red sight line that follows its owner (used by snipers). */
  laser(owner: object, a: THREE.Vector3, b: THREE.Vector3) {
    let line = this.lasers.get(owner);
    if (!line) {
      const g = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
      line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.55 }));
      line.frustumCulled = false;
      this.scene.add(line);
      this.lasers.set(owner, line);
      return;
    }
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
  }

  laserOff(owner: object) {
    const line = this.lasers.get(owner);
    if (!line) return;
    this.scene.remove(line);
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
    this.lasers.delete(owner);
  }

  clearLasers() {
    for (const owner of [...this.lasers.keys()]) this.laserOff(owner);
  }

  burst(p: THREE.Vector3, color: number, n = 6, speed = 2.5, size = 1) {
    const m = this.mat(color);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.geo, m);
      mesh.scale.setScalar(size);
      mesh.position.copy(p);
      this.scene.add(mesh);
      this.bits.push({
        mesh,
        vel: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed),
        life: 0.5 + Math.random() * 0.4,
      });
    }
  }

  // --- gore -----------------------------------------------------------------------

  /** A spray of blood droplets along `dir`; each one leaves a splat where it lands. */
  blood(p: THREE.Vector3, dir: THREE.Vector3, color: number, n = 6, power = 4) {
    if (!this.goreOn) return;
    const m = this.mat(color);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.geo, m);
      mesh.scale.setScalar(0.8 + Math.random() * 1.3);
      mesh.position.copy(p);
      this.scene.add(mesh);
      const k = power * (0.35 + Math.random());
      this.bits.push({
        mesh,
        vel: new THREE.Vector3(
          dir.x * k + (Math.random() - 0.5) * 2.2,
          dir.y * k + 1 + Math.random() * 3,
          dir.z * k + (Math.random() - 0.5) * 2.2,
        ),
        life: 1.6,
        blood: color,
      });
    }
  }

  /** A flat puddle/splat on the ground. */
  splat(p: THREE.Vector3, color: number, size = 0.6) {
    if (!this.goreOn) return;
    const mesh = new THREE.Mesh(this.splatGeo, this.mat(color));
    mesh.scale.set(size * (0.7 + Math.random() * 0.8), 1, size * (0.7 + Math.random() * 0.8));
    mesh.position.set(p.x, 0.03 + (this.splats.length % 6) * 0.002, p.z);
    mesh.rotation.y = Math.random() * Math.PI;
    this.scene.add(mesh);
    this.splats.push(mesh);
    if (this.splats.length > MAX_SPLATS) this.scene.remove(this.splats.shift()!);
  }

  /** Chunks of a fighter flying apart. `dir` biases where they go. */
  gibs(center: THREE.Vector3, colors: number[], n: number, power: number, blood: number, dir: THREE.Vector3) {
    if (!this.goreOn) return;
    for (let i = 0; i < n; i++) {
      const size = 2.2 + Math.random() * 3.2;
      const mesh = new THREE.Mesh(this.geo, this.mat(colors[Math.floor(Math.random() * colors.length)] ?? 0xcc8866));
      mesh.scale.setScalar(size);
      mesh.position.copy(center);
      this.scene.add(mesh);
      const k = power * (0.5 + Math.random());
      this.props.push({
        obj: mesh,
        vel: new THREE.Vector3(
          dir.x * k * 0.6 + (Math.random() - 0.5) * k,
          3 + Math.random() * power * 0.7,
          dir.z * k * 0.6 + (Math.random() - 0.5) * k,
        ),
        spin: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16),
        ground: size * 0.035,
        rest: false,
        gib: true,
        blood,
        splatted: false,
      });
    }
    this.blood(center, dir, blood, 14, power * 0.9);
    // keep the number of lying-around chunks sane
    let gibs = this.props.filter((p) => p.gib);
    while (gibs.length > MAX_GIBS) {
      const old = gibs.shift()!;
      this.scene.remove(old.obj);
      this.props.splice(this.props.indexOf(old), 1);
    }
  }

  /** A tumbling prop, such as a hat that has just been knocked off. */
  addProp(obj: THREE.Object3D, vel: THREE.Vector3, spin: THREE.Vector3, ground = 0.3) {
    this.props = this.props.filter((p) => p.obj !== obj);
    this.props.push({ obj, vel, spin, ground, rest: false, gib: false, splatted: true });
  }

  dropProp(obj: THREE.Object3D) {
    this.props = this.props.filter((p) => p.obj !== obj);
  }

  /** A stinky/dusty cloud of translucent puffs that drifts up and fades. */
  cloud(p: THREE.Vector3, color: number, life = 3, n = 9, size = 1) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.scale.setScalar(6 * size * (0.7 + Math.random() * 0.8));
      mesh.position.set(p.x + (Math.random() - 0.5) * 0.9, p.y + Math.random() * 0.4, p.z + (Math.random() - 0.5) * 0.9);
      mesh.rotation.y = Math.random() * Math.PI;
      this.scene.add(mesh);
      this.puffs.push({
        mesh,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 0.7),
        life: life * (0.7 + Math.random() * 0.5),
        max: life,
        mat,
      });
    }
  }

  /** Remove blood, gibs, hats and clouds (between rounds). */
  clearGore() {
    for (const s of this.splats) this.scene.remove(s);
    this.splats.length = 0;
    for (const p of this.props) if (p.gib) this.scene.remove(p.obj);
    this.props = this.props.filter((p) => !p.gib);
    for (const q of this.puffs) { this.scene.remove(q.mesh); q.mat.dispose(); }
    this.puffs.length = 0;
  }

  update(dt: number) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life -= dt;
      b.vel.y -= 14 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      const landed = b.mesh.position.y < (b.blood !== undefined ? 0.06 : 0);
      if (b.life <= 0 || landed) {
        if (landed && b.blood !== undefined) this.splat(b.mesh.position, b.blood, 0.25 + Math.random() * 0.4);
        this.scene.remove(b.mesh);
        this.bits.splice(i, 1);
      }
    }
    for (const p of this.props) {
      if (p.rest) continue;
      p.vel.y -= 18 * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.rotation.x += p.spin.x * dt;
      p.obj.rotation.y += p.spin.y * dt;
      p.obj.rotation.z += p.spin.z * dt;
      if (p.obj.position.y < p.ground) {
        p.obj.position.y = p.ground;
        if (p.blood !== undefined && !p.splatted) {
          p.splatted = true;
          this.splat(p.obj.position, p.blood, 0.6 + Math.random() * 0.5);
        }
        if (Math.abs(p.vel.y) < 1.5) {
          p.rest = true;
          p.spin.set(0, 0, 0);
        } else {
          p.vel.y *= -0.35;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
          p.spin.multiplyScalar(0.6);
        }
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const q = this.puffs[i];
      q.life -= dt;
      q.mesh.position.addScaledVector(q.vel, dt);
      q.mesh.scale.multiplyScalar(1 + dt * 0.35);
      q.mat.opacity = Math.max(0, 0.55 * Math.min(1, q.life / (q.max * 0.5)));
      if (q.life <= 0) {
        this.scene.remove(q.mesh);
        q.mat.dispose();
        this.puffs.splice(i, 1);
      }
    }
  }
}
