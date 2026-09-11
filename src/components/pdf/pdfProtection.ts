import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfRect } from './annotationModel';
import type {
  PdfProtectionModel,
  PdfRedactionMark,
  PdfSanitizeOptions,
  PdfSecurityInspection,
} from './protectionModel';

const MAX_REDACTIONS = 5_000;
const MAX_REASON = 2_048;
const ACTIVE_ACTIONS = new Set(['/JavaScript', '/Launch', '/GoToR', '/SubmitForm', '/ImportData']);

function safeReason(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('')
    .slice(0, MAX_REASON);
}

function normalizeRect(rect: PdfRect, width: number, height: number): PdfRect {
  const values = rect.map((value) => (Number.isFinite(value) ? value : 0));
  const x1 = Math.max(0, Math.min(width, Math.min(values[0], values[2])));
  const y1 = Math.max(0, Math.min(height, Math.min(values[1], values[3])));
  const x2 = Math.max(0, Math.min(width, Math.max(values[0], values[2])));
  const y2 = Math.max(0, Math.min(height, Math.max(values[1], values[3])));
  if (x2 - x1 < 1 || y2 - y1 < 1) throw new Error('The redaction region is too small.');
  return [x1, y1, x2, y2];
}

function parseRef(value: string): readonly [number, number] | null {
  const compact = /^(\d+)R(\d*)$/.exec(value);
  if (compact) return [Number(compact[1]), Number(compact[2] || 0)];
  const native = /^(\d+)\s+(\d+)\s+R$/.exec(value);
  return native ? [Number(native[1]), Number(native[2])] : null;
}

function stringValue(value: unknown): string {
  if (value && typeof value === 'object' && 'decodeText' in value) {
    try {
      return String((value as { decodeText(): string }).decodeText());
    } catch {
      return '';
    }
  }
  return '';
}

