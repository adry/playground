import { createServer } from 'vite';
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Boots the lab in a real browser and hands back a page whose window.__lab API
// can be stepped frame by frame.

function resolveChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    const dir = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().pop();
    if (dir) {
      const bin = path.join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(bin)) return bin;
    }
  }
  return undefined; // let Playwright resolve its own download
}

export async function openLab({
  width,
  height,
  verbose = false,
  gpu = process.env.LAB_GPU === '1',
  entry = '/',
  query = 'capture=1',
  readyFlag = '__labReady',
} = {}) {
  const server = await createServer({
    configFile: path.resolve('vite.config.js'),
    server: {
      port: 0,
      host: '127.0.0.1',
      // A render can run for an hour. HMR would reload the page mid-capture the
      // moment a source file is touched, destroying the execution context and
      // the run with it.
      hmr: false,
      watch: null,
    },
    logLevel: 'silent',
  });
  await server.listen();
  const url = server.resolvedUrls.local[0];

  const browser = await chromium.launch({
    executablePath: resolveChrome(),
    args: [
      '--no-sandbox',
      '--in-process-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      // Headless containers have no display for ANGLE to bind to, so WebGL is
      // rasterised on the CPU by SwiftShader. Slower per frame, but the output
      // is pixel-identical and the recorder never depends on wall-clock speed.
      // Pass gpu:true (or LAB_GPU=1) on a machine with a real GPU.
      ...(gpu ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    ],
  });

  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));
  page.on('console', (m) => {
    // Shader compile failures arrive here as console errors. Surfacing them
    // always beats staring at a black frame wondering why.
    if (verbose || m.type() === 'error' || m.type() === 'warning') console.log(`  [page] ${m.text()}`);
  });

  // The shipped pages carry an analytics tag. A capture run has no business
  // firing it, and in a sandboxed environment the request does not fail fast:
  // it hangs on the proxy, so `waitUntil: 'load'` sat there until the timeout
  // even though the scene had been ready since the first frame. Blocked at the
  // route, and the wait moved to domcontentloaded, because the readyFlag below
  // is the real gate and always was.
  await page.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.abort());

  const base = url.replace(/\/$/, '');
  // 120s rather than Playwright's 30s default. The first navigation pays for
  // vite transforming the whole module graph cold, and on a loaded machine
  // (several capture runs in parallel, all of them software-rasterising) that
  // alone has taken over a minute. A slow cold start is not a hung page.
  await page.goto(`${base}${entry}?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction((flag) => window[flag] === true, readyFlag, { timeout: 60000 });

  const renderer = await page.evaluate(() => {
    const gl = document.getElementById('view').getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });

  return {
    page,
    renderer,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

export async function grabPNG(page) {
  const dataUrl = await page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

export const PRESETS = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1920, height: 1080 },
  vertical: { width: 1080, height: 1920 },
};
