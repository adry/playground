// Builds dist-artifact/hemma-agents.html: the demo dashboard as one file,
// scripts and styles inlined, for publishing as a single shareable page.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';

execSync('npx vite build --base ./ --outDir dist-artifact/build', { stdio: 'inherit' });
const dir = new URL('./dist-artifact/build/assets/', import.meta.url);
const files = await readdir(dir);
const js = await readFile(new URL(files.find((f) => f.endsWith('.js')), dir), 'utf8');
const css = await readFile(new URL(files.find((f) => f.endsWith('.css')), dir), 'utf8');
const page = `<title>Hemma for agents</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
await mkdir(new URL('./dist-artifact/', import.meta.url), { recursive: true });
await writeFile(new URL('./dist-artifact/hemma-agents.html', import.meta.url), page);
console.log(`dist-artifact/hemma-agents.html ${(page.length / 1024).toFixed(0)} KB`);
