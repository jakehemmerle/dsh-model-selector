// Probe (final): dsh web + plugin row; dismiss the alpha's process-local
// Preview Notice; diagnose the launch page; drive a prompt to the reply.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startMockLlm, lastUserText } from './rig/mock-llm.mjs';
import { makeProfile, startWeb } from './rig/rig.mjs';

const mock = await startMockLlm({ script: () => ({ text: 'pong from mock-alpha' }) });
const pluginPath = fileURLToPath(new URL('../index.js', import.meta.url));
const { join } = await import("node:path");
function profileHome() { return "/tmp/dsh-ms-web-home-probe"; }
const { mkdirSync } = await import("node:fs");
const documents = join(profileHome(), "Documents");
mkdirSync(documents, { recursive: true });
const profile = makeProfile({ kind: "web", mock, rows: [{ id: "workspace-controller", config: { documentsDirectory: documents } }], plugins: [{ id: "dsh-model-selector", name: pluginPath, config: {} }] });
const dump = await profile.dumpConfig();
console.log('row in dump-config:', dump.stdout.includes('dsh-model-selector'));
const web = await startWeb(profile);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url().slice(0, 100)}`));
const body = () => page.locator('body').innerText().then((t) => JSON.stringify(t.replace(/\s+/g, ' ').slice(0, 300)));
try {
  await page.goto(web.url, { waitUntil: 'networkidle', timeout: 45000 });
  const notice = page.locator('[role="dialog"][aria-label="Preview Notice"]');
  await notice.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.evaluate(() => {
    for (const root of document.querySelectorAll('[role="presentation"]')) {
      if (root.querySelector('[role="dialog"][aria-label="Preview Notice"]')) root.remove();
    }
  });
  await page.waitForTimeout(400);
  console.log('notice left:', await notice.count());
  const probe = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /new session/i.test(b.getAttribute('aria-label') ?? ''));
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { found: true, atPoint: el ? `${el.tagName}.${String(el.className).slice(0, 40)}` : 'none', masks: document.querySelectorAll('[class*="_mask"]').length };
  });
  console.log('newsession probe:', JSON.stringify(probe));
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button[aria-label="New session"]')];
    btns.at(-1)?.click();
  });
  await page.waitForTimeout(1000);
  console.log('body after new-session:', await body());
  const composer = page.locator('[data-composer-input="true"]').last();
  console.log('composer phase:', await composer.getAttribute('data-phase'), '| popup:', await composer.getAttribute('aria-haspopup'));
  if ((await composer.getAttribute('data-phase')) === 'inert') {
    await composer.click();
    await page.waitForTimeout(500);
    const items = await page.getByRole('menuitem').allTextContents().catch(() => []);
    console.log('menu items:', JSON.stringify(items.slice(0, 6)));
    if (items.length > 0) await page.getByRole('menuitem').first().click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    console.log('composer phase after menu:', await composer.getAttribute('data-phase'));
  }
  const composers = await page.locator('[data-composer-input="true"]').all();
  let active = null;
  for (const [i, c] of composers.entries()) {
    console.log(`composer[${i}] phase:`, await c.getAttribute('data-phase'), '| visible:', await c.isVisible());
    if ((await c.getAttribute('data-phase')) === 'plain' && (await c.isVisible())) active = c;
  }
  assert.ok(active, 'an active plain composer exists');
  await active.click();
  await page.keyboard.type('probe prompt', { delay: 15 });
  await page.waitForTimeout(300);
  console.log('composer text after type:', JSON.stringify((await active.innerText()).slice(0, 60)));
  await page.locator('button[aria-label="Send message"]').click();
  await page.waitForTimeout(4000);
  console.log('requests after enter:', mock.requests.length);
  await page.getByText('pong from mock-alpha').first().waitFor({ timeout: 20000 });
  console.log('reply visible: true | turns:', mock.turns().length);
  await page.screenshot({ path: '/tmp/web-probe-final.png' });
} finally {
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
  await web.stop();
  profile.dispose();
  await mock.close();
}