export async function inspectPdfProtection(bytes: Uint8Array): Promise<PdfProtectionModel> {
  const pdf = await import('pdf-lib');
  const document = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  const redactions: PdfRedactionMark[] = [];
  let javascript = false;
  let activeActions = false;
  let annotationCount = 0;
  let attachments = false;
  const names = document.catalog.lookup(pdf.PDFName.of('Names'));
  if (names instanceof pdf.PDFDict) {
    javascript = names.has(pdf.PDFName.of('JavaScript'));
    attachments = names.has(pdf.PDFName.of('EmbeddedFiles'));
  }
  if (document.catalog.has(pdf.PDFName.of('OpenAction'))) activeActions = true;
  if (document.catalog.has(pdf.PDFName.of('AA'))) activeActions = true;
  for (const [, object] of document.context.enumerateIndirectObjects().slice(0, 100_000)) {
    const streamDictionary =
      object && typeof object === 'object' && 'dict' in object
        ? (object as { dict: import('pdf-lib').PDFDict }).dict
        : null;
    if (streamDictionary?.get(pdf.PDFName.of('Subtype'))?.toString() === '/EmbeddedFile')
      attachments = true;
  }

  const inspectActions = (dictionary: import('pdf-lib').PDFDict) => {
    if (dictionary.has(pdf.PDFName.of('AA'))) activeActions = true;
    const action = dictionary.lookup(pdf.PDFName.of('A'));
    if (action instanceof pdf.PDFDict) {
      const kind = action.get(pdf.PDFName.of('S'))?.toString() ?? '';
      if (kind === '/JavaScript') javascript = true;
      if (ACTIVE_ACTIONS.has(kind)) activeActions = true;
    }
  };

  for (const [pageIndex, page] of document.getPages().entries()) {
    inspectActions(page.node);
    const annots = page.node.Annots();
    if (!annots) continue;
    annotationCount += annots.size();
    for (const entry of annots.asArray().slice(0, MAX_REDACTIONS + 10_000)) {
      const dictionary = document.context.lookupMaybe(entry, pdf.PDFDict);
      if (!dictionary) continue;
      inspectActions(dictionary);
      const subtype = dictionary.get(pdf.PDFName.of('Subtype'))?.toString();
      if (subtype === '/FileAttachment') attachments = true;
      if (subtype !== '/Redact' || redactions.length >= MAX_REDACTIONS || !(entry instanceof pdf.PDFRef))
        continue;
      const rectArray = dictionary.lookup(pdf.PDFName.of('Rect'));
      if (!(rectArray instanceof pdf.PDFArray) || rectArray.size() < 4) continue;
      const rect = Array.from({ length: 4 }, (_, index) => {
        const number = rectArray.lookup(index);
        return number instanceof pdf.PDFNumber ? number.asNumber() : 0;
      }) as unknown as PdfRect;
      const quadArray = dictionary.lookup(pdf.PDFName.of('QuadPoints'));
      const quadPoints =
        quadArray instanceof pdf.PDFArray
          ? Array.from({ length: Math.min(quadArray.size(), 32_768) }, (_, index) => {
              const number = quadArray.lookup(index);
              return number instanceof pdf.PDFNumber ? number.asNumber() : 0;
            })
          : [];
      const nativeRef = `${entry.objectNumber}R${entry.generationNumber || ''}`;
      redactions.push({
        id: nativeRef,
        nativeRef,
        pageNumber: pageIndex + 1,
        rect,
        quadPoints,
        reason: safeReason(stringValue(dictionary.get(pdf.PDFName.of('Contents')))),
        color: '#ef4444',
      });
    }
  }

  const acroForm = document.catalog.lookup(pdf.PDFName.of('AcroForm'));
  if (acroForm instanceof pdf.PDFDict) inspectActions(acroForm);
  const signatures = document.context.enumerateIndirectObjects().some(([, object]) =>
    object instanceof pdf.PDFDict && object.get(pdf.PDFName.of('FT'))?.toString() === '/Sig',
  );
  const inspection: PdfSecurityInspection = {
    encrypted: false,
    signatures,
    metadata: Boolean(document.context.trailerInfo.Info),
    xmpMetadata: document.catalog.has(pdf.PDFName.of('Metadata')),
    javascript,
    activeActions,
    attachments,
    forms: acroForm instanceof pdf.PDFDict,
    xfa: acroForm instanceof pdf.PDFDict && acroForm.has(pdf.PDFName.of('XFA')),
    annotationCount,
    pendingRedactions: redactions.length,
  };
  return { inspection, redactions, selectedRedactionId: null };
}

export async function createPdfRedactionMark(
  bytes: Uint8Array,
  input: { pageNumber: number; rect: PdfRect; quadPoints?: readonly number[]; reason?: string },
): Promise<Uint8Array> {
  const pdf = await import('pdf-lib');
  const document = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  if (document.context.enumerateIndirectObjects().some(([, object]) =>
    object instanceof pdf.PDFDict && object.get(pdf.PDFName.of('FT'))?.toString() === '/Sig',
  )) throw new Error('Redaction marks are disabled for signed PDFs.');
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1 || input.pageNumber > document.getPageCount())
    throw new Error('The redaction page does not exist.');
  const page = document.getPage(input.pageNumber - 1);
  const { width, height } = page.getSize();
  const rect = normalizeRect(input.rect, width, height);
  const dictionary = document.context.obj({
    Type: 'Annot', Subtype: 'Redact', Rect: rect, P: page.ref, F: 4,
    NM: pdf.PDFHexString.fromText(`nammu-redact-${crypto.randomUUID()}`),
    Contents: pdf.PDFHexString.fromText(safeReason(input.reason ?? '')),
    C: [0.94, 0.27, 0.27], IC: [0, 0, 0], CA: 0.32,
  });
  if (input.quadPoints?.length && input.quadPoints.length % 8 === 0) {
    dictionary.set(pdf.PDFName.of('QuadPoints'), document.context.obj([...input.quadPoints].slice(0, 32_768)));
  }
  page.node.addAnnot(document.context.register(dictionary));
  return new Uint8Array(await document.save({ addDefaultPage: false, useObjectStreams: false }));
}

