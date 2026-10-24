// Test harness: drives the plugin ONLY through its public surface.
//
//   plugin module  --(real cordis Context, real dsh-TUI TuiSceneRuntime and
//                     TuiShortcutRuntime)-->  registered scene + shortcut
//   host side      --(dsh-TUI's own createChannelSceneOutlet + ink render into
//                     a headless xterm)-->  the frame a user would see
//   user input     --(raw terminal bytes on stdin)-->  keystrokes
//   observable     --  frame text, ChannelUi calls (switchModel/notify/close),
//                      and the files under $HOME/.dsh-tui
//
// Host packages resolve from test/.host (scripts/link-host.mjs), so the suite
// runs against whichever dsh / dsh-TUI build is linked there.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import xterm from '@xterm/headless';

const HOST = new URL('./.host/node_modules/', import.meta.url);
const TUI = new URL('@deepseek-harness-tui/dsh-tui/', HOST);
const hostImport = (rel) => import(new URL(rel, TUI).href);

export const cordis = await import(new URL('@deepseek-ai/cordis/lib/index.js', HOST).href);
export const tuiScenes = await hostImport('lib/types/dsh-adapter/scenes.js');
export const tuiShortcuts = await hostImport('lib/types/dsh-adapter/shortcuts.js');
export const tuiOutlet = await hostImport('lib/types/dsh-adapter/channel-scene-outlet.js');
export const tuiUi = await hostImport('lib/types/ui.js');
export const tuiRecents = await hostImport('lib/types/modelRecents.js');
export const tuiUiPolicy = await hostImport('lib/types/adapter/channel/ui-policy.js');
export const React = (await import(new URL('node_modules/react/index.js', TUI).href)).default;
export const tuiPackageJson = JSON.parse(readFileSync(new URL('package.json', TUI), 'utf8'));

const plugin = await import('../index.js');
export { plugin };

