// Final driver: pre-create the default workspace via the RPC wire format,
// then drive the client: notice removal -> New session -> tab-focus the
// composer -> type -> Enter -> reply from the mock.
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startMockLlm } from './rig/mock-llm.mjs';
import { makeProfile, startWeb } from './rig/rig.mjs';

const mock = await startMockLlm({ script: () => ({ text: 'pong from mock-alpha' }) });
const pluginPath = fileURLToPath(new URL('../index.js', import.meta.url));
const documents = '/tmp/dsh-ms-documents';
mkdirSync(documents, { recursive: true });
const profile = makeProfile({ kind: 'web', mock, rows: [{ id: 'workspace-controller', config: { documentsDirectory: documents } }], plugins: [{ id: 'dsh-model-selector', name: pluginPath, config: {} }] });
const web = await startWeb(profile);
const init = await web.fetch('/api/workspace/initializeDefault', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'workspace/initializeDefault', payload: { args: {} } }),
});
console.log('initializeDefault:', init.status, JSON.stringify((await init.text()).slice(0, 160)));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url().slice(0, 100)}`));
try {
  await page.goto(web.url, { waitUntil: 'networkidle', timeout: 45000 });
  const notice = page.locator('[role="dialog"][aria-label="Preview Notice"]');
  await notice.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.evaluate(() => {
    for (const root of document.querySelectorAll('[role="presentation"]')) {
      if (root.querySelector('[role="dialog"]')) root.remove();
    }
  });
  let phase = 'inert';
  for (let i = 0; i < 10 && phase !== 'plain'; i += 1) {
    await page.evaluate(() => { [...document.querySelectorAll('button[aria-label="New session"]')].at(-1)?.click(); });
    await page.waitForTimeout(800);
    phase = await page.evaluate(() => [...document.querySelectorAll('[data-composer-input]')].map((c) => c.getAttribute('data-phase')).join(','));
  }
  console.log('composer phases:', phase);
  const typed = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('[data-composer-input]')].filter((c) => c.getAttribute('data-phase') === 'plain');
    const c = cs.at(-1);
    if (!c) return 'no-composer';
    c.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(c);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('insertText', false, 'probe prompt');
    return `${ok ? 'inserted' : 'insert-failed'}: active=${document.activeElement === c} ${c.innerText.slice(0, 60)}`;
  });
  console.log('composer text:', JSON.stringify(typed));
  await page.keyboard.press('Enter');
  await page.getByText('pong from mock-alpha').first().waitFor({ timeout: 25000 });
  console.log('reply visible: true | turns:', mock.turns().length, '| requests:', mock.requests.length);
} finally {
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
  await web.stop();
  profile.dispose();
  await mock.close();
}
