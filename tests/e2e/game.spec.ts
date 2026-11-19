// Real browsers, real UI: a host and four players (each in their own browser
// context, like four laptops) play missions by clicking through the screens.
// The server runs with GAME_SPEED=10 (see playwright.config.ts) so the fuel pool
// fills in seconds; tests use long missions to compensate.
import { test, expect, type Browser, type Page } from '@playwright/test';
import jsQRModule from 'jsqr';
import { E2E_PASSCODE } from './env.js';
import { join as botJoin, type Client } from '../bot.js';
import { fuelInPool } from '../../src/shared/market.js';

type Role = 'captain' | 'vet' | 'pilot' | 'engineer';

// Any uncaught error in any page fails the test that produced it.
const pageErrors: string[] = [];
test.beforeEach(() => { pageErrors.length = 0; });
test.afterEach(() => { expect(pageErrors, 'uncaught errors in the browser').toEqual([]); });

test('first-time host: asked for the passcode, wrong one refused, right one remembered', async ({ browser }) => {
  const ctx = await browser.newContext(); const host = await ctx.newPage();
  host.on('pageerror', e => pageErrors.push(`host: ${e.message}`));
  await host.goto('/');
  await expect(host.locator('#hpass')).toHaveCount(0);
  await host.getByRole('button', { name: 'Create a game' }).click();
  await expect(host.locator('#hpass')).toBeVisible();
  await host.locator('#hpass').fill('wrong');
  await host.getByRole('button', { name: 'Create a game' }).click();
  await expect(host.locator('#toast')).toContainText("isn't right");
  await expect(host).toHaveURL(/\/$/);
  await host.locator('#hpass').fill(E2E_PASSCODE);
  await host.getByRole('button', { name: 'Create a game' }).click();
  await expect(host).toHaveURL(/\/host\/[A-Z]{4}$/);
  // next game from the same browser: no prompt
  const again = await ctx.newPage();
  await again.goto('/');
  await again.getByRole('button', { name: 'Create a game' }).click();
  await expect(again).toHaveURL(/\/host\/[A-Z]{4}$/);
  await expect(again.locator('#hpass')).toHaveCount(0);
});

async function createGame(browser: Browser, settings: { minutes?: number; income?: number } = {}) {
  const host = await (await browser.newContext()).newPage();
  host.on('pageerror', e => pageErrors.push(`host: ${e.message}`));
  // a returning host: the passcode is remembered from an earlier game
  await host.addInitScript(p => localStorage.setItem('eom-host-pass', JSON.stringify(p)), E2E_PASSCODE);
  await host.goto('/');
  await host.getByRole('button', { name: 'Create a game' }).click();
  await expect(host).toHaveURL(/\/host\/[A-Z]{4}$/);
  await host.locator('#s-min').fill(String(settings.minutes ?? 30)); // 30 game-minutes = 3 real minutes at 10x
  await host.locator('#s-inc').fill(String(settings.income ?? 20));
  const code = (await host.locator('.joincode').innerText()).trim();
  return { host, code };
}

async function joinGame(browser: Browser, code: string, name: string, viewport?: { width: number; height: number }) {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  page.on('pageerror', e => pageErrors.push(`${name}: ${e.message}`));
  await page.goto(`/join/${code}`);
  await expect(page.locator('#jcode')).toHaveValue(code);
  await page.locator('#jname').fill(name);
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page).toHaveURL(new RegExp(`/play/${code}$`));
  await expect(page.getByText(`You're in, ${name}`)).toBeVisible();
  return page;
}

async function roleOf(p: Page): Promise<Role> {
  await expect(p.locator('.console').first()).toBeVisible();
  return (await p.locator('.console').first().getAttribute('data-role')) as Role;
}

/** The Captain hands out money one dollar at a time, like the original's "Give $1". */
async function give(p: Page, to: Role, dollars: number) {
  const before = Number((await p.locator(`[data-wallet-of=${to}]`).innerText()).replace('$', ''));
  for (let i = 0; i < dollars; i++) await p.locator(`button[data-act=give][data-to=${to}]`).click();
  await expect(p.locator(`[data-wallet-of=${to}]`)).toHaveText(`$${before + dollars}`);
}
const wallet = (p: Page) => p.locator('.c-stats .cash');

