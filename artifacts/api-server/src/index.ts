import app from "./app";
import { logger } from "./lib/logger";
import { cleanupExpiredRooms } from "./lib/room-cleanup";
import { startPeriodicCleanup } from "./lib/periodic-cleanup";
import { assertTokenCutoverReady, authMode } from "./lib/participant-auth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Production cutover must be proven from the database, not a 24-hour stopwatch.
if (authMode() === "token" && process.env.NODE_ENV === "production") {
  await assertTokenCutoverReady();
}
const server = app.listen({ port, host: process.env.HOST }, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  const stopCleanup = startPeriodicCleanup(cleanupExpiredRooms, () => {
    logger.error("Expired room cleanup failed; will retry on the next interval");
  });
  server.once("close", stopCleanup);
});
