'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getNMUDatabase } from '@/platform/nmu/nmuDatabase';
import { getNammuVFS } from '@/platform/vfs/nammuVFS';
import { getNMUEngine } from '@/platform/nmu/nmuEngine';
import {
  CapabilityBroker,
  type SandboxContext,
  type NotificationPayload,
} from '@/platform/sandbox/capabilityBroker';
import type { PermissionIdentifier } from '@/platform/nmu/nappSpec';
import {
  createSandboxBridgeScript,
  materializeSandboxDocument,
} from '@/platform/sandbox/sandboxBridge';
import { getPlatformCapabilities } from '@/platform';
import { useWindowRuntime } from '../WindowRuntimeContext';
import { createPackageServiceRegistry } from '@/platform/sandbox/packageServiceRegistry';
import type {
  PackageSurfaceBounds,
  PackageSurfaceSnapshot,
} from '@/platform/sandbox/integrationContracts';
import type { WebSurfaceSnapshot } from '@/platform';

export interface AppSandboxHostProps {
  appId: string;
  windowId?: string;
  title?: string;
  onTitleChange?: (title: string) => void;
  onClose?: () => void;
  onNotification?: (notification: NotificationPayload) => void;
  className?: string;
}

function capabilityFailureMessage(result: { status: string; message?: string; reason?: string }) {
  return result.message || result.reason || 'The requested platform capability is unavailable.';
}

async function isolatedProfileKey(appId: string, profileKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(appId));
  const namespace = Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `pkg-${namespace}-${profileKey}`.slice(0, 80);
}

