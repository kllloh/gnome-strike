import * as THREE from 'three';
import { World } from './world';
import { buildMap } from './map';
import { NavGrid } from './nav';
import { Player } from './player';
import { Weapon, WEAPONS, type WeaponDef } from './weapon';
import { SKIN_COLOURS, type Faction } from './gnome';
import { CLASSES, CLASS_ORDER, type ClassId } from './classes';
import { Bot, type BotContext, type BotEvent, type Team } from './bots';
import { Effects } from './fx';
import { Sound } from './audio';
import { Grenades, type GrenadeKind } from './grenades';
import { Critters, Critter, type CritterContext, type CritterKind } from './critters';

// --- match rules -------------------------------------------------------------
const TEAM_SIZE = 5; // you + 4 bots vs 5 bots
const FREEZE_TIME = 10; // buy time
const ROUND_TIME = 135;
const END_TIME = 5;
const WIN_ROUNDS = 8; // first to 8 (best of 15)
const HUNT_AFTER = 15; // seconds into a round before bots start seeking enemies
const START_MONEY = 800;
const MAX_MONEY = 9000;
const WIN_BONUS = 3000;
const LOSS_BONUS = 1900;
const KILL_BONUS = 300;
const ARMOR_PRICE = 650;
const NAMES: Record<Faction, string[]> = {
  gnome: ['Barnaby', 'Bramble', 'Pip', 'Hobb', 'Moss', 'Thistle', 'Tuck', 'Wren', 'Fennel'],
  goblin: ['Grubnak', 'Snaggle', 'Skrag', 'Nibwick', 'Zog', 'Mugsy', 'Rotgut', 'Blort', 'Gnash'],
};

const FORCE_RUN = location.search.includes('run'); // lets headless tests run without pointer lock

// --- renderer / scene --------------------------------------------------------
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (err) {
  const msg = document.getElementById('msg');
  if (msg) msg.textContent = 'WebGL is unavailable in this browser (check hardware acceleration / about:support in Firefox).';
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9cbe6);
scene.fog = new THREE.Fog(0xc9d8de, 60, 180);

scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x7a9a58, 1.5));
const sun = new THREE.DirectionalLight(0xfff4dc, 2.3);
sun.position.set(-30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 140 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 300);
scene.add(camera);

// --- game objects ------------------------------------------------------------
const world = new World();
const map = buildMap(world, scene);
const nav = new NavGrid(world);
const player = new Player(world, camera);
const fx = new Effects(scene);
const sound = new Sound();
Bot.fx = fx;
const critters = new Critters(scene, fx, sound);
try {
  if (localStorage.getItem('gs-gore') === '0') fx.goreOn = false;
} catch { /* storage unavailable */ }

// --- HUD ---------------------------------------------------------------------
const $ = (id: string) => document.getElementById(id)!;
const elHealth = $('health');
const elAmmo = $('ammo');
const elScore = $('score');
const elHit = $('hit');
const elMarker = $('hitmarker');
const elBanner = $('banner');
const elOverlay = $('overlay');
const elMsg = $('msg');
const elMoney = $('money');
const elFeed = $('feed');
const elBuy = $('buy');
const elScope = $('scope');
const elCross = $('crosshair');
const elClasses = $('classes');

let bannerT = 0;
function banner(text: string, secs = 1.2) {
  elBanner.textContent = text;
  elBanner.style.opacity = '1';
  bannerT = secs;
}
let markerT = 0;
function marker(head: boolean, kill: boolean) {
  elMarker.style.color = kill ? '#ff3030' : head ? '#ffd030' : '#ffffff';
  elMarker.style.opacity = '1';
  markerT = 0.15;
}
const feed: { text: string; color: string; t: number }[] = [];
function feedPush(text: string, color: string) {
  feed.push({ text, color, t: 6 });
  if (feed.length > 5) feed.shift();
}

// --- destruction -----------------------------------------------------------------
let navDirty = false;
let navDirtyT = 0;
world.onHit = (g, at) => {
  fx.burst(at, world.colour(g), 3, 2.5, 1.5);
};
world.onDestroyed = (g) => {
  const c = g.bounds.getCenter(new THREE.Vector3());
  const size = g.bounds.getSize(new THREE.Vector3());
  const volume = Math.max(0.5, size.x * size.y * size.z);
  fx.burst(c, world.colour(g), Math.min(28, 6 + Math.round(Math.cbrt(volume) * 3)), 5, 4);
  const sp = sound.spatial(c.x, c.z);
  sound.crash(Math.max(0.25, sp.vol), sp.pan);
  navDirty = true;
  navDirtyT = 0.2; // let a chain of breaks settle, then recompute paths and cover once
};

// --- factions ------------------------------------------------------------------
const FACTION_INFO: Record<Faction, { label: string; color: string; skin: number; sleeve: number }> = {
  gnome: { label: 'GNOMES', color: '#ff7a7a', skin: SKIN_COLOURS.gnome, sleeve: 0x2f5fb0 },
  goblin: { label: 'GOBLINS', color: '#8fe06a', skin: SKIN_COLOURS.goblin, sleeve: 0x6b4a2f },
};
const otherFaction = (f: Faction): Faction => (f === 'gnome' ? 'goblin' : 'gnome');
let faction: Faction = 'gnome';
try {
  const saved = localStorage.getItem('gs-faction');
  if (saved === 'gnome' || saved === 'goblin') faction = saved;
} catch { /* storage unavailable */ }

