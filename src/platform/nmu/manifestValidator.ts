/**
 * Manifest Schema and Semantic Validator for nammu.app.json
 *
 * Implements strict SemVer 2.0.0 parsing, permission whitelist enforcement,
 * capability structure validation, duplicate detection, and publisher key rules.
 */

import {
  CURRENT_NAMMU_VERSION,
  KNOWN_PERMISSIONS,
  type CapabilityDeclaration,
  type NammuAppManifest,
  type PermissionIdentifier,
  type RuntimeClass,
} from './nappSpec';

const VALID_RUNTIMES: Set<RuntimeClass> = new Set([
  'web',
  'wasm',
  'system-extension',
  'runtime',
  'integration',
]);

const APP_ID_REGEX = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;
const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
  build: string[];
}

export function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER_REGEX.exec(version);
  if (!match) return null;

  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const patch = parseInt(match[3], 10);

  const prerelease: Array<string | number> = [];
  if (match[4]) {
    const parts = match[4].split('.');
    for (const part of parts) {
      if (/^\d+$/.test(part)) {
        prerelease.push(parseInt(part, 10));
      } else {
        prerelease.push(part);
      }
    }
  }

  const build = match[5] ? match[5].split('.') : [];

  return { major, minor, patch, prerelease, build };
}

/**
 * Fully compliant SemVer 2.0.0 precedence comparator
 * Returns:
 *  -1 if v1 < v2
 *   0 if v1 == v2
 *   1 if v1 > v2
 */
export function compareSemver(v1: string, v2: string): number {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);

  if (!p1 || !p2) {
    throw new Error(`[SemVer] Invalid version string: "${!p1 ? v1 : v2}"`);
  }

  if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
  if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
  if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;

  // 1. Normal version has higher precedence than prerelease
  if (p1.prerelease.length === 0 && p2.prerelease.length > 0) return 1;
  if (p1.prerelease.length > 0 && p2.prerelease.length === 0) return -1;
  if (p1.prerelease.length === 0 && p2.prerelease.length === 0) return 0;

  // 2. Compare dot-separated prerelease identifiers left-to-right
  const minLen = Math.min(p1.prerelease.length, p2.prerelease.length);
  for (let i = 0; i < minLen; i++) {
    const a = p1.prerelease[i];
    const b = p2.prerelease[i];

    if (a === b) continue;

    const aIsNum = typeof a === 'number';
    const bIsNum = typeof b === 'number';

    // Numeric identifiers have lower precedence than non-numeric identifiers
    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;

    // Both numbers: compare numerically
    if (aIsNum && bIsNum) return (a as number) > (b as number) ? 1 : -1;

    // Both strings: compare lexically in ASCII sort order
    return (a as string) > (b as string) ? 1 : -1;
  }

  // 3. Larger set of prerelease fields has higher precedence
  if (p1.prerelease.length !== p2.prerelease.length) {
    return p1.prerelease.length > p2.prerelease.length ? 1 : -1;
  }

  return 0;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  manifest?: NammuAppManifest;
}

