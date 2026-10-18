import { test, expect } from '@playwright/test';
import { RESET_WARNING } from '../../src/lib/room-interactions.ts';

const firstDraft = {
  nickname: '回归甲', budget: '2', distance: '3', spice: 'mild',
  cuisinePreferences: [{ cuisine: '日料', attitude: 'love' }],
};
const secondDraft = {
  nickname: '回归乙', budget: 'unlimited', distance: 'unlimited', spice: 'any',
  cuisinePreferences: [{ cuisine: '中餐', attitude: 'okay' }],
};

async function json(request, url, method = 'GET', data) {
  const response = await request.fetch(url, { method, data });
  expect(response.ok(), `${method} ${url.replace(/participants\/.*/, 'participants/[private]')}`).toBeTruthy();
  return response.json();
}

async function revealedRoom(request) {
  const a = await json(request, '/api/rooms', 'POST', {});
  const path = `/api/rooms/${a.roomCode}`;
  const b = await json(request, `${path}/join`, 'POST', {});
  for (const [participant, draft] of [[a, firstDraft], [b, secondDraft]]) {
    await json(request, `${path}/preferences`, 'PUT', {
      ...draft, participantId: participant.participantId, preferenceRevision: 1,
    });
  }
  const status = id => json(request, `${path}/participants/${id}`);
  const reset = () => json(request, `${path}/reset`, 'POST', { participantId: a.participantId });
  return { a, b, path, status, reset };
}

async function openParticipant(browser, baseURL, roomCode, participantId) {
  // Independent contexts: neither browser can accidentally reuse the other's identity.
  const context = await browser.newContext({ baseURL, viewport: { width: 402, height: 874 } });
  await context.addInitScript(({ key, id }) => {
    // Do not seed again on reload: the refresh test must prove actual persistence.
    if (!sessionStorage.getItem('browser-test-seeded')) {
      localStorage.setItem(key, id);
      sessionStorage.setItem('browser-test-seeded', 'yes');
    }
  }, { key: `duoxing:participant:${roomCode}`, id: participantId });
  const page = await context.newPage();
  try {
    await page.goto(`/room/${roomCode}`);
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}

const isStatus = (response, path) =>
  response.request().method() === 'GET' && new URL(response.url()).pathname.startsWith(`${path}/participants/`);
const isSubmit = (response, path) =>
  response.request().method() === 'PUT' && new URL(response.url()).pathname === `${path}/preferences`;

async function onScreen(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(402);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(874);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(402);
}

async function restoredDraft(page, draft) {
  await expect(page.getByTestId('form-preferences')).toBeVisible();
  await expect(page.getByTestId('text-draft-restored')).toBeVisible();
  await expect(page.getByTestId('input-preference-nickname')).toHaveValue(draft.nickname);
  for (const [group, value] of [['budget', draft.budget], ['distance', draft.distance], ['spice', draft.spice]]) {
    await expect(page.getByTestId(`choice-${group}-${value}`)).toHaveAttribute('aria-pressed', 'true');
  }
  for (const { cuisine, attitude } of draft.cuisinePreferences) {
    await expect(page.getByTestId(`choice-cuisine-${cuisine}-${attitude}`)).toHaveAttribute('aria-pressed', 'true');
  }
}

test('取消重选不发送 reset；确认重选立即移除旧结果，并同步另一端与私有草稿', async ({ browser, request, baseURL }) => {
  const room = await revealedRoom(request);
  const pages = [];
  try {
    const a = await openParticipant(browser, baseURL, room.a.roomCode, room.a.participantId);
    pages.push(a);
    const b = await openParticipant(browser, baseURL, room.a.roomCode, room.b.participantId);
    pages.push(b);
    for (const page of pages) await expect(page.getByTestId('state-results')).toBeVisible();
    const before = await Promise.all([room.status(room.a.participantId), room.status(room.b.participantId)]);
    expect(before[0].recommendations.length).toBeGreaterThan(0);
    expect(before[0].ownDraft).toEqual(firstDraft);
    expect(before[1].ownDraft).toEqual(secondDraft);

    let resetRequests = 0;
    a.on('request', req => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === `${room.path}/reset`) resetRequests++;
    });
    const reselect = a.getByTestId('button-reselect-preferences');
    await onScreen(a, reselect);
    const cancelDialog = a.waitForEvent('dialog').then(async dialog => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toBe(RESET_WARNING);
      await dialog.dismiss();
    });
    await reselect.click();
    await cancelDialog;
    // Observe a real polling cycle, not an arbitrary sleep, before proving no mutation.
    await a.waitForResponse(response => isStatus(response, room.path));
    expect(resetRequests).toBe(0);
    for (const [index, id] of [room.a.participantId, room.b.participantId].entries()) {
      const status = await room.status(id);
      for (const key of ['preferenceRevision', 'submittedCount', 'hasSubmitted', 'ownDraft', 'recommendations', 'state']) {
        expect(status[key]).toEqual(before[index][key]);
      }
    }
    for (const page of pages) await expect(page.getByTestId('state-results')).toBeVisible();

    // Block the initiator's future polls. Only the reset mutation response can
    // remove its results, so a missed local cache update cannot pass by polling.
    await a.route(`**${room.path}/participants/**`, route => route.abort());
    const confirmDialog = a.waitForEvent('dialog').then(dialog => dialog.accept());
    const resetResponse = a.waitForResponse(response =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === `${room.path}/reset`);
    await reselect.click();
    await confirmDialog;
    expect((await resetResponse).status()).toBe(200);
    await expect(a.getByTestId('state-results')).toHaveCount(0, { timeout: 1_500 });
    expect(resetRequests).toBe(1);
    await expect(b.getByTestId('state-results')).toHaveCount(0);
    await restoredDraft(a, firstDraft);
    await restoredDraft(b, secondDraft);
    for (const [id, draft] of [[room.a.participantId, firstDraft], [room.b.participantId, secondDraft]]) {
      const status = await room.status(id);
      expect(status.preferenceRevision).toBe(before[0].preferenceRevision + 1);
      expect(status.ownDraft).toEqual(draft);
      expect(status.hasSubmitted).toBe(false);
      expect(status.submittedCount).toBe(0);
      expect(status.recommendations).toEqual([]);
    }
  } finally {
    await Promise.all(pages.map(page => page.context().close()));
  }
});

