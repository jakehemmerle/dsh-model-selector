// Probe (run to shape the P-25 positive proof): where does the real dsh web
// Plugins page surface a profile-inserted plugin row on 0.2.1-alpha.2?
import { chromium } from 'playwright';
import { startMockLlm } from './rig/mock-llm.mjs';
import { makeProfile, startWeb } from './rig/rig.mjs';

const mock = await startMockLlm({ script: () => ({ text: 'pong' }) });
const pluginPath = new URL('../index.js', import.meta.url).pathname;
const profile = makeProfile({ kind: 'web', mock, rows: [{ id: 'workspace-controller', config: { documentsDirectory: '/tmp/dsh-ms-documents' } }], plugins: [{ id: 'dsh-model-selector', name: pluginPath, config: {} }] });
const web = await startWeb(profile);
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(web.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);
  const notice = page.locator('[role="dialog"][aria-label="Preview Notice"]');
  await notice.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.evaluate(() => { for (const root of document.querySelectorAll('[role="presentation"]')) { if (root.querySelector('[role="dialog"]')) root.remove(); } });
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === 'Plugins'); b?.click(); });
  await page.waitForTimeout(1200);
  let text = await page.locator('body').innerText();
  console.log('has-selector:', /model-selector/i.test(text));
  const btns = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().slice(0, 24)).filter(Boolean));
  console.log('buttons:', JSON.stringify([...new Set(btns)].slice(0, 40)));
  await page.evaluate(() => { const scrollers = [...document.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 200); for (const s of scrollers) s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(800);
  text = await page.locator('body').innerText();
  console.log('after-scroll has-selector:', /model-selector/i.test(text));
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /add plugin/i.test(x.textContent ?? '')); b?.click(); });
  await page.waitForTimeout(1000);
  text = await page.locator('body').innerText();
  console.log('dialog has-selector:', /model-selector/i.test(text));
  console.log('dialog text:', JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 500)));
  await page.screenshot({ path: '/tmp/plugins-page.png', fullPage: true });
} finally {
  await browser.close();
  await web.stop();
  profile.dispose();
  await mock.close();
}
