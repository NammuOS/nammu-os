import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  PdfAnnotation,
  PdfAnnotationAppearance,
  PdfAnnotationDraft,
  PdfAnnotationPatch,
  PdfAnnotationType,
  PdfPoint,
  PdfRect,
} from './annotationModel';

const MAX_ANNOTATIONS = 10_000;
const MAX_TEXT_LENGTH = 16_384;
const MIN_SHAPE_SIZE = 2;

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function safeText(value: unknown): string {
  return typeof value === 'string'
    ? [...value]
        .filter((character) => {
          const code = character.charCodeAt(0);
          return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
        })
        .join('')
        .slice(0, MAX_TEXT_LENGTH)
    : '';
}

function safeNumbers(value: unknown, maximum = 32_768): number[] {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return [];
  return Array.from(value as ArrayLike<unknown>)
    .slice(0, maximum)
    .map((entry) => finite(entry))
    .filter(Number.isFinite);
}

function safeRect(value: unknown): PdfRect {
  const numbers = safeNumbers(value, 4);
  if (numbers.length !== 4) return [0, 0, 1, 1];
  return [
    Math.min(numbers[0], numbers[2]),
    Math.min(numbers[1], numbers[3]),
    Math.max(numbers[0], numbers[2]),
    Math.max(numbers[1], numbers[3]),
  ];
}

