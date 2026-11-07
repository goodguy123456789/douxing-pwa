import { test, expect } from '@playwright/test';

async function fixture(browser, request, baseURL, tokenMode = 'valid') {
  const headers = { 'X-Duoxing-Auth': 'token-v1', 'X-Duoxing-Client': 'restaurants-v1' };
  const created = await request.post('/api/rooms', { headers, data: {areaId:'nanping'} });
  expect(created.status()).toBe(201);
  const a = await created.json();
  const joined = await request.post(`/api/rooms/${a.roomCode}/join`, { headers, data: {} });
  expect(joined.status()).toBe(201);
  const b = await joined.json();
  const context = await browser.newContext({ baseURL, viewport: { width: 402, height: 874 } });
  await context.addInitScript(({ code, id, token }) => {
    if (!sessionStorage.getItem('recovery-seeded')) {
      localStorage.setItem(`duoxing:participant:${code}`, id);
      if (token) localStorage.setItem(`duoxing:token:${code}:${id}`, token);
      sessionStorage.setItem('recovery-seeded', 'yes');
    }
  }, { code: a.roomCode, id: b.participantId,
    token: tokenMode === 'missing' ? null : tokenMode === 'invalid' ? 'a'.repeat(64) : b.participantToken });
  const page = await context.newPage();
  const path = `/api/rooms/${a.roomCode}/me`;
  const savedToken = () => page.evaluate(({ code, id }) =>
    localStorage.getItem(`duoxing:token:${code}:${id}`), { code: a.roomCode, id: b.participantId });
  const status = async () => {
    const response = await request.get(path, { headers: { 'X-Duoxing-Client':'restaurants-v1', Authorization: `Bearer ${a.participantToken}` } });
    expect(response.status()).toBe(200);
    return response.json();
  };
  return { a, b, context, page, path, savedToken, status,
    open: () => page.goto(`/room/${a.roomCode}`) };
}

test('lost token after refresh leaves loading immediately, never rejoins, and explicitly creates a different room', async ({ browser, request, baseURL }) => {
  const f = await fixture(browser, request, baseURL);
  try {
    await f.open();
    await expect(f.page.getByTestId('form-preferences')).toBeVisible();
    let roomReads = 0;
    let joins = 0;
    f.page.on('request', req => {
      const path = new URL(req.url()).pathname;
      if (path === f.path) roomReads++;
      if (path.endsWith('/join')) joins++;
    });
    await f.page.evaluate(({ code, id }) => localStorage.removeItem(`duoxing:token:${code}:${id}`),
      { code: f.a.roomCode, id: f.b.participantId });
    await f.page.reload();
    await expect(f.page.getByTestId('state-room-error')).toContainText('无法恢复房间身份');
    await expect(f.page.getByTestId('button-retry-room')).toHaveText('创建新饭局');
    await expect(f.page.getByTestId('state-room-loading')).toHaveCount(0);
    expect(roomReads).toBe(0);
    expect(joins).toBe(0);
    expect((await f.status()).participantCount).toBe(2);
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await f.page.getByTestId('button-retry-room').click();
    await f.page.getByTestId('select-meal-area').selectOption('nanping');
    await f.page.getByTestId('button-create-room').click();
    await expect(f.page.getByTestId('form-preferences')).toBeVisible();
    expect(new URL(f.page.url()).pathname !== `/room/${f.a.roomCode}`).toBe(true);
    expect((await f.status()).participantCount).toBe(2);
  } finally { await f.context.close(); }
});

test('real 401 shows lost identity once with no automatic retry or extra participant', async ({ browser, request, baseURL }) => {
  const f = await fixture(browser, request, baseURL, 'invalid');
  try {
    let reads = 0;
    f.page.on('request', req => { if (new URL(req.url()).pathname === f.path) reads++; });
    await f.open();
    await expect(f.page.getByTestId('state-room-error')).toContainText('无法恢复房间身份');
    await f.page.waitForTimeout(4800); // More than two former 2200ms polling cycles.
    expect(reads).toBe(1);
    expect((await f.status()).participantCount).toBe(2);
    expect((await f.savedToken()) === 'a'.repeat(64)).toBe(true);
  } finally { await f.context.close(); }
});

test('426 gives online-update guidance and full-page reload recovers valid identity', async ({ browser, request, baseURL }) => {
  const f = await fixture(browser, request, baseURL);
  try {
    await f.page.route(`**${f.path}`, route => route.fulfill({
      status: 426, contentType: 'application/json', body: JSON.stringify({ error: '应用已升级' }),
    }));
    await f.open();
    await expect(f.page.getByTestId('state-room-error')).toContainText('请更新应用');
    await expect(f.page.getByTestId('state-room-error')).toContainText('连接网络');
    await expect(f.page.getByTestId('button-retry-room')).toHaveText('刷新页面');
    await f.page.unroute(`**${f.path}`);
    await f.page.getByTestId('button-retry-room').click();
    await expect(f.page.getByTestId('form-preferences')).toBeVisible();
    expect((await f.savedToken()) === f.b.participantToken).toBe(true);
  } finally { await f.context.close(); }
});

test('network failure and temporary 503 offer explicit retry, preserve token and recover', async ({ browser, request, baseURL }) => {
  const f = await fixture(browser, request, baseURL);
  try {
    await f.page.route(`**${f.path}`, route => route.abort('internetdisconnected'));
    await f.open();
    await expect(f.page.getByTestId('state-room-error')).toContainText('检查网络后重试');
    expect((await f.savedToken()) === f.b.participantToken).toBe(true);
    await f.page.unroute(`**${f.path}`);
    await f.page.route(`**${f.path}`, route => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporary' }),
    }));
    await f.page.getByTestId('button-retry-room').click();
    await expect(f.page.getByTestId('state-room-error')).toContainText('服务暂时不可用');
    expect((await f.savedToken()) === f.b.participantToken).toBe(true);
    await f.page.unroute(`**${f.path}`);
    await f.page.getByTestId('button-retry-room').click();
    await expect(f.page.getByTestId('form-preferences')).toBeVisible();
    await f.page.reload();
    await expect(f.page.getByTestId('form-preferences')).toBeVisible();
    expect((await f.savedToken()) === f.b.participantToken).toBe(true);
    expect((await f.status()).participantCount).toBe(2);
  } finally { await f.context.close(); }
});
