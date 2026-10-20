import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { LoaderCircle } from 'lucide-react';
import { readRoom } from '@/lib/room-auth';
import { hasRoomToken, roomRecovery, type RoomRecovery } from '@/lib/room-recovery';
import { hasExpiredHint, isExpiredRoomError, recentRoom, rememberRoom } from '@/lib/recent-room';

type Notice = { title: string; message: string; action?: RoomRecovery['action'] };
const expiredNotice: Notice = {
  title: '上个饭局已经过期啦',
  message: '上一次的饭局已经结束，可以创建一个新的饭局。',
  action: 'create',
};

export function ReturnLastRoom({ onCreate, creating }: { onCreate: () => void; creating: boolean }) {
  const [, navigate] = useLocation();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  async function restore() {
    if (active.current) return;
    setNotice(null);
    const entry = recentRoom();
    if (!entry) {
      setNotice({ title: '还没有上一次的饭局', message: '创建或加入一个饭局后，下次就能从这里快速回来啦。' });
      return;
    }
    // This short-circuit is a UI hint only. A future/missing local date never
    // skips the authenticated server read below, even if local data is edited.
    if (hasExpiredHint(entry)) {
      setNotice(expiredNotice);
      return;
    }
    if (!hasRoomToken(entry.roomCode, entry.participantId)) {
      setNotice(roomRecovery(entry.participantId, false, null));
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => {
      if (active.current !== controller) return;
      // Finish the visible attempt even if a stalled transport takes longer
      // to reject its aborted fetch; a late response cannot navigate afterward.
      active.current = null;
      controller.abort();
      setLoading(false);
      setNotice({ title: '暂时无法连接，请稍后再试', message: '身份凭证仍保留在当前浏览器中，可以稍后重试。', action: 'retry' });
    }, 10_000);
    setLoading(true);
    try {
      const room = await readRoom(entry.roomCode, entry.participantId, controller.signal);
      if (active.current !== controller) return;
      if (room.roomCode !== entry.roomCode || room.participantId !== entry.participantId) {
        setNotice(roomRecovery(entry.participantId, true, { status: 401 }));
        return;
      }
      rememberRoom({ roomCode: room.roomCode, participantId: entry.participantId, expiresAt: room.expiresAt });
      navigate(`/room/${entry.roomCode}`);
    } catch (error) {
      if (active.current !== controller) return;
      if (isExpiredRoomError(error)) {
        setNotice(expiredNotice);
      } else {
        const status = Number((error as { status?: number })?.status);
        if ([401, 403, 404].includes(status)) {
          const identity = roomRecovery(entry.participantId, false, null)!;
          setNotice({ ...identity, message: `${identity.message}饭局也可能已结束并被清理。` });
        } else if (status === 426) {
          setNotice(roomRecovery(entry.participantId, true, error));
        } else {
          setNotice({ title: '暂时无法连接，请稍后再试', message: '身份凭证仍保留在当前浏览器中，可以稍后重试。', action: 'retry' });
        }
      }
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={() => void restore()} disabled={loading || creating}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#efd8bc] bg-[#fff8ed] px-4 text-[14px] font-semibold text-[#a96b32] transition hover:border-[#e6b27a] disabled:opacity-60"
        data-testid="button-return-room">
        {loading && <LoaderCircle size={17} className="animate-spin" />}
        {loading ? '正在确认饭局身份…' : '↩ 返回上次饭局'}
      </button>
      {notice && <div role="status" aria-live="polite" className="mt-3 rounded-2xl bg-[#fff8ed] p-4 text-left" data-testid="notice-return-room">
        <h2 className="text-sm font-bold text-[#554b3d]">{notice.title}</h2>
        <p className="mt-2 text-xs leading-6 text-[#8d8272]">{notice.message}</p>
        {notice.action && <button type="button" disabled={creating} data-testid="button-return-action"
          className="mt-3 min-h-11 rounded-xl border border-[#e8cfaf] px-4 text-sm font-semibold text-[#a96b32] disabled:opacity-60"
          onClick={() => {
            if (notice.action === 'create') onCreate();
            else if (notice.action === 'refresh') window.location.reload();
            else void restore();
          }}>
          {notice.action === 'create' ? '创建新饭局' : notice.action === 'refresh' ? '刷新页面' : '重试'}
        </button>}
      </div>}
    </div>
  );
}
