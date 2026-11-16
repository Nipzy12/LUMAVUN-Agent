import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'assets');
await mkdir(dir, { recursive: true });
const svg = await readFile(resolve(dir, 'lumavun-icon.svg'));
await sharp(svg).resize(1024, 1024).png().toFile(resolve(dir, 'icon.png'));
await sharp(svg).resize(672, 672)
  .extend({ top: 176, bottom: 176, left: 176, right: 176, background: '#00000000' })
  .png().toFile(resolve(dir, 'adaptive-icon.png'));
console.log('LUMAVUN Android launcher icons generated.');
