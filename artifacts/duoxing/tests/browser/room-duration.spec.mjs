import { test, expect } from '@playwright/test';

test('creation choices are unobtrusive at 320px and explicitly send the default or selected lifetime', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 874 });
  for (const hours of [12, 1, 3, 24]) {
    await page.goto('/');
    await expect(page.getByTestId('duration-12')).toHaveAttribute('aria-pressed', 'true');
    for (const option of [1, 3, 12, 24]) {
      const box = await page.getByTestId(`duration-${option}`).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByTestId(`duration-${hours}`).click();
    await expect(page.getByTestId(`duration-${hours}`)).toHaveAttribute('aria-pressed', 'true');
    const sent = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === '/api/rooms');
    const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/rooms');
    await page.getByTestId('button-create-room').click();
    expect((await sent).postDataJSON().durationHours).toBe(hours);
    const room = await (await response).json();
    await expect(page.getByTestId('form-preferences')).toBeVisible();
    const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('duoxing:recent-room')));
    expect(recent.roomCode).toBe(room.roomCode);
    expect(recent.expiresAt).toBe(room.expiresAt);
    await expect(page.locator('body')).not.toContainText(/剩余时间|倒计时|即将过期|饭局保留时间|\d+小时/);
    await expect(page.locator('[role="progressbar"]')).toHaveCount(0);
    await page.goto('/');
    await page.getByTestId('button-return-room').click();
    await expect(page).toHaveURL(new RegExp(`/room/${room.roomCode}$`));
    await expect(page.getByTestId('form-preferences')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('form-preferences')).toBeVisible();
  }
});

test('server expiry shows a gentle ended screen while network failure does not', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('button-create-room').click();
  await expect(page.getByTestId('form-preferences')).toBeVisible();
  const url = page.url();
  // Only the response is simulated. Real rejection of expired operations is API-tested.
  await page.route('**/api/rooms/*/me', route => route.fulfill({
    status: 401, contentType: 'application/json',
    body: JSON.stringify({ error: '房间已过期，无法继续使用。', code: 'ROOM_EXPIRED' }),
  }));
  await page.reload();
  await expect(page.getByTestId('state-room-error')).toContainText('这次饭局已经结束啦 🍃');
  await expect(page.getByTestId('button-retry-room')).toHaveText('创建新饭局');
  await page.unroute('**/api/rooms/*/me');
  await page.route('**/api/rooms/*/me', route => route.abort('failed'));
  await page.goto(url);
  await expect(page.getByTestId('state-room-error')).toContainText('房间暂时打不开');
  await expect(page.getByTestId('state-room-error')).not.toContainText('这次饭局已经结束啦');
});
