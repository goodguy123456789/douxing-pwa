import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  Compass,
  CookingPot,
  Heart,
  Link2,
  LoaderCircle,
  MapPin,
  RotateCcw,
  Share2,
  ShieldCheck,
  Sparkles,
  Utensils,
  X,
} from 'lucide-react';
import {
  BudgetLevel,
  Cuisine,
  CuisineAttitude,
  DistanceLimit,
  SpicePreference,
  getGetRoomQueryKey,
  getHealthCheckQueryKey,
  useCreateRoom,
  useGetRoom,
  useHealthCheck,
  useJoinRoom,
  useResetRoom,
  useSubmitPreferences,
  type Cuisine as CuisineType,
  type CuisineAttitude as CuisineAttitudeType,
  type PreferenceSubmission,
  type RoomStatus,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const cuisines: CuisineType[] = [
  Cuisine.中餐,
  Cuisine.火锅,
  Cuisine.日料,
  Cuisine.韩餐,
  Cuisine.西餐,
  Cuisine.东南亚,
  Cuisine.烧烤,
  Cuisine.小吃,
  Cuisine['咖啡_/_甜品'],
];
const cuisineIcons: Record<string, string> = {
  中餐: '筷',
  火锅: '锅',
  日料: '鲜',
  韩餐: '烤',
  西餐: '餐',
  东南亚: '香',
  烧烤: '炭',
  小吃: '街',
  '咖啡 / 甜品': '甜',
};

function participantKey(roomCode: string) {
  return `duoxing:participant:${roomCode.toUpperCase()}`;
}

function simulatedParticipantKey(roomCode: string) {
  return `duoxing:dev-participant:${roomCode.toUpperCase()}`;
}

function isDevSimulationEnabled() {
  return (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('dev') === 'true'
  );
}

function randomChoice<T>(choices: readonly T[]): T {
  return choices[Math.floor(Math.random() * choices.length)];
}

function makeRandomPreferences(participantId: string): PreferenceSubmission {
  const shuffledCuisines = [...cuisines];
  for (let index = shuffledCuisines.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffledCuisines[index], shuffledCuisines[swapIndex]] = [
      shuffledCuisines[swapIndex],
      shuffledCuisines[index],
    ];
  }

  const selectedCuisines = shuffledCuisines.slice(
    0,
    3 + Math.floor(Math.random() * 3),
  );
  const attitudes: CuisineAttitudeType[] = [
    CuisineAttitude.love,
    CuisineAttitude.okay,
    CuisineAttitude.avoid,
  ];

  return {
    participantId,
    nickname: '模拟参与者',
    budget: randomChoice([
      BudgetLevel.NUMBER_1,
      BudgetLevel.NUMBER_2,
      BudgetLevel.NUMBER_3,
      BudgetLevel.unlimited,
    ]),
    distance: randomChoice([
      DistanceLimit.NUMBER_1,
      DistanceLimit.NUMBER_3,
      DistanceLimit.NUMBER_5,
      DistanceLimit.unlimited,
    ]),
    cuisinePreferences: selectedCuisines.map((cuisine) => ({
      cuisine,
      attitude: randomChoice(attitudes),
    })),
    spice: randomChoice([
      SpicePreference.none,
      SpicePreference.mild,
      SpicePreference.any,
    ]),
  };
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" data-testid="brand-mark">
      <span className={`grid place-items-center rounded-[15px] bg-[#f28c3a] text-[#fff9ee] shadow-[0_5px_12px_#e7833540] ${small ? 'h-9 w-9' : 'h-10 w-10'}`}>
        <CookingPot size={small ? 19 : 21} strokeWidth={2.5} />
      </span>
      <span className="brand-word text-[21px] tracking-[-.07em]">都行</span>
    </div>
  );
}

function ApiSignal() {
  const { data, isError, isLoading } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 } });
  const isOnline = Boolean(data && !isError);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e5dece] bg-[#fffaf0] px-2.5 py-1 text-[10px] font-semibold tracking-[.02em] text-[#756d60]" data-testid="status-api">
      <span className={`h-1.5 w-1.5 rounded-full ${isLoading ? 'bg-[#d6a745]' : isOnline ? 'bg-[#5e9a70]' : 'bg-[#c9765c]'}`} />
      {isLoading ? '连接中' : isOnline ? '服务正常' : '暂时离线'}
    </span>
  );
}

function Header({ back }: { back?: () => void }) {
  return (
    <header className="flex items-center justify-between py-5">
      <div className="flex items-center gap-3">
        {back && (
          <button type="button" onClick={back} aria-label="返回" className="grid h-9 w-9 place-items-center rounded-full border border-[#e8dfcf] bg-[#fffcf5] text-[#756d60]" data-testid="button-back">
            <ArrowLeft size={17} />
          </button>
        )}
        <BrandMark small />
      </div>
      <ApiSignal />
    </header>
  );
}