let playerClass: ClassId = 'assault';
try {
  const savedClass = localStorage.getItem('gs-class');
  if (savedClass && savedClass in CLASSES) playerClass = savedClass as ClassId;
} catch { /* storage unavailable */ }

// --- bots ----------------------------------------------------------------------
const bots: Bot[] = [];
const grenades = new Grenades(scene, world, fx, sound, bots, player, (t, b) => {
  feedPush(`${t.name} ${pick(VERBS[t.isPlayer ? faction : otherFaction(b.faction)])} ${b.name} 💥`, b.team === 1 ? '#8cf' : '#f88');
  if (t.isPlayer) {
    kills++;
    money = Math.min(MAX_MONEY, money + KILL_BONUS);
  }
});
grenades.critters = critters.list;
const critterCtx: CritterContext = {
  world, nav, player, bots,
  onKill: (critter, victim) => feedPush(`${critter} munched ${victim}`, '#c8e07a'),
};
const ctx: BotContext = {
  world, nav, player, fx, sound, bots, grenades, critters: critters.list,
  onKill: (killer, victim, victimTeam) => {
    const kf = bots.find((x) => x.name === killer)?.faction ?? 'gnome';
    feedPush(`${killer} ${pick(VERBS[kf])} ${victim}`, victimTeam === 1 ? '#8cf' : '#f88');
  },
};

/** (Re)create every bot for the current choice of side: team 0 is the player's faction. */
function buildBots() {
  for (const b of bots) scene.remove(b.group);
  bots.length = 0;
  let mine = 0;
  let theirs = 0;
  // each team fields one of every class (your own class is taken on your side)
  const myClasses = shuffled(CLASS_ORDER.filter((c) => c !== playerClass));
  const theirClasses = shuffled(CLASS_ORDER);
  for (let i = 0; i < TEAM_SIZE * 2 - 1; i++) {
    const team: Team = i < TEAM_SIZE - 1 ? 0 : 1;
    const fac = team === 0 ? faction : otherFaction(faction);
    const names = NAMES[fac];
    const idx = team === 0 ? mine++ : theirs++;
    const cls = team === 0 ? myClasses[idx % myClasses.length] : theirClasses[idx % theirClasses.length];
    bots.push(new Bot(scene, team, names[idx % names.length], fac, cls));
  }
}
buildBots();

// --- voices: each faction talks differently -----------------------------------------
const LINES: Record<Faction, Partial<Record<BotEvent, string[]>>> = {
  gnome: {
    kill: ['Ha ha, take that!', 'Get out of my garden!', 'Get off my lawn!', 'Gnome sweet gnome!', 'Pointy hats forever!', 'Another goblin for the compost heap!', 'You have been gnomed!', 'Nice try, scoundrel!', 'Shoo! Shoo!'],
    spot: ['Goblin!', 'Get out of my garden!', 'Vermin in the vegetable patch!', 'Intruder!'],
    idle: ['I smell goblins.', 'Stay sharp, lads.', 'Not on my watch.', 'Tea after this, I think.', 'Get out of my garden!'],
    throw: ['Fire in the hole!', 'Catch!', 'Surprise!'],
    death: ['Oh, fiddlesticks!', 'Tell my snails I loved them!'],
    hat: ['My hat! Give it back!', 'Not the hat!', 'How dare you, sir!'],
    sneeze: ['Ah... ah... ACHOO!', 'Bless me!'],
    bug: ['Eek! A spider!', 'Shoo, you horrid thing!', 'Bugs! In my garden!'],
    rpg: ['Rocket!', 'Hold your ears!', 'Tally ho!'],
  },
  goblin: {
    kill: ['Heh heh heh, dead gnome!', 'Smash them, bash them!', 'Shiny hat is mine now!', 'Gnome stew tonight!', 'Squish!', 'That is what you get, hat boy!'],
    spot: ['Gnomes! Get them!', 'Fresh meat!', 'Me see a gnome!'],
    idle: ['Me smell hats.', 'Where little gnomes hiding?', 'Me hungry.', 'Hee hee hee.'],
    throw: ['Boom boom!', 'Eat this!', 'Bomb!'],
    death: ['Argh, me die!', 'Not the face!'],
    hat: ['Me hat!', 'Give hat back!', 'Hat stealer!'],
    fart: ['Oops.', 'Heh, was me.', 'Pardon me.'],
    bug: ['Big bug! Me no like!', 'Spider! Spider!', 'Eat it, bug!'],
    rpg: ['Boom stick!', 'Rocket go whoosh!', 'Run, gnomes!'],
  },
};

/** Make enemies within `radius` of a noise come and have a look. */
function alertEnemiesNear(pos: THREE.Vector3, team: Team, radius: number) {
  for (const o of bots) if (!o.dead && o.team !== team && o.pos.distanceTo(pos) < radius) o.hear(pos);
}

