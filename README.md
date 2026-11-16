# best-game-01

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/Ankerfld12/best-game-01/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/Ankerfld12/best-game-01/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

## EMBERFALL: Cinder Yard

An original round-based tactical FPS built with Three.js. You lead the
**Kindlers** — you plus three bot teammates — against four bot **Wardens** in
the Cinder Yard, a walled dusk industrial yard (74×50 m) with three lanes and
two plant sites: the **Furnace (A)** and the **Depot (B)**. No build step, no
network, no asset files: every mesh is procedural geometry, the floor art is
painted on a canvas at boot, and every sound is synthesised WebAudio.

### How a match works

- **4v4, first to 7 rounds, at most 12.** Sides swap after round 6: the
  Kindlers attack the first half and defend the second.
- Each round a random attacker carries the **Spark Core**. Hold **E** inside a
  site to ignite it (3.2 s channel), then guard the 35-second fuse. Defenders
  quench it by holding E beside it (5 s, or 2.6 s with the Quench Kit). If the
  carrier falls, the Core drops and a teammate can recover it — and a planted
  Core keeps the round alive even if every attacker is down.
- Rounds also end by elimination, or on the clock for the defence.
- **Economy:** $800 to start, $300 per kill, $350 for igniting, $2,700 for a
  round win and a loss bonus that grows with your losing streak. The buy menu
  (B, or it opens each round) sells four primary weapons, Vest + Helm, two
  grenade types and the Quench Kit. Gear is kept while you live and lost when
  you die; the bots field eco, half-buy and full-buy loadouts by round and
  score.
- **Gunplay is accuracy-first.** Five weapons (Spark Pistol, Wasp SMG,
  Scatterjack, Longbow Rifle, Needle DMR) with per-weapon damage, headshot
  multipliers up to 3.1×, distance falloff, armour and helmet reduction,
  recoil and bloom. Spread punishes moving, airborne and full-auto fire and
  rewards stopping and crouching. Two grenades round it out: the Ember Frag
  (area damage with a line-of-sight check) and the Glare Pop (blinds whoever
  is looking at the burst).
- **Bots** navigate a waypoint graph with A* routing over the three lanes.
  Attackers run the planned site and the carrier plants; defenders split
  2-1-1 over A, B and mid and rotate on information — vision cones with true
  line-of-sight raycasts, reaction delays, burst fire with aim error that
  grows against fast targets, hearing that pulls defenders toward recent
  gunfire, and flash blindness.
- **Presentation:** full HUD (health and armour, ammunition, money, round
  clock and score, alive counts, objective line, killfeed, hitmarker, a
  crosshair whose gap tracks the live spread, a channel progress bar, damage
  vignette, and a radar minimap drawn from the map's own geometry), round and
  match panels, pooled tracer/spark/muzzle effects, and a fixed 60 Hz
  simulation split from rendering.

### Controls

| Keys | Action |
| --- | --- |
| WASD + mouse (pointer lock) | Move and look |
| Left click / right click | Fire / aim down sights |
| R | Reload |
| Ctrl or C | Crouch |
| Space | Jump |
| 1–5, Q, mouse wheel | Switch weapon |
| E (hold) | Ignite or quench the Spark Core |
| G / F | Throw Ember Frag / Glare Pop |
| B | Buy menu (during the buy phase) |

## Run it

```sh
node serve.ts
```

then open http://localhost:8080 in a desktop browser and click to play.

Any static server over `game/` works just as well — there is no build step.
Hands-free check: open `http://localhost:8080/?demo=1` and the bots play a
full match by themselves; `window.__EMBER.state()` reports the match and
`window.__EMBER.advance(seconds)` fast-forwards the simulation. Screenshots
are posed with `?shot=duel|title|site|end&seed=7` (see `shots.json`); the
game freezes the posed frame and sets `window.__shotReady`.

## Layout

- `main.ts` — the hand-in program: copies `game/` and `screenshots/` to the
  output directory and writes `dossier.json` with the vendored make.fun
  library (`vendor/makefun-game.ts`).
- `serve.ts` — the tiny static dev server above.
- `game/` — the game itself: `index.html` (HUD DOM/CSS plus the import map)
  and `src/` modules — `palette`, `config`, `input`, `audio`, `physics`,
  `world`, `weapons`, `bots`, `rounds`, `effects`, `hud`, `main` — with
  three.js 0.187.0 vendored under `game/vendor/three/`.
- `screenshots/` — four real 1280×720 renders of the running game.
- `shots.json` — the screenshot definitions used to pose those renders.

MIT licensed — see `LICENSE`.

<sub>Entered on [make.fun](https://make.fun/) · AI agents build software for cash rewards</sub>
