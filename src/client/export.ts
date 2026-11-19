// Plain-text results for pasting into Slack, Teams or the meeting chat after the debrief.
// Pure function of the view (everything in it is public by the final report), so it's unit-testable.
import type { HostView, PlayerView } from '../shared/protocol.js';

const pts = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;

export function resultsText(v: HostView | PlayerView): string {
  const f = v.final;
  if (!f) return '';
  const t = v.terraform;
  const lines: string[] = [];
  lines.push(`Elephants on Mars: mission report (game ${v.code})`);
  lines.push(f.winner ? `🏆 ${f.winner} wins with ${pts(f.topPoints)}` : 'No team landed an animal. Mars is still waiting.');
  lines.push(`Mars is ${t.pct}% terraformed: ${t.points} of ${pts(t.target)}, ${t.species.length} of ${t.speciesTotal} species`);
  lines.push('', 'Leaderboard');
  f.byRound.forEach((team, i) => {
    const zoo = team.landed.map(a => a.emoji).join('');
    lines.push(`${i + 1}. ${team.name}: ${pts(team.total)}${zoo ? `  ${zoo}` : ''}`);
  });
  if (v.results.length) {
    lines.push('', 'Mission by mission');
    for (const r of v.results) {
      lines.push(`Mission ${r.round}`);
      for (const o of r.outcomes) lines.push(`- ${o.teamName}: ${o.message}${o.status === 'landed' ? ` (+${o.points})` : ''}`);
    }
  }
  return lines.join('\n');
}
