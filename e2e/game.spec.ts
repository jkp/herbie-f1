import { test, expect } from '@playwright/test';
import { pickRace, skipCutscene, intoPitLane } from './flow';

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
  await expect(page.locator('#cutscene')).toContainText(/PODIUM|YOU FINISHED P/);
  await page.keyboard.up('ArrowUp');
  await skipCutscene(page);
  await expect(page.getByRole('heading', { name: 'CHEQUERED FLAG' })).toBeVisible();
  await expect(page.locator('#verdict')).toContainText(/Italian Grand Prix|You finished P/);
  await expect(page.locator('#resrows tr')).toHaveCount(20);

  await page.getByRole('button', { name: 'Race again' }).click();
  await expect(page.locator('#results')).toBeHidden();
  await skipCutscene(page);
  expect(await page.evaluate(() => (window as any).__game.race.player.completed)).toBe(0);

  await page.evaluate(() => { const r = (window as any).__game.race; r.player.total = r.track.length * r.laps - 0.001; });
  await page.keyboard.down('ArrowUp');
  await skipCutscene(page);
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.keyboard.up('ArrowUp');
  await expect(page.getByRole('heading', { name: 'Main menu' })).toBeVisible();
});

test('drive into the pit lane: pick new tyres on the way in, the crew change them, then drive out', async ({ page }) => {
  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Silverstone', team: 'Ferrari', driver: 'Carlos Sainz', laps: 5 });
  await intoPitLane(page);
  await page.keyboard.down('ArrowUp');
  await expect(page.locator('#tyrepick')).toBeVisible();
  await page.getByRole('button', { name: /Hard/ }).click();
  await expect(page.locator('#cutscene')).toContainText('PIT STOP', { timeout: 20_000 });
  await expect(page.locator('#cutscene')).toBeHidden({ timeout: 15_000 });
  await page.keyboard.up('ArrowUp');
  const p = await page.evaluate(() => { const r = (window as any).__game.race.player; return { pits: r.pits, compound: r.compound, pit: r.pitTimer }; });
  expect(p).toEqual({ pits: 1, compound: 2, pit: 0 });
});

test('race settings offer 3 to 30 laps and a choice of starting tyres', async ({ page }) => {
  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Monza', team: 'Mercedes', driver: 'George Russell', laps: 30, tyre: 'Soft' });
  const r = await page.evaluate(() => { const r = (window as any).__game.race; return { laps: r.laps, compound: r.player.compound }; });
  expect(r).toEqual({ laps: 30, compound: 0 });
  await expect(page.locator('#tyres')).toContainText('S');
});

test('on Pro, arrows and a countdown show the way into the pit lane when you are called in', async ({ page }) => {
  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Silverstone', team: 'Ferrari', driver: 'Carlos Sainz', laps: 5 });
  await page.evaluate(() => { const g = (window as any).__game, r = g.race; r.player.boxRequested = true; g.place(r.track.length - 700, 0); });
  await expect(page.locator('#pitinfo')).toContainText(/PIT ENTRY \d+ m/);
  expect(await page.evaluate(() => (window as any).__game.stats().pitArrows)).toBe(true);
});

test('the intro cutscene names the Grand Prix and holds the start until it ends', async ({ page }) => {
  await page.goto('/?countdown=1');
  await page.getByRole('button', { name: 'Quick race' }).click();
  await page.getByRole('button', { name: /^Monaco/ }).click();
  await page.getByRole('button', { name: /Red Bull/ }).click();
  await page.getByRole('button', { name: /Verstappen/ }).click();
  await page.getByRole('button', { name: 'Start race' }).click();
  await expect(page.locator('#cutscene')).toContainText('Monaco Grand Prix');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).__game.race.phase)).toBe('countdown');
  await skipCutscene(page);
  await expect.poll(() => page.evaluate(() => (window as any).__game.race.phase)).toBe('racing');
});

test('the circuit has grandstands full of fans', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as any).__game.stats().fans)).toBeGreaterThan(2000);
});

test('a real driver sits in your car, and the pit crew time the stop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?countdown=0');
  await expect.poll(() => page.evaluate(() => (window as any).__game.stats().people), { timeout: 20_000 }).toBe(true);
  await pickRace(page, { track: 'Monza', team: 'McLaren', driver: 'Lando Norris', laps: 5 });
  expect(await page.evaluate(() => (window as any).__game.stats().driver)).toBe(true);
  await page.keyboard.press('KeyC'); // cockpit
  await intoPitLane(page);
  await page.keyboard.down('ArrowUp');
  await expect(page.locator('#cut-sub')).toHaveText(/^Stationary \d\.\ds/, { timeout: 20_000 });
  await page.keyboard.up('ArrowUp');
  expect(errors).toEqual([]);
});

test('on Beginner the car takes itself into the pits for the compulsory stop', async ({ page }) => {
  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Bahrain', team: 'Alpine', driver: 'Fernando Alonso', difficulty: 'Beginner', laps: 3 });
  // lap 2 of 3 is the pit lap: jump to near the end of it
  await page.evaluate(() => { const g = (window as any).__game, r = g.race; g.place(r.track.length - 700, 0); r.player.completed = 1; r.player.total = r.track.length * 2 - 700; });
  await page.keyboard.down('ArrowUp');
  await expect(page.locator('#pitinfo')).toContainText('AUTO PIT');
  await expect(page.locator('#cutscene')).toContainText('PIT STOP', { timeout: 40_000 });
  await page.keyboard.up('ArrowUp');
});

test('Monaco is surrounded by real buildings and has its tunnel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick race' }).click();
  await page.getByRole('button', { name: /^Monaco/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__game.stats().buildings), { timeout: 15_000 }).toBeGreaterThan(800);
  expect(await page.evaluate(() => (window as any).__game.stats().tunnels)).toBe(1);
});

test('pinch and double-tap cannot zoom the page during a race', async ({ page }) => {
  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Spa', team: 'Ferrari', driver: 'Charles Leclerc', difficulty: 'Pro', laps: 3 });
  const blocked = await page.evaluate(() => ['gesturestart', 'gesturechange', 'dblclick', 'touchmove'].map(type => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    document.querySelector('canvas')!.dispatchEvent(e);
    return [type, e.defaultPrevented];
  }));
  expect(Object.fromEntries(blocked)).toEqual({ gesturestart: true, gesturechange: true, dblclick: true, touchmove: true });
});

test('Spa is real 3D: the car climbs out of Eau Rouge up Raidillon, through dense forest', async ({ page }) => {
  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Spa', team: 'Ferrari', driver: 'Charles Leclerc', laps: 3 });
  await expect.poll(() => page.evaluate(() => (window as any).__game.stats().forest), { timeout: 15_000 }).toBeGreaterThan(15000);
  await page.evaluate(() => (window as any).__game.place(900, 0)); // the dip at Eau Rouge
  await expect.poll(() => page.evaluate(() => (window as any).__game.stats().carY)).toBeLessThan(-15);
  const dip = await page.evaluate(() => (window as any).__game.stats().carY);
  await page.keyboard.down('ArrowUp');
  await expect.poll(() => page.evaluate(() => (window as any).__game.stats().carY), { timeout: 10_000 }).toBeGreaterThan(dip + 10); // straight-line: it meets the barrier at the top of Eau Rouge
  await page.keyboard.up('ArrowUp');
});
