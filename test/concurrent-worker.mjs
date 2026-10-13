import { toggleStar } from '../lib/store.js';
import { existsSync, writeFileSync } from 'node:fs';

// Spawned by test/concurrent-toggle.test.js: waits for the start file, then
// races ONE production toggleStar against a sibling process, and reports
// saved/lost in a status file. argv: starsFile refId startFile doneFile
const [file, refId, startFile, doneFile] = process.argv.slice(2);
while (!existsSync(startFile)) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
}
const result = toggleStar({ starsFile: file }, { provider: 'mock', id: refId });
writeFileSync(doneFile, result.saved ? 'saved' : 'refused:' + JSON.stringify(result));
