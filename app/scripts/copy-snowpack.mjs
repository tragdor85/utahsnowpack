// Copy data/snowpack.json into app/public/ so Vite serves it at
// /snowpack.json in dev and bundles it into dist/ at build time.
// (docs/PLAN.md task 6; task 11's deploy step does the same for the site.)
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(appRoot, '../data/snowpack.json');
const destDir = join(appRoot, 'public');

if (!existsSync(src)) {
  console.error(`snowpack.json not found at ${src}`);
  console.error('Run `pnpm --filter @utahsnowpack/pipeline build:snowpack` first.');
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
cpSync(src, join(destDir, 'snowpack.json'));
console.log(`copied ${src} -> ${join(destDir, 'snowpack.json')}`);
