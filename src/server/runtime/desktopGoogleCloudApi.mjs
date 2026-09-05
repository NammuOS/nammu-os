import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import Busboy from 'busboy';

import {
  createDesktopGoogleDriveService,
  DesktopGoogleDriveError,
  normalizeDesktopCloudPath,
  validateDesktopCloudFileName,
} from './desktopGoogleDrive.mjs';
import { createDesktopGoogleOAuthManager, DesktopGoogleOAuthError } from './desktopGoogleOAuth.mjs';

const MAX_JSON_BYTES = 512 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
const UPLOAD_TICKET_TTL_MS = 10 * 60 * 1000;
const ID_PATTERN = /^[0-9a-f-]{36}$/i;
const ATTEMPT_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;

class HttpInputError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(request) {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new HttpInputError(415, 'Content-Type must be application/json.');
  }
  const declaredSize = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_JSON_BYTES) {
    throw new HttpInputError(413, 'The request payload is too large.');
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > MAX_JSON_BYTES)
      throw new HttpInputError(413, 'The request payload is too large.');
    chunks.push(chunk);
  }
  if (!received) return {};
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

function requireId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new HttpInputError(400, `The ${label} is invalid.`);
  }
  return value;
}

function pathSegments(request) {
  const url = new URL(request.url, 'http://127.0.0.1');
  try {
    return { url, segments: url.pathname.split('/').filter(Boolean).map(decodeURIComponent) };
  } catch {
    throw new HttpInputError(400, 'The request path is invalid.');
  }
}

function normalizeMimeType(value) {
  const mimeType = String(value || 'application/octet-stream')
    .trim()
    .toLowerCase();
  if (
    mimeType.length > 255 ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\s*;\s*[a-z0-9_-]+=[a-z0-9._+-]+)*$/.test(mimeType)
  ) {
    throw new HttpInputError(400, 'The upload MIME type is invalid.');
  }
  return mimeType;
}

function contentDisposition(fileName, inline) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function pipeMedia(request, response, responseHeaders, drive, fileId, preview) {
  const media = await drive.media(fileId, {
    preview,
    range: typeof request.headers.range === 'string' ? request.headers.range : null,
  });
  const outgoing = {
    ...responseHeaders,
    'Accept-Ranges': media.export ? 'none' : media.response.headers.get('accept-ranges') || 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': contentDisposition(media.fileName, preview),
    'Content-Type': media.mimeType,
    'Access-Control-Expose-Headers':
      'Accept-Ranges, Content-Disposition, Content-Length, Content-Range, Content-Type',
    'X-Content-Type-Options': 'nosniff',
  };
  for (const header of ['content-length', 'content-range']) {
    const value = media.response.headers.get(header);
    if (value) outgoing[header] = value;
  }
  response.writeHead(media.response.status, outgoing);
  if (!media.response.body) {
    response.end();
    return;
  }
  await pipeline(Readable.fromWeb(media.response.body), response);
}

