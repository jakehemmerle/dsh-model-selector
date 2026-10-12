// End-to-end: real dsh + patched dsh-TUI + this plugin, in tmux, against a mock
// provider. See TESTING.md "End-to-end" and test/e2e/dsh-tui.js.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeProfile, sleep, startMock, startTui } from './dsh-tui.js';

const SCENE = /⌕ >[\s\S]*Starred/u;
const userTexts = (request) => (request.messages ?? []).filter((m) => m.role === 'user')
  .map((m) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((c) => c.text ?? '').join(''))).join('\n');

describe('dsh-TUI with dsh-model-selector (e2e)', { skip: !process.env.DSH_TUI_DIR && 'set DSH_TUI_DIR to the patched dsh-tui build' }, () => {
  let mock;
  let profile;
  let tui;

  before(async () => {
    mock = await startMock();
    profile = makeProfile({ port: mock.port });
    tui = startTui(profile);
    await tui.waitFor(/Say something/u, { timeout: 60000 });
  });

  after(async () => {
    tui?.kill();
    tui?.killServer(); // private socket only; never Jake's default tmux server
    await mock?.close();
    if (!process.env.KEEP_E2E) profile?.dispose();
  });

  it('bare /model on the launch page opens the scene; Esc returns to a clean launch page', async () => {
    tui.text('/model');
    await sleep(300);
    tui.keys('Enter');
    const screen = await tui.waitFor(SCENE);
    assert.match(screen, /Mock Local\s+3/u, 'mock provider listed with its 3 models');
    assert.match(screen, /Mock Two\s+1/u);
    assert.match(screen, /❯\s+mock\/mock-alpha ✓/u, 'live model preselected and marked');
    tui.keys('Escape');
    // Back on a clean launch page: the typed /model draft is gone.
    const back = await tui.waitFor(/Say something/u);
    assert.doesNotMatch(back, /⌕ >|⌘ \/model/u);
  });

  it('picking a model from a typed /model on the launch page wipes the /model draft', async () => {
    tui.text('/model');
    await sleep(300);
    tui.keys('Enter');
    await tui.waitFor(SCENE);
    tui.text('gamma');
    await tui.waitFor(/❯\s+mock\/mock-gamma-1-5/u);
    tui.keys('Enter');
    await tui.waitFor(/⌕ >/u, { not: true });
    await tui.waitFor(/mock-gamma-1-5/u);
    const screen = await tui.waitFor(/Say something/u, { timeout: 5000 });
    assert.doesNotMatch(screen, /⌘ \/model/u, 'no leftover /model draft');
    // back to mock-alpha for the rest of the suite
    tui.keys('M-p');
    await tui.waitFor(SCENE);
    tui.text('alpha');
    await tui.waitFor(/❯\s+mock\/mock-alpha/u);
    tui.keys('Enter');
    for (let i = 0; i < 100 && profile.read('model.json')?.model !== 'mock-alpha'; i += 1) await sleep(100);
    await tui.waitFor(/Say something/u);
  });

  it('Alt+P opens it from the launch page too', async () => {
    tui.keys('M-p');
    await tui.waitFor(SCENE);
    tui.keys('Escape');
    await tui.waitFor(/Say something/u);
  });

  it('a switch forks the conversation onto the picked model; the next prompt reaches it with history', async () => {
    tui.text('first message');
    tui.keys('Enter');
    await tui.waitFor(/pong from mock-alpha/u);

    tui.keys('M-p');
    await tui.waitFor(SCENE);
    tui.text('beta');
    await tui.waitFor(/⌕ > beta/u);
    await tui.waitFor(/❯\s+mock\/mock-beta/u);
    tui.keys('Enter');
    await tui.waitFor(/⌕ >/u, { not: true });
    await tui.waitFor(/mock-beta/u);

    assert.deepEqual(profile.read('model.json'), { provider: 'mock', model: 'mock-beta' }, 'dsh-TUI persisted the route');
    assert.deepEqual(profile.read('model-recents.json').models[0], { provider: 'mock', id: 'mock-beta' }, 'recents front');

    const before = mock.requests.length;
    tui.text('second message');
    tui.keys('Enter');
    await tui.waitFor(/pong from mock-beta/u);
    const turn = mock.requests.slice(before).find((r) => userTexts(r).includes('second message'));
    assert.ok(turn, 'the turn reached the mock');
    assert.equal(turn.model, 'mock-beta', 'requested with the picked model id');
    assert.match(userTexts(turn), /first message/u, 'history carried across the switch');
  });

  it('/model provider/id still switches directly without opening the scene', async () => {
    tui.text('/model mock/mock-alpha');
    await sleep(300);
    tui.keys('Enter');
    await sleep(800);
    assert.doesNotMatch(tui.capture(), /⌕ >/u);
    for (let i = 0; i < 100 && profile.read('model.json')?.model !== 'mock-alpha'; i += 1) await sleep(100);
    assert.equal(profile.read('model.json')?.model, 'mock-alpha');
  });

  it('Space stars; the star survives a full TUI restart and the scene lands on Starred', async () => {
    tui.keys('M-p');
    await tui.waitFor(SCENE);
    tui.text('gamma');
    await tui.waitFor(/❯\s+mock\/mock-gamma-1-5/u);
    tui.keys('Space');
    await tui.waitFor(/❯ ★ mock\/mock-gamma-1-5/u);
    assert.deepEqual(profile.read('model-stars.json'), { models: [{ provider: 'mock', id: 'mock-gamma-1-5' }] });
    tui.keys('Escape'); // clear query
    tui.keys('Escape'); // close
    await tui.waitFor(/⌕ >/u, { not: true });

    tui.kill();
    tui = startTui(profile);
    await tui.waitFor(/Say something/u, { timeout: 60000 });
    tui.keys('M-p');
    await tui.waitFor(SCENE);
    // The catalog loads asynchronously (listModels); the scene first renders an
    // empty 0/0 frame. Wait for the starred row, then assert the landing scope.
    const screen = await tui.waitFor(/❯ ★ mock\/mock-gamma-1-5/u, { timeout: 15000 });
    assert.match(screen, /❯ ★ Starred\s+1/u, 'lands on Starred');
    // resolveModelInfo streams in per model after open; give it a bounded deadline.
    await tui.waitFor(/Mock Gamma 1\.5 · mock · 1M ctx · 64K out/u, { timeout: 15000 });
    tui.keys('Escape');
    await tui.waitFor(/⌕ >/u, { not: true });
  });

  it('a switch attempt during a running turn changes nothing and the turn completes', async () => {
    const route = profile.read('model.json');
    mock.hold(true);
    tui.text('slow turn');
    await sleep(300);
    tui.keys('Enter');
    let seen = false;
    for (let i = 0; i < 100 && !(seen = mock.requests.some((r) => userTexts(r).includes('slow turn'))); i += 1) await sleep(100);
    assert.ok(seen, 'the busy-turn premise holds: the mock received the prompt (a dropped Enter would make the rest of this test meaningless)');
    // dsh-TUI lets the picker open mid-turn; the scene itself refuses to switch.
    tui.keys('M-p');
    await tui.waitFor(SCENE);
    tui.keys('Down');
    await sleep(300);
    tui.keys('Enter');
    await tui.waitFor(/⚠ A turn is running/u, { timeout: 45000 });
    assert.match(tui.capture(), /⌕ >/u, 'scene stays open');
    tui.keys('Escape');
    await tui.waitFor(/⌕ >/u, { not: true });
    assert.deepEqual(profile.read('model.json'), route, 'route unchanged');
    mock.hold(false);
    await tui.waitFor(new RegExp(`slow turn[\\s\\S]*pong from ${route.model}`, 'u'), { timeout: 20000 });
  });

  it('the plugin loaded without host warnings about scenes', () => {
    const logs = profile.logs();
    assert.doesNotMatch(logs, /no TUI scene registered|dsh-model-selector.*(error|failed)/iu);
  });
});
