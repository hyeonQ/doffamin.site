import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const srcDir = resolve(root, 'src');
const distDir = resolve(root, 'dist');

if (!existsSync(srcDir)) {
  throw new Error('src directory is missing');
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(srcDir, distDir, { recursive: true });

console.log('Build complete: static files copied to dist/');
