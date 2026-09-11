import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  PdfDocumentMetadata,
  PdfFidelityProfile,
  PdfDocumentSession,
  PdfDocumentSource,
  PdfPageInfo,
  PdfSearchResult,
} from './model';
import { DEFAULT_ANNOTATION_APPEARANCE } from './annotationModel';
import { readPdfAnnotations } from './pdfAnnotations';
import { inspectPdfForms } from './pdfForms';
import { inspectEditablePdfContent } from './pdfContentEditing';
import { inspectPdfProtection } from './pdfProtection';
import { DEFAULT_CONVERSION_STATE } from './conversionModel';
import { DEFAULT_OCR_STATE } from './ocrModel';

const PDF_WORKER_URL = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

let pdfJsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function getPdfJs() {
  pdfJsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    return pdfjs;
  });
  return pdfJsPromise;
}

function nullableDate(value: Date | undefined): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function normalizedName(name: string): string {
  const trimmed = name.trim();
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed || 'Untitled'}.pdf`;
}

function sessionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function inspectPdfStructure(bytes: Uint8Array): Promise<{
  pages: PdfPageInfo[];
  metadata: PdfDocumentMetadata;
  fidelity: PdfFidelityProfile;
}> {
  const { PDFDict, PDFDocument, PDFName } = await import('pdf-lib');
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = document.getPages().map((page, index) => {
    const size = page.getSize();
    return {
      pageNumber: index + 1,
      width: size.width,
      height: size.height,
      rotation: page.getRotation().angle,
    };
  });
  const acroForm = document.catalog.lookup(PDFName.of('AcroForm'));
  const names = document.catalog.lookup(PDFName.of('Names'));
  const forms = acroForm instanceof PDFDict;
  const signatures = document.context.enumerateIndirectObjects().some(([, object]) => {
    if (!(object instanceof PDFDict)) return false;
    return object.get(PDFName.of('FT'))?.toString() === '/Sig';
  });
  const annotations = document.getPages().some((page) => page.node.has(PDFName.of('Annots')));
  const outlines = document.catalog.has(PDFName.of('Outlines'));
  const attachments = names instanceof PDFDict && names.has(PDFName.of('EmbeddedFiles'));
  const xfa = acroForm instanceof PDFDict && acroForm.has(PDFName.of('XFA'));
  const metadata = document.catalog.has(PDFName.of('Metadata'));
  const pageLabels = document.catalog.has(PDFName.of('PageLabels'));
  const startXref = [115, 116, 97, 114, 116, 120, 114, 101, 102];
  let startXrefCount = 0;
  for (let index = 0; index <= bytes.length - startXref.length; index += 1) {
    if (startXref.every((value, offset) => bytes[index + offset] === value)) startXrefCount += 1;
  }
  const incrementalUpdates = startXrefCount > 1;
  const warnings: string[] = [];
  if (forms) warnings.push('Interactive forms may not survive structural page rewriting exactly.');
  if (annotations)
    warnings.push('Annotations and their page references are not guaranteed to survive.');
  if (outlines) warnings.push('Bookmarks/outlines may lose or retain stale page destinations.');
  if (attachments) warnings.push('Embedded attachments are not guaranteed to be preserved.');
  if (xfa) warnings.push('XFA forms are unsupported by the current page-operation adapter.');
  if (incrementalUpdates)
    warnings.push('Incremental update history will be consolidated by a full document rewrite.');
  if (pageLabels) warnings.push('Custom page labels are not guaranteed to follow reordered pages.');
  if (metadata) warnings.push('Extended XMP metadata preservation is not guaranteed.');

  return {
    pages,
    metadata: {
      title: document.getTitle() ?? null,
      author: document.getAuthor() ?? null,
      subject: document.getSubject() ?? null,
      creator: document.getCreator() ?? null,
      producer: document.getProducer() ?? null,
      creationDate: nullableDate(document.getCreationDate()),
      modificationDate: nullableDate(document.getModificationDate()),
    },
    fidelity: {
      forms,
      signatures,
      annotations,
      outlines,
      attachments,
      xfa,
      incrementalUpdates,
      metadata,
      pageLabels,
      warnings,
    },
  };
}

export async function loadPdfSession(
  name: string,
  bytes: Uint8Array,
  source: PdfDocumentSource,
): Promise<PdfDocumentSession> {
  if (bytes.byteLength === 0) throw new Error('The selected PDF is empty.');
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({
    // PDF.js may transfer this buffer to its worker. Preserve the canonical
    // session bytes for save and document commands.
    data: bytes.slice(),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  let renderDocument: PDFDocumentProxy | null = null;
  try {
    const [loaded, inspected, form, editableContent, protection] = await Promise.all([
      loadingTask.promise,
      inspectPdfStructure(bytes),
      inspectPdfForms(bytes),
      inspectEditablePdfContent(bytes),
      inspectPdfProtection(bytes),
    ]);
    renderDocument = loaded;
    if (loaded.numPages !== inspected.pages.length) {
      throw new Error('The PDF engines disagreed about the document page count.');
    }
    const annotations = await readPdfAnnotations(loaded);
    return {
      id: sessionId(),
      name: normalizedName(name),
      source,
      bytes,
      size: bytes.byteLength,
      renderDocument: loaded,
      pages: inspected.pages,
      metadata: inspected.metadata,
      activePage: 1,
      selectedPages: [1],
      selectionAnchor: 1,
      zoom: 1,
      zoomMode: 'fit-width',
      viewMode: 'continuous',
      tool: 'select',
      workspaceMode: 'read',
      annotations,
      selectedAnnotationId: null,
      textSelection: null,
      annotationAppearance: DEFAULT_ANNOTATION_APPEARANCE,
      form,
      selectedFormFieldId: null,
      selectedFormWidgetId: null,
      contentEdit: { objects: editableContent, selectedObjectId: null },
      protection,
      conversion: { ...DEFAULT_CONVERSION_STATE, options: { ...DEFAULT_CONVERSION_STATE.options } },
      ocr: { ...DEFAULT_OCR_STATE, options: { ...DEFAULT_OCR_STATE.options }, results: [] },
      fidelity: inspected.fidelity,
      dirty: false,
      revision: 0,
      history: { past: [], future: [] },
    };
  } catch (error) {
    await renderDocument?.destroy().catch(() => undefined);
    await loadingTask.destroy().catch(() => undefined);
    const reason = error instanceof Error ? error.message : 'The document could not be decoded.';
    if (/password/i.test(reason)) {
      throw new Error('This PDF is encrypted. Password entry is not available in P1.');
    }
    throw new Error(`The PDF could not be opened safely. ${reason}`);
  }
}

export async function reloadPdfContent(
  session: PdfDocumentSession,
  bytes: Uint8Array,
): Promise<
  Pick<
    PdfDocumentSession,
    | 'bytes'
    | 'size'
    | 'renderDocument'
    | 'pages'
    | 'metadata'
    | 'fidelity'
    | 'annotations'
    | 'form'
    | 'contentEdit'
    | 'protection'
  >
> {
  const loaded = await loadPdfSession(session.name, bytes, session.source);
  return {
    bytes: loaded.bytes,
    size: loaded.size,
    renderDocument: loaded.renderDocument,
    pages: loaded.pages,
    metadata: loaded.metadata,
    fidelity: loaded.fidelity,
    annotations: loaded.annotations,
    form: loaded.form,
    contentEdit: loaded.contentEdit,
    protection: loaded.protection,
  };
}

export async function rotatePdfPage(
  bytes: Uint8Array,
  pageNumber: number,
  angle: 90 | -90,
): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  if (pageNumber < 1 || pageNumber > document.getPageCount()) {
    throw new Error('The selected page no longer exists.');
  }
  const page = document.getPage(pageNumber - 1);
  const rotation = (((page.getRotation().angle + angle) % 360) + 360) % 360;
  page.setRotation(degrees(rotation));
  return new Uint8Array(await document.save());
}

function normalizedPageNumbers(pageNumbers: readonly number[], pageCount: number): number[] {
  return [...new Set(pageNumbers)]
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount)
    .sort((a, b) => a - b);
}

export async function rotatePdfPages(
  bytes: Uint8Array,
  pageNumbers: readonly number[],
  angle: 90 | -90,
): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = normalizedPageNumbers(pageNumbers, document.getPageCount());
  if (pages.length === 0) throw new Error('Select at least one valid page to rotate.');
  for (const pageNumber of pages) {
    const page = document.getPage(pageNumber - 1);
    const rotation = (((page.getRotation().angle + angle) % 360) + 360) % 360;
    page.setRotation(degrees(rotation));
  }
  return new Uint8Array(await document.save());
}

export async function deletePdfPage(bytes: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  if (document.getPageCount() <= 1) throw new Error('A PDF must retain at least one page.');
  if (pageNumber < 1 || pageNumber > document.getPageCount()) {
    throw new Error('The selected page no longer exists.');
  }
  document.removePage(pageNumber - 1);
  return new Uint8Array(await document.save());
}

export async function deletePdfPages(
  bytes: Uint8Array,
  pageNumbers: readonly number[],
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = normalizedPageNumbers(pageNumbers, document.getPageCount());
  if (pages.length === 0) throw new Error('Select at least one valid page to delete.');
  if (pages.length >= document.getPageCount()) {
    throw new Error('A PDF must retain at least one page.');
  }
  [...pages].reverse().forEach((page) => document.removePage(page - 1));
  return new Uint8Array(await document.save());
}

export async function duplicatePdfPages(
  bytes: Uint8Array,
  pageNumbers: readonly number[],
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const [document, source] = await Promise.all([
    PDFDocument.load(bytes, { updateMetadata: false }),
    PDFDocument.load(bytes, { updateMetadata: false }),
  ]);
  const pages = normalizedPageNumbers(pageNumbers, document.getPageCount());
  if (pages.length === 0) throw new Error('Select at least one valid page to duplicate.');
  const copied = await document.copyPages(
    source,
    pages.map((page) => page - 1),
  );
  const insertionIndex = pages[pages.length - 1];
  copied.forEach((page, offset) => document.insertPage(insertionIndex + offset, page));
  return new Uint8Array(await document.save());
}

export async function reorderPdfPages(
  bytes: Uint8Array,
  pageOrder: readonly number[],
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const [document, source] = await Promise.all([
    PDFDocument.load(bytes, { updateMetadata: false }),
    PDFDocument.load(bytes, { updateMetadata: false }),
  ]);
  const expected = Array.from({ length: document.getPageCount() }, (_, index) => index + 1);
  const normalized = normalizedPageNumbers(pageOrder, document.getPageCount());
  if (pageOrder.length !== expected.length || normalized.length !== expected.length) {
    throw new Error('The requested page order is not a complete page permutation.');
  }
  while (document.getPageCount() > 0) document.removePage(document.getPageCount() - 1);
  const copied = await document.copyPages(
    source,
    pageOrder.map((page) => page - 1),
  );
  copied.forEach((page) => document.addPage(page));
  return new Uint8Array(await document.save());
}

export async function insertPdfPages(
  bytes: Uint8Array,
  insertBytes: Uint8Array,
  relativePage: number,
  placement: 'before' | 'after' = 'after',
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const [document, source] = await Promise.all([
    PDFDocument.load(bytes, { updateMetadata: false }),
    PDFDocument.load(insertBytes, { updateMetadata: false }),
  ]);
  const copied = await document.copyPages(source, source.getPageIndices());
  const page = Math.min(Math.max(relativePage, 1), document.getPageCount());
  const insertionIndex = placement === 'before' ? page - 1 : page;
  copied.forEach((page, offset) => document.insertPage(insertionIndex + offset, page));
  return new Uint8Array(await document.save());
}

export async function getPdfPageCount(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
}

export async function extractPdfPages(
  bytes: Uint8Array,
  pageNumbers: readonly number[],
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const indices = [...new Set(pageNumbers)]
    .filter((page) => page >= 1 && page <= source.getPageCount())
    .map((page) => page - 1);
  if (indices.length === 0) throw new Error('Select at least one valid page to extract.');
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, indices);
  pages.forEach((page) => output.addPage(page));
  return new Uint8Array(await output.save());
}

function searchExcerpt(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const index = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return normalized.slice(0, 110);
  const start = Math.max(0, index - 38);
  const end = Math.min(normalized.length, index + query.length + 58);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
}

export async function searchPdfDocument(
  document: PDFDocumentProxy,
  rawQuery: string,
): Promise<PdfSearchResult[]> {
  const query = rawQuery.trim();
  if (!query) return [];
  const lower = query.toLocaleLowerCase();
  const results: PdfSearchResult[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ');
    let matches = 0;
    let cursor = 0;
    const searchable = text.toLocaleLowerCase();
    while ((cursor = searchable.indexOf(lower, cursor)) >= 0) {
      matches += 1;
      cursor += Math.max(lower.length, 1);
    }
    if (matches > 0) results.push({ pageNumber, excerpt: searchExcerpt(text, query), matches });
  }
  return results;
}
