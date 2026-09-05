'use client';

import { createContext, useContext, type ReactNode } from 'react';

export type WindowRuntimePhase = 'active' | 'background' | 'minimized';

export interface WindowRuntimeState {
  phase: WindowRuntimePhase;
  isActive: boolean;
  isBackground: boolean;
  isMinimized: boolean;
  isInteracting: boolean;
  managedWindowId: string | null;
  zIndex: number;
  shellOverlayActive: boolean;
  requestFocus(): void;
}

const STANDALONE_RUNTIME_STATE: WindowRuntimeState = Object.freeze({
  phase: 'active',
  isActive: true,
  isBackground: false,
  isMinimized: false,
  isInteracting: false,
  managedWindowId: null,
  zIndex: 0,
  shellOverlayActive: false,
  requestFocus() {},
});

const WindowRuntimeContext = createContext<WindowRuntimeState>(STANDALONE_RUNTIME_STATE);

export function WindowRuntimeProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: WindowRuntimeState;
}) {
  return <WindowRuntimeContext.Provider value={value}>{children}</WindowRuntimeContext.Provider>;
}

export function useWindowRuntime(): WindowRuntimeState {
  return useContext(WindowRuntimeContext);
}
