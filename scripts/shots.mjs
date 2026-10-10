// Screenshot the notebook at desktop and phone widths, and run the
// accessibility checks that can be made without a human eye.
//
// Code and grep are not proof of pixels, so this is what decides whether a
// visual change is done.
//
// Usage: node scripts/shots.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.argv[2] || 'http://localhost:8191';
const SHOTS = 'shots';

const WIDTHS = [
  { name: 'desktop', width: 1536, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

/** Relative luminance of an rgb() string, per WCAG. */
function luminance(rgb) {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m) return null;
  const [r, g, b] = m.slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const run = async () => {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--window-position=0,0'] });

  const report = { base: BASE, widths: [], findings: [] };

  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/notebooks/index.html?path=octave-demo.ipynb`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await page.locator('.oh-save-m').first().waitFor({ state: 'visible', timeout: 90000 });
    // Let fonts and layout settle so the screenshot is not caught mid-paint.
    await page.waitForTimeout(2500);

    const facts = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const btn = document.querySelector('.oh-save-m');
      const btnStyle = btn ? getComputedStyle(btn) : null;

      // Anything the page scrolls sideways for is a layout failure on a phone.
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;

      // Tap targets must be at least 24x24 CSS px under WCAG 2.2 AA.
      const small = [];
      document
        .querySelectorAll('.jp-Toolbar button, .jp-Toolbar jp-button, .oh-save-m, .oh-open-m')
        .forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width && r.height && (r.width < 24 || r.height < 24)) {
            small.push(`${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        });

      return {
        fontFamily: body.fontFamily,
        bodyBg: body.backgroundColor,
        btnColor: btnStyle ? btnStyle.color : null,
        btnBg: btnStyle ? btnStyle.backgroundColor : null,
        overflow,
        small,
      };
    });

    const shot = `${SHOTS}/${w.name}.png`;
    await page.screenshot({ path: shot, fullPage: false });

    const usesSiteFont = /system-ui|Segoe UI/i.test(facts.fontFamily);
    const ratio =
      facts.btnColor && facts.btnBg && facts.btnBg !== 'rgba(0, 0, 0, 0)'
        ? contrast(facts.btnColor, facts.btnBg)
        : contrast(facts.btnColor || 'rgb(0,0,0)', facts.bodyBg || 'rgb(255,255,255)');

    report.widths.push({ ...w, shot, ...facts, buttonContrast: ratio });

    if (!usesSiteFont) {
      report.findings.push(`${w.name}: body font is ${facts.fontFamily}, not the site stack`);
    }
    if (facts.overflow > 0) {
      report.findings.push(`${w.name}: page scrolls sideways by ${facts.overflow}px`);
    }
    if (facts.small.length) {
      report.findings.push(
        `${w.name}: ${facts.small.length} target(s) under 24px: ${facts.small.slice(0, 4).join(', ')}`,
      );
    }
    if (ratio !== null && ratio < 4.5) {
      report.findings.push(`${w.name}: button contrast ${ratio.toFixed(2)}:1, under AA 4.5`);
    }

    process.stdout.write(
      `${w.name} ${w.width}x${w.height}\n` +
        `  font: ${facts.fontFamily.slice(0, 50)}\n` +
        `  bg: ${facts.bodyBg}\n` +
        `  sideways overflow: ${facts.overflow}px\n` +
        `  small targets: ${facts.small.length}\n` +
        `  button contrast: ${ratio ? ratio.toFixed(2) + ':1' : 'n/a'}\n` +
        `  -> ${shot}\n`,
    );

    await ctx.close();
  }

  await browser.close();
  await writeFile(`${SHOTS}/shots.json`, JSON.stringify(report, null, 2));

  process.stdout.write('\n');
  if (report.findings.length) {
    process.stdout.write(`${report.findings.length} finding(s):\n`);
    report.findings.forEach((f) => process.stdout.write(`  - ${f}\n`));
    process.exitCode = 1;
  } else {
    process.stdout.write('no findings\n');
  }
};

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
