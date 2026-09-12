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

export interface AppSandboxHostProps {
  appId: string;
  windowId?: string;
  title?: string;
  onTitleChange?: (title: string) => void;
  onClose?: () => void;
  onNotification?: (notification: NotificationPayload) => void;
  className?: string;
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
      });

      const context: SandboxContext = {
        instanceId,
        appId,
        windowId,
        instanceNonce,
        grantedPermissions: permissions,
        requestedPermissions,
        scopedVfs,
        postMessage: (msg) => {
          messageChannelRef.current?.port1.postMessage(msg);
        },
      };

      if (cancelled) return;

      broker.registerContext(context);
      brokerRef.current = broker;
      contextRef.current = context;

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
        brokerRef.current.unregisterContext(instanceId);
      }
      if (messageChannelRef.current) {
        messageChannelRef.current.port1.close();
        messageChannelRef.current = null;
      }
      channelBoundRef.current = false;
      pendingPortRequestsRef.current = [];
    };
  }, [appId, instanceId, instanceNonce, windowId]);

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
