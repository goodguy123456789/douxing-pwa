import { test, expect } from '@playwright/test';

test('invitation shares only the room code and cannot reveal the inviter private draft', async ({ browser, baseURL }) => {
  const aContext = await browser.newContext({ baseURL });
  const bContext = await browser.newContext({ baseURL });
  try {
    // Observe the real copy action without depending on system clipboard permission.
    await aContext.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async text => { window.copiedInviteForTest = text; } },
      });
    });
    const a = await aContext.newPage();
    const b = await bContext.newPage();
    const urls = [];
    for (const context of [aContext, bContext]) context.on('request', request => urls.push(request.url()));
    await a.goto('/');
    await a.getByTestId('button-create-room').click();
    await expect(a).toHaveURL(/\/room\/[A-Z0-9]{4}$/);
    const code = new URL(a.url()).pathname.split('/').pop();
    const key = `duoxing:participant:${code}`;
    const aId = await a.evaluate(key => localStorage.getItem(key), key);
    expect(Boolean(aId)).toBe(true);
    await a.getByTestId('choice-cuisine-日料-love').click();
    await a.getByTestId('input-preference-nickname').fill('邀请隐私验收甲');
    await a.getByTestId('button-submit-preferences').click();
    await expect(a.getByTestId('state-waiting')).toBeVisible();
    await a.getByTestId('button-copy-invite').click();
    const invite = await a.evaluate(() => window.copiedInviteForTest);
    const url = new URL(invite);
    expect(url.pathname).toBe(`/room/${code}`);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    // Assert a boolean so failed expectations never print the credential.
    expect(invite.includes(aId)).toBe(false);

    await b.goto(invite);
    expect(await b.evaluate(key => localStorage.getItem(key), key)).toBeNull();
    await b.getByTestId('button-enter-room').click();
    await expect(b.getByTestId('button-submit-preferences')).toBeVisible();
    const bId = await b.evaluate(key => localStorage.getItem(key), key);
    expect(Boolean(bId) && bId !== aId).toBe(true);
    await expect(b.getByTestId('choice-cuisine-日料-love')).toHaveAttribute('aria-pressed', 'false');
    await expect(b.getByTestId('input-preference-nickname')).not.toHaveValue('邀请隐私验收甲');

    const status = async (page, id) => page.evaluate(async ({ code, id }) => {
      const token = localStorage.getItem(`duoxing:token:${code}:${id}`);
      const response = await fetch(`/api/rooms/${code}/me`, {
        headers: { Authorization: `Bearer ${token ?? id}` },
      });
      return { status: response.status, data: await response.json() };
    }, { code, id });
    const own = await status(a, aId);
    const partner = await status(b, bId);
    expect(own.status).toBe(200);
    expect(own.data.ownDraft.nickname).toBe('邀请隐私验收甲');
    expect(partner.status).toBe(200);
    expect(partner.data.ownDraft).toBeNull();
    expect(JSON.stringify(partner.data).includes(aId)).toBe(false);
    expect(JSON.stringify(partner.data).includes('邀请隐私验收甲')).toBe(false);
    expect(JSON.stringify(own.data).includes(bId)).toBe(false);
    const unauthorized = await status(b, 'not-a-valid-participant');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.data.ownDraft).toBeUndefined();
    const aToken = await a.evaluate(({ code, id }) => localStorage.getItem(`duoxing:token:${code}:${id}`), { code, id: aId });
    const bToken = await b.evaluate(({ code, id }) => localStorage.getItem(`duoxing:token:${code}:${id}`), { code, id: bId });
    expect(Boolean(aToken && bToken && aToken !== bToken)).toBe(true);
    expect(invite.includes(aToken) || invite.includes(bToken)).toBe(false);
    // Complete a real two-browser UI journey, not API-seeded identities.
    await b.getByTestId('choice-cuisine-日料-okay').click();
    await b.getByTestId('button-submit-preferences').click();
    for (const page of [a, b]) await expect(page.getByTestId('state-results')).toBeVisible();
    const before = await status(a, aId);
    expect(before.data.submittedCount).toBe(2);
    expect(before.data.recommendations).toEqual((await status(b, bId)).data.recommendations);
    await Promise.all([a.reload(), b.reload()]);
    for (const page of [a, b]) {
      await expect(page.getByTestId('state-results')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect((await status(a, aId)).data.participantCount).toBe(2);
    expect(urls.some(url => url.includes(aToken) || url.includes(bToken))).toBe(false);
    expect(urls.some(url => /\/participants\//.test(url))).toBe(false);
    // Invalid local credentials get a friendly update prompt, not an automatic third join.
    await b.evaluate(({ code, id }) => localStorage.removeItem(`duoxing:token:${code}:${id}`), { code, id: bId });
    await b.reload();
    await expect(b.getByTestId('state-room-error')).toContainText('刷新');
    await expect(b.getByTestId('button-retry-room')).toHaveText('刷新页面');
    await expect(b.getByTestId('state-room-error')).not.toContainText(/HTTP|Zod|invalid_type/);
    expect((await status(a, aId)).data.participantCount).toBe(2);
  } finally {
    await Promise.all([aContext.close(), bContext.close()]);
  }
});
