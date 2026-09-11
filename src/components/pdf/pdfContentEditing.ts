import type {
  PdfContentObjectDraft,
  PdfContentObjectPatch,
  PdfEditableContentObject,
} from './contentEditModel';

const EDIT_ID = 'NammuEditId';
const EDIT_DATA = 'NammuEditData';
const MAX_TEXT_LENGTH = 16_384;
const MAX_METADATA_BYTES = 128 * 1024;
const MAX_EDITABLE_OBJECTS = 10_000;

function assertUnsigned(
  document: import('pdf-lib').PDFDocument,
  pdf: typeof import('pdf-lib'),
): void {
  const signed = document.context
    .enumerateIndirectObjects()
    .some(
      ([, object]) =>
        object instanceof pdf.PDFDict && object.get(pdf.PDFName.of('FT'))?.toString() === '/Sig',
    );
  if (signed)
    throw new Error(
      'Page content cannot be changed because this PDF contains a digital signature.',
    );
}

function id(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `content-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function colorChannels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error('Choose a valid six-digit text color.');
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function validateText(text: string): string {
  const value = text.trim();
  if (!value) throw new Error('Text content cannot be empty.');
  if (value.length > MAX_TEXT_LENGTH) throw new Error('Text content is too long.');
  // Standard PDF fonts use WinAnsi. Failing before encoding is safer than
  // silently replacing characters and corrupting the authored content.
  if ([...value].some((character) => character.codePointAt(0)! > 255)) {
    throw new Error(
      'This font supports Latin/WinAnsi text only. Unicode font embedding is not available yet.',
    );
  }
  return value;
}

function normalizeObject(value: unknown): PdfEditableContentObject | null {
  if (!value || typeof value !== 'object') return null;
  const object = value as Partial<PdfEditableContentObject>;
  if (
    typeof object.id !== 'string' ||
    (object.kind !== 'text' && object.kind !== 'image') ||
    !Number.isInteger(object.pageNumber) ||
    typeof object.createdAt !== 'string' ||
    typeof object.modifiedAt !== 'string'
  )
    return null;
  return {
    id: object.id.slice(0, 160),
    kind: object.kind,
    pageNumber: object.pageNumber!,
    x: number(object.x, 0, -100_000, 100_000),
    y: number(object.y, 0, -100_000, 100_000),
    width: number(object.width, 1, 1, 100_000),
    height: number(object.height, 1, 1, 100_000),
    rotation: number(object.rotation, 0, -3600, 3600),
    opacity: number(object.opacity, 1, 0.05, 1),
    text: typeof object.text === 'string' ? object.text.slice(0, MAX_TEXT_LENGTH) : undefined,
    fontSize: number(object.fontSize, 16, 4, 512),
    color:
      typeof object.color === 'string' && /^#[0-9a-f]{6}$/i.test(object.color)
        ? object.color
        : '#111827',
    resourceName: typeof object.resourceName === 'string' ? object.resourceName : undefined,
    imageFormat:
      object.imageFormat === 'png' || object.imageFormat === 'jpeg'
        ? object.imageFormat
        : undefined,
    createdAt: object.createdAt,
    modifiedAt: object.modifiedAt,
    sourceStreamId: typeof object.sourceStreamId === 'string' ? object.sourceStreamId : object.id,
  };
}

export async function inspectEditablePdfContent(
  bytes: Uint8Array,
): Promise<PdfEditableContentObject[]> {
  const { PDFArray, PDFDocument, PDFHexString, PDFName, PDFStream } = await import('pdf-lib');
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const objects: PdfEditableContentObject[] = [];
  for (const [pageIndex, page] of document.getPages().entries()) {
    const contents = page.node.Contents();
    const entries =
      contents instanceof PDFArray
        ? Array.from({ length: contents.size() }, (_, index) => contents.get(index))
        : contents
          ? [contents]
          : [];
    for (const entry of entries) {
      const stream =
        entry instanceof PDFStream ? entry : document.context.lookupMaybe(entry, PDFStream);
      const encoded = stream?.dict.lookupMaybe(PDFName.of(EDIT_DATA), PDFHexString);
      const taggedId = stream?.dict.lookupMaybe(PDFName.of(EDIT_ID), PDFHexString)?.decodeText();
      if (!encoded || !taggedId) continue;
      if (encoded.asBytes().byteLength > MAX_METADATA_BYTES || taggedId.length > 160) continue;
      try {
        const parsed = normalizeObject(JSON.parse(encoded.decodeText()));
        if (parsed && parsed.id === taggedId) {
          parsed.pageNumber = pageIndex + 1;
          parsed.sourceStreamId = taggedId;
          if (objects.some((object) => object.id === parsed.id)) {
            parsed.id = `${taggedId}::page-${pageIndex + 1}-${objects.length}`;
          }
          objects.push(parsed);
        }
        if (objects.length >= MAX_EDITABLE_OBJECTS) return objects;
      } catch {
        // Malformed untrusted custom metadata is ignored; the content stream remains preserved.
      }
    }
  }
  return objects;
}

async function removeTaggedStream(
  document: import('pdf-lib').PDFDocument,
  streamId: string,
  pageNumber: number,
): Promise<void> {
  const { PDFArray, PDFHexString, PDFName, PDFStream } = await import('pdf-lib');
  for (const [pageIndex, page] of document.getPages().entries()) {
    if (pageIndex + 1 !== pageNumber) continue;
    const contents = page.node.Contents();
    if (!(contents instanceof PDFArray)) continue;
    for (let index = contents.size() - 1; index >= 0; index -= 1) {
      const entry = contents.get(index);
      const stream = document.context.lookupMaybe(entry, PDFStream);
      const taggedId = stream?.dict.lookupMaybe(PDFName.of(EDIT_ID), PDFHexString)?.decodeText();
      if (taggedId === streamId) contents.remove(index);
    }
  }
}

async function appendObjectStream(
  document: import('pdf-lib').PDFDocument,
  object: PdfEditableContentObject,
  imageBytes?: Uint8Array,
): Promise<void> {
  const { PDFHexString, PDFName, StandardFonts, degrees, drawImage, drawText, rgb } =
    await import('pdf-lib');
  const page = document.getPage(object.pageNumber - 1);
  if (!page) throw new Error('The target page no longer exists.');
  const graphicsState = page.node.newExtGState(
    'NammuEditOpacity',
    document.context.obj({ Type: 'ExtGState', ca: object.opacity, CA: object.opacity }),
  );
  let operators;
  if (object.kind === 'text') {
    const text = validateText(object.text ?? '');
    const font = await document.embedFont(StandardFonts.Helvetica);
    const fontName = page.node.newFontDictionary('NammuText', font.ref);
    const [r, g, b] = colorChannels(object.color ?? '#111827');
    operators = drawText(font.encodeText(text), {
      font: fontName,
      size: object.fontSize ?? 16,
      color: rgb(r, g, b),
      rotate: degrees(object.rotation),
      xSkew: degrees(0),
      ySkew: degrees(0),
      graphicsState,
      x: object.x,
      y: object.y,
    });
    object.width = Math.max(1, font.widthOfTextAtSize(text, object.fontSize ?? 16));
    object.height = Math.max(1, font.heightAtSize(object.fontSize ?? 16));
  } else {
    let resourceName = object.resourceName;
    if (imageBytes) {
      const image =
        object.imageFormat === 'png'
          ? await document.embedPng(imageBytes)
          : await document.embedJpg(imageBytes);
      resourceName = page.node.newXObject('NammuImage', image.ref).toString().slice(1);
      object.resourceName = resourceName;
    }
    if (!resourceName) throw new Error('The editable image resource is missing.');
    operators = drawImage(PDFName.of(resourceName), {
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      rotate: degrees(object.rotation),
      xSkew: degrees(0),
      ySkew: degrees(0),
      graphicsState,
    });
  }
  const stream = document.context.contentStream(operators);
  stream.dict.set(PDFName.of(EDIT_ID), PDFHexString.fromText(object.id));
  stream.dict.set(PDFName.of(EDIT_DATA), PDFHexString.fromText(JSON.stringify(object)));
  page.node.addContentStream(document.context.register(stream));
}

export async function createPdfContentObject(
  bytes: Uint8Array,
  draft: PdfContentObjectDraft,
): Promise<{ bytes: Uint8Array; objectId: string }> {
  const pdf = await import('pdf-lib');
  const { PDFDocument } = pdf;
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  assertUnsigned(document, pdf);
  if (
    !Number.isInteger(draft.pageNumber) ||
    draft.pageNumber < 1 ||
    draft.pageNumber > document.getPageCount()
  ) {
    throw new Error('The target page no longer exists.');
  }
  const page = document.getPage(draft.pageNumber - 1);
  const pageSize = page.getSize();
  const now = new Date().toISOString();
  const object: PdfEditableContentObject = {
    id: id(),
    kind: draft.kind,
    pageNumber: draft.pageNumber,
    x: number(draft.x, 24, -pageSize.width, pageSize.width * 2),
    y: number(draft.y, 24, -pageSize.height, pageSize.height * 2),
    width: number(draft.width, draft.kind === 'image' ? 180 : 1, 1, pageSize.width * 4),
    height: number(draft.height, draft.kind === 'image' ? 120 : 1, 1, pageSize.height * 4),
    rotation: number(draft.rotation, 0, -3600, 3600),
    opacity: number(draft.opacity, 1, 0.05, 1),
    text: draft.kind === 'text' ? validateText(draft.text ?? '') : undefined,
    fontSize: draft.kind === 'text' ? number(draft.fontSize, 18, 4, 512) : undefined,
    color: draft.kind === 'text' ? (draft.color ?? '#111827') : undefined,
    imageFormat: draft.kind === 'image' ? draft.imageFormat : undefined,
    createdAt: now,
    modifiedAt: now,
  };
  if (object.kind === 'image' && (!draft.imageBytes || !draft.imageFormat)) {
    throw new Error('Choose a PNG or JPEG image to place.');
  }
  await appendObjectStream(document, object, draft.imageBytes);
  return { bytes: new Uint8Array(await document.save()), objectId: object.id };
}

export async function updatePdfContentObject(
  bytes: Uint8Array,
  objectId: string,
  patch: PdfContentObjectPatch,
): Promise<Uint8Array> {
  const pdf = await import('pdf-lib');
  const { PDFDocument } = pdf;
  const current = (await inspectEditablePdfContent(bytes)).find((object) => object.id === objectId);
  if (!current) throw new Error('The selected content object no longer exists.');
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  assertUnsigned(document, pdf);
  const updated: PdfEditableContentObject = {
    ...current,
    ...patch,
    id: current.id,
    kind: current.kind,
    pageNumber: current.pageNumber,
    resourceName: patch.imageBytes ? undefined : current.resourceName,
    imageFormat: patch.imageBytes ? patch.imageFormat : current.imageFormat,
    text: current.kind === 'text' ? validateText(patch.text ?? current.text ?? '') : undefined,
    modifiedAt: new Date().toISOString(),
  };
  updated.x = number(updated.x, current.x, -100_000, 100_000);
  updated.y = number(updated.y, current.y, -100_000, 100_000);
  updated.width = number(updated.width, current.width, 1, 100_000);
  updated.height = number(updated.height, current.height, 1, 100_000);
  updated.rotation = number(updated.rotation, current.rotation, -3600, 3600);
  updated.opacity = number(updated.opacity, current.opacity, 0.05, 1);
  await removeTaggedStream(document, current.sourceStreamId ?? current.id, current.pageNumber);
  updated.sourceStreamId = updated.id;
  await appendObjectStream(document, updated, patch.imageBytes);
  return new Uint8Array(await document.save());
}

export async function deletePdfContentObject(
  bytes: Uint8Array,
  objectId: string,
): Promise<Uint8Array> {
  const pdf = await import('pdf-lib');
  const { PDFDocument } = pdf;
  const current = (await inspectEditablePdfContent(bytes)).find((object) => object.id === objectId);
  if (!current) throw new Error('The selected content object no longer exists.');
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  assertUnsigned(document, pdf);
  await removeTaggedStream(document, current.sourceStreamId ?? current.id, current.pageNumber);
  return new Uint8Array(await document.save());
}
