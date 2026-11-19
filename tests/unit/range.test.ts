// Byte ranges: Safari and iOS won't play video from a server that ignores them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRange } from '../../src/server/server.js';

test('parseRange: normal, open-ended, suffix, clamped, absent and unsatisfiable ranges', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange('bytes=990-5000', 1000), { start: 990, end: 999 }, 'end clamped to the file');
  assert.equal(parseRange(undefined, 1000), null);
  for (const bad of ['bytes=1000-', 'bytes=500-100', 'bytes=-0', 'bytes=-', 'items=0-1', 'bytes=0-1,5-9', 'bytes=abc'])
    assert.equal(parseRange(bad, 1000), 'bad', bad);
});
