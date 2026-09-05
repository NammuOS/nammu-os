import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import DesktopApp from '../src/components/desktop/DesktopApp';
import { getPlatformCapabilities } from '../src/platform';
import '../src/app/localFonts';
import '../src/app/globals.css';

const rootElement = document.getElementById('nammu-root');

if (!rootElement) {
  throw new Error('Nammu desktop root element was not found.');
}
const desktopRootElement = rootElement;

async function startDesktop() {
  const services = getPlatformCapabilities().services;
  const serviceInfo = await services.ready();
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

  createRoot(desktopRootElement).render(
    <StrictMode>
      <main className="h-screen w-screen overflow-hidden select-none bg-[#05070b]">
        <DesktopApp />
      </main>
    </StrictMode>,
  );
}

void startDesktop().catch((error) => {
  desktopRootElement.textContent =
    error instanceof Error
      ? `Nammu OS could not start its local service: ${error.message}`
      : 'Nammu OS could not start its local service.';
});