Bot.onEvent = (kind, b) => {
  const { vol, pan } = sound.spatial(b.pos.x, b.pos.z);
  const goblin = b.faction === 'goblin';
  const say = (chance: number) => {
    const lines = LINES[b.faction][kind];
    if (lines && lines.length && Math.random() < chance) {
      sound.taunt(lines[Math.floor(Math.random() * lines.length)], vol, pan, b.voicePitch, b.faction, b.voiceSeed);
    }
  };
  if (kind === 'hit') sound.gnomeHit(vol, pan, b.voicePitch, goblin);
  else if (kind === 'death') {
    sound.gnomeDeath(vol, pan, b.voicePitch, goblin);
    say(0.4);
  } else if (kind === 'kill') {
    if (Math.random() < 0.3) sound.cackle(vol, pan, b.faction);
    else say(0.7);
  } else if (kind === 'fart') {
    sound.fart(vol, pan);
    fx.cloud(new THREE.Vector3(b.pos.x, 0.3, b.pos.z), 0x9bd13a, 3.2);
    alertEnemiesNear(b.pos, b.team, 16); // the smell gives you away
    say(0.6);
  } else if (kind === 'sneeze') {
    sound.sneeze(vol, pan);
    b.knockHat(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), 1); // the force of it blows the hat off
    alertEnemiesNear(b.pos, b.team, 22);
    say(0.8);
  } else say(kind === 'throw' || kind === 'rpg' ? 0.7 : 1);
};

const friends = () => bots.filter((b) => b.team === 0);
const enemies = () => bots.filter((b) => b.team === 1);

/** Medics heal teammates standing close to them. */
let critterT = 8;
let queenSpawned = false;
let bugBannerShown = false;
const LAIRS: [number, number][] = [[-28, 6], [28, -2], [-18, 27], [2, 28], [22, 26], [-10, -12], [12, -13], [27, 12], [-27, -16]];

/** Bugs and spiders turn up now and then, and more of them as the round drags on. */
function spawnCritters(dt: number) {
  critterT -= dt;
  if (critterT > 0) return;
  const elapsed = ROUND_TIME - phaseT;
  critterT = Math.max(5, 14 - elapsed / 12) + Math.random() * 6;
  if (critters.alive() >= 4 + Math.floor(elapsed / 25)) return;
  const spots = LAIRS.filter(([x, z]) => nav.isFreeAt(x, z) && Math.hypot(x - player.pos.x, z - player.pos.z) > 14);
  const [lx, lz] = spots.length ? spots[Math.floor(Math.random() * spots.length)] : [nav.randomFreePoint(28).x, nav.randomFreePoint(28).z];
  const at = new THREE.Vector3(lx, 0, lz);
  const r = Math.random();
  const kind: CritterKind = r < 0.5 ? 'spider' : r < 0.75 ? 'wasp' : 'beetle';
  critters.spawn(kind, at);
  fx.burst(at, 0x5a3d28, 10, 4, 2);
  const sp = sound.spatial(at.x, at.z);
  sound.skitter(Math.max(0.3, sp.vol), sp.pan);
  if (!bugBannerShown) {
    bugBannerShown = true;
    banner('BUGS IN THE GARDEN!', 1.6);
  }
  if (!queenSpawned && elapsed > 70 && Math.random() < 0.5) {
    queenSpawned = true;
    const [qx, qz] = spots.length ? spots[Math.floor(Math.random() * spots.length)] : [lx, lz];
    critters.spawn('spider', new THREE.Vector3(qx, 0, qz), true);
    banner('THE SPIDER QUEEN ARRIVES!', 2.6);
  }
}

function medicAura(dt: number) {
  for (const m of bots) {
    const heal = CLASSES[m.cls].healAura;
    if (m.dead || heal <= 0) continue;
    for (const o of bots) if (o !== m && !o.dead && o.team === m.team && o.pos.distanceTo(m.pos) < 7) o.heal(heal * dt);
    if (m.team === 0 && player.alive && player.pos.distanceTo(m.pos) < 7) player.heal(heal * dt);
  }
  const mine = CLASSES[playerClass].healAura;
  if (mine > 0 && player.alive) for (const o of friends()) if (!o.dead && o.pos.distanceTo(player.pos) < 7) o.heal(mine * dt);
}

// --- weapons / economy -------------------------------------------------------
const makeWeapon = (def: WeaponDef) => new Weapon(def, FACTION_INFO[faction].skin, FACTION_INFO[faction].sleeve);
let pistol = makeWeapon(WEAPONS.pistol);
let primary: Weapon | null = null;
let melee: Weapon | null = null;
let current: Weapon = pistol;
camera.add(current.model);

function equip(w: Weapon) {
  if (w === current) return;
  camera.remove(current.model);
  current.cancelReload();
  current = w;
  camera.add(current.model);
}

let money = START_MONEY;
let buyOpen = false;

