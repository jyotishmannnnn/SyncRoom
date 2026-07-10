import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Dices, MonitorPlay, Plus, ShieldCheck, Video, Zap } from 'lucide-react';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '@syncroom/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo } from '@/components/Logo';
import { VideoBackground } from '@/components/VideoBackground';

const FEATURES = [
  {
    icon: <Video size={18} />,
    title: 'Crystal-clear calls',
    text: 'Direct peer-to-peer video up to 4K60, no server compression in the middle.',
  },
  {
    icon: <MonitorPlay size={18} />,
    title: 'Watch together',
    text: 'YouTube, Drive and direct links play in perfect sync for everyone.',
  },
  {
    icon: <Zap size={18} />,
    title: 'Instant rooms',
    text: 'No accounts, no installs. Share a code and you are in.',
  },
  {
    icon: <ShieldCheck size={18} />,
    title: 'Private by design',
    text: 'Rooms are ephemeral, nothing is stored once everyone leaves.',
  },
];

export function HomePage() {
  const navigate = useNavigate();
  const [createCode, setCreateCode] = useState(generateRoomCode());
  const [joinCode, setJoinCode] = useState('');
  const [createError, setCreateError] = useState('');
  const [joinError, setJoinError] = useState('');

  const goCreate = (e: FormEvent): void => {
    e.preventDefault();
    const code = normalizeRoomCode(createCode);
    if (!isValidRoomCode(code)) {
      setCreateError('4–10 lowercase letters, digits or hyphens.');
      return;
    }
    navigate(`/room/${code}?create=1`);
  };

  const goJoin = (e: FormEvent): void => {
    e.preventDefault();
    const code = normalizeRoomCode(joinCode);
    if (!isValidRoomCode(code)) {
      setJoinError('That does not look like a room code.');
      return;
    }
    navigate(`/room/${code}`);
  };

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <VideoBackground />
      {/* Soft, off-center sakura washes, subtle rather than a centered neon blob. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-8rem] h-80 w-[42rem] rounded-full bg-accent/[0.1] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-56 left-[-10rem] h-80 w-[40rem] rounded-full bg-accent/[0.06] blur-3xl"
      />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-onaccent">
            <Logo size={20} title="" />
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">Havnn</span>
        </span>
        <ThemeToggle />
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-16">
        <section className="mx-auto max-w-2xl pt-10 text-center sm:pt-20">
          <h1 className="animate-slide-up font-display text-[clamp(2.5rem,3.5vw+2rem,4.5rem)] font-medium leading-[1.05] tracking-tight">
            Meet, share and <span className="italic text-gold">watch together</span>
          </h1>
          <p className="mx-auto mt-5 max-w-lg animate-slide-up text-base leading-relaxed text-ink-dim sm:text-lg">
            High-fidelity video calls with perfectly synchronized playback. Create a room, share the
            code, press play.
          </p>
        </section>

        <section className="mx-auto mt-12 grid max-w-3xl gap-4 sm:grid-cols-2">
          <form
            onSubmit={goCreate}
            className="glass flex flex-col gap-4 rounded-2xl p-6 animate-slide-up"
          >
            <h2 className="flex items-center gap-2 font-semibold">
              <Plus size={18} className="text-accent" /> New room
            </h2>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  label="Room code"
                  value={createCode}
                  onChange={(e) => {
                    setCreateCode(e.target.value);
                    setCreateError('');
                  }}
                  error={createError || undefined}
                  hint="Use the generated code or type your own"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={10}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                aria-label="Generate a new random code"
                onClick={() => setCreateCode(generateRoomCode())}
                className="mb-[26px] h-11 w-11 shrink-0 p-0"
              >
                <Dices size={18} />
              </Button>
            </div>
            <Button type="submit" size="lg">
              Create room <ArrowRight size={16} />
            </Button>
          </form>

          <form
            onSubmit={goJoin}
            className="glass flex flex-col gap-4 rounded-2xl p-6 animate-slide-up"
          >
            <h2 className="flex items-center gap-2 font-semibold">
              <ArrowRight size={18} className="text-accent" /> Join a room
            </h2>
            <Input
              label="Room code"
              placeholder="abcd-efgh"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value);
                setJoinError('');
              }}
              error={joinError || undefined}
              hint="Ask the host for their code"
              autoComplete="off"
              spellCheck={false}
              maxLength={10}
            />
            <Button type="submit" size="lg" variant="secondary" className="mt-auto">
              Join
            </Button>
          </form>
        </section>

        <section className="mx-auto mt-16 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-surface-raised/50 p-5">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gold/15 text-gold">
                {f.icon}
              </span>
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-dim">{f.text}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
