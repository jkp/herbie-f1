import { test, expect } from '@playwright/test';
import { pickRace, skipCutscene } from './flow';

/** Put a racer (`who`: 'me' or the k-th AI car) at `s` m round the lap, `lat` right of centre, at `speed`, turned `dh` off the track's direction. */
async function put(page: import('@playwright/test').Page, who: 'me' | number, s: number, lat: number, speed: number, dh = 0) {
  await page.evaluate(([who, s, lat, speed, dh]) => {
    const g = (window as any).__game, r = g.race;
    const racer = who === 'me' ? r.player : r.racers.filter((x: any) => !x.isPlayer)[who as number];
    g.place(s, lat, racer);
    racer.car.heading += dh; racer.car.speed = speed;
  }, [who, s, lat, speed, dh] as const);
}

test('clip the back of a car and it spins: yellow flags', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?countdown=0&size=2');
  await pickRace(page, { track: 'Silverstone', team: 'Red Bull', driver: 'Max Verstappen', difficulty: 'Pro', laps: 5 });
  await put(page, 0, 800, 0, 30);
  await put(page, 'me', 796.5, 2, 45);
  await expect.poll(() => page.evaluate(() => (window as any).__game.race.racers.some((r: any) => !r.isPlayer && r.car.spin !== 0))).toBe(true);
  await expect(page.locator('#flag')).toContainText('YELLOW FLAG');
  expect(errors).toEqual([]);
});

test('crash out on Legendary: a slow-motion replay, then the results say DNF, and you can watch it again', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Silverstone', team: 'Ferrari', driver: 'Charles Leclerc', difficulty: 'Legendary', laps: 5 });
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1500); await page.keyboard.up('ArrowUp');
  const edge = await page.evaluate(() => { const t = (window as any).__game.race.track; return t.width / 2 + t.runoff + 0.5; });
  await put(page, 'me', 300, edge, 75, 0.9);
  await expect(page.locator('#cut-title')).toHaveText('REPLAY', { timeout: 10_000 });
  await expect(page.locator('#cut-sub')).toContainText(/crashed out/i);
  await skipCutscene(page);
  await expect(page.getByRole('heading', { name: 'CHEQUERED FLAG' })).toBeVisible();
  await expect(page.locator('#verdict')).toContainText(/crashed out/i);
  await expect(page.locator('#resrows tr.me')).toContainText('DNF');

  await page.getByRole('button', { name: 'Watch replay' }).click();
  await expect(page.locator('#cut-title')).toHaveText('REPLAY');
  await skipCutscene(page);
  await expect(page.getByRole('heading', { name: 'CHEQUERED FLAG' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a car crashing out brings out the safety car, and the TV shows a replay of the crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?countdown=0&size=3');
  await pickRace(page, { track: 'Silverstone', team: 'Red Bull', driver: 'Max Verstappen', difficulty: 'Pro', laps: 5 });
  await put(page, 'me', 1500, 0, 0);
  await put(page, 0, 800, 0, 5);
  await put(page, 1, 795.8, 0.4, 85);
  await expect(page.locator('#flag')).toContainText('SAFETY CAR');
  expect(await page.evaluate(() => (window as any).__game.stats().safetyCar)).toBe(true);
  await expect(page.locator('#cut-title')).toHaveText('REPLAY', { timeout: 10_000 });
  await expect(page.locator('#cut-sub')).toContainText(/safety car/i);
  await skipCutscene(page);
  expect(errors).toEqual([]);
});

test('finish the race and watch the replay of the finish from the results', async ({ page }) => {
  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Monza', team: 'Williams', driver: 'Alexander Albon', laps: 3 });
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1500);
  await page.evaluate(() => { const r = (window as any).__game.race; r.player.total = r.track.length * r.laps - 30; });
  await expect(page.locator('#cutscene')).toContainText(/PODIUM|YOU FINISHED P/);
  await page.keyboard.up('ArrowUp');
  await skipCutscene(page);
  await page.getByRole('button', { name: 'Watch replay' }).click();
  await expect(page.locator('#cut-title')).toHaveText('REPLAY');
  await expect(page.locator('#cut-sub')).toContainText(/finish/i);
  await skipCutscene(page);
  await expect(page.getByRole('heading', { name: 'CHEQUERED FLAG' })).toBeVisible();
});
