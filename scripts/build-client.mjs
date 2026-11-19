// Bundles the browser client and copies static files into dist/public.
// app.js and styles.css get a content hash in index.html so a rebuild is never
// hidden behind a cached copy in someone's browser.
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

await mkdir('dist/public/fonts', { recursive: true });
await cp('src/public', 'dist/public', { recursive: true });
// Fonts are served from this app, never from Google: no player's browser calls out to a third party.
for (const [pkg, files] of [
  ['saira-condensed', ['saira-condensed-latin-700-normal.woff2', 'saira-condensed-latin-800-normal.woff2']],
  ['nunito-sans', ['nunito-sans-latin-400-normal.woff2', 'nunito-sans-latin-700-normal.woff2', 'nunito-sans-latin-800-normal.woff2']],
])
  for (const f of files) await cp(`node_modules/@fontsource/${pkg}/files/${f}`, `dist/public/fonts/${f}`);
await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  outfile: 'dist/public/app.js',
  logLevel: 'warning',
});
const hash = async f =>
  createHash('sha256')
    .update(await readFile(`dist/public/${f}`))
    .digest('hex')
    .slice(0, 10);
let html = await readFile('dist/public/index.html', 'utf8');
html = html.replace('/app.js"', `/app.js?v=${await hash('app.js')}"`).replace('/styles.css"', `/styles.css?v=${await hash('styles.css')}"`);
await writeFile('dist/public/index.html', html);
