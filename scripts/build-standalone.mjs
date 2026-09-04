#!/usr/bin/env node
// Bundles the whole toy into one self-contained HTML file, with no CDN or
// asset requests beyond the webfonts. The toy is the demo page at
// ghostly/index.html, not the landing page at the site root: the root is just
// a list of links and there would be nothing to inline. Emits two flavours:
//
//   dist/standalone.html  a complete document you can open or host anywhere
//   dist/artifact.html    head contents plus body, for hosts that supply their
//                         own document skeleton
//
//   npm run standalone

import { build } from 'vite';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');

await build({ logLevel: 'warn' });

// Which page to inline. Defaults to the public ghost-only build; pass `lab`
// to inline the work-in-progress scene instead, which is what gets published
// as an artifact for review.
const page = process.argv[2] === 'lab' ? 'lab' : 'ghostly';
const html = await readFile(path.join(dist, page, 'index.html'), 'utf8');
const assets = await readdir(path.join(dist, 'assets'));
// The demo is the only page with a script, so the build emits exactly one
// chunk. Anything else means a second page started shipping JS or the bundle
// got split; inlining just the first file would quietly ship a half-wired
// page, so stop instead.
const jsFiles = assets.filter((f) => f.endsWith('.js'));
if (jsFiles.length !== 1) {
  throw new Error(`expected one JS chunk in dist/assets, found ${jsFiles.length} -- check the rollup entries`);
}
const jsFile = jsFiles[0];

const js = await readFile(path.join(dist, 'assets', jsFile), 'utf8');
// A bundled string literal could contain a closing script tag and end the
// block early.
const inlineJs = `<script type="module">\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;

// A function replacer, not a string: minified bundles contain `$&` and `$\``,
// which String.replace would expand, splicing the original script tag back
// into the middle of the code.
const standalone = html
  .replace(/<link rel="modulepreload"[^>]*>/g, '')
  .replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, () => inlineJs);
await writeFile(path.join(dist, 'standalone.html'), standalone);

// Strip the document skeleton for hosts that wrap the page themselves.
const head = standalone.match(/<head>([\s\S]*?)<\/head>/)[1];
// The body tag carries attributes now (data-scene picks which world to build),
// so this cannot match a bare <body>. Failing loudly beats returning null and
// blowing up two lines later with nothing to say.
const bodyMatch = standalone.match(/<body([^>]*)>([\s\S]*?)<\/body>/);
if (!bodyMatch) throw new Error('no <body> found in the built page');
// Which world to build is a data attribute ON the body tag, and an artifact
// host supplies its own body, so that attribute does not survive the trip.
// Restate it as a line of script instead: losing it silently would put the
// whole work-in-progress scene into a page meant to carry only the ghost.
const sceneAttr = /data-scene="([^"]+)"/.exec(bodyMatch[1]);
const sceneShim = sceneAttr
  ? `<script>document.body.dataset.scene=${JSON.stringify(sceneAttr[1])}</script>\n`
  : '';
const body = sceneShim + bodyMatch[2];
const keptHead = head
  .split('\n')
  .filter((l) => !/<meta charset|<meta name="viewport"/.test(l))
  .join('\n')
  .trim();
await writeFile(path.join(dist, 'artifact.html'), `${keptHead}\n${body.trim()}\n`);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} kB`;
console.log(`dist/standalone.html  ${kb(standalone)}`);
console.log(`dist/artifact.html    ${kb(`${keptHead}\n${body}`)}`);
