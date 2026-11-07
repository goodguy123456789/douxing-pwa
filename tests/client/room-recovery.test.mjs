import test from 'node:test';
import assert from 'node:assert/strict';
import { roomRecovery, roomReadPolicy } from '../../client/lib/room-recovery.ts';

test('existing ID without token immediately offers a new room, not a refresh or join', () => {
  const state = roomRecovery('public-id', false, null);
  assert.equal(state.title, '无法恢复房间身份');
  assert.equal(state.action, 'create');
  assert.match(state.message, /无法自动恢复/);
});
test('401 cannot be retried automatically and is not a network error', () => {
  assert.equal(roomRecovery('id', true, { status: 401 }).action, 'create');
  assert.equal(roomReadPolicy.retry, false);
});
test('426 offers a full-page update without relaxing auth', () => {
  assert.equal(roomRecovery('id', true, { status: 426 }).action, 'refresh');
});
test('network and 503 errors offer retries, without changing stored identity', () => {
  assert.equal(roomRecovery('id', true, new TypeError('Failed to fetch')).action, 'retry');
  assert.equal(roomRecovery('id', true, { status: 503 }).title, '服务暂时不可用');
  assert.equal(roomReadPolicy.networkMode, 'always');
});
test('a new invitee is not a lost identity; healthy saved identity has no error', () => {
  assert.equal(roomRecovery('', false, null), null);
  assert.equal(roomRecovery('id', true, null), null);
});

test('only explicit server expiry produces the gentle ended page, not a generic 401 or network failure', () => {
  const expired = roomRecovery('id', true, { status: 401, data: { code: 'ROOM_EXPIRED' } });
  assert.equal(expired.title, '这次饭局已经结束啦 🍃');
  assert.equal(expired.message, '想再商量吃什么？随时开启一个新的饭局。');
  assert.equal(expired.action, 'create');
  assert.equal(roomRecovery('id', true, { status: 401 }).title, '无法恢复房间身份');
  assert.equal(roomRecovery('id', false, { status: 401 }).title, '无法恢复房间身份');
  for (const error of [new TypeError('offline'), { status: 503 }, { status: 426 }]) {
    assert.doesNotMatch(roomRecovery('id', true, error).title, /结束|过期/);
  }
});

test('a saved expiry only improves a rejected read after cleanup; it never overrides healthy or network responses', () => {
  assert.equal(roomRecovery('id', true, { status: 401 }, true).title, '这次饭局已经结束啦 🍃');
  assert.equal(roomRecovery('id', true, null, true), null);
  assert.equal(roomRecovery('id', true, { status: 503 }, true).action, 'retry');
  assert.equal(roomRecovery('id', true, new TypeError('offline'), true).action, 'retry');
  assert.equal(roomRecovery('id', true, { status: 426 }, true).action, 'refresh');
  assert.equal(roomRecovery('id', false, { status: 401 }, true).title, '无法恢复房间身份');
});
