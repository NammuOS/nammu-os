export class SettingsPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SettingsPayloadError';
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function boundedString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new SettingsPayloadError(`${field} is invalid.`);
  }
  return value.trim();
}

function assertSerializedSize(value, maxBytes = 512 * 1024) {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new SettingsPayloadError('The settings payload is too large.');
  }
  return serialized;
}

export function normalizePreferences(value) {
  if (!isRecord(value)) throw new SettingsPayloadError('Preferences must be an object.');
  const pinnedTools = value.pinned_tools ?? [];
  const settings = value.settings ?? {};
  if (
    !Array.isArray(pinnedTools) ||
    pinnedTools.length > 128 ||
    pinnedTools.some((item) => typeof item !== 'string' || !item.trim() || item.length > 128) ||
    !isRecord(settings)
  ) {
    throw new SettingsPayloadError('Preferences contain invalid values.');
  }

  const normalized = {
    pinned_tools: [...new Set(pinnedTools.map((item) => item.trim()))],
    settings,
  };
  assertSerializedSize(normalized);
  return normalized;
}

export function normalizeHistoryEntry(value) {
  if (!isRecord(value)) throw new SettingsPayloadError('History input must be an object.');
  const normalized = {
    tool_id: boundedString(value.tool_id, 'tool_id', 128),
    tool_name: boundedString(value.tool_name, 'tool_name', 256),
    category: boundedString(value.category, 'category', 128),
  };
  assertSerializedSize(normalized, 8 * 1024);
  return normalized;
}

export function normalizeSettingMutation(value) {
  if (!isRecord(value)) throw new SettingsPayloadError('Setting input must be an object.');
  const key = boundedString(value.key, 'key', 128);
  if (!/^[a-zA-Z0-9_.:-]+$/.test(key)) {
    throw new SettingsPayloadError('The setting key contains unsupported characters.');
  }
  const serializedValue =
    typeof value.value === 'string' ? value.value : JSON.stringify(value.value ?? null);
  if (Buffer.byteLength(serializedValue, 'utf8') > 256 * 1024) {
    throw new SettingsPayloadError('The setting value is too large.');
  }
  return { key, value: serializedValue };
}

export function isSettingsPayloadError(error) {
  return error instanceof SettingsPayloadError;
}
