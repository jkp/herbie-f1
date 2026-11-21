import { test, expect } from '@playwright/test';
import { pickRace } from './flow';

test('pick a track, car and driver, then drive off the grid', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Spa', team: 'Ferrari', driver: 'Charles Leclerc', difficulty: 'Legendary', laps: 15 });
  await expect(page.locator('#rows')).toContainText('LEC');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2500);
  await page.keyboard.up('ArrowUp');

  expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(80);
  await expect(page.locator('#pos')).toContainText('/20');
  await expect(page.locator('#lap')).toContainText('1/15');
  const race = await page.evaluate(() => { const r = (window as any).__game.race; return { track: r.track.name, me: r.player.code, difficulty: r.difficulty }; });
  expect(race).toEqual({ track: 'Spa-Francorchamps', me: 'LEC', difficulty: 5 });
  expect(errors).toEqual([]);
});

test('race settings default to Pro and 15 laps', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick race' }).click();
  await page.getByRole('button', { name: /Zandvoort/ }).click();
  await page.getByRole('button', { name: /McLaren/ }).click();
  await page.getByRole('button', { name: /Lando Norris/ }).click();
  await expect(page.getByRole('button', { name: '15 laps' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Pro', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('back buttons step back through the menus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick race' }).click();
  await page.getByRole('button', { name: /Monaco/ }).click();
  await expect(page.getByRole('heading', { name: 'Choose your car' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your track' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Main menu' })).toBeVisible();
});

test('results screen offers race again and main menu', async ({ page }) => {
  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Monza', team: 'Williams', driver: 'Alexander Albon', laps: 3 });
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
