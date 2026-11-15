// BREACHLINE entrypoint (Node 22, standard library only). Hands the game in:
// copies this repository's game/ and screenshots/ beside this file into the
// output directory and writes dossier.json — the summary the judge reads —
// with the kit's vendored library. Run locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader, MAKEFUN_OUTPUT_DIR is unset and /output is used.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyTree(name: string): void {
  const from = join(repoRoot, name);
  const to = join(outDir, name);
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) cpSync(from, to, { recursive: true });
}

mkdirSync(outDir, { recursive: true });
copyTree('game');
copyTree('screenshots');

// The grader runs this program twice and requires both runs to write
// identical bytes, so every step here is a pure copy + a deterministic
// build: no timestamps, no random ordering, no network.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`BREACHLINE handed in: game/ + screenshots/ -> ${outDir}, dossier.json ${Buffer.byteLength(dossier)} bytes`);
