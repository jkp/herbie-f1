import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1133, height: 744 }, hasTouch: true, isMobile: true });

// Real multi-touch via CDP so the game sees genuine touch pointers, like an iPad.
async function touch(page: Page, points: { x: number; y: number; id: number }[]) {
  const cdp = await page.context().newCDPSession(page);
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
  await page.locator('#menu').tap();
  await expect(page.locator('#touch')).toBeVisible();

  const heading0 = await page.evaluate(() => (window as any).__game.race.player.car.heading);
  const gas = await centre(page, '[data-ctl=gas]'), right = await centre(page, '[data-ctl=right]');
  await touch(page, [{ ...gas, id: 1 }, { ...right, id: 2 }]);
  await page.waitForTimeout(2500);
  await touch(page, []);

  const kmh = Number(await page.locator('#speed').textContent());
  expect(kmh).toBeGreaterThan(60);
  const heading1 = await page.evaluate(() => (window as any).__game.race.player.car.heading);
  expect(heading1).toBeGreaterThan(heading0 + 0.2); // steered right

  // controls release when fingers lift
  const ctl = await page.evaluate(() => (window as any).__game.touch);
  expect(ctl).toEqual({});

  await page.locator('[data-act=cam]').tap();
  expect(errors).toEqual([]);
});
