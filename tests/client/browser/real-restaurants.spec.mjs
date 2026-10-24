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
 const link=p.getByRole('link',{name:'查看地图'}).first();const url=new URL(await link.getAttribute('href'));expect(url.origin).toBe('https://uri.amap.com');expect(url.searchParams.get('city')).toBe('重庆');expect(url.searchParams.get('keyword')).toContain('重庆');expect(url.searchParams.get('keyword')).not.toContain('undefined');
 expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await p.reload();await expect(p.getByTestId('state-results')).toBeVisible();}
 }finally{await other.close();}
});
