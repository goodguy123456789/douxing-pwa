export const RESET_WARNING = '重新选择会保留双方各自已保存的偏好，仅本人可见并可修改；尚未提交的修改不会保存。旧结果会立即失效，双方都需要重新确认后才能揭晓。确定继续吗？';
export const RANKING_DESCRIPTION = '公平优先：先比较最低个人接受度，再比较平均接受度，最后比较综合参考分。因此推荐顺序不一定按参考分从高到低排列。';

/** ApiError.message contains HTTP/method/URL details; show the server's human message instead. */
export function errorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  if ('data' in error && error.data && typeof error.data === 'object'
    && 'error' in error.data && typeof error.data.error === 'string') {
    return error.data.error;
  }
  // Fetch failures and unstructured gateway responses contain browser/HTTP
  // diagnostics, not a message intended for the person using the room.
  if ('name' in error && ['TypeError', 'ApiError', 'ResponseParseError'].includes(String(error.name))) {
    return fallback;
  }
  if ('message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}
