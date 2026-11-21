import { test, expect } from '@playwright/test';
import { pickRace } from './flow';

test('pick a track, car and driver, then drive off the grid', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Spa', team: 'Ferrari', driver: 'Charles Leclerc' });
  await expect(page.locator('#rows')).toContainText('LEC');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2500);
  await page.keyboard.up('ArrowUp');

  expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(80);
  await expect(page.locator('#pos')).toContainText('/20');
  await expect(page.locator('#lap')).toContainText('1/3');
  const race = await page.evaluate(() => { const r = (window as any).__game.race; return { track: r.track.name, me: r.player.code }; });
  expect(race).toEqual({ track: 'Spa-Francorchamps', me: 'LEC' });
  expect(errors).toEqual([]);
});

test('back buttons step back through the menus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Race' }).click();
  await page.getByRole('button', { name: /Monaco/ }).click();
  await expect(page.getByRole('heading', { name: 'Choose your car' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your track' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Main menu' })).toBeVisible();
});