interface ShopItem { key: string; label: string; price: number; give: () => boolean }
const giveGun = (def: WeaponDef) => () => {
  primary = makeWeapon(def);
  equip(primary);
  return true;
};
const MAX_FRAGS = 2;
const MAX_SMOKES = 2;
let frags = 0;
let smokes = 0;
const SHOP: ShopItem[] = [
  { key: '1', label: 'SMG', price: WEAPONS.smg.price, give: giveGun(WEAPONS.smg) },
  { key: '2', label: 'Shotgun', price: WEAPONS.shotgun.price, give: giveGun(WEAPONS.shotgun) },
  { key: '3', label: 'Rifle', price: WEAPONS.rifle.price, give: giveGun(WEAPONS.rifle) },
  { key: '4', label: 'Sniper', price: WEAPONS.sniper.price, give: giveGun(WEAPONS.sniper) },
  {
    key: '5', label: 'Armor', price: ARMOR_PRICE,
    give: () => {
      if (player.armor >= 100) return false;
      player.armor = 100;
      return true;
    },
  },
  { key: '6', label: 'Frag (G)', price: 300, give: () => (frags < MAX_FRAGS ? ++frags > 0 : false) },
  { key: '7', label: 'Smoke (V)', price: 300, give: () => (smokes < MAX_SMOKES ? ++smokes > 0 : false) },
  { key: '8', label: 'RPG', price: WEAPONS.rpg.price, give: giveGun(WEAPONS.rpg) },
  {
    key: '9', label: 'Chainsaw', price: WEAPONS.chainsaw.price,
    give: () => {
      melee = makeWeapon(WEAPONS.chainsaw);
      equip(melee);
      return true;
    },
  },
];

function buy(key: string) {
  const item = SHOP.find((s) => s.key === key);
  if (!item) return;
  if (money < item.price) { banner('NOT ENOUGH MONEY', 1); sound.empty(); return; }
  if (!item.give()) { banner('ALREADY OWNED', 1); return; }
  money -= item.price;
  sound.reload();
}

// --- match state -------------------------------------------------------------
type Phase = 'freeze' | 'live' | 'end' | 'matchend';
let phase: Phase = 'freeze';
let phaseT = FREEZE_TIME;
let score: [number, number] = [0, 0];
let round = 0;
let playerDied = true; // first round starts with a fresh loadout
let kills = 0;

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

const VERBS: Record<Faction, string[]> = {
  gnome: ['gnomed', 'pruned', 'bonked', 'composted', 'mulched', 'politely removed'],
  goblin: ['squished', 'smashed', 'yoinked', 'stewed', 'yeeted', 'nommed'],
};
const ROUND_SUBS = ['BUY TIME', 'POLISH YOUR HATS', 'MIND THE SPIDERS', 'FEED THE COMPOST', 'DO NOT EAT THE SLUGS', 'TRIM THE HEDGE, THEN THE ENEMY'];
const WIN_LINES = ['ROUND WON — THE LAWN IS SAFE!', 'ROUND WON — SOMEONE GET A MOP', 'ROUND WON — HATS FOR EVERYONE!'];
const LOSS_LINES = ['ROUND LOST — THE COMPOST WINS', 'ROUND LOST — HOW EMBARRASSING', 'ROUND LOST — THE SLUGS ARE LAUGHING'];
const DEATH_LINES = ['YOU HAVE BEEN COMPOSTED', 'OH NO, YOUR HAT!', 'RIP. FLOWERS WILL BE PLANTED', 'WELL, THAT HAPPENED'];

/** You pass wind (goblins) or sneeze (gnomes) every now and then, which gives your position away. */
let playerGasT = 35 + Math.random() * 40;
function playerGas() {
  if (faction === 'goblin') {
    sound.fart(1, 0);
    fx.cloud(new THREE.Vector3(player.pos.x, 0.3, player.pos.z), 0x9bd13a, 3.2);
    banner(pick(['BRAAAP!', 'OOPS.', 'THE SMELL!']), 1.2);
    alertEnemiesNear(player.pos, 0, 16);
  } else {
    sound.sneeze(1, 0);
    player.shake = Math.max(player.shake, 0.5);
    player.pitch -= 0.06;
    banner('ACHOO!', 1);
    alertEnemiesNear(player.pos, 0, 22);
  }
}

function shuffled<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Hand out the class's free kit: its signature weapon, armor and grenades. */
function applyClassKit() {
  const def = CLASSES[playerClass];
  primary = makeWeapon(WEAPONS[def.primary]);
  equip(primary);
  player.armor = def.armor;
  frags = def.frags;
  smokes = def.smokes;
}

function startRound() {
  round++;
  player.setClass(CLASSES[playerClass]);
  phase = 'freeze';
  phaseT = FREEZE_TIME;
  buyOpen = true;

  grenades.clear();
  fx.clearLasers();
  fx.clearGore();
  critters.clear();
  critterT = 8;
  queenSpawned = false;
  bugBannerShown = false;
  world.restore(); // everything broken last round is back
  nav.rebuild(world);
  navDirty = false;
  if (playerDied) {
    frags = 0;
    smokes = 0;
    primary = null;
    melee = null;
    player.armor = 0;
    equip(pistol);
    applyClassKit();
  }
  playerDied = false;
  pistol.refill();
  primary?.refill();

  const south = shuffled(map.south);
  const north = shuffled(map.north);
  player.respawn(south[0]);
  player.frozen = true;
  friends().forEach((b, i) => b.spawn(south[i + 1], nav.randomFreePoint(18)));
  enemies().forEach((b, i) => b.spawn(north[i], nav.randomFreePoint(18)));
  playerGasT = 35 + Math.random() * 40;
  banner(`ROUND ${round} — ${pick(ROUND_SUBS)}`, 2.5);
}