for (const failure of ['network', 'server']) {
  test(`重选 ${failure} 失败保留双方结果与偏好，解除忙碌后重试仅开启一轮并同步`, async ({ browser, request, baseURL }) => {
    const room = await revealedRoom(request);
    const pages = [];
    let releaseFailure;
    const failureGate = new Promise(resolve => { releaseFailure = resolve; });
    try {
      const a = await openParticipant(browser, baseURL, room.a.roomCode, room.a.participantId);
      pages.push(a);
      const b = await openParticipant(browser, baseURL, room.a.roomCode, room.b.participantId);
      pages.push(b);
      for (const page of pages) await expect(page.getByTestId('state-results')).toBeVisible();
      const before = await Promise.all([room.status(room.a.participantId), room.status(room.b.participantId)]);
      expect(before[0].recommendations.length).toBeGreaterThan(0);
      expect(before[0].ownDraft).toEqual(firstDraft);
      expect(before[1].ownDraft).toEqual(secondDraft);
      const resultText = await Promise.all(pages.map(page => page.getByTestId('state-results').innerText()));

      let resetRequests = 0;
      a.on('request', req => {
        if (req.method() === 'POST' && new URL(req.url()).pathname === `${room.path}/reset`) resetRequests++;
      });
      // Hold only the first reset so pending/disabled is deterministic. Neither
      // failure reaches the API; all reads and the later retry use the real API.
      const resetUrl = `**${room.path}/reset`;
      await a.route(resetUrl, async route => {
        await failureGate;
        if (failure === 'network') await route.abort('internetdisconnected');
        else await route.fulfill({
          status: 503, contentType: 'text/html', body: '<h1>Service Unavailable</h1>',
        });
      }, { times: 1 });
      const reselect = a.getByTestId('button-reselect-preferences');
      const confirmReset = async () => {
        const confirmed = a.waitForEvent('dialog').then(async dialog => {
          expect(dialog.type()).toBe('confirm');
          expect(dialog.message()).toBe(RESET_WARNING);
          await dialog.accept();
        });
        await reselect.click();
        await confirmed;
      };
      await confirmReset();
      await expect(reselect).toBeDisabled();
      await expect(reselect).toHaveText('正在重新选偏好…');
      for (const page of pages) await expect(page.getByTestId('state-results')).toBeVisible();
      releaseFailure();

      const alert = a.getByTestId('error-room-action');
      await expect(alert).toHaveText('暂时无法开启新一轮，请稍后再试。');
      await expect(alert).not.toContainText(/Failed to fetch|HTTP|POST|\/api\/|Service Unavailable|TypeError/i);
      await expect(reselect).toBeEnabled();
      await expect(reselect).toHaveText('重新选偏好');
      await onScreen(a, alert);
      // A real polling cycle on each browser must not wipe the old result or
      // silently retry a failed mutation.
      await Promise.all(pages.map(page => page.waitForResponse(response => isStatus(response, room.path))));
      expect(resetRequests).toBe(1);
      for (const [index, id] of [room.a.participantId, room.b.participantId].entries()) {
        const status = await room.status(id);
        for (const key of ['preferenceRevision', 'submittedCount', 'hasSubmitted', 'ownDraft', 'recommendations', 'state']) {
          expect(status[key]).toEqual(before[index][key]);
        }
        await expect(pages[index].getByTestId('state-results')).toHaveText(resultText[index], { useInnerText: true });
        await expect(pages[index].getByTestId('form-preferences')).toHaveCount(0);
      }

      // Recovery: remove fault injection, keep the peer's polling intact, and
      // block initiator polls so only the successful reset can clear its cache.
      await a.unroute(resetUrl);
      await a.route(`**${room.path}/participants/**`, route => route.abort());
      const resetResponse = a.waitForResponse(response =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === `${room.path}/reset`);
      await confirmReset();
      const response = await resetResponse;
      expect(response.status()).toBe(200);
      expect((await response.json()).preferenceRevision).toBe(before[0].preferenceRevision + 1);
      await expect(a.getByTestId('state-results')).toHaveCount(0, { timeout: 1_500 });
      await expect(alert).toHaveCount(0);
      await expect(b.getByTestId('state-results')).toHaveCount(0);
      await restoredDraft(a, firstDraft);
      await restoredDraft(b, secondDraft);
      await b.waitForResponse(res => isStatus(res, room.path));
      expect(resetRequests).toBe(2); // One failed attempt, one real mutation.
      for (const [id, draft] of [[room.a.participantId, firstDraft], [room.b.participantId, secondDraft]]) {
        const status = await room.status(id);
        expect(status.preferenceRevision).toBe(before[0].preferenceRevision + 1);
        expect(status.ownDraft).toEqual(draft);
        expect(status.hasSubmitted).toBe(false);
        expect(status.submittedCount).toBe(0);
        expect(status.recommendations).toEqual([]);
      }
    } finally {
      releaseFailure();
      await Promise.all(pages.map(page => page.context().close()));
    }
  });
}