export function AppSandboxHost({
  appId,
  windowId,
  title,
  onTitleChange,
  onClose,
  onNotification,
  className,
}: AppSandboxHostProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const messageChannelRef = useRef<MessageChannel | null>(null);
  const brokerRef = useRef<CapabilityBroker | null>(null);
  const contextRef = useRef<SandboxContext | null>(null);
  const channelBoundRef = useRef(false);
  const pendingPortRequestsRef = useRef<unknown[]>([]);
  const callbacksRef = useRef({ onTitleChange, onClose, onNotification });
  callbacksRef.current = { onTitleChange, onClose, onNotification };

  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const windowRuntime = useWindowRuntime();
  const hostSurfaceVisibleRef = useRef(true);
  hostSurfaceVisibleRef.current =
    windowRuntime.isActive &&
    !windowRuntime.shellOverlayActive &&
    !windowRuntime.isMinimized &&
    (typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const surfaceMapRef = useRef(
    new Map<
      string,
      {
        nativeId: string;
        relativeBounds: PackageSurfaceBounds;
        capability: string;
        desiredVisible: boolean;
      }
    >(),
  );

  // Generate unique instance ID and cryptographically random nonce for channel binding
  const instanceIdRef = useRef<string>(
    `inst_${appId}_${windowId || 'main'}_${Math.random().toString(36).substring(2, 9)}`,
  );
  const instanceNonceRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : Math.random().toString(36).substring(2),
  );

  const instanceId = instanceIdRef.current;
  const instanceNonce = instanceNonceRef.current;

  const packageSurfaceSnapshot = useCallback(
    (handle: string, snapshot: WebSurfaceSnapshot): PackageSurfaceSnapshot => ({
      id: handle,
      url: snapshot.url,
      title: snapshot.title,
      isLoading: snapshot.isLoading,
      canGoBack: snapshot.canGoBack,
      canGoForward: snapshot.canGoForward,
      isAudioPlaying: snapshot.isAudioPlaying,
      isMuted: snapshot.isMuted,
      visible: snapshot.visible,
    }),
    [],
  );

  const hostBounds = useCallback((bounds: PackageSurfaceBounds): PackageSurfaceBounds => {
    const rect = iframeRef.current?.getBoundingClientRect();
    if (!rect) throw new Error('The application viewport is unavailable.');
    return {
      x: rect.left + bounds.x,
      y: rect.top + bounds.y,
      width: Math.min(bounds.width, Math.max(1, rect.width - bounds.x)),
      height: Math.min(bounds.height, Math.max(1, rect.height - bounds.y)),
    };
  }, []);

  // Load and prepare application package
  useEffect(() => {
    let isMounted = true;
    const vfs = getNammuVFS();
    const db = getNMUDatabase();

    async function bootstrap() {
      try {
        setLoading(true);
        setError(null);

        const appRecord = await db.getApp(appId);
        if (!appRecord) {
          throw new Error(`Application "${appId}" is not installed.`);
        }

        if (appRecord.state === 'Disabled') {
          throw new Error(`Application "${appId}" is currently disabled.`);
        }

        // Resolve entry file via versioned directory or flat layout
        const scopedVfs = vfs.createScopedVFS(appId);
        let htmlContent: string;
        try {
          htmlContent = await scopedVfs.readAppText(appRecord.entry);
        } catch {
          const directEntryPath = `/applications/${appId}/${appRecord.entry}`;
          if (await vfs.exists(directEntryPath)) {
            htmlContent = await vfs.readText(directEntryPath);
          } else {
            throw new Error(`Entry file "${appRecord.entry}" not found in application package`);
          }
        }

        htmlContent = await materializeSandboxDocument(htmlContent, appRecord.entry, (path) =>
          scopedVfs.readAppText(path),
        );
        const bridgeScript = createSandboxBridgeScript(appId, instanceId, instanceNonce);
        if (htmlContent.includes('<head>')) {
          htmlContent = htmlContent.replace('<head>', `<head>${bridgeScript}`);
        } else if (htmlContent.includes('<html>')) {
          htmlContent = htmlContent.replace('<html>', `<html><head>${bridgeScript}</head>`);
        } else {
          htmlContent = `${bridgeScript}\n${htmlContent}`;
        }

        if (isMounted) {
          setSrcDoc(htmlContent);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Unknown error loading sandboxed application');
          setLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      isMounted = false;
    };
  }, [appId, instanceId, instanceNonce]);

  // Setup Capability Broker & instance-keyed context
  useEffect(() => {
    let cancelled = false;
    const vfs = getNammuVFS();
    const db = getNMUDatabase();
    const engine = getNMUEngine();
    const platform = getPlatformCapabilities();
    const serviceRegistry = createPackageServiceRegistry(platform);
    let unsubscribeSurfaceState: (() => void) | undefined;

    async function initBroker() {
      const appRecord = await db.getApp(appId);
      if (!appRecord) throw new Error(`Application "${appId}" is not installed.`);
      const permissions = new Set<PermissionIdentifier>(appRecord?.grantedPermissions || []);
      const requestedPermissions = new Set<PermissionIdentifier>(
        appRecord?.requestedPermissions || [],
      );
      const scopedVfs = vfs.createScopedVFS(appId);

      const broker = new CapabilityBroker({
        onWindowTitleChange: (_, __, newTitle) => callbacksRef.current.onTitleChange?.(newTitle),
        onWindowClose: () => callbacksRef.current.onClose?.(),
        onNotification: (_, n) => callbacksRef.current.onNotification?.(n),
        onAppReady: (_, aId) => {
          return engine.acknowledgeActivation(aId);
        },
        onPermissionGranted: (aId, perm) => {
          return engine.grantRuntimePermission(aId, perm);
        },
        onClipboardReadText: async () => {
          const result = await platform.clipboard.readText();
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
          return result.value;
        },
        onClipboardWriteText: async (text) => {
          const result = await platform.clipboard.writeText(text);
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
        },
        onSaveTextFile: async (suggestedName, content, mimeType) => {
          const result = await platform.files.save({ suggestedName, contents: content, mimeType });
          if (result.status === 'cancelled') return { saved: false };
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
          return { saved: true, fileName: result.value.fileName };
        },
        onPickBinaryFiles: async (options) => {
          const result = await platform.files.pick(options);
          if (result.status === 'cancelled') return { cancelled: true, files: [] };
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
          return { cancelled: false, files: result.value.files.map((file) => ({ ...file })) };
        },
        onSaveBinaryFile: async ({ suggestedName, bytes, mimeType }) => {
          const result = await platform.files.save({ suggestedName, contents: bytes, mimeType });
          if (result.status === 'cancelled') return { saved: false };
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
          return { saved: true, fileName: result.value.fileName };
        },
        onServiceRequest: async (_, __, request) =>
          serviceRegistry.request(request.service, request.operation, request.payload),
        onWebSurfaceCreate: async (_, aId, declaration, request) => {
          if (!platform.webSurfaces.supported) {
            throw new Error(
              'This host does not yet provide a packaged web-surface driver for the current runtime.',
            );
          }
          const profileNamespace = await isolatedProfileKey(aId, request.profileKey);
          const result = await platform.webSurfaces.create({
            owner: 'integration',
            profileKey: profileNamespace,
            privateSession: request.privateSession || declaration.persistentProfile !== true,
            url: request.url,
            bounds: hostBounds(request.bounds),
            visible: request.visible && hostSurfaceVisibleRef.current,
            navigationPolicy: {
              allowPublicWeb: declaration.navigation.mode === 'public-web',
              allowedOrigins:
                declaration.navigation.mode === 'approved-origins'
                  ? declaration.navigation.origins
                  : [],
            },
          });
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
          const handle = `surface_${crypto.randomUUID().replaceAll('-', '')}`;
          surfaceMapRef.current.set(handle, {
            nativeId: result.value.id,
            relativeBounds: request.bounds,
            capability: declaration.name,
            desiredVisible: request.visible,
          });
          return packageSurfaceSnapshot(handle, result.value);
        },
        onWebSurfaceDestroy: async (_, handle) => {
          const surface = surfaceMapRef.current.get(handle);
          if (!surface) return;
          surfaceMapRef.current.delete(handle);
          const result = await platform.webSurfaces.destroy(surface.nativeId);
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
        },
        onWebSurfaceNavigate: async (_, handle, url) => {
          const surface = surfaceMapRef.current.get(handle);
          if (!surface) throw new Error('The host web surface no longer exists.');
          const result = await platform.webSurfaces.navigate(surface.nativeId, url);
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
        },
        onWebSurfaceControl: async (_, handle, control) => {
          const surface = surfaceMapRef.current.get(handle);
          if (!surface) throw new Error('The host web surface no longer exists.');
          const result = await platform.webSurfaces.control(surface.nativeId, control);
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
        },
        onWebSurfaceSetBounds: async (_, handle, bounds) => {
          const surface = surfaceMapRef.current.get(handle);
          if (!surface) throw new Error('The host web surface no longer exists.');
          surface.relativeBounds = bounds;
          const result = await platform.webSurfaces.setBounds(surface.nativeId, hostBounds(bounds));
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
        },
        onWebSurfaceSetVisible: async (_, handle, visible) => {
          const surface = surfaceMapRef.current.get(handle);
          if (!surface) throw new Error('The host web surface no longer exists.');
          surface.desiredVisible = visible;
          const result = await platform.webSurfaces.setVisible(
            surface.nativeId,
            visible && hostSurfaceVisibleRef.current,
          );
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
        },
        onWebSurfaceSetZoom: async (_, handle, zoom) => {
          const surface = surfaceMapRef.current.get(handle);
          if (!surface) throw new Error('The host web surface no longer exists.');
          const result = await platform.webSurfaces.setZoom(surface.nativeId, zoom);
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
        },
        onWebSurfaceSetProxyRoute: async (_, handle, scope, endpoints) => {
          const surface = surfaceMapRef.current.get(handle);
          if (!surface) throw new Error('The host web surface no longer exists.');
          const result = await platform.webSurfaces.setProxyRoute(
            surface.nativeId,
            scope,
            endpoints,
          );
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
        },
        onWebSurfaceFocus: async (_, handle) => {
          const surface = surfaceMapRef.current.get(handle);
          if (!surface) throw new Error('The host web surface no longer exists.');
          const result = await platform.webSurfaces.focus(surface.nativeId);
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
        },
        onWebSurfaceGetState: async (_, handle) => {
          const surface = surfaceMapRef.current.get(handle);
          if (!surface) throw new Error('The host web surface no longer exists.');
          const result = await platform.webSurfaces.getState(surface.nativeId);
          if (result.status !== 'success') throw new Error(capabilityFailureMessage(result));
          return packageSurfaceSnapshot(handle, result.value);
        },
        onLegacyStorageRead: async (key) => localStorage.getItem(key),
        onLegacyStorageComplete: async (key) => localStorage.removeItem(key),
      });

      const context: SandboxContext = {
        instanceId,
        appId,
        windowId,
        instanceNonce,
        grantedPermissions: permissions,
        requestedPermissions,
        legacyStorageKeys: new Set(appRecord.legacyStorageKeys ?? []),
        capabilities: appRecord.capabilities ?? [],
        lifecycleState: {
          phase: 'active',
          visible: true,
          focused: true,
          active: true,
          suspended: false,
        },
        scopedVfs,
        postMessage: (msg) => {
          messageChannelRef.current?.port1.postMessage(msg);
        },
      };

      if (cancelled) return;

      broker.registerContext(context);
      brokerRef.current = broker;
      contextRef.current = context;
      if (platform.webSurfaces.supported) {
        unsubscribeSurfaceState = await platform.webSurfaces.subscribe((snapshot) => {
          const match = [...surfaceMapRef.current.entries()].find(
            ([, surface]) => surface.nativeId === snapshot.id,
          );
          if (match)
            broker.publishSurfaceState(instanceId, packageSurfaceSnapshot(match[0], snapshot));
        });
        const unsubscribeOpenRequests = await platform.webSurfaces.subscribeOpenRequests(
          (request) => {
            const match = [...surfaceMapRef.current.entries()].find(
              ([, surface]) => surface.nativeId === request.sourceId,
            );
            if (match) broker.publishSurfaceOpenRequest(instanceId, match[0], request.url);
          },
        );
        const previousUnsubscribe = unsubscribeSurfaceState;
        unsubscribeSurfaceState = () => {
          previousUnsubscribe?.();
          unsubscribeOpenRequests();
        };
      }

      const pending = pendingPortRequestsRef.current.splice(0);
      for (const request of pending) {
        const response = await broker.handleRequest(context, request as any);
        messageChannelRef.current?.port1.postMessage(response);
      }
    }

    void initBroker().catch((failure) => {
      if (!cancelled) {
        setError(failure instanceof Error ? failure.message : 'Unable to initialize app sandbox');
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      if (brokerRef.current) {
        void brokerRef.current.unregisterContext(instanceId);
      }
      unsubscribeSurfaceState?.();
      if (messageChannelRef.current) {
        messageChannelRef.current.port1.close();
        messageChannelRef.current = null;
      }
      channelBoundRef.current = false;
      pendingPortRequestsRef.current = [];
    };
  }, [appId, hostBounds, instanceId, instanceNonce, packageSurfaceSnapshot, windowId]);

  useEffect(() => {
    const publish = () => {
      const suspended = document.visibilityState === 'hidden';
      brokerRef.current?.updateLifecycle(instanceId, {
        phase: suspended ? 'suspended' : windowRuntime.phase,
        visible: !windowRuntime.isMinimized && !suspended,
        focused: windowRuntime.isActive && !windowRuntime.shellOverlayActive && !suspended,
        active: windowRuntime.isActive && !suspended,
        suspended,
      });
      const platform = getPlatformCapabilities();
      if (platform.webSurfaces.supported) {
        for (const surface of surfaceMapRef.current.values()) {
          void platform.webSurfaces.setVisible(
            surface.nativeId,
            surface.desiredVisible &&
              windowRuntime.isActive &&
              !windowRuntime.shellOverlayActive &&
              !windowRuntime.isMinimized &&
              !suspended,
          );
        }
      }
    };
    publish();
    document.addEventListener('visibilitychange', publish);
    return () => document.removeEventListener('visibilitychange', publish);
  }, [
    instanceId,
    windowRuntime.isActive,
    windowRuntime.isMinimized,
    windowRuntime.phase,
    windowRuntime.shellOverlayActive,
  ]);

  useEffect(() => {
    const platform = getPlatformCapabilities();
    if (!platform.webSurfaces.supported) return;
    let frame = 0;
    const reflow = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        for (const surface of surfaceMapRef.current.values()) {
          try {
            void platform.webSurfaces.setBounds(
              surface.nativeId,
              hostBounds(surface.relativeBounds),
            );
          } catch {
            // The sandbox host may have detached between scheduling and layout.
          }
        }
      });
    };
    const observer = new ResizeObserver(reflow);
    if (iframeRef.current) observer.observe(iframeRef.current);
    const events: Array<keyof WindowEventMap> = ['mousemove', 'mouseup', 'resize', 'scroll'];
    events.forEach((name) => window.addEventListener(name, reflow, true));
    return () => {
      observer.disconnect();
      events.forEach((name) => window.removeEventListener(name, reflow, true));
      if (frame) cancelAnimationFrame(frame);
    };
  }, [hostBounds, srcDoc]);

  // Establish MessageChannel binding when iframe loads
  const handleIframeLoad = useCallback(() => {
    if (!iframeRef.current?.contentWindow || channelBoundRef.current) return;

    try {
      const channel = new MessageChannel();
      channelBoundRef.current = true;
      messageChannelRef.current = channel;

      channel.port1.onmessage = async (event: MessageEvent) => {
        if (brokerRef.current && contextRef.current && event.data) {
          const response = await brokerRef.current.handleRequest(contextRef.current, event.data);
          channel.port1.postMessage(response);
        } else if (event.data) {
          pendingPortRequestsRef.current.push(event.data);
        }
      };

      // Transfer port2 to iframe with instanceNonce
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'nammu:bootstrap',
          instanceId,
          instanceNonce,
        },
        '*',
        [channel.port2],
      );
    } catch (e) {
      channelBoundRef.current = false;
      setError(
        e instanceof Error ? e.message : 'Unable to establish the private application channel',
      );
    }
  }, [instanceId, instanceNonce]);

  return (
    <div
      className={`relative w-full h-full flex flex-col bg-neutral-950 overflow-hidden ${className || ''}`}
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center h-full text-neutral-400 gap-2">
          <div className="w-5 h-5 border-2 border-neutral-600 border-t-amber-400 rounded-full animate-spin" />
          <span className="text-xs tracking-wide">Launching {appId}...</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-full text-rose-400 p-6 text-center">
          <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-3">
            <svg
              className="w-5 h-5 text-rose-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="font-medium text-sm text-neutral-200 mb-1">Application Sandbox Error</p>
          <p className="text-xs text-rose-400/90 max-w-sm">{error}</p>
        </div>
      ) : srcDoc ? (
        <iframe
          ref={iframeRef}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          className="w-full h-full border-none bg-transparent"
          title={title || appId}
          onLoad={handleIframeLoad}
        />
      ) : null}
    </div>
  );
}
