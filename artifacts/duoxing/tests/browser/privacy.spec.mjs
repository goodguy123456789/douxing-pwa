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
      const response = await fetch(`/api/rooms/${code}/participants/${id}`);
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
    expect(unauthorized.status).toBe(404);
    expect(unauthorized.data.ownDraft).toBeUndefined();
  } finally {
    await Promise.all([aContext.close(), bContext.close()]);
  }
});