async function setupMission(browser: Browser, opts: { mobileFor?: number; income?: number } = {}) {
  const { host, code } = await createGame(browser, { income: opts.income });
  const players: Page[] = [];
  for (let i = 0; i < 4; i++) players.push(await joinGame(browser, code, `Player ${i}`, opts.mobileFor === i ? { width: 375, height: 812 } : undefined));
  await expect(host.locator('.chips span')).toHaveCount(4);
  await host.getByRole('button', { name: /Make teams/ }).click();
  await expect(host.getByRole('heading', { name: 'Teams' })).toBeVisible();
  await host.getByRole('button', { name: 'Start mission 1' }).click();
  await expect(host.getByRole('heading', { name: /Mission 1 of/ })).toBeVisible();
  const byRole = {} as Record<Role, Page>;
  for (const p of players) { await expect(p.getByRole('heading', { name: /Mission 1 of/ })).toBeVisible(); byRole[await roleOf(p)] = p; }
  expect(Object.keys(byRole).sort()).toEqual(['captain', 'engineer', 'pilot', 'vet']);
  return { host, code, players, byRole };
}

const poolUnits = async (p: Page) => Number(await p.locator('.tank span.num[data-pool]').innerText());
const onRocket = async (p: Page) => Number(await p.locator('.onrocket .num').innerText());
const stock = async (p: Page) => Number(await p.locator('.tank').nth(1).locator('.num').innerText());

test('a full mission through the real UI lands the animal', async ({ browser }) => {
  const { host, byRole: R } = await setupMission(browser);

  // Captain hands out money a dollar at a time (and can't see sizes or fuel needs).
  await give(R.captain, 'vet', 8);
  await give(R.captain, 'pilot', 8);
  await give(R.captain, 'engineer', 4);
  await expect(wallet(R.engineer)).toHaveText('$4');

  // Each role sees only its own piece.
  await expect(R.vet.locator('.item[data-animal=giraffe] .badge.size')).toHaveText('L');
  for (const r of ['captain', 'pilot', 'engineer'] as const) await expect(R[r].locator('.item[data-animal]')).toHaveCount(0);
  await expect(R.pilot.locator('.item[data-rocket=heavy] .badge.br')).toHaveText('55');
  for (const r of ['captain', 'vet', 'engineer'] as const) await expect(R[r].locator('.item[data-rocket]')).toHaveCount(0);

  // Vet takes a giraffe (L) and "tells" the Pilot its size.
  const giraffe = R.vet.locator('.item[data-animal=giraffe]');
  const size = await giraffe.locator('.badge.size').innerText();
  await giraffe.getByRole('button', { name: 'Take' }).click();
  await expect(giraffe.getByRole('button', { name: 'Taken' })).toBeVisible();

  // Pilot buys a rocket at least that big and "tells" the Engineer the fuel it needs.
  const heavy = R.pilot.locator('.item[data-rocket=heavy]');
  expect(await heavy.locator('.badge.size').innerText()).toBe(size);
  const need = Number(await heavy.locator('.badge.br').innerText());
  await heavy.getByRole('button', { name: 'Buy' }).click();
  await expect(heavy.getByRole('button', { name: 'Bought' })).toBeVisible();

  // Engineer waits for the shared pool, buys it into stock, then sends fuel to the mission 10 at a time.
  await expect.poll(() => poolUnits(R.engineer), { timeout: 20_000 }).toBeGreaterThanOrEqual(need);
  await R.engineer.getByRole('button', { name: 'Buy $1' }).click();
  await expect.poll(() => stock(R.engineer)).toBeGreaterThanOrEqual(need);
  while ((await onRocket(R.engineer)) < need) {
    const before = await onRocket(R.engineer);
    await R.engineer.locator('button[data-act=sendFuel]').click();
    await expect.poll(() => onRocket(R.engineer)).toBeGreaterThan(before);
  }
  await expect(R.engineer.locator('.status .dot').nth(2)).toHaveClass(/ok/);

  // The big screen shows every move live.
  await expect(host.locator('#feed')).toContainText('Giraffe');
  await expect(host.locator('#feed')).toContainText('Heavy');
  await expect(host.locator('#feed')).toContainText('fuel');

  // Captain launches (two taps).
  const launch = R.captain.locator('button.launch');
  await expect(launch).toBeEnabled();
  await launch.click();
  await expect(launch).toHaveText('Tap again to launch');
  await launch.click();
  await expect(launch).toHaveText('Launched');
  await expect(R.vet.locator('.item[data-animal=hippo] button')).toBeDisabled();

  await expect(host.getByText('1 of 1 teams launched')).toBeVisible();
  await host.getByRole('button', { name: /Show results/ }).click();
  await expect(host.locator('#results')).toContainText('Giraffe landed safely');
  await expect(R.pilot.locator('#results')).toContainText('Giraffe landed safely');
  await expect(host.getByText(/Mars is \d+% terraformed/).first()).toBeVisible();

  await host.getByRole('button', { name: /End game early|final report/ }).click();
  await expect(host.locator('#winner')).toContainText('wins with 40 points');
  await expect(R.engineer.locator('#winner')).toContainText('wins with 40 points');
});

