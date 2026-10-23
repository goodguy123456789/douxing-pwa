import test from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage, RESET_WARNING, RANKING_DESCRIPTION } from '../../client/lib/room-interactions.ts';
test('API errors show human server message without HTTP method or URL', () => {
  const message = errorMessage({ message: 'HTTP 400 PUT /api/rooms/ABCD/preferences', data: { error: '请刷新页面后重新提交。' } }, '保存失败');
  assert.equal(message, '请刷新页面后重新提交。');
  assert.doesNotMatch(message, /HTTP|PUT|\/api\//);
});
test('outdated-page prompt explains unsaved choices and refresh', () => {
  assert.match(errorMessage({ data: { error: '页面版本过旧，请刷新页面；这次选择尚未保存。' } }, '错误'), /刷新页面.*尚未保存/);
});
test('null and malformed errors use safe fallback', () => {
  for (const value of [null, undefined, {}, { data: { error: 5 } }]) assert.equal(errorMessage(value, '保存失败'), '保存失败');
});
test('ordinary Error still provides useful message', () => assert.equal(errorMessage(new Error('网络已断开'), '保存失败'), '网络已断开'));
test('network and unstructured HTTP errors use the Chinese action fallback', () => {
  for (const error of [
    new TypeError('Failed to fetch'),
    new TypeError('NetworkError when attempting to fetch resource.'),
    { name: 'ApiError', message: 'HTTP 503 POST /api/rooms/ABCD/reset', data: '<h1>Service Unavailable</h1>' },
    { name: 'ResponseParseError', message: 'Unexpected token in JSON response' },
  ]) {
    assert.equal(errorMessage(error, '暂时无法开启新一轮，请稍后再试。'), '暂时无法开启新一轮，请稍后再试。');
  }
});
test('reset disclosure explains private saved drafts and both confirmations', () => {
  for (const word of ['双方', '已保存', '仅本人可见', '尚未提交', '旧结果会立即失效', '重新确认', '确定继续']) assert.ok(RESET_WARNING.includes(word));
  assert.doesNotMatch(RESET_WARNING, /清除双方.*偏好|重新填写/);
});
test('ranking explanation explicitly separates fairness order from reference scores', () => {
  for (const word of ['最低个人接受度', '平均接受度', '最后', '不一定按参考分从高到低']) assert.ok(RANKING_DESCRIPTION.includes(word));
});
