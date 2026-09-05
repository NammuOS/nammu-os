import {
  isSettingsPayloadError,
  normalizeHistoryEntry,
  normalizePreferences,
  normalizeSettingMutation,
} from '../services/settingsPayloads.mjs';
import { DESKTOP_SETTINGS_USER_ID } from './desktopDatabase.mjs';

const MAX_REQUEST_BYTES = 512 * 1024;

class HttpInputError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(request) {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpInputError(415, 'Content-Type must be application/json.');
  }
  const declaredSize = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REQUEST_BYTES) {
    throw new HttpInputError(413, 'The request payload is too large.');
  }

  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > MAX_REQUEST_BYTES) {
      throw new HttpInputError(413, 'The request payload is too large.');
    }
    chunks.push(chunk);
  }
  if (received === 0) throw new HttpInputError(400, 'A JSON request body is required.');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpInputError(400, 'The request body is not valid JSON.');
  }
}

function sendJson(response, status, body, headers) {
  response.writeHead(status, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function parseStoredJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function createDesktopLocalApi(database, options = {}) {
  const repository = database.settings;
  const googleCloud = options.googleCloud || null;

  return Object.freeze({
    async handle(request, response, route, responseHeaders) {
      try {
        if (route.id.startsWith('google-')) {
          if (!googleCloud) {
            sendJson(
              response,
              503,
              { error: 'Desktop Google Drive is not available.' },
              responseHeaders,
            );
            return;
          }
          await googleCloud.handle(request, response, route, responseHeaders);
          return;
        }

        if (route.id === 'preferences') {
          if (request.method === 'GET') {
            const value = await repository.get(DESKTOP_SETTINGS_USER_ID, 'user_preferences');
            sendJson(
              response,
              200,
              parseStoredJson(value, { pinned_tools: [], settings: {} }),
              responseHeaders,
            );
            return;
          }
          const preferences = normalizePreferences(await readJson(request));
          await repository.upsert(
            DESKTOP_SETTINGS_USER_ID,
            'user_preferences',
            JSON.stringify(preferences),
          );
          sendJson(response, 200, preferences, responseHeaders);
          return;
        }

        if (route.id === 'history') {
          if (request.method === 'GET') {
            const value = await repository.get(DESKTOP_SETTINGS_USER_ID, 'tool_history');
            const history = parseStoredJson(value, []);
            sendJson(response, 200, Array.isArray(history) ? history : [], responseHeaders);
            return;
          }
          const entry = normalizeHistoryEntry(await readJson(request));
          const created = await repository.prependHistory(
            DESKTOP_SETTINGS_USER_ID,
            'tool_history',
            entry,
            50,
          );
          sendJson(response, 201, created, responseHeaders);
          return;
        }

        if (route.id === 'settings') {
          if (request.method === 'GET') {
            const rows = await repository.list(DESKTOP_SETTINGS_USER_ID);
            sendJson(
              response,
              200,
              { data: Object.fromEntries(rows.map((row) => [row.key, row.value])) },
              responseHeaders,
            );
            return;
          }
          const setting = normalizeSettingMutation(await readJson(request));
          await repository.upsert(DESKTOP_SETTINGS_USER_ID, setting.key, setting.value);
          sendJson(response, 200, { success: true, ...setting }, responseHeaders);
          return;
        }

        if (route.id === 'allocation') {
          if (request.method === 'GET') {
            const value = await repository.get(DESKTOP_SETTINGS_USER_ID, 'allocation_config');
            sendJson(
              response,
              200,
              {
                data: parseStoredJson(value, {
                  strategy: 'round_robin',
                  manual_order: [],
                }),
              },
              responseHeaders,
            );
            return;
          }
          const body = await readJson(request);
          const strategies = new Set([
            'round_robin',
            'weighted_round_robin',
            'least_used',
            'most_free',
            'manual',
          ]);
          if (!strategies.has(body?.strategy)) {
            throw new HttpInputError(400, 'The allocation strategy is invalid.');
          }
          const allocation = {
            strategy: body.strategy,
            manual_order: Array.isArray(body.manual_order)
              ? body.manual_order
                  .filter((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
                  .slice(0, 100)
              : [],
          };
          await repository.upsert(
            DESKTOP_SETTINGS_USER_ID,
            'allocation_config',
            JSON.stringify(allocation),
          );
          sendJson(response, 200, { data: allocation }, responseHeaders);
          return;
        }

        sendJson(response, 404, { error: 'Desktop route is not implemented.' }, responseHeaders);
      } catch (error) {
        const status =
          error instanceof HttpInputError
            ? error.status
            : isSettingsPayloadError(error)
              ? 400
              : 500;
        const message =
          error instanceof HttpInputError || isSettingsPayloadError(error)
            ? error.message
            : 'The desktop local service could not complete the request.';
        if (!response.headersSent) sendJson(response, status, { error: message }, responseHeaders);
        else response.destroy();
      }
    },
  });
}
