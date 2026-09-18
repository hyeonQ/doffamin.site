import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const srcDir = resolve(root, 'src');
const distDir = resolve(root, 'dist');

// Cloudflare's always-pass testing key; only used for local builds.
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
const SITE_KEY_PLACEHOLDER = '__TURNSTILE_SITE_KEY__';

if (!existsSync(srcDir)) {
  throw new Error('src directory is missing');
}

let siteKey = process.env.TURNSTILE_SITE_KEY;
if (!siteKey) {
  if (process.env.CF_PAGES) {
    throw new Error(
      'TURNSTILE_SITE_KEY is not set. Add it under Cloudflare Pages → Settings → Variables and Secrets (see docs/contact-form.md).'
    );
  }
  siteKey = TURNSTILE_TEST_SITE_KEY;
  console.warn('TURNSTILE_SITE_KEY is not set; using the Turnstile testing site key (local only).');
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(srcDir, distDir, { recursive: true });

for (const file of htmlFiles(distDir)) {
  const html = readFileSync(file, 'utf8');
  if (html.includes(SITE_KEY_PLACEHOLDER)) {
    writeFileSync(file, html.replaceAll(SITE_KEY_PLACEHOLDER, siteKey));
  }
}

console.log('Build complete: static files copied to dist/');

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}
