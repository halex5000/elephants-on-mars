// Run deterministic headless simulations. See docs/simulation.md.
//   node --import tsx scripts/sim.ts --scenario room --seeds 1-20 [--out results.jsonl] [--trace]
import { writeFileSync } from 'node:fs';
import { SCENARIOS, STRATEGIES, simulate, type MissionMetrics } from '../tests/sim/sim.js';

const args = process.argv.slice(2);
const opt = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
if (args.includes('--help')) {
  console.log(`Usage: node --import tsx scripts/sim.ts [--scenario ${Object.keys(SCENARIOS).join('|')}] [--seeds 1-20|3,7] [--out file.jsonl] [--trace]
JSONL on stdout (or --out): one "mission" line per team per mission, one "game" line per seed; --trace adds every action.
Strategies: ${Object.values(STRATEGIES)
    .map(s => `${s.id}${s.omniscient ? ' (OMNISCIENT)' : ''}`)
    .join(', ')}`);
  process.exit(0);
}
const scenario = opt('scenario', 'room')!;
const seedSpec = opt('seeds', '1-5')!;
const seeds = seedSpec.includes('-')
  ? Array.from(
      { length: Number(seedSpec.split('-')[1]) - Number(seedSpec.split('-')[0]) + 1 },
      (_, i) => Number(seedSpec.split('-')[0]) + i,
    )
  : seedSpec.split(',').map(Number);
if (!SCENARIOS[scenario] || seeds.some(s => !Number.isInteger(s))) {
  console.error('Unknown scenario or bad --seeds. Try --help.');
  process.exit(2);
}

const lines: string[] = [];
const missions: MissionMetrics[] = [];
for (const seed of seeds) {
  const r = simulate(seed, scenario);
  missions.push(...r.missions);
  lines.push(...r.missions.map(m => JSON.stringify(m)));
  if (args.includes('--trace')) lines.push(...r.trace.map(t => JSON.stringify({ kind: 'trace', seed, ...t })));
  lines.push(JSON.stringify(r.summary));
}
const out = opt('out');
if (out) writeFileSync(out, `${lines.join('\n')}\n`);
else console.log(lines.join('\n'));

console.error(
  `\n${scenario}: ${seeds.length} game(s), ${missions.length} team-missions. Simulation informs, but does not replace, the human playtest.`,
);
for (const id of [...new Set(missions.map(m => m.strategy))]) {
  const ms = missions.filter(m => m.strategy === id);
  const n = (s: string) => ms.filter(m => m.status === s).length;
  const label = STRATEGIES[id]?.omniscient ? `${id} (OMNISCIENT)` : id;
  console.error(
    `  ${label.padEnd(20)} landed ${n('landed')}  failed ${n('failed')}  scrubbed ${n('scrubbed')}  avg points ${(ms.reduce((a, m) => a + m.points, 0) / ms.length).toFixed(1)}  avg spend $${(ms.reduce((a, m) => a + m.spend, 0) / ms.length).toFixed(1)}`,
  );
}
