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
import WallpaperLayer from './WallpaperLayer';

interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const lockPreferences = useMemo(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('nammu-settings') || '{}');
      return {
        showDate: saved.lockShowDate !== false,
        showProfile: saved.lockShowProfile !== false,
      };
    } catch {
      return { showDate: true, showProfile: true };
    }
  }, []);
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
    <main className="os-lock-screen relative flex h-screen w-screen items-center justify-center overflow-hidden text-os-text">
      <WallpaperLayer />
      <div className="os-lock-scrim absolute inset-0" aria-hidden="true" />

      <header className="os-lock-menubar absolute inset-x-0 top-0 z-10 flex h-9 items-center justify-between px-4">
        <div className="flex items-center gap-2 font-mono text-[8px] font-medium uppercase tracking-[0.18em] text-os-text-muted">
          <span className="h-1 w-1 bg-os-accent" /> Nammu OS
          <span className="text-os-text-dim">/</span>
          <span>Secure session</span>
        </div>
        {lockPreferences.showDate && (
          <div className="flex items-center gap-3 font-mono text-[8px] uppercase tracking-[0.12em] text-os-text-muted">
            <span>
              {time.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span className="font-semibold text-os-text">
              {time.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })}
            </span>
          </div>
        )}
      </header>

      <section className="os-lock-card relative z-10 w-[min(92vw,380px)]">
        <div className="os-lock-card-header flex h-9 items-center justify-between px-3">
          <span className="flex items-center gap-1.5 font-mono text-[8px] font-medium uppercase tracking-[0.16em] text-os-text-muted">
            <LockKeyhole size={11} className="text-os-accent" /> Authentication
          </span>
          <span className="font-mono text-[7.5px] uppercase tracking-[0.12em] text-os-text-dim">
            Local profile
          </span>
        </div>

        <div className="p-5">
          {lockPreferences.showProfile && (
            <div className="flex items-center gap-3 border-b border-os-border/20 pb-4">
              <div className="os-lock-avatar grid h-14 w-14 shrink-0 place-items-center">
                {initials ? (
                  <span className="font-display text-[18px] font-semibold tracking-[0.08em] text-os-accent">
                    {initials}
                  </span>
                ) : (
                  <UserRound size={23} className="text-os-accent" />
                )}
              </div>
              <div className="min-w-0 text-left">
                <div className="truncate text-[15px] font-semibold text-os-text">{displayName}</div>
                <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.14em] text-os-text-muted">
                  {isFirstRun ? 'Create local profile' : `@${profile.username}`}
                </div>
              </div>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className={`${lockPreferences.showProfile ? 'mt-4' : ''} space-y-3 text-left`}
          >
            {isFirstRun && (
              <label className="block">
                <span className="mb-1.5 block font-mono text-[8px] uppercase tracking-[0.14em] text-os-text-muted">
                  Username
                </span>
                <div className="os-lock-field flex items-center gap-2 px-3">
                  <UserRound size={12} className="shrink-0 text-os-text-muted" />
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    maxLength={32}
                    className="h-9 min-w-0 flex-1 bg-transparent text-[11px] text-os-text outline-none"
                    aria-label="Username"
                  />
                </div>
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 block font-mono text-[8px] uppercase tracking-[0.14em] text-os-text-muted">
                {isFirstRun ? 'Create password' : 'Password'}
              </span>
              <div className="os-lock-field flex items-center gap-2 px-3">
                <LockKeyhole size={12} className="shrink-0 text-os-text-muted" />
                <input
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isFirstRun ? 'new-password' : 'current-password'}
                  className="h-9 min-w-0 flex-1 bg-transparent text-[11px] text-os-text outline-none"
                  placeholder={isFirstRun ? 'At least 6 characters' : 'Enter your password'}
                  aria-label={isFirstRun ? 'Create password' : 'Password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="os-lock-reveal grid h-7 w-7 place-items-center text-os-text-muted transition-colors hover:text-os-accent"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </label>

            {error && (
              <div
                role="alert"
                className="os-lock-error px-2.5 py-2 font-mono text-[8px] leading-relaxed text-os-red"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !password || (isFirstRun && normalizedUsername.length < 2)}
              className="os-lock-submit flex h-9 w-full items-center justify-center gap-2 font-mono text-[8px] font-medium uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Power size={12} />
              <span>
                {isSubmitting ? 'Verifying…' : isFirstRun ? 'Set password & power on' : 'Power on'}
              </span>
            </button>
          </form>
        </div>

        <div className="os-lock-card-footer flex h-9 items-center justify-center gap-1.5 px-3 font-mono text-[7.5px] uppercase tracking-[0.12em] text-os-text-dim">
          <ShieldCheck size={10} className="text-os-accent" />
          {isFirstRun ? 'Credentials remain on this device' : 'Workspace locked locally'}
        </div>
      </section>
    </main>
  );
}
