import { expect, type Page } from '@playwright/test';

/** Home → track → team → driver, by click or by touch. */
export async function pickRace(page: Page, o: { track: string; team: string; driver: string; difficulty?: string; laps?: number }, touch = false) {
  const press = (name: string | RegExp) => {
    const b = page.getByRole('button', { name });
    return touch ? b.tap() : b.click();
  };
  await expect(page.getByRole('heading', { name: 'Main menu' })).toBeVisible();
  await press('Quick race');
  await expect(page.getByRole('heading', { name: 'Choose your track' })).toBeVisible();
  await press(new RegExp(o.track));
  await expect(page.getByRole('heading', { name: 'Choose your car' })).toBeVisible();
  await press(new RegExp(o.team));
  await expect(page.getByRole('heading', { name: 'Choose your driver' })).toBeVisible();
  await press(new RegExp(o.driver));
  await expect(page.getByRole('heading', { name: 'Race settings' })).toBeVisible();
  await press(o.difficulty ?? 'Pro');
  await press(`${o.laps ?? 3} laps`);
  await press('Start race');
}
