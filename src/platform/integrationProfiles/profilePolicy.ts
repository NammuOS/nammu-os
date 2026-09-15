import type {
  InstalledAppRecord,
  IntegrationProfileMigrationDeclaration,
  WebSurfaceCapability,
} from '../nmu/nappSpec';
import { OFFICIAL_NAMMU_KEY_ID } from '../nmu/packageSecurity';
import type { IntegrationProfileAdoptionRequest } from '../contracts';
import { integrationProfileNamespace, isolatedIntegrationProfileKey } from './profileNamespace';

interface ApprovedIntegrationMigration {
  appId: string;
  publisher: string;
  publisherKeyId: string;
  migrationId: string;
  version: number;
  legacyNamespace: string;
  capability: string;
  profileKey: string;
  maxPartitions: number;
}

const APPROVED_MIGRATIONS: readonly ApprovedIntegrationMigration[] = Object.freeze([
  {
    appId: 'os.nammu.telegram',
    publisher: 'nammu-official',
    publisherKeyId: OFFICIAL_NAMMU_KEY_ID,
    migrationId: 'telegram-core-v1',
    version: 1,
    legacyNamespace: 'telegram',
    capability: 'telegram-web',
    profileKey: 'telegram',
    maxPartitions: 8,
  },
]);

const SAFE_LOGICAL_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

function migrationFor(
  record: InstalledAppRecord,
  migrationId: string,
): { policy: ApprovedIntegrationMigration; declaration: IntegrationProfileMigrationDeclaration } {
  const policy = APPROVED_MIGRATIONS.find(
    (candidate) => candidate.appId === record.appId && candidate.migrationId === migrationId,
  );
  const declaration = record.integrationProfileMigrations?.find(
    (candidate) => candidate.id === migrationId,
  );
  if (!policy || !declaration) {
    throw new Error('This integration-profile migration is not approved by NammuOS Core.');
  }
  return { policy, declaration };
}

/**
 * Resolves package-provided logical IDs through Core-owned policy. No package
 * path or legacy namespace crosses this boundary.
 */
export async function authorizeIntegrationProfileAdoption(
  record: InstalledAppRecord,
  input: { migrationId: string; legacyProfileId: string; partitionKey: string },
): Promise<IntegrationProfileAdoptionRequest> {
  if (
    !record.signatureVerified ||
    !record.isOfficial ||
    record.publisher !== 'nammu-official' ||
    record.publisherKeyId !== OFFICIAL_NAMMU_KEY_ID ||
    !record.grantedPermissions.includes('migration.integration-profile')
  ) {
    throw new Error('Authenticated integration-profile adoption requires an official package.');
  }
  if (
    !SAFE_LOGICAL_ID.test(input.migrationId) ||
    !SAFE_LOGICAL_ID.test(input.legacyProfileId) ||
    !SAFE_LOGICAL_ID.test(input.partitionKey) ||
    input.legacyProfileId !== input.partitionKey
  ) {
    throw new Error('The integration-profile migration identifiers are invalid.');
  }

  const { policy, declaration } = migrationFor(record, input.migrationId);
  if (
    declaration.version !== policy.version ||
    declaration.capability !== policy.capability ||
    declaration.profileKey !== policy.profileKey
  ) {
    throw new Error('The package migration declaration does not match Core policy.');
  }
  const capability = record.capabilities?.find(
    (candidate): candidate is WebSurfaceCapability =>
      candidate.type === 'web-surface' && candidate.name === policy.capability,
  );
  if (
    !capability ||
    capability.persistentProfile !== true ||
    capability.maxPartitions === undefined ||
    capability.maxPartitions > policy.maxPartitions
  ) {
    throw new Error('The destination integration-profile capability is not approved.');
  }

  return {
    appNamespace: await integrationProfileNamespace(record.appId),
    migrationId: policy.migrationId,
    migrationVersion: policy.version,
    legacyNamespace: policy.legacyNamespace,
    legacyProfileId: input.legacyProfileId,
    destinationProfileKey: await isolatedIntegrationProfileKey(record.appId, policy.profileKey),
    partitionKey: input.partitionKey,
  };
}

export async function integrationProfilePurgeNamespace(
  record: Pick<InstalledAppRecord, 'appId'>,
): Promise<string> {
  return integrationProfileNamespace(record.appId);
}

export const approvedIntegrationProfileMigrationIds = Object.freeze(
  APPROVED_MIGRATIONS.map((migration) => migration.migrationId),
);
