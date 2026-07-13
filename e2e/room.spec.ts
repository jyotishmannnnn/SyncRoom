import { expect, test, type Page } from '@playwright/test';

/* Room codes are capped at 10 chars (ROOM_CODE_MAX), so use the low bits of
   the timestamp: "e2e" + 5 base36 chars + worker index stays within the cap
   while remaining unique enough across runs and workers. */
const uniqueCode = (): string =>
  `e2e${Date.now().toString(36).slice(-5)}${test.info().workerIndex}`;

async function createAndJoin(page: Page, code: string, name: string, create: boolean) {
  await page.goto(`/room/${code}${create ? '?create=1' : ''}`);
  await expect(page.getByRole('heading', { name: 'Ready to join?' })).toBeVisible();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join now' }).click();
  await expect(page.getByRole('button', { name: /Leave call/ })).toBeVisible({ timeout: 10_000 });
}

test('home page renders both entry paths', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('watch together');
  await expect(page.getByRole('button', { name: /Create room/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
});

test('host can create a room and reach the call screen', async ({ page }) => {
  const code = uniqueCode();
  await createAndJoin(page, code, 'HostUser', true);
  // Room code visible in the top bar; self tile labeled.
  await expect(page.getByRole('button', { name: 'Copy room link' })).toContainText(code);
  await expect(page.getByText('HostUser (you)')).toBeVisible();
});

test('guest joins, both see each other, chat round-trips', async ({
  browser,
  browserName,
  page,
}) => {
  const code = uniqueCode();
  await createAndJoin(page, code, 'Host', true);

  // Firefox grants fake-media access via prefs; explicit grants are Chromium-only.
  const guestContext = await browser.newContext(
    browserName === 'firefox' ? {} : { permissions: ['camera', 'microphone'] },
  );
  const guest = await guestContext.newPage();
  await createAndJoin(guest, code, 'Guest', false);

  // Both parties see two participants.
  await expect(page.getByText('Guest', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await expect(guest.getByText('Host', { exact: false }).first()).toBeVisible();

  // Chat: host sends, guest receives.
  await page.getByRole('button', { name: /Chat \(C\)/ }).click();
  await page.getByLabel('Chat message').fill('hello from e2e');
  await page.getByRole('button', { name: 'Send message' }).click();

  await guest.getByRole('button', { name: /Chat \(C\)/ }).click();
  await expect(guest.getByText('hello from e2e')).toBeVisible({ timeout: 10_000 });

  await guestContext.close();
});

test('watch panel rejects unsupported links with specific errors', async ({ page }) => {
  const code = uniqueCode();
  await createAndJoin(page, code, 'Host', true);

  await page.getByRole('button', { name: /Watch together \(W\)/ }).click();
  const input = page.getByLabel('Video link');

  // Drive folder → specific explanation, room keeps working.
  await input.fill('https://drive.google.com/drive/folders/1AbCdEfGhIjKl');
  await page.getByRole('button', { name: 'Play now' }).click();
  await expect(page.getByText(/not a single file/)).toBeVisible();

  // YouTube playlist → specific explanation.
  await input.fill('https://www.youtube.com/playlist?list=PL123abc');
  await page.getByRole('button', { name: 'Play now' }).click();
  await expect(page.getByText(/no video in it/)).toBeVisible();

  // Room is still alive after the rejections.
  await expect(page.getByRole('button', { name: /Leave call/ })).toBeVisible();
});

test('fullscreen toggles locally for page and cinema stage', async ({ page }) => {
  const code = uniqueCode();
  await createAndJoin(page, code, 'Host', true);

  // Without media the toggle fullscreens the whole page.
  await page.getByRole('button', { name: /Fullscreen \(F\)/ }).click();
  await page.waitForFunction(() => document.fullscreenElement !== null);
  await page.getByRole('button', { name: /Exit fullscreen \(F\)/ }).click();
  await page.waitForFunction(() => document.fullscreenElement === null);

  // With media active, F targets the cinema stage (the black player wrapper).
  await page.getByRole('button', { name: /Watch together \(W\)/ }).click();
  await page.getByLabel('Video link').fill('http://localhost:3100/e2e-missing.mp4');
  await page.getByRole('button', { name: 'Play now' }).click();
  await page.keyboard.press('Escape'); // close the panel
  await page.keyboard.press('f');
  await page.waitForFunction(
    () => document.fullscreenElement?.classList.contains('bg-black') === true,
  );
  // The cinema bar lives inside the fullscreen element.
  await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.fullscreenElement === null);
});

test('joining a missing room shows a clear error', async ({ page }) => {
  // Must be a *valid-looking* code (≤10 chars) so the server answers
  // not-found rather than the client rejecting the format outright.
  await page.goto('/room/no-such-rm');
  await expect(page.getByRole('heading', { name: 'Ready to join?' })).toBeVisible();
  await page.getByLabel('Your name').fill('Nobody');
  await page.getByRole('button', { name: 'Join now' }).click();
  await expect(page.getByRole('alert')).toContainText('does not exist');
});
