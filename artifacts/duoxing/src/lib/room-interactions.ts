export const RESET_WARNING = '重新选择会清除双方本轮已提交的偏好，也会重置双方页面上尚未提交的填写内容。双方都需要重新填写并提交，旧结果会立即失效。此操作无法撤销，确定继续吗？';
export const RANKING_DESCRIPTION = '公平优先：先比较最低个人接受度，再比较平均接受度，最后比较综合参考分。因此推荐顺序不一定按参考分从高到低排列。';

/** ApiError.message contains HTTP/method/URL details; show the server's human message instead. */
export function errorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  if ('data' in error && error.data && typeof error.data === 'object'
    && 'error' in error.data && typeof error.data.error === 'string') {
    return error.data.error;
  }
  if ('message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}
