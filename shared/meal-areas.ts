export const MEAL_AREAS = [
 {id:'nanping',name:'南坪'}, {id:'danzishi',name:'弹子石／南滨路'},
 {id:'chayuan',name:'茶园'}, {id:'cqupt',name:'重庆邮电大学周边'},
] as const;
export type MealAreaId = typeof MEAL_AREAS[number]['id'];
export const isMealArea = (id:unknown):id is MealAreaId => MEAL_AREAS.some(area=>area.id===id);
export const areaName = (id:string) => MEAL_AREAS.find(area=>area.id===id)?.name ?? id;
export function restaurantMapUrl(name:string,address:string,openApp=true){
 const query=new URLSearchParams({keyword:name+' '+address,city:'重庆',view:'list',src:'douxing',callnative:openApp?'1':'0'});
 return 'https://uri.amap.com/search?'+query.toString();
}
