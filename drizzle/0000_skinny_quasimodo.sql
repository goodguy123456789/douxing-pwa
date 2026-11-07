CREATE TABLE `duoxing_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`state_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `duoxing_rooms_expiry` ON `duoxing_rooms` (`expires_at`,`code`);