test('roles reshuffle for mission 2', async ({ browser }) => {
  const { host, players } = await setupMission(browser);
  const before = await Promise.all(players.map(roleOf));
  await host.getByRole('button', { name: /End mission now/ }).click();
  await host.getByRole('button', { name: 'Start mission 2' }).click();
  for (const p of players) await expect(p.getByRole('heading', { name: /Mission 2 of/ })).toBeVisible();
  await Promise.all(players.map(p => expect(p.getByRole('heading', { name: /Mission 2 of/ })).toBeVisible()));
  const after = await Promise.all(players.map(roleOf));
  expect([...after].sort()).toEqual(['captain', 'engineer', 'pilot', 'vet']);
  for (let i = 0; i < 4; i++) expect(after[i], `player ${i} kept the same role`).not.toBe(before[i]);
});

test('live markets tick on screen: the fuel pool fills and prices drop', async ({ browser }) => {
  const { byRole: R } = await setupMission(browser);
  const a = await poolUnits(R.engineer);
  await expect.poll(() => poolUnits(R.engineer), { timeout: 5000 }).toBeGreaterThan(a);
  const price = async () => Number((await R.vet.locator('.item[data-animal=elephant] .price').innerText()).replace('$', ''));
  const p0 = await price();
  await expect.poll(price, { timeout: 15000 }).toBeLessThan(p0);
});

test('regression: every Give $1 lands on the right teammate even while the screen is updating', async ({ browser }) => {
  const { byRole: R } = await setupMission(browser, { income: 40 });
  await give(R.captain, 'vet', 20);
  // The vet keeps buying cheap animals, so the captain's screen updates constantly while they tap.
  let stop = false;
  const churn = (async () => {
    for (let i = 0; !stop && i < 40; i++) await R.vet.locator(`.item[data-animal=${i % 2 ? 'penguin' : 'cat'}] button`).click({ timeout: 2000 }).catch(() => {});
  })();
  for (let i = 0; i < 6; i++) { await R.captain.locator('button[data-act=give][data-to=pilot]').click(); await R.captain.locator('button[data-act=give][data-to=engineer]').click(); }
  stop = true; await churn;
  await expect(wallet(R.pilot)).toHaveText('$6');
  await expect(wallet(R.engineer)).toHaveText('$6');
});

test('reloading the page keeps your team and role', async ({ browser }) => {
  const { byRole: R } = await setupMission(browser);
  await R.pilot.reload();
  expect(await roleOf(R.pilot)).toBe('pilot');
  await expect(R.pilot.locator('.item[data-rocket=titan]')).toBeVisible();
});

test('regression: a play or host link opened in another browser goes to the join form instead of hanging', async ({ browser }) => {
  const { code } = await createGame(browser);
  for (const path of [`/play/${code}`, `/host/${code}`]) {
    const p = await (await browser.newContext()).newPage();
    p.on('pageerror', e => pageErrors.push(e.message));
    await p.goto(path);
    await expect(p.getByRole('heading', { name: 'Join a game' })).toBeVisible();
    await expect(p.locator('#jcode')).toHaveValue(code);
    await expect(p.locator('.pill.bad')).toBeVisible();
  }
});

