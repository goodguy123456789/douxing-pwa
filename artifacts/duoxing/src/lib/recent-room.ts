export type RecentRoom = { roomCode: string; participantId: string };
export const RECENT_ROOM_KEY = 'duoxing:recent-room';
const participantPrefix = 'duoxing:participant:';

function validEntry(value: unknown): value is RecentRoom {
  if (!value || typeof value !== 'object') return false;
  const entry = value as RecentRoom;
  return typeof entry.roomCode === 'string' && /^[A-Z0-9]{4,6}$/.test(entry.roomCode)
    && typeof entry.participantId === 'string' && entry.participantId.length > 0;
}

/** Call only after successful creation, joining, or authenticated room entry.
 * Tokens remain exclusively in the existing per-participant credential store.
 */
export function rememberRoom(entry: RecentRoom, storage: Storage = localStorage): void {
  const normalized = { roomCode: entry.roomCode.toUpperCase(), participantId: entry.participantId };
  if (!validEntry(normalized)) return;
  storage.setItem(`${participantPrefix}${normalized.roomCode}`, normalized.participantId);
  storage.setItem(RECENT_ROOM_KEY, JSON.stringify(normalized));
}

export function recentRoom(storage: Storage = localStorage): RecentRoom | null {
  try {
    const saved: unknown = JSON.parse(storage.getItem(RECENT_ROOM_KEY) || 'null');
    if (validEntry(saved)) return saved;
  } catch { /* A damaged recent-room pointer must not hide older local identities. */ }
  // Older releases did not save timestamps. Recover an existing local identity,
  // without pretending storage enumeration can establish historical visit order.
  let fallback: RecentRoom | null = null;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(participantPrefix)) continue;
    const entry = { roomCode: key.slice(participantPrefix.length), participantId: storage.getItem(key) || '' };
    if (!validEntry(entry)) continue;
    fallback = entry;
    if (storage.getItem(`duoxing:token:${entry.roomCode}:${entry.participantId}`)) return entry;
  }
  return fallback;
}

export function isExpiredRoomError(error: unknown): boolean {
  const value = error as { status?: number; data?: { code?: string } } | null;
  return value?.status === 401 && value.data?.code === 'ROOM_EXPIRED';
}
