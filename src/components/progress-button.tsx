'use client';

import { cn } from '@/utils/cn';
import { useId } from 'react';
import type { NammuAppStateOrLoading } from '@/lib/appStore';

interface ProgressButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md' | 'lg';
  state?: NammuAppStateOrLoading;
  progress?: number;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

export function ProgressButton({
  size = 'md',
  state = 'not-installed',
  progress,
  onClick,
  disabled,
  children,
  className,
  style,
  ...props
}: ProgressButtonProps) {
  const id = useId();
  const progressId = `${id}-progress`;

  const isTransitioning = ['installing', 'updating', 'starting', 'stopping', 'restarting', 'uninstalling'].includes(state);
  const showProgress = isTransitioning && progress !== undefined && ['installing', 'updating'].includes(state);

  const sizeClasses = {
    sm: 'h-7 px-3 text-xs',
    md: 'h-9 px-4 text-sm',
    lg: 'h-10 px-5 text-base',
  };

  const stateStyles = {
    idle: 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20',
    'not-installed': 'bg-[#4aa3ff]/15 border-[#4aa3ff]/30 text-[#4aa3ff] hover:bg-[#4aa3ff]/25 hover:border-[#4aa3ff]/50',
    ready: 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20',
    installing: 'bg-[#4aa3ff]/20 border-[#4aa3ff]/40 text-[#4aa3ff] cursor-wait',
    updating: 'bg-[#4aa3ff]/20 border-[#4aa3ff]/40 text-[#4aa3ff] cursor-wait',
    starting: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 cursor-wait',
    stopping: 'bg-amber-500/20 border-amber-500/40 text-amber-400 cursor-wait',
    restarting: 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400 cursor-wait',
    uninstalling: 'bg-red-500/20 border-red-500/40 text-red-400 cursor-wait',
    loading: 'bg-white/5 border-white/10 text-white/50 cursor-wait',
  };

  return (
    <button
      id={id}
      onClick={onClick}
      disabled={disabled || isTransitioning}
      aria-busy={isTransitioning}
      aria-live={showProgress ? 'polite' : 'off'}
      aria-describedby={showProgress ? progressId : undefined}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium rounded-full border transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4aa3ff]/50',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        sizeClasses[size],
        stateStyles[state],
        className,
      )}
      style={{
        ...style,
        ...(showProgress && { '--progress-button-bg': 'hsl(0 0% 30%)' }),
      }}
      {...props}
    >
      {children}
      {showProgress && (
        <span id={progressId} className="ml-1 inline-block w-[4ch] text-right opacity-60 font-mono text-[10px]">
          {Math.round(progress)}%
        </span>
      )}
    </button>
  );
}