// jsqr is CommonJS with a `default` export; unwrap it the same way under tsc and Playwright.
type Decode = typeof jsQRModule.default;
const jsQR: Decode = (jsQRModule as unknown as { default?: Decode }).default ?? (jsQRModule as unknown as Decode);

/** Rasterize the on-screen QR (exactly what the browser drew) and decode it like a phone camera would. */
async function scanQr(page: Page): Promise<string | undefined> {
  const size = 400;
  const px = await page.locator('.qrbox svg.qr').evaluate(async (svg, n) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, n, n);
    return Array.from(g.getImageData(0, 0, n, n).data);
  }, size);
  return jsQR(Uint8ClampedArray.from(px), size, size)?.data;
}

test('the lobby QR code scans to the join link, and a phone that scans it can join', async ({ browser }) => {
  const { host, code } = await createGame(browser);
  await expect(host.locator('.qrbox.big svg.qr')).toBeVisible();
  const url = await scanQr(host);
  expect(url).toBe(`${new URL(host.url()).origin}/join/${code}`);
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  phone.on('pageerror', e => pageErrors.push(`phone: ${e.message}`));
  await phone.goto(url!);
  await expect(phone.locator('#jcode')).toHaveValue(code);
  await phone.locator('#jname').fill('Scanner');
  await phone.getByRole('button', { name: 'Join' }).click();
  await expect(phone.getByText("You're in, Scanner")).toBeVisible();
});

test('after the lobby a small QR stays for latecomers and enlarges on tap', async ({ browser }) => {
  const { host, code } = await createGame(browser);
  await joinGame(browser, code, 'Early');
  await host.getByRole('button', { name: /Make teams/ }).click();
  const small = host.locator('button.qrbox.small');
  await expect(small).toBeVisible();
  expect((await small.boundingBox())!.width).toBeLessThan(80);
  await small.click();
  await expect(host.locator('button.qrbox.big')).toHaveAttribute('aria-expanded', 'true');
  expect((await host.locator('button.qrbox.big').boundingBox())!.width).toBeGreaterThan(110);
  expect(await scanQr(host)).toBe(`${new URL(host.url()).origin}/join/${code}`);
  await host.locator('button.qrbox.big').click();
  await expect(host.locator('button.qrbox.small')).toBeVisible();
});

test('the big screen opens from the host page: no controls, follows the game live, scannable', async ({ browser }) => {
  const { host, code } = await createGame(browser);
  const [screen] = await Promise.all([host.context().waitForEvent('page'), host.getByRole('link', { name: 'Open big screen' }).click()]);
  screen.on('pageerror', e => pageErrors.push(`screen: ${e.message}`));
  await expect(screen).toHaveURL(new RegExp(`/screen/${code}$`));
  await expect(screen.locator('.joincode')).toHaveText(code);
  expect(await scanQr(screen)).toBe(`${new URL(host.url()).origin}/join/${code}`);
  await expect(screen.locator('header.mast')).toBeHidden();
  await joinGame(browser, code, 'Projected');
  await expect(screen.locator('.chips')).toContainText('Projected');
  await host.getByRole('button', { name: /Make teams/ }).click();
  await expect(screen.getByRole('heading', { name: 'Teams' })).toBeVisible();
  await host.getByRole('button', { name: 'Start mission 1' }).click();
  await expect(screen.locator('.bs-clock .tmr')).toHaveText(/\d:\d\d/);
  await expect(screen.locator('.screen-join .code')).toHaveText(code);
  expect(await screen.locator('button, input, select, textarea, [data-act]').count()).toBe(0);
  await screen.reload();
  await expect(screen.locator('.bs-clock')).toBeVisible();
});

