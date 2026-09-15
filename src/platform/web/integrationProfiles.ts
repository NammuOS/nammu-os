import type {
  CapabilityResult,
  IntegrationProfileAdoptionRequest,
  IntegrationProfileAdoptionResult,
  PlatformIntegrationProfiles,
} from '../contracts';

const STORAGE_KEY = 'nammu.integration-profile-adoptions.v1';

interface AdoptionEntry {
  appNamespace: string;
  migrationId: string;
  migrationVersion: number;
  destinationProfileKey: string;
  partitionKey: string;
  legacyIdentityName: string;
}

interface AdoptionState {
  entries: AdoptionEntry[];
  pendingIdentityPurges: string[];
  pendingNamespacePurges: string[];
}

const emptyState = (): AdoptionState => ({
  entries: [],
  pendingIdentityPurges: [],
  pendingNamespacePurges: [],
});
const safe = (value: string, max = 80) =>
  value.length > 0 && value.length <= max && /^[a-z0-9][a-z0-9-]*$/.test(value);

function legacyIdentityName(namespace: string, profileId: string): string {
  if (namespace === 'telegram') return `Nammu Telegram · ${profileId}`;
  throw new Error('The legacy integration namespace is not supported in Web.');
}

export interface WebIntegrationProfileController extends PlatformIntegrationProfiles {
  identityName(profileKey: string, partitionKey: string): string | undefined;
  pendingIdentityPurges(): readonly string[];
  pendingNamespacePurges(): readonly string[];
  completeIdentityPurges(names: readonly string[], namespaces: readonly string[]): void;
  registerPurger(
    purger: (names: readonly string[], namespaces: readonly string[]) => Promise<void>,
  ): void;
}

export function createWebIntegrationProfiles(getWindow: () => Window | undefined): WebIntegrationProfileController {
  let purger:
    | ((names: readonly string[], namespaces: readonly string[]) => Promise<void>)
    | undefined;
  const load = (): AdoptionState => {
    const storage = getWindow()?.localStorage;
    if (!storage) return emptyState();
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as Partial<AdoptionState> | null;
      return {
        entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
        pendingIdentityPurges: Array.isArray(parsed?.pendingIdentityPurges)
          ? parsed.pendingIdentityPurges.filter((item): item is string => typeof item === 'string')
          : [],
        pendingNamespacePurges: Array.isArray(parsed?.pendingNamespacePurges)
          ? parsed.pendingNamespacePurges.filter(
              (item): item is string => typeof item === 'string',
            )
          : [],
      };
    } catch {
      throw new Error('The Web integration-profile adoption state is corrupt.');
    }
  };
  const save = (state: AdoptionState) => {
    const storage = getWindow()?.localStorage;
    if (!storage) throw new Error('Persistent Web integration-profile storage is unavailable.');
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  };
  const result = <T>(value: T): CapabilityResult<T> => ({ status: 'success', value });
  const failure = (error: unknown): CapabilityResult<never> => ({
    status: 'error',
    code: 'operation-failed',
    message: error instanceof Error ? error.message : 'The integration-profile operation failed.',
  });

  return Object.freeze({
    supported: Boolean(getWindow()),
    async adopt(request: IntegrationProfileAdoptionRequest) {
      try {
        if (
          !/^pkg-[a-f0-9]{24}$/.test(request.appNamespace) ||
          !safe(request.migrationId) ||
          request.migrationVersion < 1 ||
          !safe(request.legacyProfileId) ||
          !safe(request.destinationProfileKey) ||
          !request.destinationProfileKey.startsWith(`${request.appNamespace}-`) ||
          !safe(request.partitionKey) ||
          request.legacyProfileId !== request.partitionKey
        ) {
          throw new Error('The Web integration-profile adoption request is invalid.');
        }
        const state = load();
        const destination = state.entries.find(
          (entry) =>
            entry.destinationProfileKey === request.destinationProfileKey &&
            entry.partitionKey === request.partitionKey,
        );
        const candidate: AdoptionEntry = {
          appNamespace: request.appNamespace,
          migrationId: request.migrationId,
          migrationVersion: request.migrationVersion,
          destinationProfileKey: request.destinationProfileKey,
          partitionKey: request.partitionKey,
          legacyIdentityName: legacyIdentityName(
            request.legacyNamespace,
            request.legacyProfileId,
          ),
        };
        if (destination) {
          if (JSON.stringify(destination) !== JSON.stringify(candidate)) {
            throw new Error('The destination Web profile has already been adopted differently.');
          }
          return result<IntegrationProfileAdoptionResult>({ status: 'already-adopted' });
        }
        state.entries.push(candidate);
        save(state);
        return result<IntegrationProfileAdoptionResult>({ status: 'adopted' });
      } catch (error) {
        return failure(error);
      }
    },
    async purge(appNamespace: string) {
      try {
        if (!/^pkg-[a-f0-9]{24}$/.test(appNamespace)) {
          throw new Error('The Web integration-profile package namespace is invalid.');
        }
        const state = load();
        const removed = state.entries.filter((entry) => entry.appNamespace === appNamespace);
        state.entries = state.entries.filter((entry) => entry.appNamespace !== appNamespace);
        state.pendingIdentityPurges = [
          ...new Set([
            ...state.pendingIdentityPurges,
            ...removed.map((entry) => entry.legacyIdentityName),
          ]),
        ];
        state.pendingNamespacePurges = [
          ...new Set([...state.pendingNamespacePurges, appNamespace]),
        ];
        save(state);
        if (purger) {
          const names = [...state.pendingIdentityPurges];
          const namespaces = [...state.pendingNamespacePurges];
          await purger(names, namespaces);
          const latest = load();
          latest.pendingIdentityPurges = latest.pendingIdentityPurges.filter(
            (name) => !names.includes(name),
          );
          latest.pendingNamespacePurges = latest.pendingNamespacePurges.filter(
            (namespace) => !namespaces.includes(namespace),
          );
          save(latest);
        }
        return result({ removed: removed.length });
      } catch (error) {
        return failure(error);
      }
    },
    identityName(profileKey: string, partitionKey: string) {
      return load().entries.find(
        (entry) =>
          entry.destinationProfileKey === profileKey && entry.partitionKey === partitionKey,
      )?.legacyIdentityName;
    },
    pendingIdentityPurges() {
      return load().pendingIdentityPurges;
    },
    pendingNamespacePurges() {
      return load().pendingNamespacePurges;
    },
    completeIdentityPurges(names: readonly string[], namespaces: readonly string[]) {
      const state = load();
      state.pendingIdentityPurges = state.pendingIdentityPurges.filter(
        (name) => !names.includes(name),
      );
      state.pendingNamespacePurges = state.pendingNamespacePurges.filter(
        (namespace) => !namespaces.includes(namespace),
      );
      save(state);
    },
    registerPurger(
      nextPurger: (names: readonly string[], namespaces: readonly string[]) => Promise<void>,
    ) {
      purger = nextPurger;
    },
  });
}
