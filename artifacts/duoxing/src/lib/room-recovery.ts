export type RoomRecovery = {
  title: string;
  message: string;
  action: 'create' | 'refresh' | 'retry';
};

export function hasRoomToken(code: string, id: string): boolean {
  return Boolean(id && localStorage.getItem(`duoxing:token:${code.toUpperCase()}:${id}`));
}

export function roomRecovery(id: string, hasToken: boolean, error: unknown): RoomRecovery | null {
  if (!id) return null; // A new invitee must still be allowed to join.
  const status = Number((error as { status?: number } | null)?.status);
  if (!hasToken || status === 401) {
    return {
      title: '无法恢复房间身份',
      message: '当前浏览器的身份凭证已丢失或失效。为了保护双方的隐私，无法自动恢复原来的参与者身份。',
      action: 'create',
    };
  }
  if (status === 426) {
    return {
      title: '请更新应用',
      message: '应用已升级，请连接网络后刷新页面，加载最新版本。',
      action: 'refresh',
    };
  }
  if (error) {
    return {
      title: status === 503 ? '服务暂时不可用' : '房间暂时打不开',
      message: status === 503 ? '服务暂时不可用，请稍后重试。' : '网络异常或房间暂时无法访问，请检查网络后重试。',
      action: 'retry',
    };
  }
  return null;
}

// Explicit retries only: failed authentication must not enter another polling
// cycle; offline reads must fail visibly rather than pause on a loading screen.
export const roomReadPolicy = { retry: false, networkMode: 'always' } as const;