function endRound(winner: Team, why = '') {
  fx.clearLasers();
  phase = 'end';
  phaseT = END_TIME;
  buyOpen = false;
  score[winner]++;
  money = Math.min(MAX_MONEY, money + (winner === 0 ? WIN_BONUS : LOSS_BONUS));
  const msg = winner === 0 ? pick(WIN_LINES) : pick(LOSS_LINES);
  banner(why ? `${why} — ${msg}` : msg, END_TIME - 0.5);
  if (score[winner] >= WIN_ROUNDS) {
    phase = 'matchend';
    phaseT = 6;
    banner(winner === 0 ? 'VICTORY! THE GARDEN IS SAVED!' : 'DEFEAT! THE SLUGS ARE FRIENDS NOW', 5.5);
  }
}

function newMatch() {
  score = [0, 0];
  round = 0;
  money = START_MONEY;
  playerDied = true;
  kills = 0;
  startRound();
}

// --- input -------------------------------------------------------------------
let locked = false;
let firing = false;
let clickQueued = false;
let scopeHeld = false;
let scopeAmt = 0; // 0 = hip, 1 = fully scoped
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 0) { firing = true; clickQueued = true; }
  if (e.button === 2) scopeHeld = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) firing = false;
  if (e.button === 2) scopeHeld = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousemove', (e) => { if (locked) player.look(e.movementX, e.movementY); });
window.addEventListener('keydown', (e) => {
  if (!locked || e.repeat) return;
  if (e.code === 'KeyR' && player.alive && current.startReload()) sound.reload();
  if (e.code === 'KeyB' && phase === 'freeze') buyOpen = !buyOpen;
  if ((e.code === 'KeyG' || e.code === 'KeyV') && player.alive && phase !== 'freeze') {
    const kind: GrenadeKind = e.code === 'KeyG' ? 'frag' : 'smoke';
    if ((kind === 'frag' ? frags : smokes) > 0) {
      if (kind === 'frag') frags--; else smokes--;
      throwGrenade(kind);
    }
  }
  if (e.code === 'KeyH') {
    fx.goreOn = !fx.goreOn;
    try { localStorage.setItem('gs-gore', fx.goreOn ? '1' : '0'); } catch { /* ignore */ }
    banner(fx.goreOn ? 'GORE ON' : 'GORE OFF', 1);
  }
  if (e.code === 'KeyM') {
    sound.tauntsOn = !sound.tauntsOn;
    if (!sound.tauntsOn) sound.stopTaunts();
    banner(sound.tauntsOn ? 'GNOME VOICES ON' : 'GNOME VOICES OFF', 1);
  }
  const m = /^Digit([1-9])$/.exec(e.code);
  if (m && player.alive) {
    if (buyOpen && phase === 'freeze') buy(m[1]);
    else if (m[1] === '1' && primary) equip(primary);
    else if (m[1] === '2') equip(pistol);
    else if (m[1] === '3' && melee) equip(melee);
  }
});
// `locked` means "the game is running". Normally that follows pointer lock, but if the browser
// refuses the lock we fall back to running without it (mouse-move aiming, Esc to pause).
let fallback = false;
function setRunning(on: boolean) {
  locked = on;
  elOverlay.style.display = on ? 'none' : 'flex';
  if (!on) { firing = false; scopeHeld = false; sound.saw(false, false); elMsg.textContent = 'Paused — click to resume'; }
}
function startFallback() {
  if (locked) return;
  fallback = true;
  setRunning(true);
}
elOverlay.addEventListener('click', () => {
  sound.init();
  try {
    const r = renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch?.(() => startFallback());
  } catch {
    startFallback();
  }
  setTimeout(() => { if (!document.pointerLockElement) startFallback(); }, 400);
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) { fallback = false; setRunning(true); }
  else if (!fallback) setRunning(false);
});
document.addEventListener('pointerlockerror', startFallback);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && fallback) { fallback = false; setRunning(false); }
});
// side selection: switching sides restarts the match with the new factions
function refreshCards() {
  for (const el of document.querySelectorAll<HTMLElement>('.faction-card')) el.classList.toggle('selected', el.dataset.f === faction);
}
function setFaction(f: Faction) {
  if (f === faction) { refreshCards(); return; }
  faction = f;
  try { localStorage.setItem('gs-faction', f); } catch { /* ignore */ }
  camera.remove(current.model);
  pistol = makeWeapon(WEAPONS.pistol);
  primary = null;
  melee = null;
  current = pistol;
  camera.add(current.model);
  buildBots();
  grenades.clear();
  newMatch();
  refreshCards();
}
for (const el of document.querySelectorAll<HTMLElement>('.faction-card')) {
  el.addEventListener('click', () => setFaction(el.dataset.f as Faction));
}
// class picker
elClasses.innerHTML = CLASS_ORDER.map((id) => {
  const c = CLASSES[id];
  return `<div class="class-card" data-c="${id}"><b>${c.name}</b><br><span>${c.blurb}</span></div>`;
}).join('');
function refreshClassCards() {
  for (const el of elClasses.querySelectorAll<HTMLElement>('.class-card')) el.classList.toggle('selected', el.dataset.c === playerClass);
}
function setClass(c: ClassId) {
  if (c === playerClass) { refreshClassCards(); return; }
  playerClass = c;
  try { localStorage.setItem('gs-class', c); } catch { /* ignore */ }
  buildBots();
  grenades.clear();
  newMatch();
  refreshClassCards();
}
for (const el of elClasses.querySelectorAll<HTMLElement>('.class-card')) {
  el.addEventListener('click', () => setClass(el.dataset.c as ClassId));
}
refreshClassCards();
refreshCards();
if (FORCE_RUN) { locked = true; elOverlay.style.display = 'none'; }
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- shooting ----------------------------------------------------------------
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const dir = new THREE.Vector3();
const origin = new THREE.Vector3();
const muzzleW = new THREE.Vector3();

