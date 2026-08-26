import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LockKeyhole, Power, ShieldCheck, UserRound } from 'lucide-react';
import {
  createLockProfile,
  getLockDisplayName,
  getStoredLockProfile,
  normalizeLockUsername,
  saveLockProfile,
  verifyLockPassword,
} from '../../lib/osLock';

interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [time, setTime] = useState(() => new Date());
  const [profile, setProfile] = useState(() => getStoredLockProfile());
  const [username, setUsername] = useState(() => profile?.username || 'nammu');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const isFirstRun = !profile;
  const normalizedUsername = normalizeLockUsername(username);
  const displayName = profile?.displayName || getLockDisplayName(normalizedUsername);
  const initials = useMemo(
    () =>
      displayName
        .split(/\s+/)
        .map((part) => part.charAt(0))
        .join('')
        .slice(0, 2)
        .toUpperCase() || 'NU',
    [displayName],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 1_000);
    passwordRef.current?.focus();
    return () => window.clearInterval(timer);
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError('');
    setIsSubmitting(true);
    try {
      if (isFirstRun) {
        const nextProfile = await createLockProfile(normalizedUsername, password);
        saveLockProfile(nextProfile);
        setProfile(nextProfile);
        onUnlock();
        return;
      }

      if (!(await verifyLockPassword(profile, password))) {
        setError('Incorrect password. Try again.');
        setPassword('');
        window.setTimeout(() => passwordRef.current?.focus(), 0);
        return;
      }
      onUnlock();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : 'Unable to unlock Nammu OS.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="os-lock-screen relative grid h-screen w-screen overflow-hidden text-os-text">
      <div className="os-lock-atmosphere" aria-hidden="true" />
      <div className="os-scanline" aria-hidden="true" />

      <div className="absolute left-6 top-5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.24em] text-os-text-muted">
        <span className="status-dot" /> Nammu OS secure session
      </div>

      <div className="absolute right-6 top-5 text-right font-mono">
        <div className="text-[11px] font-semibold tracking-[0.14em] text-os-text">
          {time.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })}
        </div>
        <div className="mt-0.5 text-[8px] uppercase tracking-[0.15em] text-os-text-muted">
          {time.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}
        </div>
      </div>

      <section className="os-lock-card relative z-10 m-auto w-[min(92vw,390px)] px-8 py-8 text-center">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-os-accent/35 bg-os-accent/10 shadow-[0_0_36px_rgba(var(--os-accent-rgb,74,163,255),0.14)]">
          {initials ? (
            <span className="font-display text-2xl font-semibold tracking-[0.08em] text-os-accent">
              {initials}
            </span>
          ) : (
            <UserRound size={30} className="text-os-accent" />
          )}
        </div>

        <div className="mt-4">
          <div className="text-[17px] font-semibold tracking-tight text-os-text">{displayName}</div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-os-text-muted">
            {isFirstRun ? 'Create local profile' : `@${profile.username}`}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3 text-left">
          {isFirstRun && (
            <label className="block">
              <span className="mb-1.5 block font-mono text-[8px] uppercase tracking-[0.16em] text-os-text-muted">
                Username
              </span>
              <div className="os-lock-field flex items-center gap-2 px-3">
                <UserRound size={13} className="shrink-0 text-os-accent" />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  maxLength={32}
                  className="h-10 min-w-0 flex-1 bg-transparent text-[12px] text-os-text outline-none"
                  aria-label="Username"
                />
              </div>
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block font-mono text-[8px] uppercase tracking-[0.16em] text-os-text-muted">
              {isFirstRun ? 'Create password' : 'Password'}
            </span>
            <div className="os-lock-field flex items-center gap-2 px-3 focus-within:border-os-accent/60">
              <LockKeyhole size={13} className="shrink-0 text-os-accent" />
              <input
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isFirstRun ? 'new-password' : 'current-password'}
                className="h-10 min-w-0 flex-1 bg-transparent text-[12px] text-os-text outline-none"
                placeholder={isFirstRun ? 'At least 6 characters' : 'Enter your password'}
                aria-label={isFirstRun ? 'Create password' : 'Password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="grid h-7 w-7 place-items-center rounded text-os-text-muted transition-colors hover:bg-os-accent/10 hover:text-os-accent"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </label>

          {error && (
            <div role="alert" className="font-mono text-[9px] leading-relaxed text-os-red">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !password || (isFirstRun && normalizedUsername.length < 2)}
            className="os-lock-submit flex h-10 w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Power size={14} />
            <span>
              {isSubmitting ? 'Verifying…' : isFirstRun ? 'Set password & power on' : 'Power on'}
            </span>
          </button>
        </form>

        <div className="mt-5 flex items-center justify-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.13em] text-os-text-dim">
          <ShieldCheck size={10} className="text-os-accent" />
          {isFirstRun ? 'Password stays on this device' : 'Workspace locked locally'}
        </div>
      </section>
    </main>
  );
}
