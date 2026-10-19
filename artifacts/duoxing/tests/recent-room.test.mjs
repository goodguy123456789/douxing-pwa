import test from 'node:test';
import assert from 'node:assert/strict';
import { recentRoom, rememberRoom, RECENT_ROOM_KEY, isExpiredRoomError } from '../src/lib/recent-room.ts';

class Store {
  entries = new Map();
  get length() { return this.entries.size; }
  key(index) { return [...this.entries.keys()][index] ?? null; }
  getItem(key) { return this.entries.get(key) ?? null; }
  setItem(key, value) { this.entries.set(key, value); }
  removeItem(key) { this.entries.delete(key); }
}

test('no local identity produces an empty state, without changing storage', () => {
  const storage = new Store();
  assert.equal(recentRoom(storage), null);
  assert.equal(storage.length, 0);
});
test('successful room entry saves only public identifiers and preserves the original token', () => {
  const storage = new Store();
  storage.setItem('duoxing:token:ABCD:owner', 'private-fixture');
  rememberRoom({ roomCode: 'abcd', participantId: 'owner', participantToken: 'must-not-copy' }, storage);
  assert.deepEqual(recentRoom(storage), { roomCode: 'ABCD', participantId: 'owner' });
  assert.equal(storage.getItem('duoxing:participant:ABCD'), 'owner');
  assert.equal(storage.getItem('duoxing:token:ABCD:owner'), 'private-fixture');
  assert.equal(storage.getItem(RECENT_ROOM_KEY).includes('private-fixture'), false);
  assert.equal(storage.getItem(RECENT_ROOM_KEY).includes('must-not-copy'), false);
});
test('new successful entry replaces the pointer but does not erase previous identities', () => {
  const storage = new Store();
  rememberRoom({ roomCode: 'ABCD', participantId: 'one' }, storage);
  rememberRoom({ roomCode: 'EFGH', participantId: 'two' }, storage);
  assert.equal(recentRoom(storage).roomCode, 'EFGH');
  assert.equal(storage.getItem('duoxing:participant:ABCD'), 'one');
  // Re-reading simulates a new component/page after reload.
  assert.equal(recentRoom(storage).participantId, 'two');
});
test('old local identity without recent pointer still works; dev participants are ignored', () => {
  const storage = new Store();
  storage.setItem('duoxing:dev-participant:EFGH', 'virtual');
  storage.setItem('duoxing:participant:ABCD', 'old-owner');
  storage.setItem('duoxing:token:ABCD:old-owner', 'existing-token');
  assert.deepEqual(recentRoom(storage), { roomCode: 'ABCD', participantId: 'old-owner' });
  assert.equal(storage.getItem(RECENT_ROOM_KEY), null); // No premature success recording.
});
test('old identity with missing token is retained so UI can explain identity loss', () => {
  const storage = new Store();
  storage.setItem('duoxing:participant:ABCD', 'owner');
  assert.equal(recentRoom(storage).participantId, 'owner');
});
test('bad pointers fall back to valid old identities; current pointer is never silently replaced', () => {
  const storage = new Store();
  storage.setItem(RECENT_ROOM_KEY, '{broken');
  storage.setItem('duoxing:participant:bad/code', 'ignored');
  storage.setItem('duoxing:participant:ABCD', 'owner');
  assert.equal(recentRoom(storage).roomCode, 'ABCD');
  rememberRoom({ roomCode: 'EFGH', participantId: 'lost-owner' }, storage);
  storage.setItem('duoxing:token:ABCD:owner', 'still-valid-other-token');
  assert.equal(recentRoom(storage).roomCode, 'EFGH');
});
test('only an explicit server 401 marker establishes expiry; network and generic 401 do not', () => {
  assert.equal(isExpiredRoomError({ status: 401, data: { code: 'ROOM_EXPIRED' } }), true);
  assert.equal(isExpiredRoomError({ status: 401, data: { error: '可能已过期' } }), false);
  assert.equal(isExpiredRoomError({ status: 503 }), false);
  assert.equal(isExpiredRoomError(new TypeError('network')), false);
});
