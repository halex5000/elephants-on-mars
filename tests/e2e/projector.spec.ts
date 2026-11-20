import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { type Client, join } from '../bot.js';
import { E2E_PASSCODE } from './env.js';

for (const teams of [6, 12]) {
  test(`${teams}-team projector is readable and fits a 1080p frame`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(p => localStorage.setItem('eom-host-pass', JSON.stringify(p)), E2E_PASSCODE);
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a game' }).click();
    await expect(page).toHaveURL(/\/host\//);
    const code = (await page.locator('.joincode').innerText()).trim();
    const clients: Client[] = [];
    try {
      await page.locator('#s-size').fill('1');
      await page.locator('#s-min').fill('30');
      for (let i = 0; i < teams; i++) clients.push(await join(baseURL!, code, `Crew ${i}`, undefined, false));
      await page.getByRole('button', { name: /Make teams/ }).click();
      await page.getByRole('button', { name: 'Start mission 1' }).click();
      await page.goto(`/screen/${code}`);
      await expect(page.locator('.bs-clock')).toBeVisible();
      // Fill the feed with real purchases to exercise the full nine-row layout.
      for (const client of clients) {
        await client.until(() => client.pv.phase === 'play');
        client.act({ a: 'transfer', from: 'captain', to: 'vet', amount: 6 });
        client.act({ a: 'buyAnimal', animal: 'cat', maxPrice: 99 });
        client.act({ a: 'buyAnimal', animal: 'cat', maxPrice: 99 });
      }
      await expect(page.locator('.bs-feed div')).toHaveCount(teams > 10 ? 4 : 9);
      const labels =
        '.bs-clock small, .bs-pool .sm, .bs-stat small, .bs-feed div, .bs-team b, .screen-join .sm, .projected-ranking li, .projected-ranking summary';
      const sizes = await page
        .locator(labels)
        .evaluateAll(els => els.filter(el => (el as HTMLElement).offsetHeight > 0).map(el => parseFloat(getComputedStyle(el).fontSize)));
      expect(
        sizes.every(size => size >= 22),
        `player-facing text sizes: ${sizes}`,
      ).toBe(true);
      const board = await page.locator('.bigscreen').boundingBox();
      expect(board!.width).toBeGreaterThan(1800);
      expect(board!.y + board!.height).toBeLessThanOrEqual(1080);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1920);
      if (teams === 6) {
        await expect(page.locator('.bs-team')).toHaveCount(6);
        await expect(page.locator('.bs-team .sw').first()).toHaveCSS('width', '16px');
        await expect(page.locator('.bs-team .mini span').first()).toHaveCSS('width', '36px');
      } else {
        await expect(page.locator('.bs-team')).toHaveCount(0);
        await expect(page.locator('.projected-ranking li:visible')).toHaveCount(10);
      }
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(axe.violations).toEqual([]);
      await testInfo.attach(`projector-${teams}-teams`, { body: await page.screenshot(), contentType: 'image/png' });
      if (teams > 10) {
        await page.getByText('Show remaining 2 teams').click();
        await expect(page.locator('.projected-ranking li:visible')).toHaveCount(12);
      }
    } finally {
      for (const client of clients) client.close();
    }
  });
}
