import * as THREE from 'three';

export const GNOME_SCALE = 0.8;

import type { ClassId } from './classes';

export type Faction = 'gnome' | 'goblin';

export interface GnomeModel {
  root: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  mats: THREE.MeshLambertMaterial[];
  /** Unscaled heights/half-width used for headshot and hat hitboxes. */
  headTop: number;
  hatTop: number;
  headHalf: number;
  /** The hat, as its own group so it can be shot off. hatHeight is where its centre sits (unscaled). */
  hat: THREE.Group;
  hatHeight: number;
  hatHalf: number;
}

const SKIN = 0xf0c8a0;

export function createGnome(shirt: number, hat = 0xc42b2b): GnomeModel {
  const root = new THREE.Group();
  const mats: THREE.MeshLambertMaterial[] = [];

  const mk = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
    const m = new THREE.MeshLambertMaterial({ color });
    mats.push(m);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // legs pivot at the hip
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.13, 0.45, 0);
  legR.position.set(0.13, 0.45, 0);
  mk(legL, 0.22, 0.45, 0.25, 0, -0.225, 0, 0x4a3320);
  mk(legR, 0.22, 0.45, 0.25, 0, -0.225, 0, 0x4a3320);
  root.add(legL, legR);

  // torso, belt
  mk(root, 0.6, 0.55, 0.35, 0, 0.725, 0, shirt);
  mk(root, 0.62, 0.08, 0.37, 0, 0.52, 0, 0x222222);
  mk(root, 0.1, 0.1, 0.02, 0, 0.52, -0.19, 0xe0b030);

  // head (front is -z)
  mk(root, 0.38, 0.38, 0.38, 0, 1.19, 0, SKIN);
  mk(root, 0.1, 0.1, 0.1, 0, 1.15, -0.23, 0xe0908a);
  mk(root, 0.06, 0.06, 0.04, -0.09, 1.25, -0.19, 0x111111);
  mk(root, 0.06, 0.06, 0.04, 0.09, 1.25, -0.19, 0x111111);
  mk(root, 0.38, 0.3, 0.1, 0, 0.95, -0.24, 0xf4f4f4); // beard
  mk(root, 0.2, 0.08, 0.06, 0, 1.08, -0.2, 0xf4f4f4); // moustache

  // pointy hat, stacked blocks
  const HC = 1.9; // hat group pivots at its own centre so it tumbles nicely when knocked off
  const hatGroup = new THREE.Group();
  hatGroup.position.y = HC;
  root.add(hatGroup);
  mk(hatGroup, 0.5, 0.1, 0.5, 0, 1.43 - HC, 0, hat);
  mk(hatGroup, 0.38, 0.2, 0.38, 0, 1.58 - HC, 0, hat);
  mk(hatGroup, 0.3, 0.2, 0.3, 0, 1.78 - HC, 0, hat);
  mk(hatGroup, 0.22, 0.2, 0.22, 0, 1.98 - HC, 0, hat);
  mk(hatGroup, 0.14, 0.2, 0.14, 0, 2.18 - HC, 0, hat);
  mk(hatGroup, 0.08, 0.12, 0.08, 0, 2.34 - HC, 0, hat);

  // arms pivot at the shoulder
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.38, 0.98, 0);
  armR.position.set(0.38, 0.98, 0);
  for (const arm of [armL, armR]) {
    mk(arm, 0.15, 0.5, 0.15, 0, -0.25, 0, shirt);
    mk(arm, 0.14, 0.14, 0.14, 0, -0.56, 0, SKIN);
  }
  // rifle held by the right arm
  mk(armR, 0.09, 0.6, 0.12, 0, -0.6, 0, 0x2a2a2a);
  mk(armR, 0.07, 0.2, 0.2, 0, -0.45, 0.14, 0x6b4a2f);
  root.add(armL, armR);

  root.scale.setScalar(GNOME_SCALE);
  return { root, legL, legR, armL, armR, mats, headTop: 1.48, hatTop: 2.4, headHalf: 0.25, hat: hatGroup, hatHeight: HC, hatHalf: 0.15 };
}

