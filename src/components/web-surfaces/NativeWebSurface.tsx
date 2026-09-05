'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  getPlatformCapabilities,
  type WebSurfaceBounds,
  type WebSurfaceOwner,
  type WebSurfaceSnapshot,
} from '../../platform';
import { createWebSurface, type WebSurface } from '../../web-surfaces';
import { useContextMenuStore } from '../context-menu/contextMenuStore';
import { useWindowRuntime } from '../os/WindowRuntimeContext';

export interface NativeWebSurfaceHandle {
  navigate(url: string): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  focus(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
}

interface NativeWebSurfaceProps {
  enabled: boolean;
  active: boolean;
  owner?: WebSurfaceOwner;
  profileKey?: string;
  privateSession?: boolean;
  url: string | null;
  zoom: number;
  muted: boolean;
  browserOverlayActive: boolean;
  overlayActive?: boolean;
  surfaceLabel?: string;
  onState(snapshot: WebSurfaceSnapshot): void;
  onReady(): void;
  onFailure(message: string): void;
  onDiagnostic(message: string): void;
  onOpenRequest?(url: string): void;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function invokeSurface(
  surfaceRef: MutableRefObject<WebSurface | null>,
  operation: (surface: WebSurface) => Promise<void>,
) {
  const surface = surfaceRef.current;
  return surface ? operation(surface) : Promise.resolve();
}

const NativeWebSurface = forwardRef<NativeWebSurfaceHandle, NativeWebSurfaceProps>(function NativeWebSurface(
  {
    enabled,
    active,
    owner = 'browser',
    profileKey = 'default',
    privateSession = false,
    url,
    zoom,
    muted,
    browserOverlayActive,
    overlayActive = false,
    surfaceLabel = 'Native website viewport',
    onState,
    onReady,
    onFailure,
    onDiagnostic,
    onOpenRequest,
  },
  ref,
) {
  const platform = getPlatformCapabilities();
  const windowRuntime = useWindowRuntime();
  const { menu: globalContextMenu } = useContextMenuStore();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<WebSurface | null>(null);
  const mountedRef = useRef(true);
  const creatingRef = useRef(false);
  const observedUrlRef = useRef<string | null>(null);
  const boundsFrameRef = useRef(0);
  const lastBoundsRef = useRef('');
  const boundsInFlightRef = useRef(false);
  const pendingBoundsRef = useRef<WebSurfaceBounds | null>(null);
  const visibilityQueueRef = useRef<Promise<void>>(Promise.resolve());
  const visibilityRevisionRef = useRef(0);
  const callbacksRef = useRef({ onState, onReady, onFailure, onDiagnostic, onOpenRequest });
  const [surfaceEpoch, setSurfaceEpoch] = useState(0);
  const [surfaceId, setSurfaceId] = useState<string | null>(null);

  callbacksRef.current = { onState, onReady, onFailure, onDiagnostic, onOpenRequest };

  const flushBounds = useCallback(async () => {
    if (boundsInFlightRef.current) return;
    boundsInFlightRef.current = true;
    try {
      while (pendingBoundsRef.current) {
        const nextBounds = pendingBoundsRef.current;
        pendingBoundsRef.current = null;
        const surface = surfaceRef.current;
        if (!surface) return;
        await surface.setBounds(nextBounds);
      }
    } catch (error) {
      callbacksRef.current.onDiagnostic(messageFrom(error));
    } finally {
      boundsInFlightRef.current = false;
      if (pendingBoundsRef.current) void flushBounds();
    }
  }, []);

  const scheduleBounds = useCallback(() => {
    if (boundsFrameRef.current) return;
    boundsFrameRef.current = window.requestAnimationFrame(() => {
      boundsFrameRef.current = 0;
      const node = hostRef.current;
      const surface = surfaceRef.current;
      if (!node || !surface) return;
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const bounds = {
        x: Math.max(0, rect.left),
        y: Math.max(0, rect.top),
        width: rect.width,
        height: rect.height,
      };
      const signature = [bounds.x, bounds.y, bounds.width, bounds.height]
        .map((value) => value.toFixed(2))
        .join(':');
      if (signature === lastBoundsRef.current) return;
      lastBoundsRef.current = signature;
      pendingBoundsRef.current = bounds;
      void flushBounds();
    });
  }, [flushBounds]);

  useImperativeHandle(
    ref,
    () => ({
      navigate: (target) => invokeSurface(surfaceRef, (surface) => surface.navigate(target)),
      goBack: () => invokeSurface(surfaceRef, (surface) => surface.control('go-back')),
      goForward: () => invokeSurface(surfaceRef, (surface) => surface.control('go-forward')),
      reload: () => invokeSurface(surfaceRef, (surface) => surface.control('reload')),
      stop: () => invokeSurface(surfaceRef, (surface) => surface.control('stop')),
      focus: () => invokeSurface(surfaceRef, (surface) => surface.focus()),
      setMuted: (muted) =>
        invokeSurface(surfaceRef, (surface) => surface.control(muted ? 'mute' : 'unmute')),
    }),
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.cancelAnimationFrame(boundsFrameRef.current);
      pendingBoundsRef.current = null;
      const surface = surfaceRef.current;
      surfaceRef.current = null;
      if (surface) void surface.destroy().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!enabled || !url || surfaceRef.current || creatingRef.current) return;
    const node = hostRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    creatingRef.current = true;
    void createWebSurface(platform.webSurfaces, {
      owner,
      profileKey,
      privateSession,
      url,
      bounds: {
        x: Math.max(0, rect.left),
        y: Math.max(0, rect.top),
        width: rect.width,
        height: rect.height,
      },
      visible: false,
    })
      .then(({ surface, initialState }) => {
        if (!mountedRef.current) {
          void surface.destroy();
          return;
        }
        surfaceRef.current = surface;
        setSurfaceId(surface.id);
        observedUrlRef.current = initialState.url;
        setSurfaceEpoch((value) => value + 1);
        lastBoundsRef.current = '';
        callbacksRef.current.onState(initialState);
        callbacksRef.current.onReady();
        scheduleBounds();
      })
      .catch((error) => callbacksRef.current.onFailure(messageFrom(error)))
      .finally(() => {
        creatingRef.current = false;
      });
  }, [enabled, owner, platform.webSurfaces, privateSession, profileKey, scheduleBounds, url]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void platform.webSurfaces
      .subscribe((snapshot) => {
        if (surfaceRef.current?.id === snapshot.id) {
          observedUrlRef.current = snapshot.url;
          callbacksRef.current.onState(snapshot);
        }
      })
      .then((dispose) => {
        if (cancelled) dispose();
        else unlisten = dispose;
      })
      .catch((error) => callbacksRef.current.onDiagnostic(messageFrom(error)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, platform.webSurfaces]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void platform.webSurfaces
      .subscribeOpenRequests((request) => {
        if (surfaceRef.current?.id === request.sourceId) {
          callbacksRef.current.onOpenRequest?.(request.url);
        }
      })
      .then((dispose) => {
        if (cancelled) dispose();
        else unlisten = dispose;
      })
      .catch((error) => callbacksRef.current.onDiagnostic(messageFrom(error)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, platform.webSurfaces]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !url || observedUrlRef.current === url) return;
    void surface.navigate(url).catch((error) => callbacksRef.current.onFailure(messageFrom(error)));
  }, [surfaceEpoch, url]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    void surface
      .setZoom(Math.min(2, Math.max(0.5, zoom / 100)))
      .catch((error) => callbacksRef.current.onDiagnostic(messageFrom(error)));
  }, [surfaceEpoch, zoom]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    void surface
      .control(muted ? 'mute' : 'unmute')
      .catch((error) => callbacksRef.current.onDiagnostic(messageFrom(error)));
  }, [muted, surfaceEpoch]);

  const shouldBeVisible =
    enabled &&
    active &&
    Boolean(url) &&
    windowRuntime.isActive &&
    !windowRuntime.isMinimized &&
    !windowRuntime.isInteracting &&
    !windowRuntime.shellOverlayActive &&
    !browserOverlayActive &&
    !overlayActive &&
    !globalContextMenu;

  useEffect(() => {
    const revision = ++visibilityRevisionRef.current;
    visibilityQueueRef.current = visibilityQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const surface = surfaceRef.current;
        if (!surface || revision !== visibilityRevisionRef.current) return;
        await surface.setVisible(shouldBeVisible);
        if (shouldBeVisible && revision === visibilityRevisionRef.current) scheduleBounds();
      })
      .catch((error) => callbacksRef.current.onDiagnostic(messageFrom(error)));
  }, [scheduleBounds, shouldBeVisible, surfaceEpoch]);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const observer = new ResizeObserver(scheduleBounds);
    observer.observe(node);
    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'mouseup',
      'pointermove',
      'pointerup',
      'resize',
      'scroll',
    ];
    events.forEach((eventName) => window.addEventListener(eventName, scheduleBounds, true));
    return () => {
      observer.disconnect();
      events.forEach((eventName) => window.removeEventListener(eventName, scheduleBounds, true));
    };
  }, [scheduleBounds]);

  return (
    <div
      ref={hostRef}
      data-native-web-surface-host={owner}
      data-native-web-surface-id={surfaceId || undefined}
      className={`absolute inset-0 bg-[#05080d] ${active ? '' : 'invisible pointer-events-none'}`}
      onMouseDown={windowRuntime.requestFocus}
      aria-label={surfaceLabel}
    />
  );
});

export default NativeWebSurface;