for (const revision of ['stale', 'missing']) {
  test(`${revision} preferenceRevision：中文刷新提示，刷新保留身份与草稿并提交新版本（402px）`, async ({ browser, request, baseURL }) => {
    const room = await revealedRoom(request);
    const current = await room.reset();
    const page = await openParticipant(browser, baseURL, room.a.roomCode, room.a.participantId);
    try {
      await restoredDraft(page, firstDraft);
      await page.getByTestId('input-preference-nickname').fill('尚未保存的修改');
      const storageBefore = await page.evaluate(() => ({ ...localStorage }));
      let joins = 0;
      page.on('request', req => {
        if (req.method() === 'POST' && new URL(req.url()).pathname === `${room.path}/join`) joins++;
      });
      // Corrupt only the first outgoing PUT; the real API must reject it.
      await page.route(`**${room.path}/preferences`, async route => {
        const payload = route.request().postDataJSON();
        expect(payload.participantId).toBe(room.a.participantId);
        expect(payload.preferenceRevision).toBe(current.preferenceRevision);
        if (revision === 'missing') delete payload.preferenceRevision;
        else payload.preferenceRevision = current.preferenceRevision - 1;
        await route.continue({ postData: JSON.stringify(payload) });
      }, { times: 1 });
      const rejected = page.waitForResponse(response => isSubmit(response, room.path));
      await page.getByTestId('button-submit-preferences').click();
      expect((await rejected).status()).toBe(400);
      const alert = page.getByTestId('error-room-action');
      await expect(alert).toContainText('刷新页面');
      if (revision === 'missing') await expect(alert).toContainText('尚未保存');
      else await expect(alert).toContainText('偏好版本已更新');
      await expect(alert).not.toContainText(/HTTP|PUT|\/api\/|Zod|invalid_type|expected|preferenceRevision/i);
      await expect(page.getByTestId('input-preference-nickname')).toHaveValue('尚未保存的修改');
      const unchanged = await room.status(room.a.participantId);
      expect(unchanged.ownDraft).toEqual(firstDraft);
      expect(unchanged.submittedCount).toBe(0);
      expect(unchanged.preferenceRevision).toBe(current.preferenceRevision);
      await onScreen(page, alert);
      const refresh = page.getByTestId('button-refresh-room');
      await onScreen(page, refresh);
      await expect(refresh).toBeEnabled();
      await expect(refresh).toHaveAttribute('title', /尚未提交/);
      await Promise.all([page.waitForEvent('load'), refresh.click()]);
      await expect(alert).toHaveCount(0);
      await expect(page.getByTestId('state-join-room')).toHaveCount(0);
      await restoredDraft(page, firstDraft);
      expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(storageBefore);

      // Submit an actual edit after refresh, with the current server revision.
      await page.getByTestId('input-preference-nickname').fill('刷新后已保存');
      const saved = page.waitForResponse(response => isSubmit(response, room.path));
      const submit = page.getByTestId('button-submit-preferences');
      await onScreen(page, submit);
      await submit.click();
      const response = await saved;
      expect(response.status()).toBe(200);
      expect(response.request().postDataJSON()).toMatchObject({
        participantId: room.a.participantId, preferenceRevision: current.preferenceRevision,
      });
      await expect(page.getByTestId('state-waiting')).toBeVisible();
      const status = await room.status(room.a.participantId);
      expect(status.hasSubmitted).toBe(true);
      expect(status.submittedCount).toBe(1);
      expect(status.participantCount).toBe(2);
      expect(status.preferenceRevision).toBe(current.preferenceRevision);
      expect(status.ownDraft).toEqual({ ...firstDraft, nickname: '刷新后已保存' });
      expect(joins).toBe(0);
      expect((await room.status(room.b.participantId)).ownDraft).toEqual(secondDraft);
    } finally {
      await page.context().close();
    }
  });
}