export async function removePdfRedactionMark(bytes: Uint8Array, nativeRef: string): Promise<Uint8Array> {
  const parsed = parseRef(nativeRef);
  if (!parsed) throw new Error('The redaction mark has no stable PDF reference.');
  const pdf = await import('pdf-lib');
  const document = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  const ref = pdf.PDFRef.of(parsed[0], parsed[1]);
  let removed = false;
  for (const page of document.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let index = annots.size() - 1; index >= 0; index -= 1) {
      const candidate = annots.get(index);
      if (candidate instanceof pdf.PDFRef && candidate.objectNumber === ref.objectNumber && candidate.generationNumber === ref.generationNumber) {
        const dict = document.context.lookupMaybe(candidate, pdf.PDFDict);
        if (dict?.get(pdf.PDFName.of('Subtype'))?.toString() !== '/Redact')
          throw new Error('The selected object is not a redaction mark.');
        annots.remove(index); removed = true;
      }
    }
    if (annots.size() === 0) page.node.delete(pdf.PDFName.of('Annots'));
  }
  if (!removed) throw new Error('The redaction mark no longer exists.');
  return new Uint8Array(await document.save({ addDefaultPage: false, useObjectStreams: false }));
}

function removeActiveActions(document: import('pdf-lib').PDFDocument, pdf: typeof import('pdf-lib')): void {
  const names = document.catalog.lookup(pdf.PDFName.of('Names'));
  if (names instanceof pdf.PDFDict) names.delete(pdf.PDFName.of('JavaScript'));
  document.catalog.delete(pdf.PDFName.of('OpenAction'));
  document.catalog.delete(pdf.PDFName.of('AA'));
  for (const [, object] of document.context.enumerateIndirectObjects().slice(0, 100_000)) {
    if (!(object instanceof pdf.PDFDict)) continue;
    object.delete(pdf.PDFName.of('AA'));
    const action = object.lookup(pdf.PDFName.of('A'));
    if (action instanceof pdf.PDFDict && ACTIVE_ACTIONS.has(action.get(pdf.PDFName.of('S'))?.toString() ?? '')) {
      object.delete(pdf.PDFName.of('A'));
    }
  }
}

