// Accessibility: axe (WCAG 2.1 A/AA) on every screen, plus checks axe can't make on
// its own: the information each role depends on has to reach a screen reader.
import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_PASSCODE } from './env.js';

const pageErrors: string[] = [];
test.afterEach(() => {
  expect(pageErrors, 'uncaught errors in the browser').toEqual([]);
  pageErrors.length = 0;
});

async function open(browser: Browser, name: string) {
  const p = await (await browser.newContext()).newPage();
  p.on('pageerror', e => pageErrors.push(`${name}: ${e.message}`));
  return p;
}
async function noViolations(p: Page, screen: string) {
  const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = r.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);
  expect(summary, `axe violations on ${screen}`).toEqual([]);
}
/** Host + 4 players (one full team) in separate browsers, minutes = game minutes at the 10x test clock. */
async function game(browser: Browser, minutes = 30) {
  const host = await open(browser, 'host');
  await host.addInitScript(p => localStorage.setItem('eom-host-pass', JSON.stringify(p)), E2E_PASSCODE);
  await host.goto('/');
  await host.getByRole('button', { name: 'Create a game' }).click();
  await expect(host).toHaveURL(/\/host\//);
  const code = (await host.locator('.joincode').innerText()).trim();
  const players: Page[] = [];
  for (const n of ['Ana', 'Ben', 'Cal', 'Dee']) {
    const p = await open(browser, n);
    await p.goto(`/join/${code}`);
    await p.locator('#jname').fill(n);
    await p.getByRole('button', { name: 'Join' }).click();
    await expect(p).toHaveURL(/\/play\//);
    players.push(p);
  }
  await host.locator('#s-min').fill(String(minutes));
  return { host, code, players };
}
const byRole = async (players: Page[], role: string) => {
  for (const p of players) if ((await p.locator('.console').getAttribute('data-role')) === role) return p;
  throw new Error(`nobody is ${role}`);
};

test('no axe violations on any screen, for any role', async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, players } = await game(browser);
  await noViolations(host, 'host lobby');
  await noViolations(players[0]!, 'player lobby');
  const [screen] = await Promise.all([host.context().waitForEvent('page'), host.getByRole('link', { name: 'Open big screen' }).click()]);
  await expect(screen.locator('.joincode')).toBeVisible();
  await noViolations(screen, 'big screen lobby');
  await host.getByRole('button', { name: /Make teams/ }).click();
  await expect(host.getByRole('heading', { name: 'Teams' })).toBeVisible();
  await noViolations(host, 'host teams');
  await noViolations(players[0]!, 'briefing');
  await host.getByRole('button', { name: 'Start mission 1' }).click();
  await expect(screen.locator('.bs-clock')).toBeVisible();
  for (const role of ['captain', 'vet', 'pilot', 'engineer']) {
    const p = await byRole(players, role);
    await expect(p.locator('.console')).toBeVisible();
    await noViolations(p, `${role} console`);
  }
  await noViolations(host, 'host mission');
  await noViolations(screen, 'big screen mission');
  await host.getByRole('button', { name: /End mission now/ }).click();
  await expect(host.locator('#results')).toBeVisible();
  await noViolations(host, 'results');
  await noViolations(players[0]!, 'player results');
  await host.getByRole('button', { name: /End game early/ }).click();
  await expect(host.locator('#winner')).toBeVisible();
  await noViolations(host, 'final');
  await noViolations(players[0]!, 'player final');
  const home = await open(browser, 'home');
  await home.goto('/');
  await noViolations(home, 'home');
});

test('screen readers get what each role needs: sizes, points, fuel, whose dollar, which tab, status', async ({ browser }) => {
  const { host, players } = await game(browser);
  await host.getByRole('button', { name: /Make teams/ }).click();
  await host.getByRole('button', { name: 'Start mission 1' }).click();
  const vet = await byRole(players, 'vet');
  const pilot = await byRole(players, 'pilot');
  const captain = await byRole(players, 'captain');
  // Vet: size and points are spoken, and every Take button says which animal
  const animals = vet.getByRole('region', { name: 'Animals for sale' });
  await expect(animals.locator('[data-animal=giraffe]')).toContainText('size L, 40 points');
  await expect(vet.getByRole('button', { name: 'Take Giraffe' })).toBeVisible();
  // Pilot: size and fuel need are spoken
  await expect(pilot.getByRole('region', { name: 'Rockets for sale' }).locator('[data-rocket=heavy]')).toContainText(
    'size L, needs 55 fuel',
  );
  // Captain: three distinct Give buttons
  for (const r of ['Vet', 'Pilot', 'Engineer']) await expect(captain.getByRole('button', { name: `Give $1 to the ${r}` })).toBeVisible();
  // Status lights say their state, and it changes when the Vet buys
  await expect(vet.getByRole('img', { name: 'Animal: not yet' })).toBeVisible();
  await captain.getByRole('button', { name: 'Give $1 to the Vet' }).click();
  await captain.getByRole('button', { name: 'Give $1 to the Vet' }).click();
  await captain.getByRole('button', { name: 'Give $1 to the Vet' }).click();
  await expect(vet.getByRole('button', { name: 'Take Cat' })).toBeEnabled({ timeout: 15_000 });
  await vet.getByRole('button', { name: 'Take Cat' }).click();
  await expect(vet.getByRole('img', { name: 'Animal: on board' })).toBeVisible();
  await expect(host.getByRole('img', { name: 'animal: done' })).toBeVisible();
  // The product list scrolls, so keyboard users can reach it
  await expect(animals).toHaveAttribute('tabindex', '0');
});

test('the clock is announced at milestones and when the mission ends, not every second', async ({ browser }) => {
  const { host, players } = await game(browser, 2); // 2 game minutes = 12 real seconds at 10x
  await host.getByRole('button', { name: /Make teams/ }).click();
  await host.getByRole('button', { name: 'Start mission 1' }).click();
  const p = players[0]!;
  const said: string[] = [];
  await p.exposeFunction('__said', (t: string) => said.push(t));
  await p.evaluate(() => {
    const el = document.getElementById('announce')!;
    new MutationObserver(() => el.textContent && (window as unknown as { __said: (t: string) => void }).__said(el.textContent)).observe(
      el,
      {
        childList: true,
        characterData: true,
        subtree: true,
      },
    );
  });
  await expect(p.locator('#announce')).toHaveText('10 seconds left', { timeout: 10_000 });
  await expect(p.locator('#announce')).toHaveText('Mission over. Results are in.', { timeout: 15_000 });
  expect(said.filter(t => t === '10 seconds left')).toHaveLength(1);
  expect(said.length).toBeLessThanOrEqual(3);
});