const GOBLIN_SKIN = 0x6aa84f;
const GOBLIN_SHIRTS = [0x6b4a2f, 0x4a4d52, 0x7a3b2a, 0x555a3a, 0x3a3a52];
export const SKIN_COLOURS: Record<Faction, number> = { gnome: SKIN, goblin: GOBLIN_SKIN };

/** Green, gleeful and a bit grubby: big ears, big nose, pointy teeth and a horned iron cap. */
export function createGoblin(shirt: number): GnomeModel {
  const root = new THREE.Group();
  const mats: THREE.MeshLambertMaterial[] = [];

  const mk = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
    const m = new THREE.MeshLambertMaterial({ color });
    mats.push(m);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.13, 0.45, 0);
  legR.position.set(0.13, 0.45, 0);
  for (const leg of [legL, legR]) {
    mk(leg, 0.2, 0.3, 0.22, 0, -0.15, 0, GOBLIN_SKIN);
    mk(leg, 0.24, 0.17, 0.3, 0, -0.365, -0.02, 0x3b2a1a); // boot
  }
  root.add(legL, legR);

  // ragged leather tunic
  mk(root, 0.6, 0.55, 0.35, 0, 0.725, 0, shirt);
  mk(root, 0.62, 0.08, 0.37, 0, 0.52, 0, 0x2a1d12);
  mk(root, 0.12, 0.12, 0.02, 0, 0.52, -0.19, 0xb08a3a);
  mk(root, 0.14, 0.2, 0.37, -0.2, 0.42, 0, shirt); // torn hem
  mk(root, 0.14, 0.14, 0.37, 0.12, 0.43, 0, shirt);

  // head: green, brutish, front is -z
  mk(root, 0.4, 0.4, 0.4, 0, 1.2, 0, GOBLIN_SKIN);
  mk(root, 0.14, 0.18, 0.2, 0, 1.15, -0.28, 0x88c060); // big nose
  mk(root, 0.08, 0.08, 0.04, -0.1, 1.27, -0.2, 0xffe040);
  mk(root, 0.08, 0.08, 0.04, 0.1, 1.27, -0.2, 0xffe040);
  mk(root, 0.035, 0.05, 0.05, -0.1, 1.27, -0.215, 0x111111);
  mk(root, 0.035, 0.05, 0.05, 0.1, 1.27, -0.215, 0x111111);
  mk(root, 0.36, 0.06, 0.06, 0, 1.35, -0.21, 0x3f6f2e); // angry brow
  mk(root, 0.22, 0.05, 0.04, 0, 1.04, -0.2, 0x2a1010); // mouth
  mk(root, 0.05, 0.08, 0.04, -0.07, 1.07, -0.215, 0xf4f0d8); // tusks
  mk(root, 0.05, 0.08, 0.04, 0.07, 1.07, -0.215, 0xf4f0d8);
  // big pointy ears
  for (const sx of [-1, 1]) {
    const e1 = mk(root, 0.34, 0.12, 0.06, sx * 0.36, 1.3, 0, GOBLIN_SKIN);
    e1.rotation.z = sx * 0.45;
    mk(root, 0.18, 0.08, 0.05, sx * 0.55, 1.42, 0, 0x7bbd5c);
  }

  // rusty iron cap with horns
  const HC = 1.55;
  const hatGroup = new THREE.Group();
  hatGroup.position.y = HC;
  root.add(hatGroup);
  mk(hatGroup, 0.46, 0.1, 0.46, 0, 1.45 - HC, 0, 0x7a5a3a);
  mk(hatGroup, 0.34, 0.1, 0.34, 0, 1.55 - HC, 0, 0x6a4c30);
  for (const sx of [-1, 1]) {
    const h = mk(hatGroup, 0.08, 0.26, 0.08, sx * 0.24, 1.62 - HC, 0, 0xe8ddc0);
    h.rotation.z = -sx * 0.4;
  }

  // arms: bare green with leather bracers
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.38, 0.98, 0);
  armR.position.set(0.38, 0.98, 0);
  for (const arm of [armL, armR]) {
    mk(arm, 0.15, 0.5, 0.15, 0, -0.25, 0, GOBLIN_SKIN);
    mk(arm, 0.17, 0.14, 0.17, 0, -0.4, 0, 0x4a3320);
    mk(arm, 0.14, 0.14, 0.14, 0, -0.56, 0, GOBLIN_SKIN);
  }
  mk(armR, 0.09, 0.6, 0.12, 0, -0.6, 0, 0x2a2a2a);
  mk(armR, 0.07, 0.2, 0.2, 0, -0.45, 0.14, 0x4a3320);
  root.add(armL, armR);

  root.scale.setScalar(GNOME_SCALE);
  return { root, legL, legR, armL, armR, mats, headTop: 1.4, hatTop: 1.75, headHalf: 0.3, hat: hatGroup, hatHeight: HC, hatHalf: 0.24 };
}