function Home() {
  const [, setLocation] = useLocation();
  const devSimulationEnabled = isDevSimulationEnabled();
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'home' | 'join'>('home');
  const createRoom = useCreateRoom();
  const joinRoom = useJoinRoom();

  const handleCreate = () => {
    createRoom.mutate({ data: nickname.trim() ? { nickname: nickname.trim() } : undefined }, {
      onSuccess: (room) => {
        localStorage.setItem(participantKey(room.roomCode), room.participantId);
        setLocation(
          `/room/${room.roomCode}${devSimulationEnabled ? '?dev=true' : ''}`,
        );
      },
    });
  };

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (normalized.length < 4 || normalized.length > 6) return;
    joinRoom.mutate({ roomCode: normalized, data: nickname.trim() ? { nickname: nickname.trim() } : undefined }, {
      onSuccess: (room) => {
        localStorage.setItem(participantKey(room.roomCode), room.participantId);
        setLocation(
          `/room/${room.roomCode}${devSimulationEnabled ? '?dev=true' : ''}`,
        );
      },
    });
  };

  return (
    <main className="app-shell">
      <div className="page-wrap pb-10">
        <Header />
        <section className="page-enter relative pt-7 text-center">
          <div className="mx-auto flex w-fit items-center gap-1.5 rounded-full border border-[#f0d9b7] bg-[#fff6e5] px-3 py-1.5 text-[11px] font-semibold tracking-[.05em] text-[#a76a2b]">
            <Sparkles size={13} /> 两个人的晚餐灵感
          </div>
          <h1 className="display-title mt-6 text-[60px] font-extrabold text-[#30291f] sm:text-[72px]" data-testid="text-home-title">都行<span className="text-[#f28c3a]">?</span></h1>
          <p className="mt-3 text-[17px] font-semibold tracking-[-.02em] text-[#554b3d]" data-testid="text-home-tagline">别再说都行了。</p>
          <p className="mx-auto mt-2 max-w-[290px] text-[13px] leading-6 text-[#8d8272]">
            各自悄悄选好口味，等两个人都准备好了，再一起揭晓今晚吃什么。
          </p>

          <div className="relative mx-auto mt-8 flex h-[182px] w-full max-w-[340px] items-center justify-center">
            <span className="float-orb absolute left-[17%] top-4 grid h-12 w-12 place-items-center rounded-[17px] bg-[#f9d780] text-[#885c26] shadow-[0_8px_18px_#d39d5140]">
              <Utensils size={22} />
            </span>
            <span className="float-orb absolute right-[14%] top-10 grid h-10 w-10 place-items-center rounded-full bg-[#f4b5a0] text-[#8d5140] [animation-delay:.8s]">
              <Heart size={19} />
            </span>
            <div className="relative grid h-[142px] w-[196px] place-items-center rounded-[42%_58%_51%_49%/49%_44%_56%_51%] border-[8px] border-[#fff7e8] bg-[#f4c84e] shadow-[0_18px_35px_#b47d3420]">
              <div className="grid h-[110px] w-[148px] place-items-center rounded-[45%_55%_48%_52%/50%_44%_56%_50%] bg-[#f9e29d]">
                <span className="brand-word text-[36px] text-[#6e5130]">今晚</span>
              </div>
              <span className="absolute -bottom-2 right-5 h-5 w-5 rounded-full border-[5px] border-[#fff7e8] bg-[#f28c3a]" />
            </div>
            <span className="absolute bottom-1 left-[22%] h-2 w-2 rounded-full bg-[#efa879]" />
            <span className="absolute bottom-5 right-[24%] h-3 w-3 rounded-full bg-[#ecd27c]" />
          </div>
        </section>

        <section className="surface page-enter mt-5 rounded-[28px] p-5 sm:p-6" aria-label="开始决定晚餐">
          {mode === 'home' ? (
            <>
              <label className="mb-2 block text-left text-[12px] font-semibold text-[#776d5e]" htmlFor="home-nickname">怎么称呼你 <span className="font-normal text-[#a79b89]">· 可不填</span></label>
              <input id="home-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={24} placeholder="留个名字也可以" className="h-12 w-full rounded-2xl border border-[#e8dfcf] bg-[#fffdf8] px-4 text-[14px] outline-none transition focus:border-[#eea260] focus:ring-4 focus:ring-[#f6c89430]" data-testid="input-nickname" />
              <button type="button" onClick={handleCreate} disabled={createRoom.isPending} className="mt-3 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[#f28c3a] text-[15px] font-bold text-white shadow-[0_7px_16px_#e9873840] transition hover:bg-[#e8802d] disabled:cursor-wait disabled:opacity-65" data-testid="button-create-room">
                {createRoom.isPending ? <LoaderCircle className="animate-spin" size={19} /> : <Sparkles size={18} />}
                {createRoom.isPending ? '正在开个小房间…' : '发起今晚的饭局'}
                {!createRoom.isPending && <ArrowRight size={17} />}
              </button>
              {createRoom.isError && <p className="mt-2 text-left text-xs text-[#bd594b]" role="alert" data-testid="error-create-room">{errorMessage(createRoom.error, '创建失败，请稍后再试。')}</p>}
              <div className="my-4 flex items-center gap-3 text-[10px] font-semibold tracking-[.15em] text-[#b5a995]"><span className="h-px flex-1 bg-[#eee6d8]" />或者加入朋友的房间<span className="h-px flex-1 bg-[#eee6d8]" /></div>
              <button type="button" onClick={() => setMode('join')} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#e8dfcf] bg-[#fffdf8] text-[14px] font-semibold text-[#675d50] transition hover:border-[#e6b27a]" data-testid="button-open-join">
                <Link2 size={16} /> 我有房间码
              </button>
            </>
          ) : (
            <form onSubmit={handleJoin}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[15px] font-bold text-[#383025]">加入饭局</p>
                  <p className="mt-1 text-[12px] text-[#958978]">输入朋友发来的 4–6 位房间码</p>
                </div>
                <button type="button" onClick={() => setMode('home')} className="grid h-9 w-9 place-items-center rounded-full bg-[#f5efe4] text-[#857866]" aria-label="关闭加入" data-testid="button-close-join"><X size={17} /></button>
              </div>
              <input value={code} onChange={(event) => setCode(event.target.value.replace(/\s/g, '').slice(0, 6).toUpperCase())} minLength={4} maxLength={6} autoFocus placeholder="例如 7K3P" className="h-14 w-full rounded-2xl border border-[#e8dfcf] bg-[#fffdf8] text-center font-mono text-[23px] font-bold tracking-[.22em] uppercase outline-none placeholder:text-[#c4b9a7] focus:border-[#eea260] focus:ring-4 focus:ring-[#f6c89430]" data-testid="input-room-code" />
              <label className="mb-2 mt-4 block text-left text-[12px] font-semibold text-[#776d5e]" htmlFor="join-nickname">怎么称呼你 <span className="font-normal text-[#a79b89]">· 可不填</span></label>
              <input id="join-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={24} placeholder="留个名字也可以" className="h-12 w-full rounded-2xl border border-[#e8dfcf] bg-[#fffdf8] px-4 text-[14px] outline-none focus:border-[#eea260] focus:ring-4 focus:ring-[#f6c89430]" data-testid="input-join-nickname" />
              {joinRoom.isError && <p className="mt-2 text-left text-xs text-[#bd594b]" role="alert" data-testid="error-join-room">{errorMessage(joinRoom.error, '没有找到这个房间，检查一下房间码吧。')}</p>}
              <button type="submit" disabled={code.length < 4 || joinRoom.isPending} className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#f28c3a] text-[15px] font-bold text-white disabled:opacity-50" data-testid="button-join-room">
                {joinRoom.isPending ? <LoaderCircle className="animate-spin" size={18} /> : null}
                {joinRoom.isPending ? '正在加入…' : '加入这个房间'} {!joinRoom.isPending && <ArrowRight size={17} />}
              </button>
            </form>
          )}
        </section>
        <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-[#958a79]" data-testid="text-privacy-note"><ShieldCheck size={14} className="text-[#77a17c]" />彼此的选择会先保密，直到两个人都选完</div>
        <footer className="mt-8 flex items-center justify-center gap-1.5 text-[10px] text-[#b4a995]"><span>不需要注册</span><span>·</span><span>只为今晚的一顿饭</span></footer>
      </div>
    </main>
  );
}

function ChoiceGroup<T extends string>({ label, hint, options, value, onChange, testId }: {
  label: string;
  hint?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  testId: string;
}) {
  return (
    <fieldset>
      <div className="mb-2.5 flex items-baseline justify-between">
        <legend className="text-[14px] font-bold text-[#3d352b]">{label}</legend>
        {hint && <span className="text-[11px] text-[#a39785]">{hint}</span>}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button key={option.value} type="button" onClick={() => onChange(option.value)} aria-pressed={active} className={`pill-choice min-h-[43px] rounded-[14px] border px-2 text-[12px] font-semibold ${active ? 'border-[#f28c3a] bg-[#fff0dc] text-[#b96020] shadow-[inset_0_0_0_1px_#f28c3a]' : 'border-[#ebe3d7] bg-[#fffdf8] text-[#716757] hover:border-[#e8bb8b]'}`} data-testid={`${testId}-${String(option.value)}`}>
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function RoomPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = (params.roomCode || '').toUpperCase();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [participantId, setParticipantId] = useState(() => typeof window === 'undefined' ? '' : localStorage.getItem(participantKey(roomCode)) || '');
  const [devParticipantId, setDevParticipantId] = useState(() => typeof window === 'undefined' ? '' : localStorage.getItem(simulatedParticipantKey(roomCode)) || '');
  const [nickname, setNickname] = useState('');
  const [joinNickname, setJoinNickname] = useState('');
  const [budget, setBudget] = useState<string>(BudgetLevel.unlimited);
  const [distance, setDistance] = useState<string>(DistanceLimit.unlimited);
  const [spice, setSpice] = useState<string>(SpicePreference.any);
  const [attitudes, setAttitudes] = useState<Record<string, CuisineAttitudeType>>({});
  const [copied, setCopied] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [roomError, setRoomError] = useState('');
  const [simulationPending, setSimulationPending] = useState(false);
  const devSimulationEnabled = isDevSimulationEnabled();

  useEffect(() => {
    setParticipantId(localStorage.getItem(participantKey(roomCode)) || '');
    setDevParticipantId(
      localStorage.getItem(simulatedParticipantKey(roomCode)) || '',
    );
  }, [roomCode]);

  const roomQuery = useGetRoom(roomCode, participantId, {
    query: { queryKey: getGetRoomQueryKey(roomCode, participantId), enabled: Boolean(roomCode && participantId), refetchInterval: 2200 },
  });
  const joinRoom = useJoinRoom();
  const submitPreferences = useSubmitPreferences();
  const resetRoom = useResetRoom();
  const room = roomQuery.data;
  const revealed = room?.state === 'revealed';
  const mySubmitted = Boolean(room?.hasSubmitted);
  const previousRoomState = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (room?.state === 'choosing' && previousRoomState.current === 'revealed') {
      setNickname('');
      setBudget(BudgetLevel.unlimited);
      setDistance(DistanceLimit.unlimited);
      setSpice(SpicePreference.any);
      setAttitudes({});
    }
    previousRoomState.current = room?.state;
  }, [room?.state]);

  const joinCurrentRoom = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setJoinError('');
    joinRoom.mutate({ roomCode, data: joinNickname.trim() ? { nickname: joinNickname.trim() } : undefined }, {
      onSuccess: (response) => {
        localStorage.setItem(participantKey(roomCode), response.participantId);
        setParticipantId(response.participantId);
      },
      onError: (error) => setJoinError(errorMessage(error, '这个房间暂时无法加入，可能已满或已过期。')),
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!participantId) return;
    const cuisinePreferences = cuisines.filter((cuisine) => attitudes[cuisine]).map((cuisine) => ({
      cuisine,
      attitude: attitudes[cuisine],
    }));
    const payload: PreferenceSubmission = {
      participantId,
      ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
      budget: budget as PreferenceSubmission['budget'],
      distance: distance as PreferenceSubmission['distance'],
      cuisinePreferences,
      spice: spice as PreferenceSubmission['spice'],
    };
    submitPreferences.mutate({ roomCode, data: payload }, {
      onError: (error) => setRoomError(errorMessage(error, '保存失败，请检查网络后再试。')),
    });
  };

  const submitAsSimulatedParticipant = (virtualParticipantId: string) => {
    if (virtualParticipantId === participantId) {
      setSimulationPending(false);
      setRoomError('模拟参与者不能复用你的参与者身份。');
      return;
    }

    localStorage.setItem(
      simulatedParticipantKey(roomCode),
      virtualParticipantId,
    );
    setDevParticipantId(virtualParticipantId);
    submitPreferences.mutate(
      {
        roomCode,
        data: makeRandomPreferences(virtualParticipantId),
      },
      {
        onSuccess: () => {
          setSimulationPending(false);
          void queryClient.invalidateQueries({
            queryKey: getGetRoomQueryKey(roomCode, participantId),
          });
        },
        onError: (error) => {
          setSimulationPending(false);
          setRoomError(
            errorMessage(error, '模拟参与者提交失败，请稍后再试。'),
          );
        },
      },
    );
  };

  const simulateSecondParticipant = () => {
    if (
      !devSimulationEnabled ||
      !room?.hasSubmitted ||
      room.state === 'revealed' ||
      simulationPending
    ) {
      return;
    }

    setRoomError('');
    setSimulationPending(true);
    if (devParticipantId) {
      submitAsSimulatedParticipant(devParticipantId);
      return;
    }

    joinRoom.mutate(
      { roomCode, data: { nickname: '模拟参与者' } },
      {
        onSuccess: (virtualParticipant) => {
          if (virtualParticipant.participantId === participantId) {
            setSimulationPending(false);
            setRoomError('模拟参与者不能复用你的参与者身份。');
            return;
          }
          submitAsSimulatedParticipant(virtualParticipant.participantId);
        },
        onError: (error) => {
          setSimulationPending(false);
          setRoomError(
            errorMessage(error, '无法创建模拟参与者，请确认房间仍有空位。'),
          );
        },
      },
    );
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${roomCode}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setRoomError('复制失败，请从地址栏复制房间链接。');
    }
  };

  const shareInvite = async () => {
    const url = `${window.location.origin}/room/${roomCode}`;
    if (!navigator.share) {
      await copyInvite();
      return;
    }
    try {
      await navigator.share({
        title: '都行',
        text: '和我一起决定今晚吃什么。',
        url,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      await copyInvite();
    }
  };

  const startAgain = () => {
    if (!participantId) return;
    resetRoom.mutate({ roomCode, data: { participantId } }, {
      onSuccess: () => {
        setRoomError('');
        setAttitudes({});
        queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomCode, participantId) });
      },
      onError: (error) => setRoomError(errorMessage(error, '暂时无法开启新一轮，请稍后再试。')),
    });
  };

  const stateLabel = useMemo(() => {
    if (room?.state === 'revealed') return '揭晓时刻';
    if (room?.state === 'waiting_for_partner') return '等对方选好';
    if (room?.state === 'waiting_for_other') return '你已经准备好了';
    return '今晚吃什么';
  }, [room?.state]);

  return (
    <main className="app-shell">
      <div className="page-wrap pb-12">
        <Header back={() => setLocation('/')} />
        {!participantId ? (
          <section className="surface page-enter mt-9 rounded-[28px] p-6" data-testid="state-join-room">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff0dc] text-[#e77d2b]"><Link2 size={22} /></div>
            <p className="mt-5 text-[11px] font-bold tracking-[.14em] text-[#ae7948]">房间码 · {roomCode}</p>
            <h1 className="display-title mt-2 text-[28px] font-extrabold">来一起决定晚餐</h1>
            <p className="mt-2 text-[13px] leading-6 text-[#8e8372]">给自己起个名字（可选），然后悄悄选偏好。</p>
            <form onSubmit={joinCurrentRoom} className="mt-5">
              <input value={joinNickname} onChange={(event) => setJoinNickname(event.target.value)} maxLength={24} placeholder="怎么称呼你 · 可不填" className="h-12 w-full rounded-2xl border border-[#e8dfcf] bg-[#fffdf8] px-4 text-sm outline-none focus:border-[#eea260]" data-testid="input-room-nickname" />
              {joinError && <p className="mt-2 text-xs text-[#bd594b]" role="alert" data-testid="error-room-join">{joinError}</p>}
              <button type="submit" disabled={joinRoom.isPending} className="mt-3 flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#f28c3a] text-sm font-bold text-white disabled:opacity-55" data-testid="button-enter-room">
                {joinRoom.isPending ? <LoaderCircle size={18} className="animate-spin" /> : null}
                {joinRoom.isPending ? '正在加入…' : '加入房间'} {!joinRoom.isPending && <ArrowRight size={17} />}
              </button>
            </form>
          </section>
        ) : roomQuery.isLoading ? (
          <section className="mt-7 space-y-4" aria-label="正在加载房间" data-testid="state-room-loading">
            <div className="h-8 w-28 animate-pulse rounded-full bg-[#e9dfcc]" />
            <div className="surface h-40 animate-pulse rounded-[28px] bg-[#fffaf0]" />
            <div className="surface h-48 animate-pulse rounded-[28px] bg-[#fffaf0]" />
          </section>
        ) : roomQuery.isError || !room ? (
          <section className="surface page-enter mt-9 rounded-[28px] p-6 text-center" data-testid="state-room-error">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#fce9df] text-[#bd684e]"><CircleHelp size={25} /></div>
            <h1 className="mt-4 text-xl font-extrabold">房间暂时打不开</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[#8e8372]">可能是房间码不对、房间已满，或邀请已经过期。</p>
            <button type="button" onClick={() => roomQuery.refetch()} className="mt-5 h-11 rounded-xl border border-[#e8dfcf] px-5 text-sm font-bold text-[#6a5d4d]" data-testid="button-retry-room">再试一次</button>
            <button type="button" onClick={() => setLocation('/')} className="mt-3 block w-full text-sm font-semibold text-[#e47f30]" data-testid="button-home-from-error">回到首页</button>
          </section>
        ) : (
          <div className="page-enter">
            <div className="mb-5 mt-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold tracking-[.16em] text-[#a99b87]">ROOM · {room.roomCode}</p>
                <h1 className="display-title mt-1 text-[28px] font-extrabold text-[#352e24]" data-testid="text-room-state">{stateLabel}</h1>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button type="button" onClick={shareInvite} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#eaddc9] bg-[#fff8eb] px-3 text-[11px] font-semibold text-[#8d7456]" data-testid="button-share-invite">
                  <Share2 size={13} />分享邀请
                </button>
                <div className="rounded-full border border-[#eaddc9] bg-[#fff8eb] px-3 py-1.5 text-[11px] font-semibold text-[#8d7456]" data-testid="text-participant-count">
                  {room.hasSubmitted
                    ? `1/${room.requiredParticipantCount} 位已提交`
                    : `${room.participantCount}/${room.requiredParticipantCount} 位已加入`}
                </div>
              </div>
            </div>
            {roomError && <div className="mb-4 rounded-xl border border-[#f0c7b7] bg-[#fff1eb] px-4 py-3 text-xs text-[#a94e3d]" role="alert" data-testid="error-room-action">{roomError}</div>}

            {revealed ? (
              <Results room={room} onAgain={startAgain} onHome={() => setLocation('/')} busy={resetRoom.isPending} />
            ) : mySubmitted || room.state === 'waiting_for_partner' || room.state === 'waiting_for_other' ? (
              <Waiting
                roomCode={roomCode}
                onCopy={copyInvite}
                copied={copied}
                state={room.state}
                devSimulationEnabled={devSimulationEnabled}
                canSimulate={room.participantCount < room.requiredParticipantCount || Boolean(devParticipantId)}
                simulationPending={simulationPending}
                onSimulate={simulateSecondParticipant}
              />
            ) : (
              <PreferenceForm
                nickname={nickname}
                setNickname={setNickname}
                budget={budget}
                setBudget={setBudget}
                distance={distance}
                setDistance={setDistance}
                spice={spice}
                setSpice={setSpice}
                attitudes={attitudes}
                setAttitudes={setAttitudes}
                pending={submitPreferences.isPending}
                onSubmit={handleSubmit}
              />
            )}
            <div className="mt-6 flex items-center justify-center gap-1.5 text-[10px] text-[#aa9f8e]"><ShieldCheck size={13} className="text-[#77a17c]" />你的偏好只会在双方提交后参与匹配</div>
          </div>
        )}
      </div>
    </main>
  );
}

function PreferenceForm({ nickname, setNickname, budget, setBudget, distance, setDistance, spice, setSpice, attitudes, setAttitudes, pending, onSubmit }: {
  nickname: string;
  setNickname: (value: string) => void;
  budget: string;
  setBudget: (value: string) => void;
  distance: string;
  setDistance: (value: string) => void;
  spice: string;
  setSpice: (value: string) => void;
  attitudes: Record<string, CuisineAttitudeType>;
  setAttitudes: (value: Record<string, CuisineAttitudeType>) => void;
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="form-preferences">
      <section className="surface rounded-[24px] p-4">
        <div className="mb-3 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-[10px] bg-[#fff0dc] text-[#da762a]"><Compass size={15} /></span><h2 className="text-[14px] font-bold">先说说你的范围</h2></div>
        <div className="space-y-4">
          <ChoiceGroup label="人均预算" hint="约每人" value={budget} onChange={setBudget} testId="choice-budget" options={[
            { value: BudgetLevel.NUMBER_1, label: '¥' }, { value: BudgetLevel.NUMBER_2, label: '¥¥' }, { value: BudgetLevel.NUMBER_3, label: '¥¥¥' }, { value: BudgetLevel.unlimited, label: '不限' },
          ]} />
          <ChoiceGroup label="愿意走多远" value={distance} onChange={setDistance} testId="choice-distance" options={[
            { value: DistanceLimit.NUMBER_1, label: '1 km' }, { value: DistanceLimit.NUMBER_3, label: '3 km' }, { value: DistanceLimit.NUMBER_5, label: '5 km' }, { value: DistanceLimit.unlimited, label: '不限' },
          ]} />
        </div>
      </section>

      <section className="surface rounded-[24px] p-4">
        <div className="mb-1 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-[10px] bg-[#fff0dc] text-[#da762a]"><Heart size={15} /></span><h2 className="text-[14px] font-bold">今天想吃哪种？</h2></div>
        <p className="mb-3 ml-9 text-[11px] text-[#a39785]">选择喜欢 / 可以 / 不太想；再点一次可取消</p>
        <div className="space-y-2">
          {cuisines.map((cuisine) => {
            const current = attitudes[cuisine];
            const settings: { value: CuisineAttitudeType; label: string; selected: string }[] = [
              { value: CuisineAttitude.love, label: '喜欢', selected: 'border-[#e9a05a] bg-[#fff1df] text-[#a95f24]' },
              { value: CuisineAttitude.okay, label: '可以', selected: 'border-[#d9dfbd] bg-[#f4f6e9] text-[#687443]' },
              { value: CuisineAttitude.avoid, label: '不想', selected: 'border-[#e6c5b8] bg-[#fff0ea] text-[#a9654e]' },
            ];
            return (
              <div key={cuisine} className="flex min-h-[43px] items-center justify-between rounded-[14px] bg-[#fffdf8] px-2.5" data-testid={`row-cuisine-${cuisine}`}>
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-[#f7efdf] text-[10px] font-bold text-[#9c7850]">{cuisineIcons[cuisine]}</span>
                  <span className="text-[12px] font-semibold text-[#5d5346]">{cuisine}</span>
                </div>
                <div className="flex rounded-xl bg-[#f5f0e7] p-[3px]">
                  {settings.map((setting) => (
                    <button type="button" key={setting.value} onClick={() => {
                      const next = { ...attitudes };
                      if (current === setting.value) delete next[cuisine];
                      else next[cuisine] = setting.value;
                      setAttitudes(next);
                    }} aria-pressed={current === setting.value} className={`rounded-[9px] px-2.5 py-1.5 text-[10px] font-semibold transition ${current === setting.value ? `${setting.selected} shadow-[0_1px_4px_#76532b18]` : 'text-[#a39785]'}`} data-testid={`choice-cuisine-${cuisine}-${setting.value}`}>
                      {setting.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="surface rounded-[24px] p-4">
        <ChoiceGroup label="辣度接受度" hint="今晚的辣度" value={spice} onChange={setSpice} testId="choice-spice" options={[
          { value: SpicePreference.none, label: '不辣' }, { value: SpicePreference.mild, label: '微辣' }, { value: SpicePreference.any, label: '随意' },
        ]} />
      </section>

      <section className="rounded-[22px] border border-[#f0dfc4] bg-[#fff7e9] p-4">
        <label className="mb-2 block text-[12px] font-semibold text-[#74654f]" htmlFor="preference-nickname">给对方看的称呼 <span className="font-normal text-[#a39785]">· 可不填</span></label>
        <input id="preference-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={24} placeholder="比如：小林" className="h-11 w-full rounded-xl border border-[#eadcc5] bg-[#fffdf8] px-3 text-sm outline-none focus:border-[#eea260]" data-testid="input-preference-nickname" />
      </section>
      <button type="submit" disabled={pending} className="flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[#f28c3a] text-[15px] font-bold text-white shadow-[0_7px_16px_#e9873840] transition hover:bg-[#e8802d] disabled:cursor-wait disabled:opacity-60" data-testid="button-submit-preferences">
        {pending ? <LoaderCircle size={19} className="animate-spin" /> : <Check size={19} />}
        {pending ? '悄悄收好你的选择…' : '我选好了，先保密'}
      </button>
      <p className="text-center text-[10px] leading-5 text-[#a39785]">默认「可以」的口味也会纳入匹配，不代表你必须喜欢。</p>
    </form>
  );
}

function Waiting({ roomCode, onCopy, copied, state, devSimulationEnabled, canSimulate, simulationPending, onSimulate }: {
  roomCode: string;
  onCopy: () => void;
  copied: boolean;
  state: string;
  devSimulationEnabled: boolean;
  canSimulate: boolean;
  simulationPending: boolean;
  onSimulate: () => void;
}) {
  return (
    <section className="surface page-enter overflow-hidden rounded-[28px]" data-testid="state-waiting">
      <div className="relative flex min-h-[214px] flex-col items-center justify-center overflow-hidden bg-[#fff4dd] px-6 py-7 text-center">
        <div className="absolute -left-8 -top-10 h-36 w-36 rounded-full bg-[#f6dfaa]/55" />
        <div className="absolute -bottom-16 -right-6 h-44 w-44 rounded-full bg-[#f7d6bd]/55" />
        <div className="pulse-soft relative grid h-[74px] w-[74px] place-items-center rounded-[25px] border-[5px] border-white bg-[#f3c958] text-[#805927] shadow-[0_8px_18px_#bd8b3130]">
          <Utensils size={30} />
        </div>
        <p className="relative mt-4 text-[19px] font-extrabold tracking-[-.04em] text-[#443627]" data-testid="text-waiting-title">{state === 'waiting_for_other' ? '你已经选好啦' : '你的选择已收好'}</p>
        <p className="relative mt-1 max-w-[250px] text-[12px] leading-5 text-[#8f7d62]">等对方也准备好，兩个人的口味就会一起变成今晚的答案。</p>
      </div>
      <div className="p-5">
        <div className="flex items-center gap-3 rounded-2xl bg-[#f8f4ec] p-3.5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-[#fffaf0] text-[#bf8743]"><ClipboardCheck size={19} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold text-[#5e5344]">等对方完成选择</p>
            <p className="mt-0.5 text-[10px] text-[#9c907d]">房间码 <span className="font-mono font-bold tracking-[.12em] text-[#78674f]">{roomCode}</span></p>
          </div>
          <span className="h-2 w-2 rounded-full bg-[#efa342] pulse-soft" />
        </div>
        <button type="button" onClick={onCopy} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#e8dfcf] bg-[#fffdf8] text-[13px] font-bold text-[#6d604e] transition hover:border-[#e6b27a]" data-testid="button-copy-invite">
          {copied ? <CheckCircle2 size={16} className="text-[#60946d]" /> : <Link2 size={16} />}
          {copied ? '链接已复制' : '复制邀请链接'}
        </button>
        {devSimulationEnabled && canSimulate && (
          <button
            type="button"
            onClick={onSimulate}
            disabled={simulationPending}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#dfbd8a] bg-[#fffaf0] text-[12px] font-semibold text-[#987345] disabled:cursor-wait disabled:opacity-60"
            data-testid="button-simulate-participant"
          >
            {simulationPending ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {simulationPending ? '正在创建并提交…' : '模拟第二个参与者'}
          </button>
        )}
        <p className="mt-3 text-center text-[10px] text-[#aea28f]">这一页只显示你的进度，不会显示任何人的口味。</p>
      </div>
    </section>
  );
}

function Results({ room, onAgain, onHome, busy }: {
  room: RoomStatus;
  onAgain: () => void;
  onHome: () => void;
  busy: boolean;
}) {
  const recommendations = room.recommendations || [];
  return (
    <section data-testid="state-results">
      <div className="surface page-enter overflow-hidden rounded-[28px]">
        <div className="relative overflow-hidden bg-[#f6cd67] px-5 pb-6 pt-7">
          <span className="absolute -right-8 -top-12 h-40 w-40 rounded-full border-[22px] border-[#f9df9b]/60" />
          <span className="absolute right-12 top-10 h-3 w-3 rounded-full bg-[#fff6dc]" />
          <div className="relative flex items-center gap-2 rounded-full bg-[#fff6dd]/70 px-3 py-1.5 text-[10px] font-bold tracking-[.06em] text-[#8b6831] w-fit"><Sparkles size={13} /> 双方偏好已合拍</div>
          <h2 className="display-title relative mt-4 max-w-[260px] text-[30px] font-extrabold text-[#473821]">今晚的答案，<br />有眉目了。</h2>
          <p className="relative mt-2 text-[12px] text-[#856b3f]">根据两个人的选择，给你们排了这些去处</p>
        </div>
        <div className="space-y-3 p-4">
          {recommendations.length === 0 ? (
            <div className="rounded-[20px] bg-[#f8f4ec] px-4 py-7 text-center" data-testid="empty-recommendations">
              <MapPin size={24} className="mx-auto text-[#c89c62]" />
              <p className="mt-2 text-sm font-bold text-[#645746]">这一轮暂时没有合适的推荐</p>
              <p className="mt-1 text-xs text-[#9d907b]">放宽一点预算或距离，再试一轮吧。</p>
            </div>
          ) : recommendations.map((restaurant, index) => (
            <article key={`${restaurant.name}-${index}`} className={`stagger-in rounded-[21px] border p-4 ${index === 0 ? 'border-[#edc781] bg-[#fff9ed]' : 'border-[#eee5d7] bg-[#fffdf9]'}`} data-testid={`card-recommendation-${index}`}>
              <div className="flex items-start gap-3">
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-[15px] ${index === 0 ? 'bg-[#f7d77f] text-[#815e2c]' : 'bg-[#f2ecdf] text-[#8c7859]'}`}>
                  {index === 0 ? <Sparkles size={20} /> : <Utensils size={19} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-[16px] font-extrabold tracking-[-.03em] text-[#43392c]" data-testid={`text-recommendation-name-${index}`}>{restaurant.name}</h3>
                    <span className="shrink-0 text-[17px] font-extrabold text-[#e47d2e]">{restaurant.matchPercent}<span className="text-[10px]">%</span></span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-medium text-[#958875]">
                    <span>{restaurant.cuisine}</span><span>·</span><span>{'¥'.repeat(Math.max(1, Math.min(3, restaurant.priceLevel || 1)))}</span><span>·</span><span>{restaurant.distance.toFixed(1)} km</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {restaurant.reasons.map((reason, reasonIndex) => <span key={`${reason}-${reasonIndex}`} className="rounded-full bg-[#f6f0e4] px-2.5 py-1 text-[10px] font-medium text-[#7e705b]" data-testid={`text-match-reason-${index}-${reasonIndex}`}>{reason}</span>)}
              </div>
            </article>
          ))}
          <div className="flex items-start gap-2 rounded-[16px] bg-[#f7f3eb] px-3.5 py-3 text-[10px] leading-[1.65] text-[#978a76]">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[#7d9b78]" />
            <p>这些是按你们刚才提交的口味做的本地示例推荐，不是实时商家或营业状态信息。</p>
          </div>
        </div>
      </div>
      <button type="button" onClick={onAgain} disabled={busy} className="mt-4 flex h-[53px] w-full items-center justify-center gap-2 rounded-2xl bg-[#f28c3a] text-[15px] font-bold text-white shadow-[0_7px_16px_#e9873840] disabled:opacity-60" data-testid="button-again">
        {busy ? <LoaderCircle size={18} className="animate-spin" /> : <RotateCcw size={17} />}
        {busy ? '正在开启新一轮…' : '再来一次'}
      </button>
      <button type="button" onClick={onHome} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#e8dfcf] bg-[#fffdf8] text-[13px] font-bold text-[#766a58]" data-testid="button-new-room">
        开一个新房间 <ArrowDownRight size={15} />
      </button>
      <p className="mt-4 text-center text-[10px] text-[#aea28f]" data-testid="text-ranked-note">按共同偏好由高到低排序</p>
    </section>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/room/:roomCode" component={RoomPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function PwaRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
    }
  }, []);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <PwaRegistration />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
