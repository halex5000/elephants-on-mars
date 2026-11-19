import { encode } from 'uqr';
// Hand-drawn SVG for the game: no image files, nothing borrowed.
let uid = 0;

/** Mars that terraforms: green land and blue seas fade in as the group scores. */
export function planet(pct: number, cls = 'planet'): string {
  const id = `p${++uid}`,
    p = Math.max(0, Math.min(100, pct)) / 100;
  const atmo = (0.08 + p * 0.6).toFixed(2);
  const show = (at: number) => (p >= at ? 1 : 0); // solid patches appear one by one, never a muddy half-fade
  return `<svg class="${cls}" viewBox="0 0 400 400" role="img" aria-label="Mars, ${Math.round(pct)}% terraformed">
<defs>
<radialGradient id="${id}b" cx="36%" cy="30%" r="75%"><stop offset="0" stop-color="#ff9e6e"/><stop offset=".45" stop-color="#c4552f"/><stop offset="1" stop-color="#3b140b"/></radialGradient>
<radialGradient id="${id}s" cx="70%" cy="72%" r="70%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".65"/></radialGradient>
<radialGradient id="${id}a" r="50%"><stop offset=".9" stop-color="#7fd6ff" stop-opacity="0"/><stop offset=".94" stop-color="#7fd6ff" stop-opacity=".8"/><stop offset="1" stop-color="#7fd6ff" stop-opacity="0"/></radialGradient>
<clipPath id="${id}c"><circle cx="200" cy="200" r="160"/></clipPath>
</defs>
<circle class="atmo" cx="200" cy="200" r="190" fill="url(#${id}a)" opacity="${atmo}"/>
<circle cx="200" cy="200" r="160" fill="url(#${id}b)"/>
<g clip-path="url(#${id}c)">
<g fill="#7a2e1b" opacity=".55"><ellipse cx="140" cy="150" rx="26" ry="18"/><ellipse cx="250" cy="250" rx="34" ry="22"/><ellipse cx="275" cy="135" rx="14" ry="10"/><ellipse cx="170" cy="285" rx="18" ry="12"/></g>
<g fill="#2aa7a0"><path opacity="${show(0.3)}" d="M70 230c30-20 70-10 90 10s10 50-30 55-75-40-60-65z"/><path opacity="${show(0.6)}" d="M250 90c30 0 60 20 55 45s-50 25-70 5-12-50 15-50z"/></g>
<g fill="#4fc27c" stroke="#2f8f57" stroke-width="2"><path d="M110 120c20-15 50-10 55 10s-15 35-40 30-30-28-15-40z" opacity="${show(0.05)}"/><path d="M220 210c25-10 55 0 60 25s-20 40-45 35-40-48-15-60z" opacity="${show(0.18)}"/><path d="M150 300c15-10 40-5 42 12s-22 25-36 18-20-22-6-30z" opacity="${show(0.4)}"/><path d="M290 170c12-6 26 0 26 14s-16 20-26 14-12-22 0-28z" opacity="${show(0.7)}"/><path d="M95 180c10-6 24 0 22 12s-18 14-24 8-6-16 2-20z" opacity="${show(0.85)}"/></g>
<g fill="#f4fbff" opacity="${show(0.5) * 0.9}"><ellipse cx="200" cy="48" rx="70" ry="14"/></g>
</g>
<circle cx="200" cy="200" r="160" fill="url(#${id}s)"/>
</svg>`;
}

/** A rocket whose body grows with its size class. */
export function rocket(size: string): string {
  const k = ({ S: 0.78, M: 0.88, L: 0.96, XL: 1.06 } as Record<string, number>)[size] ?? 0.9;
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><g transform="translate(24 24) scale(${k}) translate(-24 -24)">
<path d="M24 3c7 6 10 15 10 25H14C14 18 17 9 24 3z" fill="#e9ecff"/><path d="M24 3c3.5 3 6 7 7.6 12H16.4C18 10 20.5 6 24 3z" fill="var(--c)"/>
<circle cx="24" cy="20" r="4" fill="#0b0f24" stroke="var(--c)" stroke-width="2"/>
<path d="M14 28l-6 9h8zM34 28l6 9h-8z" fill="var(--c)"/><path d="M19 28h10l-2 6h-6z" fill="#9aa3c7"/>
<path d="M21 34c1 5 2 8 3 9 1-1 2-4 3-9z" fill="#ffb347"/></g></svg>`;
}

export const drop = (fill = 'currentColor') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c4 5.5 7 9.3 7 13a7 7 0 0 1-14 0c0-3.7 3-7.5 7-13z" fill="${fill}"/></svg>`;
export const paw = () =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><ellipse cx="6" cy="10" rx="2.2" ry="2.8"/><ellipse cx="10" cy="6.5" rx="2.2" ry="2.8"/><ellipse cx="14.5" cy="6.5" rx="2.2" ry="2.8"/><ellipse cx="18.5" cy="10" rx="2.2" ry="2.8"/><path d="M12 11c3 0 6 4 6 6.5 0 2-1.6 3-3.4 2.5-1-.3-1.8-.8-2.6-.8s-1.6.5-2.6.8C7.6 20.5 6 19.5 6 17.5 6 15 9 11 12 11z"/></svg>`;
export const rocketGlyph = () =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2c3.5 3 5 7.5 5 12.5H7C7 9.5 8.5 5 12 2zM7 14.5l-3 4.5h4zM17 14.5l3 4.5h-4zM10 15h4l-1 4h-2z"/></svg>`;

/** A fuel drum, filled to `level` (0–1). */
export function tank(level: number, color: string): string {
  const id = `t${++uid}`,
    h = Math.max(0, Math.min(1, level)) * 84;
  return `<svg viewBox="0 0 96 120" aria-hidden="true"><defs><clipPath id="${id}"><rect x="10" y="14" width="76" height="96" rx="12"/></clipPath></defs>
<rect x="10" y="14" width="76" height="96" rx="12" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
<rect x="10" y="${110 - h}" width="76" height="${h + 2}" fill="${color}" opacity=".85" clip-path="url(#${id})"/>
<path d="M10 44h76M10 80h76" stroke="rgba(255,255,255,.18)" stroke-width="2"/>
<rect x="34" y="6" width="28" height="10" rx="3" fill="rgba(255,255,255,.35)"/></svg>`;
}

/**
 * A QR code as one crisp SVG path: dark modules on a white tile with a quiet zone,
 * because many phone scanners can't read light-on-dark codes. Generated locally
 * (no third-party QR service). Medium error correction survives a blurry screen share.
 */
const qrCache = new Map<string, string>();
export function qr(text: string, label: string): string {
  let path = qrCache.get(text);
  if (!path) {
    const { data, size } = encode(text, { ecc: 'M', border: 0 });
    let d = '';
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y]![x]) d += `M${x} ${y}h1v1h-1z`;
    path = `${size}|${d}`;
    qrCache.set(text, path);
  }
  const [n, d] = path.split('|') as [string, string];
  const q = 4,
    v = Number(n) + q * 2;
  return `<svg class="qr" viewBox="${-q} ${-q} ${v} ${v}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect x="${-q}" y="${-q}" width="${v}" height="${v}" fill="#fff" rx="2"/><path d="${d}" fill="#0b0f24"/></svg>`;
}
