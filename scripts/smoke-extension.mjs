// Prove the toolbar extension works in a real browser against the built site.
//
// Checks, in order:
//   1. the demo notebook opens and both buttons are on the toolbar
//   2. Save .m produces a download whose contents are converted MATLAB
//   3. the conversion report appears and names what it changed
//
// The kernel is never started, so this stays fast. scripts/smoke.mjs covers
// execution and plotting.
//
// Usage: node scripts/smoke-extension.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const BASE = process.argv[2] || 'http://localhost:8191';
const SHOTS = 'shots';
const HEADED = process.env.HEADED === '1';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
};

const run = async () => {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--window-position=0,0', '--window-size=1536,960'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1536, height: 900 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  const url = `${BASE}/notebooks/index.html?path=octave-demo.ipynb`;
  process.stdout.write(`opening ${url}\n`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // JupyterLab 4 renders toolbar items as <jp-button> web components, not
  // <button>, so match on the classes the extension sets instead.
  const saveBtn = page.locator('.oh-save-m').first();
  const openBtn = page.locator('.oh-open-m').first();
  let buttonsThere = false;
  try {
    await saveBtn.waitFor({ state: 'visible', timeout: 90000 });
    await openBtn.waitFor({ state: 'visible', timeout: 15000 });
    buttonsThere = true;
  } catch {
    buttonsThere = false;
  }
  check('both toolbar buttons render', buttonsThere);

  let text = '';
  if (buttonsThere) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }).catch(() => null),
      saveBtn.click(),
    ]);

    check(
      'Save .m starts a download',
      !!download,
      download ? download.suggestedFilename() : 'no download event',
    );

    if (download) {
      const path = `${SHOTS}/${download.suggestedFilename()}`;
      await download.saveAs(path);
      text = await readFile(path, 'utf8');

      check('file is named .m', download.suggestedFilename().endsWith('.m'), download.suggestedFilename());
      check('cells became %% sections', text.includes('%% Cell'));
      check('!= converted to ~=', text.includes('~=') && !/[^~]!=/.test(text));
      check('+= expanded', /total = total \+ i;/.test(text));
      check('endif and endfor collapsed', !/\bendif\b/.test(text) && !/\bendfor\b/.test(text));
      check('printf became fprintf', text.includes('fprintf(') && !/[^f]printf\(/.test(text));
      check('CRLF line endings', text.includes('\r\n'));
      check('matrix code survived verbatim', text.includes('A = [1 2; 3 4];'));
    }

    const dialog = page.locator('.oh-report');
    const reported = await dialog
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check('conversion report shown', reported);
    if (reported) {
      const reportText = (await dialog.first().textContent()) || '';
      check('report names a line number', /line \d+/.test(reportText), reportText.slice(0, 120));
    }
  }

  await page.screenshot({ path: `${SHOTS}/extension.png`, fullPage: true });
  await writeFile(
    `${SHOTS}/smoke-extension.json`,
    JSON.stringify({ base: BASE, checks, consoleErrors, savedText: text.slice(0, 1200) }, null, 2),
  );
  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  process.stdout.write(`\n${checks.length - failed.length}/${checks.length} passed\n`);
  if (consoleErrors.length) {
    process.stdout.write(`console errors (${consoleErrors.length}), first 3:\n`);
    consoleErrors.slice(0, 3).forEach((e) => process.stdout.write(`  ${e.slice(0, 200)}\n`));
  }
  process.exitCode = failed.length ? 1 : 0;
};

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
