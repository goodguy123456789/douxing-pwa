import { test, expect } from '@playwright/test';

const headers = { 'X-Duoxing-Auth': 'token-v1' };
const participantKey = code => `duoxing:participant:${code}`;
const recentKey = 'duoxing:recent-room';

async function fixture(page, request) {
  const created = await request.post('/api/rooms', { headers, data: {} });
  expect(created.status()).toBe(201);
  const entry = await created.json();
  await page.goto('/');
  await page.evaluate(entry => {
    localStorage.setItem(`duoxing:participant:${entry.roomCode}`, entry.participantId);
    localStorage.setItem(`duoxing:token:${entry.roomCode}:${entry.participantId}`, entry.participantToken);
    localStorage.setItem('duoxing:recent-room', JSON.stringify({ roomCode: entry.roomCode, participantId: entry.participantId }));
  }, entry);
  return entry;
}

async function ownStatus(page, code) {
  return page.evaluate(async code => {
    const id = localStorage.getItem(`duoxing:participant:${code}`);
    const token = localStorage.getItem(`duoxing:token:${code}:${id}`);
    const response = await fetch(`/api/rooms/${code}/me`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, data: await response.json() };
  }, code);
}

test('two real participants return to a full room without rejoining, still submit/reveal, and remember only successful new entries', async ({ page: a, browser, baseURL }) => {
  const bContext = await browser.newContext({ baseURL, viewport: { width: 402, height: 874 } });
  const b = await bContext.newPage();
  try {
    await a.goto('/');
    await a.getByTestId('button-create-room').click();
    await expect(a.getByTestId('form-preferences')).toBeVisible();
    const code = new URL(a.url()).pathname.split('/').at(-1);
    await b.goto(`/room/${code}`);
    await b.getByTestId('button-enter-room').click();
    await expect(b.getByTestId('form-preferences')).toBeVisible();
    const aId = await a.evaluate(key => localStorage.getItem(key), participantKey(code));
    const bId = await b.evaluate(key => localStorage.getItem(key), participantKey(code));
    expect(Boolean(aId && bId && aId !== bId)).toBe(true);
    let joins = 0;
    for (const page of [a, b]) page.on('request', req => { if (new URL(req.url()).pathname.endsWith('/join')) joins++; });
    for (const page of [a, b]) {
      await page.goto('/');
      await page.reload();
      await expect(page.getByTestId('text-home-title')).toBeVisible(); // Never auto-redirect.
      await page.getByTestId('button-return-room').click();
      await expect(page.getByTestId('form-preferences')).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(`/room/${code}`);
      expect((await ownStatus(page, code)).data.participantCount).toBe(2);
    }
    expect(joins).toBe(0);
    await a.getByTestId('choice-cuisine-日料-love').click();
    await b.getByTestId('choice-cuisine-日料-okay').click();
    await a.getByTestId('button-submit-preferences').click();
    await expect(a.getByTestId('state-waiting')).toBeVisible();
    await expect(b.getByTestId('form-preferences')).toBeVisible();
    await b.getByTestId('button-submit-preferences').click();
    for (const page of [a, b]) await expect(page.getByTestId('state-results')).toBeVisible();
    expect((await ownStatus(a, code)).data.recommendations).toEqual((await ownStatus(b, code)).data.recommendations);
    expect((await ownStatus(a, code)).data.participantCount).toBe(2);

    await b.goto('/');
    await b.getByTestId('button-open-join').click();
    await b.route('**/api/rooms/ZZZZZZ/join', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"没有找到这个房间"}' }));
    await b.getByTestId('input-room-code').fill('ZZZZZZ');
    await b.getByTestId('button-join-room').click();
    await expect(b.getByTestId('error-join-room')).toBeVisible();
    expect(await b.evaluate(key => JSON.parse(localStorage.getItem(key)).roomCode, recentKey)).toBe(code);
    await a.goto('/');
    await a.getByTestId('button-create-room').click();
    await expect(a.getByTestId('form-preferences')).toBeVisible();
    const nextCode = new URL(a.url()).pathname.split('/').at(-1);
    expect(nextCode !== code).toBe(true);
    await b.getByTestId('input-room-code').fill(nextCode);
    await b.getByTestId('button-join-room').click();
    await expect(b.getByTestId('form-preferences')).toBeVisible();
    expect(await b.evaluate(key => JSON.parse(localStorage.getItem(key)).roomCode, recentKey)).toBe(nextCode);
    await b.goto('/');
    const beforeReturn = joins;
    await b.getByTestId('button-return-room').click();
    await expect(b.getByTestId('form-preferences')).toBeVisible();
    expect(new URL(b.url()).pathname).toBe(`/room/${nextCode}`);
    expect(joins).toBe(beforeReturn);
    expect((await ownStatus(b, nextCode)).data.participantCount).toBe(2);
  } finally { await bContext.close(); }
});

