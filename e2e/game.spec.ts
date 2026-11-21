import { test, expect } from '@playwright/test';

test('drive off the grid at Silverstone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/?countdown=0');
  await expect(page.locator('#title')).toContainText('Silverstone');
  await page.keyboard.press('Enter');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2500);
  await page.keyboard.up('ArrowUp');

  const kmh = Number(await page.locator('#speed').textContent());
  expect(kmh).toBeGreaterThan(80);
  await expect(page.locator('#pos')).toContainText('/6');
  await expect(page.locator('#lap')).toContainText('1/3');
  expect(errors).toEqual([]);
});
