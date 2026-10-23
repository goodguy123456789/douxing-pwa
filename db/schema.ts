import {integer,sqliteTable,text,index} from 'drizzle-orm/sqlite-core';
export const rooms=sqliteTable('duoxing_rooms',{code:text('code').primaryKey(),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),version:integer('version').notNull().default(0),stateJson:text('state_json').notNull()},table=>[index('duoxing_rooms_expiry').on(table.expiresAt,table.code)]);
