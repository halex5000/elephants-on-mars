import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { Client, join, playBot } from '../bot.js';
import { E2E_PASSCODE } from './env.js';

test('a landed passenger stays on the shared map and the host downloads the postcard', async ({ page, baseURL }) => {
  const host = new Client(baseURL!);
  await host.opened;
  host.send({ t: 'create', passcode: E2E_PASSCODE });
  await host.until(() => host.view?.kind === 'host');
  const { code, hostToken } = host.creds!;
  await page.goto('/');
  await page.evaluate(({ code, hostToken }) => localStorage.setItem(`eom-host-${code}`, JSON.stringify(hostToken)), { code, hostToken });
  await page.goto(`/host/${code}`);
  // Anchor to a fresh server view even when other tests have used the accelerated server for minutes.
  const clockStart = host.hv.serverNow;
  const start = Date.now();
  const pilot = await join(
    baseURL!,
    code,
    'Scout',
    playBot(new Map(), () => 'cat', { clock: () => clockStart + (Date.now() - start) * host.hv.speed }),
  );
  try {
    host.act({ a: 'makeTeams', settings: { rounds: 1, minutes: 10, income: 40 } });
    await host.until(() => host.hv.phase === 'teams');
    host.act({ a: 'startRound' });
    await host.until(() => host.hv.stats.launched === 1, 30000);
    host.act({ a: 'endRound' });
    const map = page.getByRole('img', { name: 'Greetings from Mars' });
    await expect(map).toContainText('Clipboard');
    host.act({ a: 'finish' });
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Mars postcard' }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(`elephants-on-mars-${code}.svg`);
    const svg = await readFile((await download.path())!, 'utf8');
    expect(svg).toContain('Clipboard, Cat');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toContain(hostToken!);
    await page.goto(`/screen/${code}`);
    await expect(map).toContainText('Clipboard');
    await expect(page.getByRole('button', { name: 'Download Mars postcard' })).toHaveCount(0);
  } finally {
    pilot.close();
    host.close();
  }
});