test('a big-screen link opened outside the host browser goes to the join form', async ({ browser }) => {
  const { code } = await createGame(browser);
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(`/screen/${code}`);
  await expect(stranger).toHaveURL(/\/$/);
  await expect(stranger.locator('#jcode')).toHaveValue(code);
  await expect(stranger.getByText(/big screen opens from the host's browser/)).toBeVisible();
});

/** A WebSocket bot that joins as a solo team (all four roles) and launches a cat as soon as the shared pool allows. */
const botLaunches = (baseURL: string, code: string) => botJoin(baseURL, code, 'Rocketeer');
async function launchSolo(b: Client) {
  await b.until(() => b.view?.phase === 'play', 10_000, 'mission started');
  b.act({ a: 'transfer', from: 'captain', to: 'vet', amount: 5 });
  b.act({ a: 'transfer', from: 'captain', to: 'pilot', amount: 8 });
  b.act({ a: 'transfer', from: 'captain', to: 'engineer', amount: 2 });
  b.act({ a: 'buyAnimal', animal: 'cat', maxPrice: 99 });
  b.act({ a: 'buyRocket', rocket: 'compact', maxPrice: 99 }); // needs 20 fuel
  // Views only arrive when something changes, so project the game clock forward from the last one.
  const t0 = Date.now(), s0 = b.pv.serverNow, speed = b.pv.speed || 1;
  const pool = () => { const m = b.pv.console?.engineer?.market; return m ? fuelInPool(m.resetAt, m.ratePerSec, s0 + (Date.now() - t0) * speed) : 0; };
  await expect.poll(pool, { timeout: 15_000 }).toBeGreaterThanOrEqual(20);
  b.act({ a: 'buyFuel', minUnits: 1 });
  await b.until(() => (b.pv.console?.engineer?.stock ?? 0) >= 20, 10_000, 'fuel in stock');
  b.act({ a: 'sendFuel' }); b.act({ a: 'sendFuel' });
  await b.until(() => b.pv.team?.status.fuel === true, 5000, 'fuel loaded');
  b.act({ a: 'launch' });
  await b.until(() => b.pv.team?.status.launched === true, 5000, 'launched');
}

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`a launch lifts off once on the big screen (${motion === 'reduce' ? 'reduced motion: no movement' : 'animated'})`, async ({ browser, baseURL }) => {
    const { host, code } = await createGame(browser, { income: 20 });
    const [screen] = await Promise.all([host.context().waitForEvent('page'), host.getByRole('link', { name: 'Open big screen' }).click()]);
    screen.on('pageerror', e => pageErrors.push(`screen: ${e.message}`));
    await screen.emulateMedia({ reducedMotion: motion });
    const bot = await botLaunches(baseURL!, code);
    await host.getByRole('button', { name: /Make teams/ }).click();
    await host.getByRole('button', { name: 'Start mission 1' }).click();
    await expect(screen.locator('.bs-clock')).toBeVisible();
    await launchSolo(bot);
    const lift = screen.locator('#liftoffs .liftoff');
    await expect(lift).toHaveCount(1);
    await expect(lift).toContainText('launched');
    const team = (await screen.locator('.bs-team b').first().innerText()).trim();
    await expect(lift).toContainText(team);
    const anim = await lift.evaluate(el => getComputedStyle(el).animationName);
    expect(anim).toBe(motion === 'reduce' ? 'liftoff-still' : 'liftoff');
    await expect(lift).toHaveCount(0, { timeout: 6000 });
    await screen.reload();
    await expect(screen.locator('.bs-team.done')).toHaveCount(1);
    await screen.waitForTimeout(800);
    await expect(screen.locator('#liftoffs .liftoff')).toHaveCount(0); // not replayed
    bot.close();
  });
}

test('the host link survives a reload and a wrong code gets a clear error', async ({ browser }) => {
  const { host, code } = await createGame(browser);
  await host.reload();
  await expect(host.locator('.joincode')).toHaveText(code);
  const p = await (await browser.newContext()).newPage();
  await p.goto('/join/ZZZZ');
  await p.locator('#jname').fill('Lost');
  await p.getByRole('button', { name: 'Join' }).click();
  await expect(p.locator('#toast')).toHaveText(/No game with that code/);
});

