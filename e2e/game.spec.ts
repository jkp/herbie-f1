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

test('results screen offers race again and main menu', async ({ page }) => {
  await page.goto('/?countdown=0&laps=1');
  await pickRace(page, { track: 'Monza', team: 'Williams', driver: 'Alexander Albon' });
  // jump the player to just short of the line on the final lap
  await page.evaluate(() => { const r = (window as any).__game.race; r.player.total = r.track.length * r.laps - 0.001; });
  await page.keyboard.down('ArrowUp');
  await expect(page.getByRole('heading', { name: 'CHEQUERED FLAG' })).toBeVisible();
  await page.keyboard.up('ArrowUp');
  await expect(page.locator('#verdict')).toContainText(/Italian Grand Prix|You finished P/);
  await expect(page.locator('#resrows tr')).toHaveCount(20);

  await page.getByRole('button', { name: 'Race again' }).click();
  await expect(page.locator('#results')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__game.race.player.completed)).toBe(0);

  await page.evaluate(() => { const r = (window as any).__game.race; r.player.total = r.track.length * r.laps - 0.001; });
  await page.keyboard.down('ArrowUp');
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.keyboard.up('ArrowUp');
  await expect(page.getByRole('heading', { name: 'Main menu' })).toBeVisible();
});
