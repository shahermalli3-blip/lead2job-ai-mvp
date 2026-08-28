import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'mobile-web');
const files = [
  'start.html',
  'setup.html',
  'new.html',
  'actions.html',
  'agent.html',
  'reception-test.html',
  'requests.html',
  'channels.html',
  'privacy.html',
  'manifest.webmanifest',
  'icon.svg'
];

await mkdir(out, { recursive: true });

for (const file of files) {
  const source = join(root, file);
  if (!existsSync(source)) throw new Error(`Missing mobile source file: ${file}`);
  await copyFile(source, join(out, file));
}

const entry = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="refresh" content="0;url=./start.html"><title>Lead2Job</title></head><body><script>location.replace('./start.html')</script></body></html>`;
await writeFile(join(out, 'index.html'), entry, 'utf8');

console.log(`Prepared ${files.length + 1} bundled mobile files in mobile-web/`);
