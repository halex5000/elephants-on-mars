// All markers are derived from published mission reports. Earlier landings keep
// their coordinates and callsigns as later missions are appended.
import type { Common } from '../shared/protocol.js';
import { esc } from './escape.js';

const callsigns = [
  'Clipboard',
  'Pickles',
  'Biscuit',
  'Mittens',
  'Lunchbox',
  'Tater Tot',
  'Crumpet',
  'Pocket',
  'Pebble',
  'Sprout',
  'Noodle',
  'Button',
];
const columns = 3;
const width = 660;

export function landingMap(view: Common, download: boolean) {
  const landings = view.results.flatMap(r =>
    r.outcomes.flatMap(o => (o.status === 'landed' && o.animal ? [{ team: o.teamName, round: r.round, animal: o.animal }] : [])),
  );
  const height = 158 + Math.max(1, Math.ceil(landings.length / columns)) * 102;
  const terraformed = view.terraform.pct >= 50;
  const terrain = terraformed ? '#ae7856' : '#a86045';
  const roster: string[] = [];
  const markers = landings
    .map(({ team, round, animal }, index) => {
      const cycle = Math.floor(index / callsigns.length);
      const name = callsigns[index % callsigns.length]! + (cycle ? ` ${cycle + 1}` : '');
      const label = `${name}, ${animal.name} · ${team} · Mission ${round}`;
      const col = index % columns;
      const x = 120 + col * 206 + (Math.floor(index / columns) % 2 ? 12 : -8);
      const y = 145 + Math.floor(index / columns) * 102 + (col === 1 ? 10 : 0);
      roster.push(`<li>${esc(label)}</li>`);
      return `<g transform="translate(${x} ${y})" text-anchor="middle"><title>${esc(label)}</title>
      <ellipse cy="6" rx="22" ry="6" fill="#542f2b" opacity=".45"/>
      <text font-size="34">${esc(animal.emoji)}</text>
      <rect x="-84" y="12" width="168" height="40" rx="9" fill="#382f2a"/>
      <text y="29" font-size="15" font-weight="bold" fill="#fff5d9">${esc(name)}</text>
      <text y="45" font-size="11" fill="#f0d6b3">${esc(team)} · M${round}</text></g>`;
    })
    .join('');
  const count = landings.length;
  const svg = `<svg id="mars-postcard" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="map-title map-desc" font-family="system-ui, sans-serif" style="display:block;width:100%;min-width:420px;height:auto">
    <title id="map-title">Greetings from Mars</title><desc id="map-desc">${count} successful landings. The landing register lists each animal and crew.</desc>
    <defs><pattern id="mars-contours" width="345" height="175" patternUnits="userSpaceOnUse">
      <rect width="345" height="175" fill="${terrain}"/>
      <path d="M-12 97Q28 82 66 103T151 98T238 95T358 85V100Q298 132 242 110T153 114T65 118T-12 113Z" fill="${terraformed ? '#778369' : '#bd805d'}"/>
        <path d="M-9 104Q30 88 66 109T152 104T241 102T355 91" fill="none" stroke="${terraformed ? '#8db8bc' : '#cb9a74'}" stroke-width="3"/>
      <g fill="none" stroke="#f2c494" opacity=".35" stroke-width="1.6">
        <path d="M-20 54Q47 8 117 41T260 22T368 38M-20 65Q49 18 118 51T261 33T368 48M-20 76Q49 32 121 63T267 45T368 57"/>
        <ellipse cx="235" cy="113" rx="49" ry="18"/><ellipse cx="235" cy="113" rx="41" ry="12"/><ellipse cx="235" cy="115" rx="31" ry="8"/>
      </g><g fill="#593c33" opacity=".4"><circle cx="49" cy="139" r="3"/><circle cx="60" cy="144" r="2"/><ellipse cx="162" cy="88" rx="7" ry="3"/></g></pattern></defs>
    <rect width="660" height="${height}" fill="#fbebcb"/><rect x="8" y="8" width="644" height="${height - 16}" fill="url(#mars-contours)"/>
    <path d="M8 8H652V81Q567 60 486 83T301 79T107 86T8 72Z" fill="#302d36"/>
    <g fill="#fcebc4"><circle cx="563" cy="28" r="12"/><circle cx="600" cy="46" r="4"/><circle cx="521" cy="22" r="1.5"/><circle cx="626" cy="21" r="2"/>
    <text x="26" y="43" font-family="Georgia,serif" font-size="30" font-style="italic">Greetings from Mars</text>
    <text x="28" y="64" font-size="13">Expedition ${esc(view.code)} · ${count} ${count === 1 ? 'arrival' : 'arrivals'} · ${view.terraform.pct}% terraformed</text></g>
    ${markers || '<text x="330" y="160" text-anchor="middle" fill="#fff8e2" font-size="20">Awaiting the first landing</text>'}
    <rect x="8" y="${height - 38}" width="644" height="30" fill="#f2dfbb"/><text x="26" y="${height - 18}" font-size="12" fill="#48392f">ELEPHANTS ON MARS   /   SURFACE LANDING REGISTER</text></svg>`;
  return `<section class="panel" style="margin-top:16px"><h3>Mars landing map</h3>
    <div tabindex="0" role="region" aria-label="Scrollable Mars landing map" style="overflow:auto;max-height:65vh;margin:10px 0">${svg}</div>
    ${count ? `<details><summary>Landing register (${count})</summary><ul>${roster.join('')}</ul></details>` : ''}
    ${download ? '<button class="ghost" data-act="postcard">Download Mars postcard</button>' : ''}</section>`;
}

export function downloadPostcard(code: string) {
  const svg = document.querySelector('#mars-postcard');
  if (!svg) return;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  const link = document.createElement('a');
  link.download = `elephants-on-mars-${code}.svg`;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
