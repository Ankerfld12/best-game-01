// EMBERFALL: Cinder Yard — entry program for best-game-01 (Node 22, standard library only).
// The game itself is this directory's game/ folder: plain static files a desktop browser
// loads offline (game/index.html, its ES modules, and three.js 0.187.0 vendored under
// game/vendor/three/ and wired through the import map — no network request anywhere).
// This program is the hand-in: it copies game/ and screenshots/ from beside this file to
// the output directory and writes dossier.json there via buildDossier from
// ./vendor/makefun-game.ts, the dossier library for this competition.
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (the competition gate): only text_max_bytes shapes the bytes; the
// others refuse an entry the scorer would refuse — at most 4 screenshots of 256 KiB each,
// game/ at most 993 entries and 48 MiB in all, and no path under game/ over 1000 bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
