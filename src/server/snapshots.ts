// One writer per server. Keep the previous complete checkpoint until rename succeeds.
import { open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Game } from './engine.js';

export async function loadGames(path: string): Promise<Game[]> {
  let json: string;
  try {
    json = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  let snapshot: { version?: unknown; games?: unknown } | null;
  try {
    snapshot = JSON.parse(json);
  } catch {
    throw new Error('Malformed game snapshot');
  }
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.games)) throw new Error('Unsupported game snapshot');
  const codes = new Set<string>();
  for (const game of snapshot.games) {
    if (
      !game ||
      typeof game.code !== 'string' ||
      codes.has(game.code) ||
      typeof game.hostToken !== 'string' ||
      !Array.isArray(game.players) ||
      !Array.isArray(game.teams) ||
      !Array.isArray(game.feed) ||
      !Array.isArray(game.transfers) ||
      !game.settings ||
      !game.market ||
      !game.picks ||
      !game.fuelStock ||
      !Number.isFinite(game.touchedAt) ||
      !['lobby', 'teams', 'play', 'results', 'final'].includes(game.phase) ||
      (game.phase === 'play' && !Number.isFinite(game.endsAt))
    )
      throw new Error('Invalid game snapshot');
    codes.add(game.code);
  }
  return snapshot.games;
}

export async function saveGames(path: string, games: Iterable<Game>) {
  const json = JSON.stringify({ version: 1, games: Array.from(games) });
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try {
    try {
      await file.writeFile(json);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