async function toFinalReport(browser: Browser) {
  const { host, code } = await createGame(browser);
  const p = await joinGame(browser, code, 'Solo');
  await host.locator('#s-rnd').fill('1');
  await host.getByRole('button', { name: /Make teams/ }).click();
  await host.getByRole('button', { name: 'Start mission 1' }).click();
  await host.getByRole('button', { name: /End mission now/ }).click();
  await host.getByRole('button', { name: 'Show the final report' }).click();
  await expect(host.locator('#winner')).toBeVisible();
  return { host, p, code };
}

test('Copy results puts a readable report on the clipboard', async ({ browser }) => {
  const { host, code } = await toFinalReport(browser);
  await host.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await host.getByRole('button', { name: 'Copy results' }).click();
  await expect(host.locator('#toast')).toHaveText(/Results copied/);
  const text = await host.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain(`mission report (game ${code})`);
  expect(text).toContain('No team landed an animal');
  expect(text).toMatch(/Leaderboard\n1\. .+: 0 points/);
  expect(text).toMatch(/Mission 1\n- .+: Never launched/);
});

test('without a clipboard, Copy results opens the text, selected and ready to copy', async ({ browser }) => {
  const { host, code } = await toFinalReport(browser);
  await host.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await host.getByRole('button', { name: 'Copy results' }).click();
  const box = host.locator('#results-text');
  await expect(box).toBeVisible();
  await expect(box).toBeFocused();
  expect(await box.evaluate((t: HTMLTextAreaElement) => t.value.slice(t.selectionStart, t.selectionEnd))).toContain(`game ${code}`);
  // and it stays open through later screen updates
  await host.waitForTimeout(1500);
  await expect(box).toBeVisible();
});

test('regression: an opened panel stays open when the screen updates', async ({ browser }) => {
  const { host, code } = await createGame(browser);
  await joinGame(browser, code, 'First');
  await host.getByRole('button', { name: /Make teams/ }).click();
  const panel = host.locator('details', { hasText: 'Players (' });
  await panel.locator('summary').click();
  await expect(panel).toHaveAttribute('open', '');
  const late = await (await browser.newContext()).newPage(); // joining re-renders the host's screen
  await late.goto(`/join/${code}`);
  await late.locator('#jname').fill('Latecomer');
  await late.getByRole('button', { name: 'Join' }).click();
  await expect(panel).toContainText('Players (2)');
  await expect(panel).toHaveAttribute('open', '');
});

test('running out of time ends the mission and locks the console', async ({ browser }) => {
  const { host, code } = await createGame(browser, { minutes: 0.5 }); // 3 real seconds at 10x
  const p = await joinGame(browser, code, 'Solo');
  await host.getByRole('button', { name: /Make teams/ }).click();
  await host.getByRole('button', { name: 'Start mission 1' }).click();
  await expect(p.locator('.tmr').first()).toHaveText(/0:0\d|Time's up/);
  await expect(host.locator('#results')).toBeVisible({ timeout: 15_000 });
  await expect(p.locator('#results')).toContainText('Never launched');
});

test('a solo player holds all four roles with tabs', async ({ browser }) => {
  const { host, code } = await createGame(browser);
  const p = await joinGame(browser, code, 'Solo');
  await host.getByRole('button', { name: /Make teams/ }).click();
  await host.getByRole('button', { name: 'Start mission 1' }).click();
  await expect(p.locator('.tabs button')).toHaveCount(4);
  await p.locator('.tabs button', { hasText: 'Engineer' }).click();
  await expect(p.getByRole('button', { name: 'Buy $1' })).toBeVisible();
  await expect(p.locator('.console')).toHaveAttribute('data-role', 'engineer');
});

test('works on a phone-sized screen without sideways scrolling', async ({ browser }) => {
  const { players } = await setupMission(browser, { mobileFor: 0 });
  const overflow = await players[0]!.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('no console errors on any screen', async ({ browser }) => {
  const errors: string[] = [];
  const watch = (p: Page) => { p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); }); };
  const { host, players } = await setupMission(browser);
  [host, ...players].forEach(watch);
  for (const p of players) await p.reload();
  await host.reload();
  await expect(host.locator('.joincode')).toBeVisible();
  expect(errors).toEqual([]);
});
