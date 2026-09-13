import type { PlatformCapabilities } from '../contracts';
import {
  PACKAGE_SERVICE_RESPONSE_LIMIT_BYTES,
  type PackageServiceResponse,
} from './integrationContracts';

type ServiceHandler = (payload: unknown) => Promise<PackageServiceResponse>;

function serializedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
}

/**
 * Core-owned, deny-by-default service catalog for packaged apps.
 * Entries expose named operations, never URLs, headers, credentials, or raw fetch.
 */
export function createPackageServiceRegistry(platform: PlatformCapabilities) {
  const services = new Map<string, Map<string, ServiceHandler>>([
    [
      'core.runtime',
      new Map([
        [
          'describe',
          async () => ({
            status: 200,
            data: { runtime: platform.runtime, webSurfaces: platform.webSurfaces.supported },
          }),
        ],
      ]),
    ],
  ]);

  return Object.freeze({
    async request(service: string, operation: string, payload: unknown) {
      if (serializedSize(payload) > 256 * 1024) {
        throw new Error('The packaged service request exceeds the 256 KiB limit.');
      }
      const handler = services.get(service)?.get(operation);
      if (!handler) throw new Error('The requested packaged service operation is unavailable.');
      const response = await handler(payload);
      if (serializedSize(response.data) > PACKAGE_SERVICE_RESPONSE_LIMIT_BYTES) {
        throw new Error('The packaged service response exceeds the 4 MiB limit.');
      }
      return response;
    },
  });
}

export type PackageServiceRegistry = ReturnType<typeof createPackageServiceRegistry>;