export const KEYS = {
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D',
  pageUp: '\x1b[5~', pageDown: '\x1b[6~', home: '\x1b[H', end: '\x1b[F',
  enter: '\r', tab: '\t', shiftTab: '\x1b[Z', space: ' ', backspace: '\x7f',
  escape: '\x1b', ctrlU: '\x15', ctrlW: '\x17', ctrlC: '\x03',
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh $HOME with a .dsh-tui data dir; restores the old HOME on dispose. */
export function isolatedHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-model-selector-'));
  mkdirSync(join(dir, '.dsh-tui'), { recursive: true });
  const prior = process.env.HOME;
  process.env.HOME = dir;
  return {
    dir,
    dataDir: join(dir, '.dsh-tui'),
    read(name) {
      try { return JSON.parse(readFileSync(join(dir, '.dsh-tui', name), 'utf8')); } catch { return undefined; }
    },
    write(name, value) {
      writeFileSync(join(dir, '.dsh-tui', name), typeof value === 'string' ? value : JSON.stringify(value));
    },
    dispose() {
      process.env.HOME = prior;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * The ChannelUi slice the scene may touch, recorded. Shape follows
 * dsh-TUI's adapter/ports/channel-ui.d.ts.
 */
export function fakeChannel({
  models, providers, provider = '', model = '', working = false, switchResult = true,
  // dsh-TUI 0.15 ChannelCapabilities (adapter/ports/channel-view.d.ts): the DSH
  // kernel reports backendId 'dsh' and provider-tab model routes.
  backendCapabilities = { backendId: 'dsh', models: true, modelRoutes: 'providers' },
}) {
  const calls = { switchModel: [], notify: [], closePluginScene: 0, listModels: 0 };
  const channel = {
    provider, model, working, backendCapabilities,
    modelDisplay: model,
    async listModels() { calls.listModels += 1; return models.map((m) => ({ ...m })); },
    async listProviders() { return providers.map((p) => ({ ...p })); },
    async switchModel(p, m) {
      calls.switchModel.push({ provider: p, id: m });
      if (switchResult) { channel.provider = p; channel.model = m; }
      return switchResult;
    },
    notify(text, options) { calls.notify.push({ text, color: options?.color }); return () => {}; },
    closePluginScene() { calls.closePluginScene += 1; },
    subscribe() { return () => {}; },
  };
  return { channel, calls };
}

/** Optional fake `llm` service (dsh-llm's LlmRuntime.resolveModelInfo). */
export function fakeLlmService(infoFor) {
  return class FakeLlm extends cordis.Service {
    constructor(ctx) { super(ctx, 'llm'); }
    async resolveModelInfo(provider, model) { return infoFor(provider, model); }
  };
}

class FakeStdin extends PassThrough {
  isTTY = true;
  setRawMode() { return this; }
  ref() { return this; }
  unref() { return this; }
}

/**
 * Boot a cordis root with dsh-TUI's scene + shortcut runtimes, load the plugin
 * (as an inserted cordis plugin, exactly like cordis.patch.yml does), and
 * expose host-side handles.
 */
export async function bootHost({ config = {}, llm } = {}) {
  const warnings = [];
  const root = new cordis.Context();
  root.on('internal/warning', (...args) => warnings.push(args.map(String).join(' ')));
  await root.plugin(tuiScenes.TuiSceneRuntime);
  await root.plugin(tuiShortcuts.TuiShortcutRuntime);
  if (llm) await root.plugin(llm);
  const fiber = root.plugin(plugin, config);
  await fiber;
  await sleep(0);
  const scenes = tuiScenes.getHostSceneRuntime(root.get('tuiScenes'));
  const shortcuts = tuiShortcuts.getHostShortcuts(root.get('tuiShortcuts'));
  return {
    root, fiber, scenes, shortcuts, warnings,
    async unload() { await fiber.dispose?.(); await sleep(0); },
  };
}

/**
 * Open the plugin's scene the way dsh-TUI does (host.open + the host's own
 * scene outlet) and render it full-screen into a headless terminal.
 */
export async function openScene(host, channel, { cols = 120, rows = 30 } = {}) {
  const term = new xterm.Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  class Out extends Writable {
    columns = cols; rows = rows; isTTY = true;
    _write(chunk, _enc, cb) { term.write(String(chunk), cb); }
  }
  class Err extends Writable { isTTY = true; _write(_c, _e, cb) { cb(); } }
  const stdin = new FakeStdin();
  const stdout = new Out();
  const opened = host.scenes.open(plugin.SCENE_ID);
  if (!opened) throw new Error(`scene ${plugin.SCENE_ID} did not open`);
  // channel.closePluginScene is what the host outlet wires `close` to.
  const realClose = channel.closePluginScene;
  channel.closePluginScene = () => { realClose.call(channel); host.scenes.close(); };
  const renderScene = tuiOutlet.createChannelSceneOutlet(() => host.scenes.active);
  function Root() {
    const [, bump] = React.useState(0);
    React.useEffect(() => host.scenes.subscribe(() => bump((n) => n + 1)), []);
    const active = host.scenes.active;
    return React.createElement(tuiUi.ThemeProvider, { theme: 'dark' },
      active ? renderScene(active.id, channel) : React.createElement(tuiUi.Text, null, '<<scene closed>>'));
  }
  const app = await tuiUi.render(React.createElement(tuiUi.AlternateScreen, null, React.createElement(Root)), {
    stdout, stdin, stderr: new Err(), exitOnCtrlC: false, patchConsole: false,
  });

  function lines() {
    const buffer = term.buffer.active;
    const out = [];
    for (let y = 0; y < rows; y += 1) out.push(buffer.getLine(y)?.translateToString(true) ?? '');
    return out;
  }
  const text = () => lines().join('\n');
  /** Resolve once the frame stops changing (or after `max` ms). */
  async function quiet({ min = 25, stable = 3, max = 1500 } = {}) {
    await sleep(min);
    let last = text();
    let same = 0;
    const deadline = Date.now() + max;
    while (Date.now() < deadline) {
      await sleep(10);
      const now = text();
      if (now === last) { same += 1; if (same >= stable) return; } else { same = 0; last = now; }
    }
  }
  async function until(predicate, max = 3000) {
    const deadline = Date.now() + max;
    while (Date.now() < deadline) {
      if (predicate(text())) return;
      await sleep(10);
    }
    throw new Error(`frame never satisfied predicate:\n${text()}`);
  }
  async function press(seq) {
    stdin.write(seq);
    // A bare ESC is held by the key parser until its escape timeout.
    await quiet({ min: seq === KEYS.escape ? 120 : 25 });
  }
  async function type(str) {
    for (const ch of str) await press(ch);
  }
  await until((t) => t.includes('Models'));
  await quiet();
  return {
    term, stdin, lines, text, quiet, until, press, type,
    get open() { return host.scenes.active?.id === plugin.SCENE_ID; },
    frame: () => parseFrame(lines()),
    async unmount() { await app.unmount(); },
  };
}

/**
 * Parse the scene's frame grammar (see README "Frame layout"):
 *   ╭─ Models ─…┬─…╮
 *   │ <body>   │ <sidebar> │
 *   ├─…┴─…┤
 *   │ <hints> │
 *   ╰─…╯
 * Body: the search line (`⌕ > query  n/total`), list rows
 * (`❯ ★ provider/id ✓  ctx`), an optional empty-state line, the detail line.
 * Sidebar: entries `❯ ★ Starred  3`.
 */
export function parseFrame(lines) {
  const split = lines.map((line) => line.split('│'));
  const twoPane = split.filter((cells) => cells.length >= 4);
  const body = twoPane.map((cells) => cells[1]);
  const side = twoPane.map((cells) => cells[2]);
  const searchLine = body.find((cell) => cell.includes('⌕')) ?? '';
  const search = /⌕\s*>\s?(.*?)(?:\s{2,}(\d+)\/(\d+))?\s*$/u.exec(searchLine);
  let query = (search?.[1] ?? '').trimEnd();
  if (query.startsWith('type a model name')) query = '';
  const rows = [];
  for (const cell of body) {
    const m = /^\s?([❯ ])\s([★ ])\s(\S+?\/\S+?)(?:\s(✓))?(?:\s{2,}(.*?))?\s*$/u.exec(cell);
    if (!m || cell.includes('⌕')) continue;
    rows.push({ focused: m[1] === '❯', starred: m[2] === '★', selector: m[3], current: m[4] === '✓', extra: m[5] ?? '' });
  }
  const sidebar = [];
  for (const cell of side) {
    const m = /^\s?([❯ ])\s(\S)\s(.+?)\s+(\d+)?\s*$/u.exec(cell);
    if (!m || /^[\s─]*$/u.test(cell)) continue;
    sidebar.push({ active: m[1] === '❯', icon: m[2], label: m[3].trim(), count: m[4] === undefined ? undefined : Number(m[4]) });
  }
  const sidebarX = (() => {
    const row = lines.find((line) => line.split('│').length >= 4);
    if (!row) return -1;
    const first = row.indexOf('│');
    return row.indexOf('│', first + 1);
  })();
  return {
    query,
    matches: search?.[2] === undefined ? undefined : Number(search[2]),
    total: search?.[3] === undefined ? undefined : Number(search[3]),
    rows,
    focused: rows.find((row) => row.focused),
    sidebar,
    scope: sidebar.find((entry) => entry.active)?.label,
    empty: body.some((cell) => cell.includes('No matching models')),
    detail: body.find((cell) => cell.includes(' · ')) ?? '',
    sidebarX,
    title: lines[0] ?? '',
    hints: lines.find((line) => line.includes('esc')) ?? '',
  };
}

/** Normalize like the selector's search: lowercase, non-alnum runs → spaces. */
export function words(text) {
  return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, ' ').trim().split(' ').filter(Boolean);
}

/** Subsequence test used as the search soundness oracle. */
export function isSubsequence(needle, haystack) {
  let i = 0;
  for (const ch of haystack) if (ch === needle[i]) i += 1;
  return i === needle.length;
}