function rgbToHex(value: unknown, fallback: string): string {
  const numbers = safeNumbers(value, 3);
  if (numbers.length < 3) return fallback;
  return `#${numbers
    .slice(0, 3)
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function normalizeHex(value: string, fallback: string): string {
  return /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function hexToRgb(value: string): readonly [number, number, number] {
  const normalized = normalizeHex(value, '#000000');
  return [1, 3, 5].map(
    (offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
  ) as [number, number, number];
}

function annotationType(data: Record<string, unknown>): PdfAnnotationType {
  const subtype = typeof data.subtype === 'string' ? data.subtype.toLowerCase() : '';
  if (subtype === 'highlight') return 'highlight';
  if (subtype === 'underline') return 'underline';
  if (subtype === 'strikeout') return 'strikeout';
  if (subtype === 'text') return 'note';
  if (subtype === 'freetext') return 'freeText';
  if (subtype === 'ink') return 'ink';
  if (subtype === 'square') return 'rectangle';
  if (subtype === 'circle') return 'ellipse';
  if (subtype === 'polygon') return 'polygon';
  if (subtype === 'polyline') return 'polyline';
  if (subtype === 'stamp') return data.isSignature ? 'signature' : 'stamp';
  if (subtype === 'line') {
    const endings = Array.isArray(data.lineEndings) ? data.lineEndings : [];
    return endings.some((ending) => typeof ending === 'string' && /arrow/i.test(ending))
      ? 'arrow'
      : 'line';
  }
  return 'unknown';
}

function inkPaths(value: unknown): readonly (readonly PdfPoint[])[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 256).map((path) => {
    const numbers = safeNumbers(path, 65_536);
    const points: PdfPoint[] = [];
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      points.push([numbers[index], numbers[index + 1]]);
    }
    return points;
  });
}

export function normalizePdfJsAnnotation(
  data: Record<string, unknown>,
  pageNumber: number,
): PdfAnnotation {
  const type = annotationType(data);
  const nativeRef = typeof data.id === 'string' && /^\d+R\d*$/.test(data.id) ? data.id : null;
  const borderStyle =
    data.borderStyle && typeof data.borderStyle === 'object'
      ? (data.borderStyle as Record<string, unknown>)
      : {};
  const contents =
    data.contentsObj && typeof data.contentsObj === 'object'
      ? (data.contentsObj as Record<string, unknown>).str
      : '';
  const title =
    data.titleObj && typeof data.titleObj === 'object'
      ? (data.titleObj as Record<string, unknown>).str
      : '';
  const color = rgbToHex(data.color, type === 'highlight' ? '#ffcf3d' : '#2f8fff');
  const fillColor = safeNumbers(data.interiorColor, 3).length
    ? rgbToHex(data.interiorColor, '#000000')
    : null;
  const opacity = clamp(
    finite(data.opacity ?? data.fillAlpha, type === 'highlight' ? 0.55 : 1),
    0.05,
    1,
  );
  const supported = type !== 'unknown' && type !== 'stamp' && type !== 'signature';
  return {
    id: `${pageNumber}:${(nativeRef ?? safeText(data.id)) || `annotation-${pageNumber}`}`,
    nativeRef,
    pageNumber,
    type,
    rect: safeRect(data.rect),
    quadPoints: safeNumbers(data.quadPoints),
    line: safeNumbers(data.lineCoordinates, 4),
    vertices: safeNumbers(data.vertices),
    inkPaths: inkPaths(data.inkLists),
    content: safeText(contents),
    author: safeText(title),
    createdAt: safeText(data.creationDate) || null,
    modifiedAt: safeText(data.modificationDate) || null,
    appearance: {
      color,
      fillColor,
      opacity,
      strokeWidth: clamp(finite(borderStyle.width, 2), 0.5, 24),
      fontSize: clamp(
        finite(
          data.defaultAppearanceData && typeof data.defaultAppearanceData === 'object'
            ? (data.defaultAppearanceData as Record<string, unknown>).fontSize
            : data.fontSize,
          12,
        ),
        6,
        96,
      ),
    },
    hasAppearance: Boolean(data.hasAppearance),
    editable: supported && Boolean(nativeRef),
    source: safeText(data.name).startsWith('nammu-') ? 'nammu' : 'existing',
  };
}

export async function readPdfAnnotations(document: PDFDocumentProxy): Promise<PdfAnnotation[]> {
  const annotations: PdfAnnotation[] = [];
  const concurrency = 8;
  for (let firstPage = 1; firstPage <= document.numPages; firstPage += concurrency) {
    const pages = await Promise.all(
      Array.from(
        { length: Math.min(concurrency, document.numPages - firstPage + 1) },
        (_, index) => firstPage + index,
      ).map(async (pageNumber) => {
        try {
          const page = await document.getPage(pageNumber);
          return {
            pageNumber,
            values: await page.getAnnotations({ intent: 'display' }),
          };
        } catch {
          // A malformed optional annotation structure must not prevent the
          // document itself from opening. The original bytes remain untouched.
          return { pageNumber, values: [] };
        }
      }),
    );
    for (const { pageNumber, values } of pages) {
      for (const value of values) {
        if (annotations.length >= MAX_ANNOTATIONS) return annotations;
        if (!value || typeof value !== 'object') continue;
        const mapped = normalizePdfJsAnnotation(value as Record<string, unknown>, pageNumber);
        if (mapped.type !== 'unknown' || mapped.content) annotations.push(mapped);
      }
    }
  }
  return annotations;
}

function pdfDate(date = new Date()): string {
  const digits = (value: number, length = 2) => String(value).padStart(length, '0');
  return `D:${digits(date.getUTCFullYear(), 4)}${digits(date.getUTCMonth() + 1)}${digits(date.getUTCDate())}${digits(date.getUTCHours())}${digits(date.getUTCMinutes())}${digits(date.getUTCSeconds())}Z`;
}

function normalizedRect(rect: PdfRect, width: number, height: number): PdfRect {
  const x1 = clamp(Math.min(rect[0], rect[2]), 0, width);
  const y1 = clamp(Math.min(rect[1], rect[3]), 0, height);
  const x2 = clamp(Math.max(rect[0], rect[2]), 0, width);
  const y2 = clamp(Math.max(rect[1], rect[3]), 0, height);
  if (x2 - x1 < MIN_SHAPE_SIZE || y2 - y1 < MIN_SHAPE_SIZE) {
    throw new Error('The annotation area is too small.');
  }
  return [x1, y1, x2, y2];
}

function appearance(value: PdfAnnotationAppearance): PdfAnnotationAppearance {
  return {
    color: normalizeHex(value.color, '#2f8fff'),
    fillColor: value.fillColor ? normalizeHex(value.fillColor, '#ffffff') : null,
    opacity: clamp(finite(value.opacity, 1), 0.05, 1),
    strokeWidth: clamp(finite(value.strokeWidth, 2), 0.5, 24),
    fontSize: clamp(finite(value.fontSize, 12), 6, 96),
  };
}

function number(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function localPoint(point: PdfPoint, rect: PdfRect): PdfPoint {
  return [point[0] - rect[0], point[1] - rect[1]];
}

function localPair(values: readonly number[], rect: PdfRect): readonly number[] {
  return values.map((value, index) => value - (index % 2 === 0 ? rect[0] : rect[1]));
}

function appearanceCommands(draft: PdfAnnotationDraft, rect: PdfRect): string {
  const style = appearance(draft.appearance);
  const stroke = hexToRgb(style.color).map(number).join(' ');
  const fill = style.fillColor ? hexToRgb(style.fillColor).map(number).join(' ') : null;
  const width = rect[2] - rect[0];
  const height = rect[3] - rect[1];
  const prefix = `q /GS0 gs ${number(style.strokeWidth)} w 1 J 1 j ${stroke} RG`;
  const suffix = 'Q';

  if (draft.type === 'highlight' || draft.type === 'underline' || draft.type === 'strikeout') {
    const quads = localPair(draft.quadPoints ?? [], rect);
    const commands: string[] = [prefix];
    for (let index = 0; index + 7 < quads.length; index += 8) {
      const points = quads.slice(index, index + 8);
      if (draft.type === 'highlight') {
        commands.push(
          `${stroke} rg`,
          `${number(points[0])} ${number(points[1])} m`,
          `${number(points[2])} ${number(points[3])} l`,
          `${number(points[6])} ${number(points[7])} l`,
          `${number(points[4])} ${number(points[5])} l h f`,
        );
      } else {
        const y =
          draft.type === 'underline'
            ? Math.min(points[5], points[7]) + Math.max(style.strokeWidth, 1)
            : (Math.max(points[1], points[3]) + Math.min(points[5], points[7])) / 2;
        commands.push(`${number(points[4])} ${number(y)} m ${number(points[6])} ${number(y)} l S`);
      }
    }
    return `${commands.join('\n')}\n${suffix}`;
  }

  if (draft.type === 'ink') {
    const commands = [prefix];
    for (const path of draft.inkPaths ?? []) {
      if (!path.length) continue;
      const first = localPoint(path[0], rect);
      commands.push(`${number(first[0])} ${number(first[1])} m`);
      for (const point of path.slice(1)) {
        const local = localPoint(point, rect);
        commands.push(`${number(local[0])} ${number(local[1])} l`);
      }
      commands.push('S');
    }
    return `${commands.join('\n')}\n${suffix}`;
  }

  if (draft.type === 'line' || draft.type === 'arrow') {
    const line = localPair(draft.line ?? [], rect);
    const [x1 = 0, y1 = 0, x2 = width, y2 = height] = line;
    const commands = [prefix, `${number(x1)} ${number(y1)} m ${number(x2)} ${number(y2)} l S`];
    if (draft.type === 'arrow') {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const size = Math.max(6, style.strokeWidth * 4);
      const ax = x2 - size * Math.cos(angle - Math.PI / 6);
      const ay = y2 - size * Math.sin(angle - Math.PI / 6);
      const bx = x2 - size * Math.cos(angle + Math.PI / 6);
      const by = y2 - size * Math.sin(angle + Math.PI / 6);
      commands.push(
        `${number(ax)} ${number(ay)} m ${number(x2)} ${number(y2)} l ${number(bx)} ${number(by)} l S`,
      );
    }
    return `${commands.join('\n')}\n${suffix}`;
  }

  if (draft.type === 'rectangle') {
    return `${prefix}\n${fill ? `${fill} rg ` : ''}${number(style.strokeWidth / 2)} ${number(style.strokeWidth / 2)} ${number(Math.max(0, width - style.strokeWidth))} ${number(Math.max(0, height - style.strokeWidth))} re ${fill ? 'B' : 'S'}\n${suffix}`;
  }

  if (draft.type === 'ellipse') {
    const k = 0.5522847498;
    const rx = Math.max(0, width / 2 - style.strokeWidth / 2);
    const ry = Math.max(0, height / 2 - style.strokeWidth / 2);
    const cx = width / 2;
    const cy = height / 2;
    return `${prefix}\n${fill ? `${fill} rg` : ''}\n${number(cx + rx)} ${number(cy)} m\n${number(cx + rx)} ${number(cy + k * ry)} ${number(cx + k * rx)} ${number(cy + ry)} ${number(cx)} ${number(cy + ry)} c\n${number(cx - k * rx)} ${number(cy + ry)} ${number(cx - rx)} ${number(cy + k * ry)} ${number(cx - rx)} ${number(cy)} c\n${number(cx - rx)} ${number(cy - k * ry)} ${number(cx - k * rx)} ${number(cy - ry)} ${number(cx)} ${number(cy - ry)} c\n${number(cx + k * rx)} ${number(cy - ry)} ${number(cx + rx)} ${number(cy - k * ry)} ${number(cx + rx)} ${number(cy)} c\n${fill ? 'B' : 'S'}\n${suffix}`;
  }

  if (draft.type === 'polygon' || draft.type === 'polyline') {
    const vertices = localPair(draft.vertices ?? [], rect);
    if (vertices.length < 4) return `${prefix}\n${suffix}`;
    const commands = [prefix, `${number(vertices[0])} ${number(vertices[1])} m`];
    for (let index = 2; index + 1 < vertices.length; index += 2) {
      commands.push(`${number(vertices[index])} ${number(vertices[index + 1])} l`);
    }
    if (draft.type === 'polygon') commands.push(fill ? `${fill} rg B` : 'h S');
    else commands.push('S');
    return `${commands.join('\n')}\n${suffix}`;
  }

  return `${prefix}\n${suffix}`;
}

function parsePdfJsRef(value: string) {
  const match = /^(\d+)R(\d*)$/.exec(value);
  if (!match || match[1] === '0') return null;
  return { objectNumber: Number(match[1]), generationNumber: match[2] ? Number(match[2]) : 0 };
}

function assertUnsigned(document: import('pdf-lib').PDFDocument, pdf: typeof import('pdf-lib')) {
  const { PDFDict, PDFName } = pdf;
  const signed = document.context
    .enumerateIndirectObjects()
    .some(
      ([, object]) =>
        object instanceof PDFDict && object.get(PDFName.of('FT'))?.toString() === '/Sig',
    );
  if (signed)
    throw new Error('Annotations cannot be changed because this PDF contains a digital signature.');
}

async function createAppearance(
  document: import('pdf-lib').PDFDocument,
  draft: PdfAnnotationDraft,
  rect: PdfRect,
) {
  const style = appearance(draft.appearance);
  const resources: Record<string, unknown> = {
    ExtGState: {
      GS0: { Type: 'ExtGState', CA: style.opacity, ca: style.opacity },
    },
  };
  let commands = appearanceCommands(draft, rect);
  if (draft.type === 'freeText') {
    const { StandardFonts } = await import('pdf-lib');
    const font = await document.embedFont(StandardFonts.Helvetica);
    const fontSize = style.fontSize;
    const width = rect[2] - rect[0];
    const height = rect[3] - rect[1];
    const safe = safeText(draft.content).replace(/[^\x20-\x7e]/g, '?') || 'Text';
    const encoded = font.encodeText(safe.slice(0, 512)).toString();
    resources.Font = { F1: font.ref };
    commands = `q /GS0 gs ${hexToRgb(style.color).map(number).join(' ')} rg BT /F1 ${number(fontSize)} Tf 3 ${number(Math.max(3, height - fontSize - 3))} Td ${encoded} Tj ET Q`;
    if (width <= 0 || height <= 0) throw new Error('The text annotation area is invalid.');
  }
  const stream = document.context.flateStream(commands, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, rect[2] - rect[0], rect[3] - rect[1]],
    Resources: document.context.obj(resources as never),
  });
  return document.context.register(stream);
}

function baseSubtype(type: PdfAnnotationDraft['type']): string {
  if (type === 'note') return 'Text';
  if (type === 'freeText') return 'FreeText';
  if (type === 'rectangle') return 'Square';
  if (type === 'ellipse') return 'Circle';
  if (type === 'arrow' || type === 'line') return 'Line';
  if (type === 'strikeout') return 'StrikeOut';
  if (type === 'polyline') return 'PolyLine';
  return `${type[0].toUpperCase()}${type.slice(1)}`;
}

function annotationId(): string {
  return `nammu-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export async function createPdfAnnotation(
  bytes: Uint8Array,
  input: PdfAnnotationDraft,
): Promise<Uint8Array> {
  const pdf = await import('pdf-lib');
  const { PDFDocument, PDFHexString, PDFName, PDFString } = pdf;
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  assertUnsigned(document, pdf);
  if (
    !Number.isInteger(input.pageNumber) ||
    input.pageNumber < 1 ||
    input.pageNumber > document.getPageCount()
  ) {
    throw new Error('The annotation page does not exist.');
  }
  const page = document.getPage(input.pageNumber - 1);
  const size = page.getSize();
  const rect = normalizedRect(input.rect, size.width, size.height);
  const style = appearance(input.appearance);
  const annotation = document.context.obj({
    Type: 'Annot',
    Subtype: baseSubtype(input.type),
    Rect: rect,
    P: page.ref,
    F: 4,
    NM: PDFHexString.fromText(annotationId()),
    T: PDFHexString.fromText(safeText(input.author || 'Nammu PDF')),
    Contents: PDFHexString.fromText(safeText(input.content)),
    CreationDate: PDFString.of(pdfDate()),
    M: PDFString.of(pdfDate()),
    C: hexToRgb(style.color),
    CA: style.opacity,
    Border: [0, 0, style.strokeWidth],
    BS: { Type: 'Border', W: style.strokeWidth, S: 'S' },
  });

  if (style.fillColor)
    annotation.set(PDFName.of('IC'), document.context.obj([...hexToRgb(style.fillColor)]));
  if (input.quadPoints?.length)
    annotation.set(PDFName.of('QuadPoints'), document.context.obj(safeNumbers(input.quadPoints)));
  if (input.line?.length === 4)
    annotation.set(PDFName.of('L'), document.context.obj(safeNumbers(input.line, 4)));
  if (input.type === 'arrow')
    annotation.set(PDFName.of('LE'), document.context.obj(['None', 'OpenArrow']));
  if (input.vertices?.length)
    annotation.set(PDFName.of('Vertices'), document.context.obj(safeNumbers(input.vertices)));
  if (input.inkPaths?.length) {
    annotation.set(
      PDFName.of('InkList'),
      document.context.obj(
        input.inkPaths.map((path) => path.flatMap((point) => [point[0], point[1]])),
      ),
    );
  }
  if (input.type === 'note') annotation.set(PDFName.of('Name'), PDFName.of('Comment'));
  if (input.type === 'freeText') {
    annotation.set(
      PDFName.of('DA'),
      PDFString.of(
        `/Helv ${number(style.fontSize)} Tf ${hexToRgb(style.color).map(number).join(' ')} rg`,
      ),
    );
    annotation.set(PDFName.of('Q'), document.context.obj(0));
  }
  if (input.type !== 'note') {
    const normalAppearance = await createAppearance(document, input, rect);
    annotation.set(PDFName.of('AP'), document.context.obj({ N: normalAppearance }));
  }

  const annotationRef = document.context.register(annotation);
  page.node.addAnnot(annotationRef);
  return new Uint8Array(await document.save({ addDefaultPage: false, useObjectStreams: false }));
}

async function findAnnotation(
  document: import('pdf-lib').PDFDocument,
  nativeRef: string,
  pdf: typeof import('pdf-lib'),
) {
  const parsed = parsePdfJsRef(nativeRef);
  if (!parsed) throw new Error('The annotation does not expose a stable PDF reference.');
  const ref = pdf.PDFRef.of(parsed.objectNumber, parsed.generationNumber);
  const dictionary = document.context.lookupMaybe(ref, pdf.PDFDict);
  if (!dictionary) throw new Error('The annotation no longer exists.');
  return { ref, dictionary };
}

export async function deletePdfAnnotation(
  bytes: Uint8Array,
  annotation: PdfAnnotation,
): Promise<Uint8Array> {
  if (!annotation.nativeRef) throw new Error('This annotation cannot be edited safely.');
  const pdf = await import('pdf-lib');
  const document = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  assertUnsigned(document, pdf);
  const { ref } = await findAnnotation(document, annotation.nativeRef, pdf);
  const page = document.getPage(annotation.pageNumber - 1);
  const annots = page.node.Annots();
  if (!annots) throw new Error('The annotation no longer exists on its page.');
  const index = annots
    .asArray()
    .findIndex(
      (candidate) =>
        candidate instanceof pdf.PDFRef &&
        candidate.objectNumber === ref.objectNumber &&
        candidate.generationNumber === ref.generationNumber,
    );
  if (index < 0) throw new Error('The annotation no longer exists on its page.');
  annots.remove(index);
  if (annots.size() === 0) page.node.delete(pdf.PDFName.of('Annots'));
  return new Uint8Array(await document.save({ addDefaultPage: false, useObjectStreams: false }));
}

export async function removeAllPdfAnnotations(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await import('pdf-lib');
  const document = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  assertUnsigned(document, pdf);
  let removed = 0;
  for (const page of document.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let index = annots.size() - 1; index >= 0; index -= 1) {
      const candidate = annots.get(index);
      const dictionary = document.context.lookupMaybe(candidate, pdf.PDFDict);
      // Form widgets are fields, not comments. Removing them here would silently
      // destroy the AcroForm tree and is intentionally outside P3.
      if (dictionary?.get(pdf.PDFName.of('Subtype'))?.toString() === '/Widget') continue;
      annots.remove(index);
      removed += 1;
    }
    if (annots.size() === 0) page.node.delete(pdf.PDFName.of('Annots'));
  }
  if (removed === 0) throw new Error('This PDF does not contain removable annotations.');
  return new Uint8Array(await document.save({ addDefaultPage: false, useObjectStreams: false }));
}

