import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
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
  const firstName = displayName.split(/\s+/)[0] || 'there';
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
  const clock = useMemo(() => {
    const parts = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(time);
    const readPart = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value || '';
    return {
      hour: readPart('hour'),
      minute: readPart('minute'),
      period: readPart('dayPeriod'),
    };
  }, [time]);

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
      <div className="os-lock-ambient absolute inset-0" aria-hidden="true">
        <span />
        <span />
      </div>

      <header className="os-lock-menubar absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5">
        <div className="os-lock-brand flex items-center gap-2.5">
          <img
            className="h-6 w-6 rounded-[8px] object-contain"
            src="/branding/nammu-logo.webp"
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <span>Nammu OS</span>
        </div>
        <div className="os-lock-secure-badge flex items-center gap-2">
          <ShieldCheck size={13} />
          <span>Private workspace</span>
        </div>
      </header>

      <section className="os-lock-clock absolute top-[11vh] z-10 flex flex-col items-center">
        <div
          className="os-lock-time-glass flex items-end"
          aria-label={`Current time ${clock.hour}:${clock.minute} ${clock.period}`}
        >
          <span className="os-lock-time-digits">
            {clock.hour}:{clock.minute}
          </span>
          <span className="os-lock-time-period">{clock.period}</span>
        </div>
        {lockPreferences.showDate && (
          <p className="os-lock-date">
            {time.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        )}
      </section>

      <section className="os-lock-card relative z-10 w-[min(92vw,390px)]">
        <div className="os-lock-card-content p-6">
          {lockPreferences.showProfile && (
            <div className="os-lock-profile mb-4 flex flex-col items-center text-center">
              <div className="os-lock-avatar grid h-20 w-20 place-items-center">
                {initials ? (
                  <span className="os-lock-initials">{initials}</span>
                ) : (
                  <UserRound size={30} />
                )}
              </div>
            </div>
          )}

          <div className="os-lock-greeting text-center">
            <h1>{isFirstRun ? 'Create your workspace' : `Welcome back, ${firstName}`}</h1>
            <p>
              {isFirstRun
                ? 'Set up a local profile to protect this device.'
                : 'Enter your password to unlock Nammu OS.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="os-lock-form mt-5 space-y-3 text-left">
            {isFirstRun && (
              <label className="block">
                <span className="sr-only">Username</span>
                <div className="os-lock-field flex items-center gap-3 px-4">
                  <UserRound size={16} className="shrink-0" />
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    maxLength={32}
                    className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                    placeholder="Choose a username"
                    aria-label="Username"
                  />
                </div>
              </label>
            )}

            <label className="block">
              <span className="sr-only">{isFirstRun ? 'Create password' : 'Password'}</span>
              <div className="os-lock-field flex items-center gap-3 py-1 pl-4 pr-1.5">
                <LockKeyhole size={16} className="shrink-0" />
                <input
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isFirstRun ? 'new-password' : 'current-password'}
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
                  placeholder={isFirstRun ? 'At least 6 characters' : 'Enter your password'}
                  aria-label={isFirstRun ? 'Create password' : 'Password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="os-lock-reveal grid h-9 w-9 shrink-0 place-items-center"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button
                  type="submit"
                  disabled={
                    isSubmitting || !password || (isFirstRun && normalizedUsername.length < 2)
                  }
                  className="os-lock-submit grid h-9 w-9 shrink-0 place-items-center disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={isFirstRun ? 'Create profile and unlock' : 'Unlock Nammu OS'}
                >
                  <ArrowRight size={17} className={isSubmitting ? 'animate-pulse' : ''} />
                </button>
              </div>
            </label>

            {error && (
              <div
                role="alert"
                className="os-lock-error px-3 py-2.5 text-center text-xs leading-relaxed text-os-red"
              >
                {error}
              </div>
            )}
          </form>

          <div className="os-lock-local-note mt-4 flex items-center justify-center gap-2 text-[10px]">
            <ShieldCheck size={13} />
            <span>
              {isSubmitting
                ? 'Unlocking securely…'
                : isFirstRun
                  ? 'Credentials remain only on this device'
                  : `Local profile · @${profile.username}`}
            </span>
          </div>
        </div>
      </section>

      <p className="os-lock-hint absolute bottom-6 z-10 text-xs">Press Enter to unlock</p>
    </main>
  );
}