function throwGrenade(kind: GrenadeKind) {
  camera.updateMatrixWorld();
  player.eyePos(origin);
  camera.getWorldDirection(dir);
  const vel = dir.clone().multiplyScalar(15).add(new THREE.Vector3(player.vel.x * 0.5, 3.5, player.vel.z * 0.5));
  const from = origin.clone().addScaledVector(dir, 0.6);
  grenades.throw(kind, from, vel, { team: 0, name: 'You', isPlayer: true });
}

const baseDir = new THREE.Vector3();

function creditCritter(k: Critter) {
  money = Math.min(MAX_MONEY, money + 75);
  feedPush(`You squashed ${k.displayName}`, '#c8e07a');
}

function creditKill(victim: Bot, head: boolean) {
  kills++;
  money = Math.min(MAX_MONEY, money + KILL_BONUS);
  feedPush(`You ${pick(VERBS[faction])} ${victim.name}${head ? ' ★' : ''}`, '#ffe08a');
}

/** Chainsaw: a short, wide cut straight ahead. Very messy. */
function meleeAttack(def: WeaponDef) {
  camera.updateMatrixWorld();
  player.eyePos(origin);
  camera.getWorldDirection(dir);
  const range = def.melee ?? 2.5;
  const wh = world.raycastHit(origin, dir, range);
  let tBest = wh.t;
  let hitBot: Bot | null = null;
  let zone: 'head' | 'body' | 'hat' = 'body';
  for (const b of bots) {
    if (b.team !== 1) continue;
    const h = b.rayHit(origin, dir);
    if (h && h.t < tBest && h.t <= range) { tBest = h.t; hitBot = b; zone = h.zone; }
  }
  let hitCritter: Critter | null = null;
  for (const k of critters.list) {
    const ct = k.rayHit(origin, dir);
    if (ct !== null && ct <= range && ct < tBest) { tBest = ct; hitCritter = k; hitBot = null; }
  }
  const end = origin.clone().addScaledVector(dir, Number.isFinite(tBest) ? tBest : range);
  if (hitCritter) {
    const k = hitCritter as Critter;
    sound.squelch(0.8, 0);
    player.shake = Math.max(player.shake, 0.2);
    if (k.damage(def.body * 1.6, player.pos, 'melee')) creditCritter(k);
  } else if (hitBot) {
    const victim = hitBot as Bot;
    if (zone === 'hat') {
      if (victim.knockHat(dir, 1.2)) {
        sound.bonk();
        Bot.onEvent?.('hat', victim);
      }
    } else {
      const head = zone === 'head';
      const killed = victim.damage(head ? def.head : def.body, player.pos, 'melee');
      sound.squelch(0.8, 0);
      player.shake = Math.max(player.shake, 0.25);
      marker(head, killed);
      if (killed) creditKill(victim, head);
    }
  } else if (Number.isFinite(tBest) && wh.collider?.group) {
    world.damage(wh.collider.group, def.body * 2.5, end); // it chews through scenery
    fx.burst(end, 0xffd060, 4, 5, 1);
    sound.chunk(0.5);
    player.shake = Math.max(player.shake, 0.1);
  }
  if (wh.glass?.group && wh.glassT <= range) world.damage(wh.glass.group, 99, end);
  for (const b of enemies()) if (!b.dead && b.pos.distanceTo(player.pos) < 28 && Math.random() < 0.15) b.hear(player.pos); // it's loud
}

function fireRocket() {
  camera.updateMatrixWorld();
  player.eyePos(origin);
  camera.getWorldDirection(baseDir);
  current.muzzle.getWorldPosition(muzzleW);
  const hit = world.raycast(origin, baseDir, 120);
  const aimAt = origin.clone().addScaledVector(baseDir, Number.isFinite(hit) ? hit : 120);
  const d = aimAt.sub(muzzleW).normalize();
  grenades.rocket(muzzleW, d, { team: 0, name: 'You', isPlayer: true });
  player.pitch += 0.09;
  player.shake = Math.max(player.shake, 0.35);
  alertEnemiesNear(player.pos, 0, 50);
}

