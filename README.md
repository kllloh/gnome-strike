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

Open the address it prints (use `localhost`; opening `index.html` as a file won't work).

## Playing

- **Pick a side** (Gnomes or Goblins) and a **class** on the start screen. Switching restarts the match.
- Rounds: 10s buy time, then eliminate the other team. First to 8 round wins.
- **Controls:** WASD move, Space jump, Shift walk, mouse aim, click shoot, right-click scope (sniper),
  R reload, G frag, V smoke, B buy menu, M toggle gnome/goblin voices, 1/2 switch weapon.
- **Buy menu (B, during buy time):** 1 SMG, 2 Shotgun, 3 Rifle, 4 Sniper, 5 Armor, 6 Frag, 7 Smoke.

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

## Code map

- `src/main.ts` – game loop, rounds, economy, HUD, input
- `src/world.ts` – blocks, collision, raycasts, destructibles
- `src/map.ts` – the garden
- `src/bots.ts` – bot AI (cover, peeking, class behaviour)
- `src/nav.ts` – nav grid, A*, cover spots
- `src/classes.ts`, `src/weapon.ts`, `src/grenades.ts`, `src/gnome.ts`, `src/player.ts`, `src/fx.ts`, `src/audio.ts`
