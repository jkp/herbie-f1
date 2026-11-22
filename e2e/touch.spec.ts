import { test, expect, type Page } from '@playwright/test';
import { pickRace } from './flow';

test.use({ viewport: { width: 1133, height: 744 }, hasTouch: true, isMobile: true });

const sessions = new Map<Page, import('@playwright/test').CDPSession>();
// Real multi-touch via CDP so the game sees genuine touch pointers, like an iPad.
async function touch(page: Page, points: { x: number; y: number; id: number }[]) {
  const cdp = sessions.get(page) ?? await page.context().newCDPSession(page);
  sessions.set(page, cdp);
  await cdp.send('Input.dispatchTouchEvent', { type: points.length ? 'touchStart' : 'touchEnd', touchPoints: points });
}
const centre = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('race on an iPad with on-screen controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/?countdown=0');
  await expect(page.locator('#touch')).toBeHidden(); // not over the menu
  await pickRace(page, { track: 'Silverstone', team: 'Mercedes', driver: 'Lewis Hamilton' }, true);
  await expect(page.locator('#touch')).toBeVisible();

  const heading0 = await page.evaluate(() => (window as any).__game.race.player.car.heading);
  const gas = await centre(page, '[data-ctl=gas]'), right = await centre(page, '[data-ctl=right]');
  await touch(page, [{ ...gas, id: 1 }]);
  await page.waitForTimeout(2000);
  const kmh = Number(await page.locator('#speed').textContent());
  expect(kmh).toBeGreaterThan(60);

  await touch(page, [{ ...gas, id: 1 }, { ...right, id: 2 }]); // second finger steers while the first keeps the gas on
  await page.waitForTimeout(600);
  await touch(page, []);
  const heading1 = await page.evaluate(() => (window as any).__game.race.player.car.heading);
  expect(heading1).toBeGreaterThan(heading0 + 0.2); // steered right

  // controls release when fingers lift
  const ctl = await page.evaluate(() => (window as any).__game.touch);
  expect(ctl).toEqual({});

  await page.locator('[data-act=cam]').tap();
  expect(errors).toEqual([]);
});

test('TILT steers by turning the iPad like a steering wheel', async ({ page }) => {
  await page.goto('/?countdown=0');
  await pickRace(page, { track: 'Silverstone', team: 'Mercedes', driver: 'Lewis Hamilton' }, true);
  // a reading of the iPad held upright, turned clockwise by `turn` degrees
  const motion = (turn: number) => page.evaluate(turn => {
    const f = turn * Math.PI / 180, a = (screen.orientation?.angle ?? 0) * Math.PI / 180, sx = -Math.sin(f) * 9.81, sy = Math.cos(f) * 9.81;
    dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: sx * Math.cos(a) + sy * Math.sin(a), y: -sx * Math.sin(a) + sy * Math.cos(a), z: 0 } }));
  }, turn);
  await page.locator('[data-act=tilt]').tap();
  await expect(page.locator('[data-act=tilt]')).toHaveClass(/on/);
  await motion(0); // how it's held when switched on is straight ahead
  const gas = (await page.locator('[data-ctl=gas]').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gas.x + gas.width / 2, y: gas.y + gas.height / 2, id: 1 }] });
  await page.waitForTimeout(1200);
  for (let k = 0; k < 10; k++) { await motion(25); await page.waitForTimeout(50); }
  expect(await page.evaluate(() => (window as any).__game.race.player.car.steer)).toBeGreaterThan(0.5);
  for (let k = 0; k < 10; k++) { await motion(-25); await page.waitForTimeout(50); }
  expect(await page.evaluate(() => (window as any).__game.race.player.car.steer)).toBeLessThan(-0.5);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
});
