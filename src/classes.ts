import type { WeaponDef } from './weapon';

export type ClassId = 'assault' | 'scout' | 'heavy' | 'sniper' | 'medic';

export interface ClassDef {
  id: ClassId;
  name: string;
  blurb: string; // one line for the picker
  health: number;
  speed: number; // multiplier on run/walk speed
  jump: number; // multiplier on jump height
  armor: number; // starting armor
  primary: WeaponDef['id']; // free signature weapon, restored whenever you lose your gear
  frags: number;
  smokes: number;
  regen: number; // hp/s once out of combat for a few seconds
  healAura: number; // hp/s given to teammates within 7m
}

export const CLASSES: Record<ClassId, ClassDef> = {
  assault: {
    id: 'assault', name: 'ASSAULT', blurb: 'Rifle · balanced · 1 frag',
    health: 100, speed: 1, jump: 1, armor: 0, primary: 'rifle', frags: 1, smokes: 0, regen: 0, healAura: 0,
  },
  scout: {
    id: 'scout', name: 'SCOUT', blurb: 'SMG · fast, high jump · 80 HP',
    health: 80, speed: 1.22, jump: 1.35, armor: 0, primary: 'smg', frags: 0, smokes: 1, regen: 0, healAura: 0,
  },
  heavy: {
    id: 'heavy', name: 'HEAVY', blurb: 'Shotgun · 140 HP + armor · slow',
    health: 140, speed: 0.85, jump: 0.9, armor: 50, primary: 'shotgun', frags: 0, smokes: 0, regen: 0, healAura: 0,
  },
  sniper: {
    id: 'sniper', name: 'SNIPER', blurb: 'Scoped rifle (right-click) · 85 HP',
    health: 85, speed: 0.95, jump: 1, armor: 0, primary: 'sniper', frags: 0, smokes: 1, regen: 0, healAura: 0,
  },
  medic: {
    id: 'medic', name: 'MEDIC', blurb: 'SMG · heals you and nearby allies',
    health: 100, speed: 1, jump: 1, armor: 0, primary: 'smg', frags: 0, smokes: 1, regen: 2, healAura: 2.5,
  },
};

export const CLASS_ORDER: ClassId[] = ['assault', 'scout', 'heavy', 'sniper', 'medic'];
