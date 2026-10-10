// Drive the built site in a dedicated browser and prove the kernel runs.
//
// Two things must hold before anything else in this project matters:
//   1. real Octave executes and returns a numeric result
//   2. a plot produces a figure in the page
//
// Usage: node scripts/smoke.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.argv[2] || 'http://localhost:8191';
const SHOTS = 'shots';
const HEADED = process.env.HEADED === '1';

const cases = [
  {
    name: 'matrix',
    code: 'A = [1 2; 3 4]; disp(A * A)',
    // A * A is [7 10; 15 22]
    expect: (t) => /\b7\b/.test(t) && /\b10\b/.test(t) && /\b15\b/.test(t) && /\b22\b/.test(t),
    describe: 'disp(A * A) prints 7 10 15 22',
  },
  {
    name: 'plot',
    code: 'plot(1:10, (1:10).^2); title("squares")',
    expect: null, // judged by finding a figure in the DOM instead of text
    describe: 'plot(1:10) renders a figure',
  },
];

const run = async () => {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--window-position=0,0', '--window-size=1536,960'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  const results = [];

  for (const c of cases) {
    const url = `${BASE}/repl/index.html?kernel=xoctave&toolbar=1&code=${encodeURIComponent(c.code)}&execute=1`;
    process.stdout.write(`\n[${c.name}] ${c.describe}\n  ${url}\n`);

    const started = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

    // The kernel is ~150MB, so the first execution includes its download.
    let outputText = '';
    let figures = 0;
    let ok = false;
    const deadline = Date.now() + 480000;

    while (Date.now() < deadline) {
      const snap = await page.evaluate(() => {
        const out = Array.from(document.querySelectorAll('.jp-OutputArea-output'))
          .map((n) => n.textContent || '')
          .join('\n');
        const imgs = document.querySelectorAll(
          '.jp-OutputArea-output img, .jp-OutputArea-output canvas, .jp-OutputArea-output svg, .plot-container',
        ).length;
        return { out, imgs };
      });
      outputText = snap.out;
      figures = snap.imgs;

      if (c.expect ? c.expect(outputText) : figures > 0) {
        ok = true;
        break;
      }
      await page.waitForTimeout(3000);
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const shot = `${SHOTS}/${c.name}.png`;
    await page.screenshot({ path: shot, fullPage: true });

    results.push({ name: c.name, ok, seconds, figures, outputText: outputText.slice(0, 400), shot });
    process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'} in ${seconds}s (figures seen: ${figures})\n`);
    if (outputText.trim()) process.stdout.write(`  output: ${outputText.trim().slice(0, 300)}\n`);
  }

  await writeFile(`${SHOTS}/smoke.json`, JSON.stringify({ base: BASE, results, consoleErrors }, null, 2));
  await browser.close();

  process.stdout.write('\n==== summary ====\n');
  results.forEach((r) => process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.seconds}s  ${r.shot}\n`));
  if (consoleErrors.length) {
    process.stdout.write(`\nconsole errors (${consoleErrors.length}), first 5:\n`);
    consoleErrors.slice(0, 5).forEach((e) => process.stdout.write(`  ${e.slice(0, 200)}\n`));
  }

  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
};

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
