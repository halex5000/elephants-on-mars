import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

// Every game lives in one process. A stray exception in a timer callback must not end them all.
let child: ChildProcess | undefined;
after(() => child?.kill('SIGKILL'));

test('the server keeps serving after an uncaught exception in a timer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eom-crash-'));
  const boom = join(dir, 'boom.mjs');
  await writeFile(boom, "setTimeout(() => { throw new Error('boom from a timer'); }, 300);\n");
  const port = 41000 + Math.floor(Math.random() * 2000);
  child = spawn(process.execPath, ['--import', 'tsx', '--import', boom, resolve('src/server/index.ts')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', HOST_PASSCODE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', d => {
    stderr += d;
  });
  const exited = once(child, 'exit').then(() => true);

  await new Promise(r => setTimeout(r, 1500));
  assert.equal(await Promise.race([exited, Promise.resolve(false)]), false, `server exited:\n${stderr}`);
  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(res.status, 200);
  assert.match(stderr, /uncaught_exception.*boom from a timer/);
});
