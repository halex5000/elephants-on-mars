// Sound is opt-in on phones, on by default for the host, and the choice survives a reload.
import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, test } from '@playwright/test';
import { E2E_PASSCODE } from './env.js';

test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map(c => c.close()));
});

async function host(browser: Browser) {
  const p = await (await browser.newContext()).newPage();
  await p.addInitScript(pass => localStorage.setItem('eom-host-pass', JSON.stringify(pass)), E2E_PASSCODE);
  await p.goto('/');
  await p.getByRole('button', { name: 'Create a game' }).click();
  await expect(p).toHaveURL(/\/host\//);
  return p;
}

test('host sound starts on, a phone starts muted, and each choice persists across reloads', async ({ browser }) => {
  const h = await host(browser);
  const hostSound = h.getByRole('button', { name: 'Sound' });
  await expect(hostSound).toHaveAttribute('aria-pressed', 'true');
  expect((await new AxeBuilder({ page: h }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  await hostSound.click();
  await expect(hostSound).toHaveAttribute('aria-pressed', 'false');
  await h.reload();
  await expect(hostSound).toHaveAttribute('aria-pressed', 'false');

  const code = (await h.locator('.joincode').innerText()).trim();
  const p = await (await browser.newContext()).newPage();
  await p.goto(`/join/${code}`);
  await expect(p.getByRole('button', { name: 'Sound' })).toBeHidden(); // no control on the join form
  await p.locator('#jname').fill('Ana');
  await p.getByRole('button', { name: 'Join' }).click();
  await expect(p).toHaveURL(/\/play\//);
  const phoneSound = p.getByRole('button', { name: 'Sound' });
  await expect(phoneSound).toHaveAttribute('aria-pressed', 'false');
  await phoneSound.click();
  await expect(phoneSound).toHaveAttribute('aria-pressed', 'true');
  expect((await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  await p.reload();
  await expect(phoneSound).toHaveAttribute('aria-pressed', 'true');
  // the host's choice is separate from the phone's
  await expect(hostSound).toHaveAttribute('aria-pressed', 'false');
});
