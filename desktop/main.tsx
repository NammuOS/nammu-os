import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import DesktopApp from '../src/components/desktop/DesktopApp';
import StandaloneWindowContent from '../src/components/desktop/StandaloneWindowContent';
import { getPlatformCapabilities } from '../src/platform';
import '../src/app/localFonts';
import '../src/app/globals.css';
import '../src/app/horizon.css';

interface StandaloneBootstrap {
  kind: 'app' | 'tool';
  id: string;
}

async function getStandaloneBootstrap(): Promise<StandaloneBootstrap | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<StandaloneBootstrap | null>('get_standalone_bootstrap');
}

const rootElement = document.getElementById('nammu-root');

if (!rootElement) {
  throw new Error('Nammu desktop root element was not found.');
}
const desktopRootElement = rootElement;

async function startDesktop() {
  const services = getPlatformCapabilities().services;
  const [serviceInfo, standaloneBootstrap] = await Promise.all([
    services.ready(),
    getStandaloneBootstrap(),
  ]);
  const healthResponse = await services.request('/api/health', { cache: 'no-store' });
  if (!healthResponse.ok) {
    throw new Error(`Local service health check failed (${healthResponse.status}).`);
  }
  const health = (await healthResponse.json()) as {
    status?: unknown;
    runtime?: unknown;
    instanceId?: unknown;
  };
  if (
    health.status !== 'ok' ||
    health.runtime !== 'desktop-local' ||
    health.instanceId !== serviceInfo.instanceId
  ) {
    throw new Error('Local service health check returned the wrong session identity.');
  }

  const standaloneKind = standaloneBootstrap?.kind;
  const standaloneId = standaloneBootstrap?.id;
  const isStandalone =
    (standaloneKind === 'app' || standaloneKind === 'tool') &&
    Boolean(standaloneId && /^[a-z0-9-]{1,80}$/u.test(standaloneId));

  createRoot(desktopRootElement).render(
    <StrictMode>
      {isStandalone && standaloneId ? (
        <StandaloneWindowContent kind={standaloneKind} id={standaloneId} />
      ) : (
        <main className="h-screen w-screen overflow-hidden select-none bg-[#05070b]">
          <DesktopApp />
        </main>
      )}
    </StrictMode>,
  );
}

void startDesktop().catch((error) => {
  const message =
    error instanceof Error
      ? `Nammu OS could not start: ${error.message}`
      : 'Nammu OS could not start.';
  desktopRootElement.innerHTML = '';
  const shell = document.createElement('main');
  shell.className = 'desktop-startup-error';
  const panel = document.createElement('section');
  panel.className = 'desktop-startup-error-panel';
  const heading = document.createElement('h1');
  heading.textContent = 'Unable to open Nammu OS';
  const detail = document.createElement('p');
  detail.textContent = message;
  panel.append(heading, detail);
  shell.append(panel);
  desktopRootElement.append(shell);
});