test('empty, pre-upgrade identity, missing token and real invalid token have distinct safe outcomes', async ({ page, request }) => {
  await page.goto('/');
  await page.getByTestId('button-return-room').click();
  await expect(page.getByTestId('notice-return-room')).toContainText('还没有上一次的饭局');
  const entry = await fixture(page, request);
  await page.evaluate(key => localStorage.removeItem(key), recentKey);
  await page.reload();
  await expect(page.getByTestId('text-home-title')).toBeVisible();
  await page.getByTestId('button-return-room').click();
  await expect(page.getByTestId('form-preferences')).toBeVisible();
  expect((await ownStatus(page, entry.roomCode)).data.participantCount).toBe(1);
  await page.goto('/');
  let reads = 0, joins = 0;
  page.on('request', req => {
    if (new URL(req.url()).pathname.endsWith('/me')) reads++;
    if (new URL(req.url()).pathname.endsWith('/join')) joins++;
  });
  await page.evaluate(entry => localStorage.removeItem(`duoxing:token:${entry.roomCode}:${entry.participantId}`), entry);
  await page.getByTestId('button-return-room').click();
  await expect(page.getByTestId('notice-return-room')).toContainText('无法恢复房间身份');
  expect(reads).toBe(0);
  await page.evaluate(entry => localStorage.setItem(`duoxing:token:${entry.roomCode}:${entry.participantId}`, 'f'.repeat(64)), entry);
  await page.getByTestId('button-return-room').click();
  await expect(page.getByTestId('notice-return-room')).toContainText('无法恢复房间身份');
  expect(reads).toBe(1);
  expect(joins).toBe(0);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('explicit authenticated expiry marker shows ended-room notice without rejoining or reactivation', async ({ page, request }) => {
  const entry = await fixture(page, request);
  await page.route(`**/api/rooms/${entry.roomCode}/me`, route => route.fulfill({
    status: 401, contentType: 'application/json', body: '{"error":"房间已过期","code":"ROOM_EXPIRED"}',
  }));
  await page.getByTestId('button-return-room').click();
  await expect(page.getByTestId('notice-return-room')).toContainText('上个饭局已经过期啦');
  await expect(page.getByTestId('button-return-action')).toHaveText('创建新饭局');
  expect(new URL(page.url()).pathname).toBe('/');
});

test('network and 503 retry preserve credentials; 426 asks to refresh instead of rejoining', async ({ page, request }) => {
  const entry = await fixture(page, request);
  const path = `**/api/rooms/${entry.roomCode}/me`;
  let kind = 'network';
  await page.route(path, route => kind === 'network' ? route.abort('failed')
    : route.fulfill({ status: Number(kind), contentType: 'application/json', body: '{"error":"暂不可用"}' }));
  await page.getByTestId('button-return-room').click();
  await expect(page.getByTestId('notice-return-room')).toContainText('暂时无法连接，请稍后再试');
  kind = '503';
  await page.getByTestId('button-return-action').click();
  await expect(page.getByTestId('notice-return-room')).toContainText('暂时无法连接，请稍后再试');
  expect(await page.evaluate(entry => localStorage.getItem(`duoxing:token:${entry.roomCode}:${entry.participantId}`) === entry.participantToken, entry)).toBe(true);
  kind = '426';
  await page.getByTestId('button-return-action').click();
  await expect(page.getByTestId('notice-return-room')).toContainText('请更新应用');
  await expect(page.getByTestId('button-return-action')).toHaveText('刷新页面');
  await page.unroute(path);
  await page.getByTestId('button-return-action').click();
  await expect(page.getByTestId('text-home-title')).toBeVisible();
  await page.getByTestId('button-return-room').click();
  await expect(page.getByTestId('form-preferences')).toBeVisible();
  expect((await ownStatus(page, entry.roomCode)).data.participantCount).toBe(1);
});

test('an unresponsive validation request times out visibly and allows retry', async ({ page, request }) => {
  const entry = await fixture(page, request);
  const path = `**/api/rooms/${entry.roomCode}/me`;
  // Hold only this browser-local request past the ten-second deadline.
  let held;
  await page.route(path, route => { held = route; });
  await page.getByTestId('button-return-room').click();
  await expect(page.getByTestId('notice-return-room')).toContainText('暂时无法连接，请稍后再试', { timeout: 13_000 });
  await expect(page.getByTestId('button-return-room')).toBeEnabled();
  await page.unroute(path);
  if (held) await held.abort().catch(() => {});
  await page.getByTestId('button-return-action').click();
  await expect(page.getByTestId('form-preferences')).toBeVisible();
});
