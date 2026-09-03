/**
 * Loads the exported web bundle in a real browser and reports any uncaught
 * error. Bundling proves the imports resolve; only this proves the app boots.
 */
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../.expo-export-web');
const PORT = 8099;

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, 'index.html');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    // wa-sqlite needs cross-origin isolation for its OPFS/SharedArrayBuffer path.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  });
  res.end(body);
});

(async () => {
  await new Promise((resolve) => server.listen(PORT, resolve));
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  const errors = [];
  const warnings = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    if (m.type() === 'warning') warnings.push(m.text());
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);

  const text = await page.evaluate(() => document.body.innerText.slice(0, 600));

  console.log('--- visible text ---');
  console.log(text.trim() || '(empty)');
  console.log('\n--- warnings ---');
  console.log(warnings.length ? warnings.slice(0, 5).join('\n') : '(none)');
  console.log('\n--- errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');

  await browser.close();
  server.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => {
  console.error('harness failed:', e);
  process.exit(2);
});
