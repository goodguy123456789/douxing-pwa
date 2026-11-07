import { test,expect } from '@playwright/test';
test('片区必选、重邮双端固定、未知人均展示和地图搜索编码',async({page,browser,baseURL})=>{
 await page.goto('/');let creates=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/rooms')creates++;});
 await page.getByTestId('button-create-room').click();await expect(page.getByRole('alert')).toContainText('请先选择');expect(creates).toBe(0);
 await page.getByTestId('select-meal-area').selectOption('cqupt');await page.getByTestId('button-create-room').click();
 await expect(page.getByTestId('text-room-area')).toContainText('重庆邮电大学周边');await expect(page.getByTestId('choice-distance-1')).toHaveCount(0);
 const other=await browser.newContext({baseURL,viewport:{width:320,height:874}});try{
 const b=await other.newPage();await b.goto(page.url());await b.getByTestId('button-enter-room').click();await expect(b.getByTestId('text-room-area')).toContainText('重庆邮电大学周边');
 await page.getByTestId('button-submit-preferences').click();await b.getByTestId('button-submit-preferences').click();
 for(const p of [page,b]){await expect(p.getByTestId('state-results')).toBeVisible();await expect(p.getByTestId('restaurant-details').first()).toBeVisible();await expect(p.getByTestId('state-results')).not.toContainText(' km');
 const link=p.getByRole('link',{name:'在高德中打开'}).first();expect(await link.getAttribute('target')).toBe('_self');const url=new URL(await link.getAttribute('href'));expect(url.searchParams.get('callnative')).toBe('1');const fallback=new URL(await p.getByRole('link',{name:'网页版地图'}).first().getAttribute('href'));expect(fallback.searchParams.get('callnative')).toBe('0');expect(fallback.searchParams.get('keyword')).toBe(url.searchParams.get('keyword'));expect(url.origin).toBe('https://uri.amap.com');expect(url.searchParams.get('city')).toBe('重庆');expect(url.searchParams.get('keyword')).toContain('重庆');expect(url.searchParams.get('keyword')).not.toContain('undefined');
 expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await p.reload();await expect(p.getByTestId('state-results')).toBeVisible();}
 }finally{await other.close();}
});

for(const areaId of ['nanping','danzishi','chayuan','cqupt'])test(areaId+'：50元预算双端评价、来源、地图与刷新一致',async({page,browser,baseURL})=>{
 await page.goto('/');await page.getByTestId('select-meal-area').selectOption(areaId);await page.getByTestId('button-create-room').click();
 await page.getByTestId('choice-budget-1').click();
 const context=await browser.newContext({baseURL,viewport:{width:320,height:874}});
 try{
  const b=await context.newPage();await b.goto(page.url());await b.getByTestId('button-enter-room').click();await b.getByTestId('choice-budget-1').click();
  await page.getByTestId('button-submit-preferences').click();await b.getByTestId('button-submit-preferences').click();
  for(const p of [page,b]){
   await expect(p.getByTestId('state-results')).toBeVisible();await expect(p.getByTestId('empty-recommendations')).toHaveCount(0);
   const first=p.getByTestId('restaurant-feedback-details').first();await first.locator('summary').click();
   await expect(first).toContainText('大众点评');await expect(first).toContainText('/5');await expect(first).toContainText('食客反馈：');await expect(first).toContainText('核对：2026-10-25');
   await expect(first.getByRole('link',{name:/查看原始资料/}).first()).toHaveAttribute('href',/^https:\/\/www.dianping.com\/shop\//);
   expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  const names=await page.locator('[data-testid^="text-recommendation-name-"]').allTextContents();
  expect(await b.locator('[data-testid^="text-recommendation-name-"]').allTextContents()).toEqual(names);
  await page.reload();await expect(page.getByTestId('state-results')).toBeVisible();expect(await page.locator('[data-testid^="text-recommendation-name-"]').allTextContents()).toEqual(names);
 }finally{await context.close();}
});
