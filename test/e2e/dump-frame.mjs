// Probe: replay starOne (star 'delta', close, reopen, isolate 'alpha') with dumps.
import { makeProfile, sleep, startMock, startTui } from './dsh-tui.js';
import { writeFileSync } from 'node:fs';

const mock = await startMock();
const profile = makeProfile({ port: mock.port });
let tui = startTui(profile);
const dump = (name) => writeFileSync(`/tmp/probe-star-${name}.txt`, tui.capture());
try {
  await tui.waitFor(/Say something/u, { timeout: 60000 });
  tui.keys('M-p');
  await tui.waitFor(/⌕ >/u, { timeout: 20000 });
  await sleep(800);
  tui.text('delta');
  await sleep(500);
  dump('1-delta-typed');
  tui.keys('Space');
  await sleep(600);
  dump('2-starred');
  tui.keys('Escape');
  await sleep(250);
  tui.keys('Escape');
  await sleep(400);
  dump('3-closed');
  tui.keys('M-p');
  await tui.waitFor(/⌕ >/u, { timeout: 20000 });
  await sleep(800);
  dump('4-reopened');
  tui.text('alpha');
  await sleep(500);
  dump('5-alpha-typed');
  console.log('dumped');
} finally {
  tui.kill();
  tui.killServer();
  await mock.close();
  profile.dispose();
}