async function receiveUpload(request, ticket) {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data;')) {
    throw new HttpInputError(415, 'The upload must use multipart/form-data.');
  }
  const declaredSize = Number(request.headers['content-length'] || 0);
  if (
    Number.isFinite(declaredSize) &&
    (declaredSize <= 0 || declaredSize > ticket.size + 1024 * 1024)
  ) {
    throw new HttpInputError(413, 'The upload payload size is invalid.');
  }

  const directory = await mkdtemp(join(tmpdir(), 'nammu-google-upload-'));
  const filePath = join(directory, 'payload');
  let receivedBytes = 0;
  let fileWrite = null;
  try {
    const parser = Busboy({
      headers: request.headers,
      limits: { files: 1, fields: 0, fileSize: ticket.size + 1, parts: 1 },
    });
    await new Promise((resolve, reject) => {
      let foundFile = false;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      parser.on('file', (fieldName, stream, info) => {
        if (foundFile || fieldName !== 'file') {
          stream.resume();
          return;
        }
        foundFile = true;
        if (info.filename !== ticket.fileName) {
          stream.resume();
          fail(new HttpInputError(400, 'The selected file does not match the upload session.'));
          return;
        }
        stream.on('limit', () => fail(new HttpInputError(413, 'The uploaded file is too large.')));
        stream.on('data', (chunk) => {
          receivedBytes += chunk.length;
        });
        fileWrite = pipeline(stream, createWriteStream(filePath, { flags: 'wx' }));
        fileWrite.catch(fail);
      });
      parser.once('error', fail);
      parser.once('finish', () => {
        if (settled) return;
        if (!foundFile || !fileWrite) {
          fail(new HttpInputError(400, 'No file was provided.'));
          return;
        }
        settled = true;
        resolve();
      });
      request.once('aborted', () => fail(new HttpInputError(400, 'The upload was interrupted.')));
      request.pipe(parser);
    });
    await fileWrite;
    if (receivedBytes !== ticket.size) {
      throw new HttpInputError(400, 'The uploaded byte count does not match the selected file.');
    }
    return { directory, filePath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export function createDesktopGoogleCloudApi({ database, clientId, clientSecret, instanceId }) {
  const drive = createDesktopGoogleDriveService({ database, clientId, clientSecret });
  const oauth = createDesktopGoogleOAuthManager({
    clientId,
    clientSecret,
    instanceId,
    completeAuthorization: (authorization) => drive.completeAuthorization(authorization),
  });
  const uploadTickets = new Map();

  function pruneUploadTickets() {
    const current = Date.now();
    for (const [id, ticket] of uploadTickets) {
      if (ticket.expiresAt <= current || ticket.consumed) uploadTickets.delete(id);
    }
  }

  async function handle(request, response, route, responseHeaders) {
    try {
      const { url, segments } = pathSegments(request);

      if (route.id === 'google-accounts') {
        sendJson(response, 200, { data: drive.listAccounts() }, responseHeaders);
        return;
      }
      if (route.id === 'google-account-connect') {
        const body = await readJson(request);
        const result = await oauth.start({ label: body.label });
        sendJson(response, 201, { data: result }, responseHeaders);
        return;
      }
      if (route.id === 'google-account-status') {
        const attemptId = url.searchParams.get('attempt_id');
        if (!ATTEMPT_PATTERN.test(attemptId || '')) {
          throw new HttpInputError(400, 'The OAuth attempt ID is invalid.');
        }
        if (request.method === 'DELETE') {
          const cancelled = oauth.cancel(attemptId);
          sendJson(response, cancelled ? 200 : 409, { success: cancelled }, responseHeaders);
          return;
        }
        const status = oauth.status(attemptId);
        if (!status) throw new HttpInputError(404, 'The OAuth attempt was not found.');
        sendJson(response, 200, { data: status }, responseHeaders);
        return;
      }
      if (route.id === 'google-account-item') {
        const accountId = requireId(segments[2], 'account ID');
        await drive.disconnect(accountId);
        sendJson(response, 200, { success: true }, responseHeaders);
        return;
      }
      if (route.id === 'google-files') {
        const sharedParentId = url.searchParams.get('shared_parent');
        const files = sharedParentId
          ? await drive.listSharedFolder(requireId(sharedParentId, 'shared folder ID'))
          : drive.listFiles({
              path: url.searchParams.get('path') || '/',
              starred: url.searchParams.get('starred') === '1',
              trash: url.searchParams.get('trash') === '1',
              recent: url.searchParams.get('recent') === '1',
              shared: url.searchParams.get('shared') === '1',
              search: String(url.searchParams.get('search') || '')
                .trim()
                .slice(0, 200),
            });
        sendJson(response, 200, { data: files }, responseHeaders);
        return;
      }
      if (route.id === 'google-file-folder') {
        const body = await readJson(request);
        if (body.provider && body.provider !== 'google_drive') {
          throw new HttpInputError(400, 'Only Google Drive is available in desktop Cloud.');
        }
        const created = await drive.createFolder({
          virtualPath: body.virtual_path || body.path || '/',
          folderName: body.folder_name || body.name,
          accountId: body.account_id ? requireId(body.account_id, 'account ID') : null,
        });
        sendJson(response, 201, { data: created }, responseHeaders);
        return;
      }
      if (route.id === 'google-file-bulk-delete') {
        const body = await readJson(request);
        const ids = Array.isArray(body.ids)
          ? body.ids.map((id) => requireId(id, 'file ID')).slice(0, 500)
          : [];
        if (!ids.length) throw new HttpInputError(400, 'Select at least one cloud file.');
        await drive.bulkTrash(ids);
        sendJson(response, 200, { success: true, count: ids.length }, responseHeaders);
        return;
      }
      if (route.id === 'google-empty-trash') {
        await drive.emptyTrash();
        sendJson(response, 200, { success: true }, responseHeaders);
        return;
      }
      if (route.id === 'google-file-item') {
        const fileId = requireId(segments[2], 'file ID');
        await drive.trash(fileId, true);
        sendJson(response, 200, { success: true }, responseHeaders);
        return;
      }
      if (route.id === 'google-file-action') {
        const fileId = requireId(segments[2], 'file ID');
        const action = segments[3];
        const body = request.method === 'DELETE' ? {} : await readJson(request);
        if (action === 'rename') await drive.rename(fileId, body.name || body.fileName);
        else if (action === 'star') await drive.star(fileId, body.is_starred ?? true);
        else if (action === 'restore') await drive.trash(fileId, false);
        else if (action === 'permanent' || action === 'delete') {
          await drive.deletePermanently(fileId);
        } else throw new HttpInputError(400, 'The cloud file action is not supported.');
        sendJson(response, 200, { success: true }, responseHeaders);
        return;
      }
      if (route.id === 'google-file-download' || route.id === 'google-file-preview') {
        const fileId = requireId(segments[2], 'file ID');
        await pipeMedia(
          request,
          response,
          responseHeaders,
          drive,
          fileId,
          route.id === 'google-file-preview',
        );
        return;
      }
      if (route.id === 'google-sync') {
        const sync = await drive.syncAll();
        sendJson(
          response,
          sync.failures.length ? 502 : 200,
          {
            success: sync.failures.length === 0,
            syncedAccounts: sync.results.length,
            syncedFiles: sync.results.reduce((sum, result) => sum + result.fileCount, 0),
            ...sync,
          },
          responseHeaders,
        );
        return;
      }
      if (route.id === 'google-upload-initiate') {
        pruneUploadTickets();
        const body = await readJson(request);
        if (body.provider && body.provider !== 'google_drive') {
          throw new HttpInputError(400, 'Only Google Drive is available in desktop Cloud.');
        }
        const size = Number(body.size);
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_UPLOAD_BYTES) {
          throw new HttpInputError(400, 'The upload size is invalid or exceeds 5 GB.');
        }
        const account = drive.selectUploadAccount(
          body.account_id ? requireId(body.account_id, 'account ID') : null,
        );
        if (account.total_space > 0 && account.total_space - account.used_space < size) {
          throw new HttpInputError(
            507,
            'The selected Google Drive does not have enough free space.',
          );
        }
        const uploadId = randomBytes(24).toString('base64url');
        uploadTickets.set(uploadId, {
          accountId: account.id,
          fileName: validateDesktopCloudFileName(body.file_name),
          mimeType: normalizeMimeType(body.mime_type),
          size,
          virtualPath: normalizeDesktopCloudPath(body.virtual_path || '/'),
          expiresAt: Date.now() + UPLOAD_TICKET_TTL_MS,
          consumed: false,
        });
        sendJson(
          response,
          201,
          { uploadId, accountId: account.id, data: { uploadId, accountId: account.id } },
          responseHeaders,
        );
        return;
      }
      if (route.id === 'google-upload-stream') {
        pruneUploadTickets();
        const uploadId = segments[2];
        if (!UPLOAD_ID_PATTERN.test(uploadId || '')) {
          throw new HttpInputError(400, 'The upload session ID is invalid.');
        }
        const ticket = uploadTickets.get(uploadId);
        if (!ticket || ticket.consumed || ticket.expiresAt <= Date.now()) {
          throw new HttpInputError(404, 'The upload session expired or was already used.');
        }
        ticket.consumed = true;
        const received = await receiveUpload(request, ticket);
        try {
          const uploaded = await drive.upload({ ...ticket, filePath: received.filePath });
          sendJson(response, 200, { success: true, data: uploaded }, responseHeaders);
        } finally {
          uploadTickets.delete(uploadId);
          await rm(received.directory, { recursive: true, force: true });
        }
        return;
      }

      throw new HttpInputError(404, 'The desktop Google Drive route is not implemented.');
    } catch (error) {
      const status =
        error instanceof HttpInputError ||
        error instanceof DesktopGoogleOAuthError ||
        error instanceof DesktopGoogleDriveError
          ? error.status
          : 500;
      const message =
        error instanceof HttpInputError ||
        error instanceof DesktopGoogleOAuthError ||
        error instanceof DesktopGoogleDriveError
          ? error.message
          : 'The desktop Google Drive service could not complete the request.';
      if (!response.headersSent) sendJson(response, status, { error: message }, responseHeaders);
      else response.destroy();
    }
  }

  return Object.freeze({
    handle,
    close() {
      oauth.close();
      uploadTickets.clear();
    },
  });
}
