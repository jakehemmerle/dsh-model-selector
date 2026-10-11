// End-to-end rig: a real `dsh --profile e2e` running dsh-TUI in tmux, against
// an isolated HOME / DSH_HOME and a local OpenAI-compatible mock provider.
//
//   DSH_TUI_DIR   dsh-TUI package to mount (the nix-config patched build)
//   PLUGIN_DIR    plugin directory to insert (default: this checkout)
//   DSH_BIN       dsh launcher (default: `dsh` on PATH)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** OpenAI chat-completions mock. Records each request's model; can hold streams open. */
export async function startMock() {
  const requests = [];
  let hold = false;
  const held = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
      const json = JSON.parse(body || '{}');
      requests.push({ model: json.model, messages: json.messages });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const chunk = (delta, finish = null) => `data: ${JSON.stringify({
        id: 'c', object: 'chat.completion.chunk', created: 0, model: json.model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
      const finish = () => {
        res.write(chunk({ content: `pong from ${json.model}` }));
        res.write(chunk({}, 'stop'));
        res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: json.model, choices: [], usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 } })}\n\n`);
        res.end('data: [DONE]\n\n');
      };
      res.write(chunk({ role: 'assistant', content: '' }));
      if (hold) held.push(finish); else finish();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    requests,
    hold(on) { hold = on; if (!on) while (held.length) held.shift()(); },
    async close() { this.hold(false); await new Promise((r) => server.close(r)); },
  };
}

const MODELS = {
  mock: [
    { id: 'mock-alpha', name: 'Mock Alpha', contextWindow: 128000, maxTokens: 8000, input: ['text'] },
    { id: 'mock-beta', name: 'Mock Beta', contextWindow: 200000, maxTokens: 16000, input: ['text', 'image'] },
    { id: 'mock-gamma-1-5', name: 'Mock Gamma 1.5', contextWindow: 1000000, maxTokens: 64000, input: ['text'] },
  ],
  mock2: [
    { id: 'other-delta', name: 'Other Delta', contextWindow: 64000, maxTokens: 4000, input: ['text'] },
  ],
};

/** Isolated HOME + DSH_HOME with an `e2e` profile mirroring home/dsh.nix's dsh-tui profile. */
export function makeProfile({ port }) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ms-e2e-'));
  const home = join(root, 'home');
  const dshHome = join(home, '.dsh');
  const profile = join(dshHome, 'profiles', 'e2e');
  const work = join(root, 'work');
  for (const dir of [profile, work, join(home, '.dsh-tui')]) mkdirSync(dir, { recursive: true });
  const tuiDir = process.env.DSH_TUI_DIR;
  if (!tuiDir) throw new Error('set DSH_TUI_DIR to the patched dsh-tui package');
  const pluginDir = resolve(process.env.PLUGIN_DIR ?? join(here, '..', '..'));
  const tuiPkg = JSON.parse(readFileSync(join(tuiDir, 'package.json'), 'utf8'));
  const dshVersion = process.env.DSH_VERSION ?? '0.2.1-alpha.2';

  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-e2e', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui'] } },
  }));
  writeFileSync(join(profile, 'compatibility.json'), JSON.stringify({ [`@deepseek-harness-tui/dsh-tui@${tuiPkg.version}`]: [dshVersion] }));
  writeFileSync(join(profile, 'cordis.yml'), '[]\n');
  const provider = (id, label) => ({
    api: 'openai-completions', apiKeyEnv: 'MOCK_KEY', baseURL: `http://127.0.0.1:${port}/v1`,
    displayName: label, models: MODELS[id],
  });
  const rows = [
    { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', config: { provider: 'mock', model: 'mock-alpha' } },
    { id: 'permission', name: '@deepseek-ai/dsh-permission-presets', config: { defaultPreset: 'danger-full-access', presets: { 'danger-full-access': { approval: 'never', sandbox: 'danger-full-access' } } } },
    { id: 'session-log-deepseek', name: '@deepseek-ai/dsh-session-log-deepseek', config: { enabled: false } },
    { id: 'session-telemetry-otel', name: '@deepseek-ai/dsh-session-telemetry-otel', config: { mode: 'DISABLED' } },
    { id: 'plugin-package-inventory-deepseek', name: '@deepseek-ai/dsh-plugin-package-inventory-deepseek', config: { enabled: false } },
    { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: { mock: provider('mock', 'Mock Local'), mock2: provider('mock2', 'Mock Two') } } },
    // Same row home/dsh.nix inserts (Alt+P reaches the scene through /model).
    { insert: [{ id: 'dsh-model-selector', name: join(pluginDir, 'index.js'), config: { shortcut: false } }] },
  ];
  writeFileSync(join(profile, 'cordis.patch.yml'), `${rows.map((r) => `- ${JSON.stringify(r)}`).join('\n')}
- id: dsh-tui
  config:
    fullscreen: true
    lang: en
    terminalImages: false
`);
  mkdirSync(join(profile, 'node_modules', '@deepseek-harness-tui'), { recursive: true });
  symlinkSync(tuiDir, join(profile, 'node_modules', '@deepseek-harness-tui', 'dsh-tui'));

  const seed = { 'onboarding.json': { completed: true, version: 1 }, 'lang.json': { lang: 'en' }, 'home.json': { seen: true },
    'theme.json': { theme: 'dark' }, 'model.json': { provider: 'mock', model: 'mock-alpha' } };
  for (const [name, value] of Object.entries(seed)) writeFileSync(join(home, '.dsh-tui', name), JSON.stringify(value));
  return {
    root, home, dshHome, work,
    read(name) { try { return JSON.parse(readFileSync(join(home, '.dsh-tui', name), 'utf8')); } catch { return undefined; } },
    logs() {
      const dir = join(dshHome, 'logs');
      try { return readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n'); } catch { return ''; }
    },
    dispose() { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); },
  };
}

const tmux = (...args) => execFileSync('tmux', args, { encoding: 'utf8' });

/** One dsh-TUI instance in a detached tmux session. */
export function startTui(profile, { name = `dsh-ms-e2e-${process.pid}-${Date.now()}`, cols = 150, rows = 40 } = {}) {
  const bin = process.env.DSH_BIN ?? 'dsh';
  const env = [`HOME=${profile.home}`, `DSH_HOME=${profile.dshHome}`, 'MOCK_KEY=mock', 'DSH_TELEMETRY_DISABLED=1', 'TERM=xterm-256color'];
  tmux('new-session', '-d', '-s', name, '-x', String(cols), '-y', String(rows), '-c', profile.work,
    `env ${env.join(' ')} ${bin} --profile e2e; echo "[[exited $?]]"; sleep 600`);
  const capture = () => tmux('capture-pane', '-p', '-t', name);
  return {
    name,
    capture,
    keys(...keys) { tmux('send-keys', '-t', name, ...keys); },
    text(str) { tmux('send-keys', '-t', name, '-l', str); },
    async waitFor(pattern, { timeout = 30000, not = false } = {}) {
      const deadline = Date.now() + timeout;
      let last = '';
      while (Date.now() < deadline) {
        last = capture();
        if (pattern.test(last) !== not) return last;
        await sleep(150);
      }
      throw new Error(`timed out waiting for ${not ? 'absence of ' : ''}${pattern}\n--- screen ---\n${last}`);
    },
    kill() { try { tmux('kill-session', '-t', name); } catch { /* gone */ } execFileSync('sleep', ['1']); },
  };
}