function draftFromAnnotation(
  annotation: PdfAnnotation,
  patch: PdfAnnotationPatch,
): PdfAnnotationDraft {
  if (
    annotation.type === 'unknown' ||
    annotation.type === 'stamp' ||
    annotation.type === 'signature'
  ) {
    throw new Error('This annotation type is preserved as read-only.');
  }
  return {
    pageNumber: annotation.pageNumber,
    type: annotation.type,
    rect: annotation.rect,
    quadPoints: annotation.quadPoints,
    line: annotation.line,
    vertices: annotation.vertices,
    inkPaths: annotation.inkPaths,
    content: safeText(patch.content ?? annotation.content),
    author: safeText(patch.author ?? annotation.author),
    appearance: appearance({ ...annotation.appearance, ...patch.appearance }),
  };
}

export async function updatePdfAnnotation(
  bytes: Uint8Array,
  annotation: PdfAnnotation,
  patch: PdfAnnotationPatch,
): Promise<Uint8Array> {
  if (!annotation.nativeRef || !annotation.editable)
    throw new Error('This annotation cannot be edited safely.');
  const pdf = await import('pdf-lib');
  const document = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  assertUnsigned(document, pdf);
  const { dictionary } = await findAnnotation(document, annotation.nativeRef, pdf);
  const draft = draftFromAnnotation(annotation, patch);
  const style = draft.appearance;
  dictionary.set(pdf.PDFName.of('Contents'), pdf.PDFHexString.fromText(safeText(draft.content)));
  dictionary.set(pdf.PDFName.of('T'), pdf.PDFHexString.fromText(safeText(draft.author)));
  dictionary.set(pdf.PDFName.of('M'), pdf.PDFString.of(pdfDate()));
  dictionary.set(pdf.PDFName.of('C'), document.context.obj([...hexToRgb(style.color)]));
  dictionary.set(pdf.PDFName.of('CA'), document.context.obj(style.opacity));
  dictionary.set(pdf.PDFName.of('Border'), document.context.obj([0, 0, style.strokeWidth]));
  dictionary.set(
    pdf.PDFName.of('BS'),
    document.context.obj({ Type: 'Border', W: style.strokeWidth, S: 'S' }),
  );
  if (style.fillColor)
    dictionary.set(pdf.PDFName.of('IC'), document.context.obj([...hexToRgb(style.fillColor)]));
  else dictionary.delete(pdf.PDFName.of('IC'));
  if (draft.type === 'freeText') {
    dictionary.set(
      pdf.PDFName.of('DA'),
      pdf.PDFString.of(
        `/Helv ${number(style.fontSize)} Tf ${hexToRgb(style.color).map(number).join(' ')} rg`,
      ),
    );
  }
  if (draft.type !== 'note') {
    const normalAppearance = await createAppearance(document, draft, annotation.rect);
    dictionary.set(pdf.PDFName.of('AP'), document.context.obj({ N: normalAppearance }));
  }
  return new Uint8Array(await document.save({ addDefaultPage: false, useObjectStreams: false }));
}

export const PDF_ANNOTATION_LIMITS = {
  maxAnnotations: MAX_ANNOTATIONS,
  maxTextLength: MAX_TEXT_LENGTH,
} as const;