export function createFighter(faction: Faction, cls: ClassId = 'assault'): GnomeModel {
  const model = baseFighter(faction);
  addClassGear(model, cls);
  return model;
}

function baseFighter(faction: Faction): GnomeModel {
  if (faction === 'gnome') {
    const shirts = [0x2f5fb0, 0x3d8a3d, 0xd88a2a, 0x7a3fa0, 0x2a8f8f, 0xb5527a];
    return createGnome(shirts[Math.floor(Math.random() * shirts.length)], 0xc42b2b);
  }
  return createGoblin(GOBLIN_SHIRTS[Math.floor(Math.random() * GOBLIN_SHIRTS.length)]);
}

/** Visible kit so you can tell classes apart at a glance. Meshes join `mats` so the hit flash still works. */
function addClassGear(model: GnomeModel, cls: ClassId) {
  const add = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
    const m = new THREE.MeshLambertMaterial({ color });
    model.mats.push(m);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const root = model.root;
  switch (cls) {
    case 'heavy':
      for (const sx of [-1, 1]) add(model.armL.parent!, 0.3, 0.12, 0.32, sx * 0.4, 1.04, 0, 0x6a6d72); // shoulder plates
      add(root, 0.52, 0.34, 0.05, 0, 0.78, -0.2, 0x55585e); // chest plate
      add(root, 0.5, 0.3, 0.05, 0, 0.78, 0.2, 0x55585e); // back plate
      break;
    case 'sniper':
      add(model.armR, 0.07, 0.3, 0.07, 0, -0.95, 0, 0x2a2a2a); // long barrel
      add(model.armR, 0.07, 0.22, 0.07, 0.0, -0.55, -0.1, 0x161616); // scope
      add(root, 0.44, 0.1, 0.44, 0, 0.99, 0, 0x3a4a2a); // hood-like scarf
      break;
    case 'scout':
      add(root, 0.42, 0.09, 0.05, 0, 1.27, -0.2, 0x111111); // goggles strap + lenses
      add(root, 0.12, 0.08, 0.05, -0.1, 1.27, -0.23, 0x4aa8d8);
      add(root, 0.12, 0.08, 0.05, 0.1, 1.27, -0.23, 0x4aa8d8);
      add(root, 0.32, 0.34, 0.16, 0, 0.78, 0.26, 0xb5651d); // backpack
      break;
    case 'medic':
      add(root, 0.36, 0.36, 0.03, 0, 0.78, -0.18, 0xffffff); // white patch with red cross
      add(root, 0.26, 0.08, 0.04, 0, 0.78, -0.2, 0xd23a32);
      add(root, 0.08, 0.26, 0.04, 0, 0.78, -0.2, 0xd23a32);
      add(root, 0.36, 0.36, 0.03, 0, 0.78, 0.18, 0xffffff);
      add(root, 0.26, 0.08, 0.04, 0, 0.78, 0.2, 0xd23a32);
      add(root, 0.08, 0.26, 0.04, 0, 0.78, 0.2, 0xd23a32);
      break;
    default:
      add(root, 0.1, 0.5, 0.05, -0.12, 0.74, -0.19, 0x3a2a1a); // bandolier
      break;
  }
}