export function validateNammuAppManifest(
  raw: unknown,
  options: { allowOfficialNamespace?: boolean } = {},
): ManifestValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Manifest must be a non-null object'] };
  }

  const obj = raw as Record<string, unknown>;

  // 1. Manifest Specification Version
  if (obj.manifestVersion !== 1) {
    errors.push(`Unsupported or missing manifestVersion: expected 1, got ${String(obj.manifestVersion)}`);
  }

  // 2. Application Identifier
  if (typeof obj.id !== 'string' || !APP_ID_REGEX.test(obj.id)) {
    errors.push('Invalid application "id": must be a lowercase reverse-domain string (e.g. "dev.nammu.hello")');
  } else if (obj.id.startsWith('os.nammu.') && !options.allowOfficialNamespace) {
    errors.push('Reserved namespace violation: "os.nammu.*" is reserved for official signed packages');
  }

  // 3. Name
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    errors.push('Missing or empty application "name"');
  }

  // 4. Version
  if (typeof obj.version !== 'string' || !SEMVER_REGEX.test(obj.version)) {
    errors.push('Invalid application "version": must follow Semantic Versioning 2.0.0 (e.g. "1.0.0")');
  }

  // 5. Runtime Class
  if (typeof obj.runtime !== 'string' || !VALID_RUNTIMES.has(obj.runtime as RuntimeClass)) {
    errors.push(`Invalid application "runtime": must be one of ${Array.from(VALID_RUNTIMES).join(', ')}`);
  }

  // 6. Entry Path
  if (typeof obj.entry !== 'string' || obj.entry.trim().length === 0) {
    errors.push('Missing or empty application "entry" path');
  } else if (
    obj.entry.startsWith('/') ||
    obj.entry.startsWith('\\') ||
    obj.entry.includes('..') ||
    Array.from(obj.entry).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    errors.push('Invalid application "entry": must be a safe relative path within package without directory traversal');
  }

  // 7. Minimum NammuOS Core Version
  if (typeof obj.minNammuVersion !== 'string' || !SEMVER_REGEX.test(obj.minNammuVersion)) {
    errors.push('Invalid "minNammuVersion": must follow Semantic Versioning');
  } else if (compareSemver(CURRENT_NAMMU_VERSION, obj.minNammuVersion) < 0) {
    errors.push(
      `Incompatible platform: application requires NammuOS >= ${obj.minNammuVersion}, current is ${CURRENT_NAMMU_VERSION}`,
    );
  }

  // 8. Data Schema Version
  if (
    typeof obj.dataSchemaVersion !== 'number' ||
    !Number.isInteger(obj.dataSchemaVersion) ||
    obj.dataSchemaVersion < 1
  ) {
    errors.push('Invalid "dataSchemaVersion": must be an integer >= 1');
  }

  // 9. Permissions & Whitelist Validation
  if (!Array.isArray(obj.permissions)) {
    errors.push('Field "permissions" must be an array of permission identifier strings');
  } else {
    const seenPerms = new Set<string>();
    for (const perm of obj.permissions) {
      if (typeof perm !== 'string' || perm.trim().length === 0) {
        errors.push(`Invalid permission identifier: ${String(perm)}`);
      } else if (!KNOWN_PERMISSIONS.has(perm as PermissionIdentifier)) {
        errors.push(`Unknown permission identifier "${perm}". Must be one of: ${Array.from(KNOWN_PERMISSIONS).join(', ')}`);
      } else if (seenPerms.has(perm)) {
        errors.push(`Duplicate permission requested: "${perm}"`);
      }
      seenPerms.add(String(perm));
    }
  }

  // 10. Capabilities Validation
  if (obj.capabilities !== undefined) {
    if (!Array.isArray(obj.capabilities)) {
      errors.push('Field "capabilities" must be an array if provided');
    } else {
      const seenProtocols = new Set<string>();
      const seenServices = new Set<string>();

      for (const cap of obj.capabilities) {
        if (!cap || typeof cap !== 'object') {
          errors.push('Capability declaration must be an object');
          continue;
        }

        const c = cap as CapabilityDeclaration;
        if (c.type === 'protocol') {
          if (!c.scheme || !/^[a-z][a-z0-9+.-]*$/.test(c.scheme)) {
            errors.push(`Invalid protocol capability scheme: "${c.scheme}"`);
          } else if (seenProtocols.has(c.scheme)) {
            errors.push(`Duplicate protocol capability scheme declared: "${c.scheme}"`);
          }
          seenProtocols.add(c.scheme);
        } else if (c.type === 'file-handler') {
          if (!Array.isArray(c.extensions) || c.extensions.length === 0) {
            errors.push('File handler capability must define a non-empty array of file extensions');
          } else {
            for (const ext of c.extensions) {
              if (typeof ext !== 'string' || !ext.startsWith('.') || ext.length < 2) {
                errors.push(`Invalid file extension "${ext}" in file-handler capability (must start with ".")`);
              }
            }
          }
        } else if (c.type === 'service') {
          if (!c.name || typeof c.name !== 'string' || c.name.trim().length === 0) {
            errors.push('Service capability must have a non-empty name');
          } else if (seenServices.has(c.name)) {
            errors.push(`Duplicate service capability declared: "${c.name}"`);
          }
          seenServices.add(c.name);
        } else {
          errors.push(`Unknown capability type: "${(c as any).type}"`);
        }
      }
    }
  }

  // 11. providesCapabilities & optionalCapabilities
  const validateCapStrings = (field: string, values: unknown) => {
    if (values !== undefined) {
      if (!Array.isArray(values)) {
        errors.push(`Field "${field}" must be an array of strings`);
      } else {
        const seen = new Set<string>();
        for (const item of values) {
          if (typeof item !== 'string' || item.trim().length === 0) {
            errors.push(`Invalid capability name in "${field}": must be a non-empty string`);
          } else if (seen.has(item)) {
            errors.push(`Duplicate capability name in "${field}": "${item}"`);
          }
          seen.add(item);
        }
      }
    }
  };

  validateCapStrings('providesCapabilities', obj.providesCapabilities);
  validateCapStrings('optionalCapabilities', obj.optionalCapabilities);

  // 12. Publisher & Key Consistency
  if (typeof obj.id === 'string' && obj.id.startsWith('os.nammu.')) {
    if (!obj.publisherKeyId || typeof obj.publisherKeyId !== 'string') {
      errors.push('Official namespace "os.nammu.*" requires "publisherKeyId" declaration');
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    manifest: obj as unknown as NammuAppManifest,
  };
}
