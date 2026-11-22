import { test, expect, type Page } from '@playwright/test';
import { skipCutscene } from './flow';

const finishRace = async (page: Page) => {
  // put the player just short of the flag, then drive over it
  await page.evaluate(() => { const r = (window as any).__game.race; r.player.total = r.track.length * r.laps - 0.001; });
  await page.keyboard.down('ArrowUp');
  await skipCutscene(page); // podium
  await page.keyboard.up('ArrowUp');
};

test('start a career as a 17-year-old, race round 1, and pick it up again after a reload', async ({ page }) => {
  await page.goto('/?countdown=0');
  await page.getByRole('button', { name: 'Career' }).click();
  await expect(page.getByRole('heading', { name: 'New career' })).toBeVisible();
  await page.getByLabel('Driver name').fill('Herbie Rocket');
  await page.getByLabel('Race number').fill('44');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('#career-error')).toContainText('Lewis Hamilton');
  await page.getByLabel('Race number').fill('17');
  await page.getByRole('button', { name: '3 laps' }).click();
  // what the driver looks like
  await page.getByRole('button', { name: 'Curly' }).click();
  await page.getByRole('button', { name: 'Skin tone 4' }).click();
  await page.getByRole('button', { name: 'Ginger' }).click();
  await expect(page.locator('#c-avatar')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Choose your first team' })).toBeVisible();
  await page.getByRole('button', { name: /^Williams/ }).click();
  await expect(page.locator('#cutscene')).toContainText('Williams');
  await skipCutscene(page);

  const hub = page.locator('#career-hub');
  await expect(hub).toContainText('Season 1');
  await expect(hub).toContainText('Age 17');
  await expect(hub).toContainText('Round 1 of 11');
  await expect(hub).toContainText('Bahrain Grand Prix');

  await page.getByRole('button', { name: 'Race', exact: true }).click();
  await expect(page.locator('#cutscene')).toContainText('Round 1 of 11');
  await skipCutscene(page);
  const me = await page.evaluate(() => { const r = (window as any).__game.race; return { code: r.player.code, team: r.player.team.name, laps: r.laps, track: r.track.name }; });
  expect(me).toEqual({ code: 'HER', team: 'Williams', laps: 3, track: 'Bahrain' });

  await finishRace(page);
  await expect(page.getByRole('button', { name: 'Race again' })).toBeHidden();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(hub).toContainText('Round 2 of 11');
  await expect(hub).toContainText('Spanish Grand Prix');
  await expect(page.locator('#standings')).toContainText('HER');

  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('herbie-f1-career')!).look)).toEqual({ skin: 3, hair: 2, hairColor: 3 });

  await page.reload();
  await page.getByRole('button', { name: 'Career' }).click();
  await expect(hub).toContainText('Round 2 of 11');
  await expect(hub).toContainText('Herbie Rocket');
});

test('a winning season ends with offers from the big teams and a move to Ferrari', async ({ page }) => {
  await page.goto('/?countdown=0');
  // a saved career on the last round, having won everything so far
  await page.evaluate(() => {
    const races = 10, others = ['VER', 'LEC', 'PER', 'SAI', 'HAM', 'RUS', 'NOR', 'ALO', 'OCO', 'BOT'];
    const points: Record<string, number> = { HER: 25 * races };
    others.forEach((c, k) => { points[c] = [18, 15, 12, 10, 8, 6, 4, 2, 1, 0][k] * races; });
    localStorage.setItem('herbie-f1-career', JSON.stringify({
      name: 'Herbie Rocket', code: 'HER', number: 17, team: 'Williams', age: 17, season: 1, round: races,
      difficulty: 0, laps: 3, points, finishes: Array(races).fill(1), history: [],
    }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Career' }).click();
  await expect(page.locator('#career-hub')).toContainText('Abu Dhabi Grand Prix');
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  await skipCutscene(page);
  await finishRace(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Season review' })).toBeVisible();
  await expect(page.locator('#season-review')).toContainText('World Champion');
  for (const t of ['Ferrari', 'Mercedes', 'McLaren']) await expect(page.getByRole('button', { name: new RegExp(`^Sign for ${t}`) })).toBeVisible();
  await page.getByRole('button', { name: /^Sign for Ferrari/ }).click();
  await expect(page.locator('#cutscene')).toContainText('Ferrari');
  await skipCutscene(page);
  const hub = page.locator('#career-hub');
  await expect(hub).toContainText('Season 2');
  await expect(hub).toContainText('Age 18');
  await expect(hub).toContainText('Ferrari');
  await expect(hub).toContainText('Round 1 of 11');
});
