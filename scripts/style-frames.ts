// N20 style frames: play a real (seeded) game with bots, freeze the projector and phone
// screens mid-mission, then render that one frozen DOM under each visual direction in
// docs/visual-directions/css/. Same layout, different looks. Also runs axe (WCAG 2.1 AA)
// on every direction so a pretty frame that fails contrast is visible before anyone picks it.
//
//   npm run build && node --import tsx scripts/style-frames.ts
//
// Exploration tooling only: nothing here ships in the product.
import AxeBuilder from '@axe-core/playwright';
import { type Browser, chromium, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../src/server/server.js';
import { join as botJoin, type Client, playBot, type Radio } from '../tests/bot.js';
import { seeded } from '../tests/helpers.js';

const OUT = resolve('docs/visual-directions');
const DIRECTIONS = [
  { id: 'current', css: [] as string[] },
  { id: 'a-mission-control', css: ['room-scale.css', 'a-mission-control.css'] },
  { id: 'b-mars-daylight', css: ['room-scale.css', 'b-mars-daylight.css'] },
  { id: 'c-cosmic-cartoon', css: ['room-scale.css', 'c-cosmic-cartoon.css'] },
];
const PROJECTOR = { width: 1920, height: 1080 };
const PHONE = { width: 390, height: 844 };
const ANIMALS = ['giraffe', 'rhino', 'kangaroo', 'hippo', 'penguin', 'orca'];

type Snapshot = { name: string; html: string; viewport: { width: number; height: number }; shoot: 'viewport' | '.console' };

/** One live game, frozen mid-mission. Returns static HTML of each screen worth framing. */
async function playAndFreeze(browser: Browser, teams: number, phones: string[], label: string): Promise<Snapshot[]> {
  const app = await startServer({ host: '127.0.0.1', port: 0, publicDir: resolve('dist/public'), rng: seeded(7), log: () => {} });
  const bots: Client[] = [];
  try {
    const hostCtx = await browser.newContext({ viewport: PROJECTOR });
    const host = await hostCtx.newPage();
    await host.goto(app.url);
    await host.getByRole('button', { name: 'Create a game' }).click();
    await host.waitForURL(/\/host\//);
    const code = (await host.locator('.joincode').innerText()).trim();

    const phonePages: Page[] = [];
    for (const n of phones) {
      const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const p = await ctx.newPage();
      await p.goto(`${app.url}/join/${code}`);
      await p.locator('#jname').fill(n);
      await p.getByRole('button', { name: 'Join' }).click();
      await p.waitForURL(/\/play\//);
      phonePages.push(p);
    }
    const radios = new Map<string, Radio>();
    const step = playBot(radios, (_r, ti) => ANIMALS[ti % ANIMALS.length]!);
    const crew = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu'];
    for (let i = 0; i < teams * 4 - phones.length; i++)
      bots.push(await botJoin(app.url, code, `${crew[i % crew.length]} ${Math.floor(i / crew.length) + 1}`, step, false));

    await host.getByRole('button', { name: /Make teams/ }).click();
    await host.getByRole('heading', { name: 'Teams' }).waitFor();
    const screen = await hostCtx.newPage();
    await screen.goto(`${app.url}/screen/${code}`);
    await host.getByRole('button', { name: 'Start mission 1' }).click();
    await screen.locator('.bs-clock').waitFor();
    // Let the bots buy for a while so the feed, status lights and markets look like a real mission.
    await delay(18_000);

    const snaps: Snapshot[] = [{ name: `projector-${label}`, html: await screen.content(), viewport: PROJECTOR, shoot: 'viewport' }];
    for (const p of phonePages) {
      const role = await p.locator('.console').getAttribute('data-role');
      if (role && !snaps.some(s => s.name === `phone-${role}`))
        snaps.push({ name: `phone-${role}`, html: await p.content(), viewport: PHONE, shoot: '.console' });
    }
    return snaps;
  } finally {
    for (const b of bots) b.ws.close();
    await Promise.all(browser.contexts().map(c => c.close()));
    await app.close();
  }
}

async function main() {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  // 6 teams = the normal projector board; 12 teams = compact mode (>10 teams), which must keep working.
  const snaps = [
    ...(await playAndFreeze(browser, 6, ['Ana', 'Ben', 'Cal', 'Dee', 'Eve', 'Fin'], 'six-teams')),
    ...(await playAndFreeze(browser, 12, [], 'twelve-teams')),
  ];

  // Serve the frozen pages from a fresh server so /styles.css and /fonts resolve. No game state needed.
  const app = await startServer({ host: '127.0.0.1', port: 0, publicDir: resolve('dist/public'), log: () => {} });
  const axe: Record<string, Record<string, string[]>> = {};
  try {
    await mkdir(resolve(OUT, 'frames'), { recursive: true });
    for (const s of snaps) {
      const ctx = await browser.newContext({
        viewport: s.viewport,
        deviceScaleFactor: s.shoot === 'viewport' ? 1 : 2,
        reducedMotion: 'reduce',
      });
      const page = await ctx.newPage();
      await page.goto(`${app.url}/healthz`);
      const frozen = s.html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace('<head>', `<head><base href="${app.url}/">`);
      await page.setContent(frozen, { waitUntil: 'load' });
      for (const d of DIRECTIONS.filter(x => !process.env.ONLY || x.id === process.env.ONLY)) {
        const css = (await Promise.all(d.css.map(f => readFile(resolve(OUT, 'css', f), 'utf8')))).join('\n');
        await page.evaluate(text => {
          document.getElementById('direction')?.remove();
          const el = document.createElement('style');
          el.id = 'direction';
          el.textContent = text;
          document.head.append(el);
        }, css);
        await page.evaluate(() => document.fonts.ready);
        const file = resolve(OUT, 'frames', `${d.id}--${s.name}.jpg`);
        if (s.shoot === 'viewport') await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
        else await page.locator(s.shoot).first().screenshot({ path: file, type: 'jpeg', quality: 82 });
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        axe[d.id] ??= {};
        axe[d.id]![s.name] = r.violations.map(v => `${v.id}: ${v.nodes.length} node(s)`);
        console.log(`${d.id} ${s.name}: ${r.violations.length ? r.violations.map(v => v.id).join(', ') : 'axe clean'}`);
      }
      await ctx.close();
    }
    await writeFile(resolve(OUT, 'axe.json'), `${JSON.stringify(axe, null, 2)}\n`);
  } finally {
    await app.close();
    await browser.close();
  }
}

await main();
