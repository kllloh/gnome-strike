# Gnomes vs Goblins

A blocky, Counter-Strike-style first-person shooter that runs in the browser. You and four bot
teammates fight five bots in a destructible English back garden, at garden-gnome scale.
Single player: no server needed. Built with TypeScript, Vite and Three.js.

## Run it

```bash
npm install
npm run dev        # development server
# or
npm run build && npx vite preview
```

Open the address it prints (use `localhost`).

**Play without a server:** `npm run build` produces a single self-contained `dist/index.html`
(everything inlined), which you can open by double-clicking it or share as one file. Don't open the
*source* `index.html` in the project root as a file: browsers won't run the TypeScript source that way.

**Play online:** https://kllloh.github.io/gnome-strike/ (auto-deployed from `main`).

## Playing

- **Pick a side** (Gnomes or Goblins) and a **class** on the start screen. Switching restarts the match.
- Rounds: 10s buy time, then eliminate the other team. First to 8 round wins.
- **Controls:** WASD move, Space jump, Shift walk, mouse aim, click shoot, right-click scope (sniper),
  R reload, G frag, V smoke, B buy menu, M toggle voices, H toggle gore, 1 primary / 2 pistol / 3 chainsaw.
- **Buy menu (B, during buy time):** 1 SMG, 2 Shotgun, 3 Rifle, 4 Sniper, 5 Armor, 6 Frag, 7 Smoke,
  8 RPG, 9 Chainsaw.

### Classes

| Class | HP | Free weapon | Perk |
|---|---|---|---|
| Assault | 100 | Rifle | 1 frag |
| Scout | 80 | SMG | fast, high jump, 1 smoke |
| Heavy | 140 | Shotgun | 50 armor, slow |
| Sniper | 85 | Sniper rifle | scoped shots, 1 smoke |
| Medic | 100 | SMG | regenerates and heals nearby allies |

### The garden

Most props, the low brick walls, the shed and the greenhouse can be shot or blown apart; the house and
boundary walls can't. Smoke blocks bots' sight, glass stops movement but not bullets, and everything
resets each round.

### Chaos

- **Hats:** shoot a hat off and it goes flying, with no damage to the owner. Hats also fly off when someone
  dies or sneezes.
- **Weapons for the unhinged:** RPG (rockets with a huge blast radius) and a chainsaw that gibs whatever it touches.
- **Gore:** blood sprays, splats on the ground, gibs, and corpses launched by explosions. Goblins bleed
  green. Press **H** to switch it off.
- **Pests:** spiders, beetles and wasps turn up during rounds and attack both teams. Late in a round the
  Spider Queen may show up.
- **Accidents:** goblins fart and gnomes sneeze now and then (and so do you, depending on your side). It
  gives your position away.
- **Voices:** uses the best English speech voices your system has (gnomes: British-style, goblins: low male).
  Windows/Edge "Natural" voices sound the best.

## Code map

- `src/main.ts` – game loop, rounds, economy, HUD, input
- `src/world.ts` – blocks, collision, raycasts, destructibles
- `src/map.ts` – the garden
- `src/bots.ts` – bot AI (cover, peeking, class behaviour)
- `src/nav.ts` – nav grid, A*, cover spots
- `src/critters.ts` – spiders, beetles, wasps
- `src/classes.ts`, `src/weapon.ts`, `src/grenades.ts`, `src/gnome.ts`, `src/player.ts`, `src/fx.ts`, `src/audio.ts`