function fire() {
  const def = current.def;
  if (def.melee) { meleeAttack(def); return; }
  if (def.projectile === 'rocket') { fireRocket(); return; }
  camera.updateMatrixWorld();
  player.eyePos(origin);
  camera.getWorldDirection(baseDir);
  right.setFromMatrixColumn(camera.matrixWorld, 0);
  up.setFromMatrixColumn(camera.matrixWorld, 1);
  const pellets = def.pellets ?? 1;
  const spread = current.spread(player.horizSpeed, player.onGround, scopeAmt > 0.8) + (pellets > 1 ? def.pelletSpread ?? 0 : 0);
  current.muzzle.getWorldPosition(muzzleW);

  let anyHit = false;
  let anyHead = false;
  let anyKill = false;
  let anyHat = false;
  for (let i = 0; i < pellets; i++) {
    dir.copy(baseDir)
      .addScaledVector(right, (Math.random() - 0.5) * 2 * spread)
      .addScaledVector(up, (Math.random() - 0.5) * 2 * spread)
      .normalize();

    const wh = world.raycastHit(origin, dir, 200);
    let tBest = wh.t;
    let hitBot: Bot | null = null;
    let zone: 'head' | 'body' | 'hat' = 'body';
    for (const b of bots) {
      if (b.team !== 1) continue; // bullets pass through teammates
      const h = b.rayHit(origin, dir);
      if (h && h.t < tBest) { tBest = h.t; hitBot = b; zone = h.zone; }
    }
    let hitCritter: Critter | null = null;
    for (const k of critters.list) {
      const ct = k.rayHit(origin, dir);
      if (ct !== null && ct < tBest) { tBest = ct; hitCritter = k; hitBot = null; }
    }
    const t = Number.isFinite(tBest) ? tBest : 120;
    const end = origin.clone().addScaledVector(dir, t);
    fx.tracer(muzzleW, end, pellets > 1 ? 0xfff0c0 : 0xffe9a0);
    // shots break glass they pass through, and chip whatever solid thing they hit
    if (wh.glass?.group && wh.glassT < tBest) world.damage(wh.glass.group, def.body, end);
    if (!hitBot && wh.collider?.group) world.damage(wh.collider.group, def.body, end);

    if (hitCritter) {
      const k = hitCritter as Critter;
      const killed = k.damage(def.body * (pellets > 1 ? Math.max(0.2, 1 - t / 28) : 1), player.pos, pellets > 1 && t < 6 ? 'shotgun' : 'bullet');
      anyHit = true;
      if (killed) {
        anyKill = true;
        creditCritter(k);
      }
    } else if (hitBot && zone === 'hat') {
      // shooting a hat off hurts nobody: it just goes flying
      if ((hitBot as Bot).knockHat(dir, 1)) {
        anyHat = true;
        Bot.onEvent?.('hat', hitBot as Bot);
      }
    } else if (hitBot) {
      const victim = hitBot as Bot;
      const head = zone === 'head';
      const falloff = pellets > 1 ? Math.max(0.2, 1 - t / 28) : 1; // shotguns lose punch with range
      const killed = victim.damage((head ? def.head : def.body) * falloff, player.pos, pellets > 1 && t < 6 ? 'shotgun' : 'bullet');
      anyHit = true;
      anyHead = anyHead || head;
      if (killed) {
        anyKill = true;
        creditKill(victim, head);
      }
    } else if (Number.isFinite(tBest)) {
      fx.burst(end, 0xd8b87a, pellets > 1 ? 1 : 5, 2);
    }
  }

  sound.shot(1, 0, pellets > 1);
  if (anyHit) {
    sound.hit(anyHead);
    marker(anyHead, anyKill);
  } else if (anyHat) {
    sound.bonk();
    banner('HAT OFF!', 0.7);
    marker(false, false);
  }

  // recoil: the player has to pull down to compensate
  player.pitch += def.recoil + current.heat * 0.006;
  player.yaw += (Math.random() - 0.5) * 0.008;

  for (const b of enemies()) if (!b.dead && b.pos.distanceTo(player.pos) < 35) b.hear(player.pos);
}

// --- per-frame HUD -----------------------------------------------------------
const fmtTime = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function renderHud(dt: number) {
  player.hurt = Math.max(0, player.hurt - dt * 1.8);
  elHit.style.boxShadow = `inset 0 0 120px 30px rgba(220,0,0,${(player.hurt * 0.7).toFixed(2)})`;
  elHealth.textContent = `♥ ${Math.ceil(player.health)}${player.armor > 0 ? `   ⛨ ${Math.ceil(player.armor)}` : ''}  · ${CLASSES[playerClass].name}`;
  elAmmo.innerHTML =
    (current.def.melee ? `${current.def.name}  BRRRRR` : current.reloading ? 'RELOADING…' : `${current.def.name}  ${current.ammo} / ${current.reserve}`) +
    `<div style="font-size:15px;opacity:.85;text-align:right">FRAG ${frags} [G] · SMOKE ${smokes} [V]</div>`;
  elMoney.textContent = `$${money}`;

  const fAlive = friends().filter((b) => !b.dead).length + (player.alive ? 1 : 0);
  const eAlive = enemies().filter((b) => !b.dead).length;
  const clock = phase === 'freeze' ? `BUY TIME ${Math.ceil(phaseT)}s` : phase === 'live' ? fmtTime(phaseT) : '';
  elScore.innerHTML =
    `<span style="color:${FACTION_INFO[faction].color}">${FACTION_INFO[faction].label} ${score[0]}</span> : <span style="color:${FACTION_INFO[otherFaction(faction)].color}">${score[1]} ${FACTION_INFO[otherFaction(faction)].label}</span>` +
    `<div style="font-size:15px;opacity:.9">ROUND ${round} · ${clock} · ALIVE <span style="color:${FACTION_INFO[faction].color}">${fAlive}</span> v <span style="color:${FACTION_INFO[otherFaction(faction)].color}">${eAlive}</span></div>`;

  if (buyOpen && phase === 'freeze' && player.alive) {
    elBuy.style.display = 'block';
    elBuy.innerHTML =
      `<b>BUY MENU</b> <span style="opacity:.6;font-size:14px">(B to close)</span><br>` +
      SHOP.map((s) => {
        const ok = money >= s.price;
        return `<span style="color:${ok ? '#fff' : '#a66'}">[${s.key}] ${s.label.padEnd(6, ' ')} $${s.price}</span>`;
      }).join('<br>') +
      `<br><span style="color:#8f8">Money $${money}</span>`;
  } else {
    elBuy.style.display = 'none';
  }

  for (const f of feed) f.t -= dt;
  while (feed.length && feed[0].t <= 0) feed.shift();
  elFeed.innerHTML = feed.map((f) => `<div style="color:${f.color}">${f.text}</div>`).join('');

  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) elBanner.style.opacity = '0'; }
  if (markerT > 0) { markerT -= dt; if (markerT <= 0) elMarker.style.opacity = '0'; }
}

