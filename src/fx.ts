import * as THREE from 'three';

interface Tracer { line: THREE.Line; life: number }
interface Bit { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }

/** Short-lived visuals: bullet tracers and blocky debris. */
export class Effects {
  private tracers: Tracer[] = [];
  private bits: Bit[] = [];
  private geo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  private mats = new Map<number, THREE.MeshBasicMaterial>();
  private lasers = new Map<object, THREE.Line>();

  constructor(private scene: THREE.Scene) {}

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
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      this.mats.set(color, m);
    }
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
      if (b.life <= 0 || b.mesh.position.y < 0) {
        this.scene.remove(b.mesh);
        this.bits.splice(i, 1);
      }
    }
  }
}
