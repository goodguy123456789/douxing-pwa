export const ROOM_CLEANUP_INTERVAL_MS = 60_000;

// Run immediately (including after downtime), then retry on the next tick.
// One process never overlaps its own runs; database locks coordinate processes.
export function startPeriodicCleanup(
  cleanup: () => Promise<unknown>,
  onError: () => void,
): () => void {
  let running = false;
  let stopped = false;
  async function run() {
    if (running || stopped) return;
    running = true;
    try {
      await cleanup();
    } catch {
      // Never expose raw DB errors, which can contain private SQL parameters.
      onError();
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => { void run(); }, ROOM_CLEANUP_INTERVAL_MS);
  timer.unref();
  void run();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