export async function sanitizePdfDocument(bytes: Uint8Array, options: PdfSanitizeOptions): Promise<Uint8Array> {
  if (!options.metadata && !options.javascriptAndActions && !options.attachments)
    throw new Error('Select at least one document element to remove.');
  const pdf = await import('pdf-lib');
  const document = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  if (document.context.enumerateIndirectObjects().some(([, object]) =>
    object instanceof pdf.PDFDict && object.get(pdf.PDFName.of('FT'))?.toString() === '/Sig',
  )) throw new Error('Sanitization is disabled for signed PDFs.');
  if (options.metadata) {
    document.catalog.delete(pdf.PDFName.of('Metadata'));
    document.context.trailerInfo.Info = undefined;
  }
  if (options.javascriptAndActions) removeActiveActions(document, pdf);
  if (options.attachments) {
    const names = document.catalog.lookup(pdf.PDFName.of('Names'));
    if (names instanceof pdf.PDFDict) names.delete(pdf.PDFName.of('EmbeddedFiles'));
    for (const page of document.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      for (let index = annots.size() - 1; index >= 0; index -= 1) {
        const candidate = document.context.lookupMaybe(annots.get(index), pdf.PDFDict);
        if (candidate?.get(pdf.PDFName.of('Subtype'))?.toString() === '/FileAttachment') annots.remove(index);
      }
      if (annots.size() === 0) page.node.delete(pdf.PDFName.of('Annots'));
    }
    // pdf-lib serializes every indirect object still registered in the context.
    // Remove detached FileSpec and EmbeddedFile objects as well as their visible
    // references so the payload cannot survive as an orphaned stream.
    for (const [ref, object] of document.context.enumerateIndirectObjects().slice(0, 100_000)) {
      const streamDictionary =
        object && typeof object === 'object' && 'dict' in object
          ? (object as { dict: import('pdf-lib').PDFDict }).dict
          : null;
      const embeddedStream =
        streamDictionary?.get(pdf.PDFName.of('Subtype'))?.toString() === '/EmbeddedFile';
      const fileSpec =
        object instanceof pdf.PDFDict &&
        (object.get(pdf.PDFName.of('Type'))?.toString() === '/Filespec' ||
          object.has(pdf.PDFName.of('EF')));
      if (embeddedStream || fileSpec) document.context.delete(ref);
    }
  }
  const output = new Uint8Array(await document.save({ addDefaultPage: false, useObjectStreams: false }));
  const verified = await inspectPdfProtection(output);
  if (options.metadata && (verified.inspection.metadata || verified.inspection.xmpMetadata))
    throw new Error('Metadata removal verification failed; the original document was retained.');
  if (options.javascriptAndActions && (verified.inspection.javascript || verified.inspection.activeActions))
    throw new Error('Active-action removal verification failed; the original document was retained.');
  if (options.attachments && verified.inspection.attachments)
    throw new Error('Attachment-reference removal verification failed; the original document was retained.');
  return output;
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('The redacted page could not be encoded.')), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export async function applyRasterRedactions(
  bytes: Uint8Array,
  renderDocument: PDFDocumentProxy,
  redactions: readonly PdfRedactionMark[],
): Promise<Uint8Array> {
  if (!redactions.length) throw new Error('Mark at least one region before applying redactions.');
  if (typeof document === 'undefined') throw new Error('Secure raster redaction requires the PDF workspace renderer.');
  const grouped = new Map<number, PdfRedactionMark[]>();
  for (const mark of redactions.slice(0, MAX_REDACTIONS)) grouped.set(mark.pageNumber, [...(grouped.get(mark.pageNumber) ?? []), mark]);
  const rasterPages = new Map<number, Uint8Array>();
  for (const [pageNumber, marks] of grouped) {
    const renderPage = await renderDocument.getPage(pageNumber);
    const viewport = renderPage.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas rendering is unavailable.');
    await renderPage.render({ canvas, canvasContext: context, viewport }).promise;
    context.save(); context.fillStyle = '#000000';
    for (const mark of marks) {
      const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([...mark.rect]);
      context.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    context.restore();
    rasterPages.set(pageNumber, await canvasPng(canvas));
  }
  const result = await replacePdfPagesWithRasters(bytes, rasterPages);
  const inspected = await inspectPdfProtection(result);
  if (inspected.redactions.length) throw new Error('Redaction verification failed; the original document was retained.');
  return result;
}

export async function replacePdfPagesWithRasters(
  bytes: Uint8Array,
  rasterPages: ReadonlyMap<number, Uint8Array>,
): Promise<Uint8Array> {
  if (!rasterPages.size) throw new Error('At least one rasterized page is required.');
  const pdf = await import('pdf-lib');
  const source = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  const output = await pdf.PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= source.getPageCount(); pageNumber += 1) {
    const raster = rasterPages.get(pageNumber);
    if (!raster) {
      const [copy] = await output.copyPages(source, [pageNumber - 1]);
      output.addPage(copy);
      continue;
    }
    const image = await output.embedPng(raster);
    const size = source.getPage(pageNumber - 1).getSize();
    const page = output.addPage([size.width, size.height]);
    page.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
  }
  return new Uint8Array(await output.save({ addDefaultPage: false, useObjectStreams: false }));
}
