import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../../src/server/server.js';
import { Client } from '../bot.js';
import { started, fund, T0 } from '../helpers.js';

test('a running checkpoint restores rooms, seats, transfers and mission deadlines', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'eom-checkpoint-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateFile = join(dir, 'state.json');
  const options = { port: 0, host: '127.0.0.1', publicDir: join(dir, 'public'), stateFile, snapshotIntervalMs: 20 };
  const first = await startServer({ ...options, now: () => T0 });
  const active = started();
  fund(active, 0, { pilot: 2 });
  const expired = { ...started(), code: 'LATE', endsAt: T0 + 1 };
  first.games.set(active.code, active);
  first.games.set(expired.code, expired);
  const copy = join(dir, 'crash.json');
  try {
    // Capture the on-disk file while the server is running, before the shutdown flush.
    for (let n = 0; ; n++) {
      try {
        await copyFile(stateFile, copy);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || n >= 100) throw err;
      }
      await delay(10);
    }
  } finally {
    await first.close();
  }

  const start = Date.now();
  const second = await startServer({ ...options, stateFile: copy, now: () => active.endsAt! - 800 + Date.now() - start });
  try {
    assert.deepEqual(second.games.get(active.code), active);
    assert.equal(second.games.get(expired.code)?.phase, 'results');
    const host = new Client(second.url),
      player = new Client(second.url);
    await Promise.all([host.opened, player.opened]);
    host.send({ t: 'host', code: active.code, hostToken: active.hostToken });
    const p = active.players[0]!;
    player.send({ t: 'resume', code: active.code, playerId: p.id, token: p.token });
    await Promise.all([host.until(() => host.view?.phase === 'play'), player.until(() => player.view?.kind === 'player')]);
    await host.until(() => host.view?.phase === 'results');
    host.close();
    player.close();
  } finally {
    await second.close();
  }
});

test('invalid snapshot aborts startup and preserves the file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'eom-invalid-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateFile = join(dir, 'state.json');
  await writeFile(stateFile, '{broken');
  await assert.rejects(async () => {
    const app = await startServer({ port: 0, publicDir: join(dir, 'public'), stateFile });
    await app.close();
  });
  assert.equal(await readFile(stateFile, 'utf8'), '{broken');
});

test('shutdown saves the latest rooms before the first periodic checkpoint', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'eom-shutdown-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = {
    port: 0,
    publicDir: join(dir, 'public'),
    stateFile: join(dir, 'state.json'),
    now: () => T0,
    snapshotIntervalMs: 60_000,
  };
  const server = await startServer(options);
  const game = started();
  server.games.set(game.code, game);
  await server.close();
  const recovered = await startServer(options);
  try {
    assert.deepEqual(recovered.games.get(game.code), game);
  } finally {
    await recovered.close();
  }
});

test('a snapshot containing credentials cannot be created under the public directory', async () => {
  await assert.rejects(startServer({ publicDir: tmpdir(), stateFile: join(tmpdir(), 'rooms.json') }), /outside the public/);
});
