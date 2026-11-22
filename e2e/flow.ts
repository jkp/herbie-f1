import { expect, type Page } from '@playwright/test';

/** Home → track → team → driver, by click or by touch. */
export async function pickRace(page: Page, o: { track: string; team: string; driver: string; difficulty?: string; laps?: number; tyre?: string; time?: string; weather?: string }, touch = false) {
  const press = (name: string | RegExp) => {
    const b = page.getByRole('button', { name, exact: typeof name === 'string' });
    return touch ? b.tap() : b.click();
  };
  await expect(page.getByRole('heading', { name: 'Main menu' })).toBeVisible();
  await press('Quick race');
  await expect(page.getByRole('heading', { name: 'Choose your track' })).toBeVisible();
  await press(new RegExp(`^${o.track}`));
  await expect(page.getByRole('heading', { name: 'Choose your car' })).toBeVisible();
  await press(new RegExp(o.team));
  await expect(page.getByRole('heading', { name: 'Choose your driver' })).toBeVisible();
  await press(new RegExp(o.driver));
  await expect(page.getByRole('heading', { name: 'Race settings' })).toBeVisible();
  await press(o.difficulty ?? 'Pro');
  await press(`${o.laps ?? 3} laps`);
  if (o.tyre) await press(o.tyre);
  if (o.time) await press(o.time);
  if (o.weather) await press(o.weather);
  await press('Start race');
  await skipCutscene(page, touch);
}

/** Skip whichever cutscene is playing (intro, podium…). */
export async function skipCutscene(page: Page, touch = false) {
  const c = page.locator('#cutscene');
  await expect(c).toBeVisible();
  await (touch ? c.tap() : c.click());
  await expect(c).toBeHidden();
}

/** Box this lap and put the player in the pit lane, `rel` metres from the line. */
export async function intoPitLane(page: Page, rel = -280) {
  await page.evaluate(rel => {
    const g = (window as any).__game, r = g.race, { pit } = r;
    r.player.boxRequested = true;
    g.place(r.track.length + rel, pit.side * pit.centre(rel));
    r.player.inPitLane = true;
  }, rel);
}
