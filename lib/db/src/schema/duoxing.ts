import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export type SavedCuisinePreference = {
  cuisine: string;
  attitude: "love" | "okay" | "avoid";
};

export const duoxingRoomsTable = pgTable("duoxing_rooms", {
  code: varchar("code", { length: 6 }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  round: integer("round").notNull().default(1),
  recommendationPage: integer("recommendation_page").notNull().default(0),
});

export const duoxingParticipantsTable = pgTable(
  "duoxing_participants",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash"),
    roomCode: varchar("room_code", { length: 6 })
      .notNull()
      .references(() => duoxingRoomsTable.code, { onDelete: "cascade" }),
    nickname: varchar("nickname", { length: 24 }).notNull(),
    participantIndex: integer("participant_index").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("duoxing_participants_token_hash_unique").on(table.tokenHash),
    uniqueIndex("duoxing_participants_room_index_unique").on(
      table.roomCode,
      table.participantIndex,
    ),
  ],
);

export const duoxingPreferencesTable = pgTable("duoxing_preferences", {
  participantId: text("participant_id")
    .primaryKey()
    .references(() => duoxingParticipantsTable.id, { onDelete: "cascade" }),
  budget: varchar("budget", { length: 12 }).notNull(),
  distance: varchar("distance", { length: 12 }).notNull(),
  cuisinePreferences: jsonb("cuisine_preferences")
    .$type<SavedCuisinePreference[]>()
    .notNull(),
  spice: varchar("spice", { length: 12 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