// --- main loop ---------------------------------------------------------------
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (locked) {
    const wasAlive = player.alive;
    const hpBefore = player.health;
    player.frozen = phase === 'freeze';

    // right-click to scope (scoped weapons only): zoom in, slow down, steady the aim
    const canScope = player.alive && phase !== 'freeze' && !!current.def.scope && !current.reloading;
    const scopeGoal = scopeHeld && canScope ? 1 : 0;
    scopeAmt += Math.max(-dt * 8, Math.min(dt * 8, scopeGoal - scopeAmt));
    const fov = 75 + ((current.def.scope ?? 75) - 75) * scopeAmt;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    player.sensScale = camera.fov / 75;
    player.moveScale = scopeAmt > 0.5 ? 0.45 : 1;
    elScope.style.display = scopeAmt > 0.9 ? 'block' : 'none';
    elCross.style.visibility = scopeAmt > 0.5 ? 'hidden' : 'visible';

    player.update(dt);

    if (player.alive) {
      if (phase !== 'freeze') {
        const want = current.def.auto ? firing : clickQueued;
        if (want && current.canFire && current.tryFire()) fire();
        else if (want && current.ammo === 0 && !current.reloading && current.startReload()) sound.reload();
      }
      if (player.health < hpBefore) sound.hurt();
    } else if (wasAlive) {
      playerDied = true;
      banner(pick(DEATH_LINES), 2.5);
      feedPush('You were fragged', '#f88');
    }
    clickQueued = false;
    current.revving = firing && player.alive && current.def.id === 'chainsaw';
    sound.saw(player.alive && current.def.id === 'chainsaw', current.revving);
    current.update(dt, player.alive ? player.horizSpeed : 0);

    if (phase === 'end') for (const b of bots) if (b.dead) b.update(dt, ctx); // let flying corpses land
    if (phase === 'live') {
      for (const b of bots) b.update(dt, ctx);
      critters.update(dt, critterCtx);
      spawnCritters(dt);
      medicAura(dt);
      if (player.alive) {
        playerGasT -= dt;
        if (playerGasT <= 0) {
          playerGasT = 40 + Math.random() * 60;
          playerGas();
        }
      }
      if (ROUND_TIME - phaseT > HUNT_AFTER) {
        const pressure = Math.min(1, (ROUND_TIME - phaseT - HUNT_AFTER) / 35);
        for (const b of bots) { b.hunt = true; b.pressure = pressure; }
      }
    }
    fx.update(dt);
    grenades.update(dt);
    if (navDirty) {
      navDirtyT -= dt;
      if (navDirtyT <= 0) {
        nav.rebuild(world);
        navDirty = false;
      }
    }

    // phase machine
    phaseT -= dt;
    if (phase === 'freeze' && phaseT <= 0) {
      phase = 'live';
      phaseT = ROUND_TIME;
      buyOpen = false;
      banner('GO!', 1);
    } else if (phase === 'live') {
      const fAlive = friends().filter((b) => !b.dead).length + (player.alive ? 1 : 0);
      const eAlive = enemies().filter((b) => !b.dead).length;
      if (eAlive === 0) endRound(0);
      else if (fAlive === 0) endRound(1);
      else if (phaseT <= 0) endRound(1, 'TIME UP');
    } else if (phase === 'end' && phaseT <= 0) {
      startRound();
    } else if (phase === 'matchend' && phaseT <= 0) {
      newMatch();
    }
  }

  // spectate a living teammate after dying
  const spec = !player.alive ? friends().find((b) => !b.dead) ?? null : null;
  for (const b of bots) b.group.visible = !b.gibbed && b !== spec;
  if (spec) {
    camera.position.set(spec.pos.x, spec.pos.y + 1.4, spec.pos.z);
    camera.rotation.set(0, spec.yaw, 0);
  }

  sound.setListener(camera.position.x, camera.position.z, camera.rotation.y);
  current.model.visible = player.alive && scopeAmt < 0.5;
  renderHud(dt);
  renderer.render(scene, camera);
}

newMatch();
tick();

// handy for poking at the game from the console / tests
(window as unknown as { __gs: unknown }).__gs = {
  world, nav, player, bots, camera, fire, buy, grenades, setFaction, setClass, ctx, critters, critterCtx, setRunning: (v: boolean) => { locked = v; }, throwGrenade, giveFrags: (n: number) => { frags = n; smokes = n; }, giveMoney: (n: number) => { money = n; }, startRound, endRound, newMatch, sound,
  get state() {
    return { phase, phaseT, score, round, money, kills, weapon: current.def.id, armor: player.armor };
  },
  set phaseT(v: number) { phaseT = v; },
};
