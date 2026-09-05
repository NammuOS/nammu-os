import { isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline';

export const DESKTOP_LOCAL_RUNTIME = 'desktop-local';
export const DESKTOP_CONTROL_PROTOCOL_VERSION = 1;
export const DESKTOP_READY_PREFIX = 'NAMMU_LOCAL_READY ';

const INSTANCE_ID_PATTERN = /^[a-f0-9]{32}$/;
const CAPABILITY_PATTERN = /^[a-f0-9]{64}$/;

function normalizeFrontendOrigin(value) {
  if (typeof value !== 'string' || value.length > 512) {
    throw new Error('Invalid desktop bootstrap field: frontendOrigin');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid desktop bootstrap field: frontendOrigin');
  }

  const isTauriOrigin =
    url.protocol === 'tauri:' &&
    url.hostname === 'localhost' &&
    !url.port &&
    value === 'tauri://localhost';
  const isHttpOrigin =
    (url.protocol === 'http:' || url.protocol === 'https:') && value === url.origin;

  if (
    (!isHttpOrigin && !isTauriOrigin) ||
    url.username ||
    url.password ||
    (isTauriOrigin ? url.pathname !== '' : url.pathname !== '/') ||
    url.search ||
    url.hash
  ) {
    throw new Error('The desktop frontend origin must be an exact trusted origin.');
  }
  return isTauriOrigin ? value : url.origin;
}

function requireString(value, fieldName, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Invalid desktop bootstrap field: ${fieldName}`);
  }
  return value;
}

export function parseDesktopBootstrapLine(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('The desktop bootstrap message is not valid JSON.');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The desktop bootstrap message must be an object.');
  }
  if (value.protocolVersion !== DESKTOP_CONTROL_PROTOCOL_VERSION) {
    throw new Error('The desktop bootstrap protocol version is not supported.');
  }

  const instanceId = requireString(value.instanceId, 'instanceId', INSTANCE_ID_PATTERN);
  const apiCapability = requireString(value.apiCapability, 'apiCapability', CAPABILITY_PATTERN);
  const vaultKey = requireString(value.vaultKey, 'vaultKey', CAPABILITY_PATTERN);
  if (vaultKey === apiCapability) {
    throw new Error('Desktop vault and API capabilities must be different.');
  }
  const frontendOrigin = normalizeFrontendOrigin(value.frontendOrigin);

  if (typeof value.dataDirectory !== 'string' || !isAbsolute(value.dataDirectory)) {
    throw new Error('The desktop data directory must be an absolute path.');
  }

  return Object.freeze({
    protocolVersion: DESKTOP_CONTROL_PROTOCOL_VERSION,
    instanceId,
    apiCapability,
    vaultKey: Buffer.from(vaultKey, 'hex'),
    frontendOrigin,
    dataDirectory: resolve(value.dataDirectory),
  });
}

export function createDesktopControlChannel(input = process.stdin) {
  const reader = createInterface({ input, crlfDelay: Infinity, terminal: false });
  let shutdownHandler = null;
  let shutdownRequested = false;
  let closed = false;

  const requestShutdown = () => {
    shutdownRequested = true;
    shutdownHandler?.();
  };

  const bootstrap = new Promise((resolveBootstrap, rejectBootstrap) => {
    const handleFirstLine = (line) => {
      try {
        resolveBootstrap(parseDesktopBootstrapLine(line));
      } catch (error) {
        rejectBootstrap(error);
        reader.close();
      }
    };

    reader.once('line', handleFirstLine);
    reader.once('close', () => {
      if (!closed) {
        rejectBootstrap(new Error('The desktop bootstrap channel closed before startup.'));
      }
    });
  });

  reader.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message?.type === 'shutdown') requestShutdown();
  });

  reader.on('close', () => {
    if (!closed) requestShutdown();
  });

  return {
    bootstrap,
    onShutdown(handler) {
      shutdownHandler = handler;
      if (shutdownRequested) shutdownHandler();
    },
    close() {
      closed = true;
      reader.close();
    },
  };
}

export function serializeDesktopReadyMessage({ instanceId, port }) {
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    throw new Error('Cannot serialize readiness for an invalid desktop instance.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Cannot serialize readiness for an invalid port.');
  }

  return `${DESKTOP_READY_PREFIX}${JSON.stringify({
    protocolVersion: DESKTOP_CONTROL_PROTOCOL_VERSION,
    type: 'ready',
    instanceId,
    origin: `http://127.0.0.1:${port}`,
  })}\n`;
}
