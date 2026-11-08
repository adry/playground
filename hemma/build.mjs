// Builds dist/hemma.html: the whole app in one file, scripts inlined, ready to
// publish as a single page (the artifact viewer adds its own <html>/<head>).
// `npm run dev` serves index.html with the modules unbundled instead.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const between = (start, end) => {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a < 0 || b < 0) throw new Error(`index.html is missing ${start} or ${end}`);
  return html.slice(a + start.length, b).trim();
};

const head = between('<!-- page:head -->', '<!-- /page:head -->');
const body = between('<!-- page:body -->', '<!-- /page:body -->');
const tag = '<script type="module" src="./src/main.js"></script>';
if (!body.includes(tag)) throw new Error('index.html no longer loads ./src/main.js the way build.mjs expects');

const out = await build({
  entryPoints: [new URL('./src/main.js', import.meta.url).pathname],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
const page = `${head}\n${body.replace(tag, () => `<script>${js}</script>`)}\n`;
await writeFile(new URL('./dist/hemma.html', import.meta.url), page);
console.log(`dist/hemma.html  ${(page.length / 1024).toFixed(1)} KB`);
