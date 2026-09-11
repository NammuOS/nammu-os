import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import type { PdfDocumentSession } from './model';
import type {
  PdfOcrLine,
  PdfOcrOptions,
  PdfOcrPageKind,
  PdfOcrPageResult,
  PdfOcrWord,
} from './ocrModel';
import { resolvePdfPageScope } from './pdfConversion';
import { inspectPdfStructure } from './pdfEngine';

const MAX_OCR_PAGES = 500;
const MAX_RENDER_PIXELS = 40_000_000;
const MAX_WORDS_PER_PAGE = 50_000;
const MAX_RESULT_CHARACTERS = 5_000_000;

export interface PdfOcrProgress {
  stage: string;
  completed: number;
  total: number;
  engineProgress?: number;
}

type OcrWorker = import('tesseract.js').Worker;

export function getOcrRuntimeAssetUrls(origin = globalThis.location?.origin ?? 'http://127.0.0.1'): {
  workerPath: string;
  corePath: string;
  langPath: string;
  fontPath: string;
} {
  const root = new URL('/ocr/', origin);
  return {
    workerPath: new URL('tesseract/worker.min.js', root).href,
    corePath: new URL('tesseract/tesseract-core-simd-lstm.wasm.js', root).href,
    langPath: new URL('tesseract/lang', root).href,
    fontPath: new URL('fonts/LiberationSans-Regular.ttf', root).href,
  };
}

export function classifyOcrPage(text: string, imageCount: number): PdfOcrPageKind {
  const usefulCharacters = text.replace(/\s/g, '').length;
  if (usefulCharacters >= 8 && imageCount > 0) return 'mixed';
  if (usefulCharacters >= 8) return 'text-present';
  if (imageCount > 0) return 'image-only';
  return 'unknown';
}

async function inspectPage(page: PDFPageProxy): Promise<PdfOcrPageKind> {
  const [text, operators, pdfjs] = await Promise.all([
    page.getTextContent({ disableNormalization: false }),
    page.getOperatorList(),
    import('pdfjs-dist'),
  ]);
  const extracted = text.items
    .flatMap((item) => (item && typeof item === 'object' && 'str' in item ? [String(item.str)] : []))
    .join(' ');
  const imageOperations = new Set([
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintImageMaskXObjectGroup,
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintSolidColorImageMask,
  ]);
  return classifyOcrPage(extracted, operators.fnArray.filter((operator) => imageOperations.has(operator)).length);
}

function binarize(context: CanvasRenderingContext2D): void {
  const image = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114 >= 150 ? 255 : 0;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
}

function toPdfBox(viewport: PageViewport, box: import('tesseract.js').Bbox): PdfOcrWord['box'] {
  const corners = [
    viewport.convertToPdfPoint(box.x0, box.y0),
    viewport.convertToPdfPoint(box.x1, box.y0),
    viewport.convertToPdfPoint(box.x0, box.y1),
    viewport.convertToPdfPoint(box.x1, box.y1),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function normalizeTesseractPage(
  data: import('tesseract.js').Page,
  pageNumber: number,
  kindBeforeOcr: PdfOcrPageKind,
  viewport: PageViewport,
): PdfOcrPageResult {
  const lines: PdfOcrLine[] = [];
  let wordCount = 0;
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const words: PdfOcrWord[] = [];
        for (const word of line.words ?? []) {
          if (wordCount >= MAX_WORDS_PER_PAGE) break;
          const text = word.text.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 4_096);
          if (!text.trim()) continue;
          words.push({ text, confidence: Number.isFinite(word.confidence) ? word.confidence : 0, box: toPdfBox(viewport, word.bbox) });
          wordCount += 1;
        }
        if (words.length) lines.push({
          text: words.map((word) => word.text).join(' '),
          confidence: Number.isFinite(line.confidence) ? line.confidence : 0,
          words,
        });
      }
    }
  }
  const text = lines.map((line) => line.text).join('\n').slice(0, MAX_RESULT_CHARACTERS);
  return {
    pageNumber,
    kindBeforeOcr,
    text: text || data.text.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, MAX_RESULT_CHARACTERS),
    confidence: Number.isFinite(data.confidence) ? data.confidence : 0,
    lines,
    bitmap: { width: Math.round(viewport.width), height: Math.round(viewport.height) },
  };
}

async function createLocalWorker(
  onEngineProgress: (stage: string, progress: number) => void,
): Promise<OcrWorker> {
  const [{ default: Tesseract }, { OEM }] = await Promise.all([
    import('tesseract.js'),
    import('tesseract.js'),
  ]);
  const assets = getOcrRuntimeAssetUrls();
  return Tesseract.createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: assets.workerPath,
    corePath: assets.corePath,
    langPath: assets.langPath,
    gzip: false,
    cacheMethod: 'none',
    workerBlobURL: true,
    logger: (message) => onEngineProgress(message.status, message.progress),
    errorHandler: (error) => console.error('[Nammu OCR worker]', error),
  });
}

export async function recognizePdfPages(
  session: PdfDocumentSession,
  options: PdfOcrOptions,
  signal?: AbortSignal,
  onProgress?: (progress: PdfOcrProgress) => void,
): Promise<readonly PdfOcrPageResult[]> {
  const pages = resolvePdfPageScope(session, { ...session.conversion.options, pageScope: options.pageScope });
  if (pages.length > MAX_OCR_PAGES) throw new Error(`OCR is limited to ${MAX_OCR_PAGES} pages per job.`);
  let worker: OcrWorker | null = null;
  const results: PdfOcrPageResult[] = [];
  let characters = 0;
  let activePage = 0;
  let examined = 0;
  const terminate = () => { if (worker) void worker.terminate(); };
  signal?.addEventListener('abort', terminate, { once: true });
  try {
    onProgress?.({ stage: 'Loading local OCR engine', completed: 0, total: pages.length });
    worker = await createLocalWorker((stage, engineProgress) => onProgress?.({ stage: `${stage} ${Math.round(engineProgress * 100)}%`, completed: examined, total: pages.length, engineProgress }));
    await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: options.quality === 'accurate' ? '216' : '144' });
    for (const pageNumber of pages) {
      activePage = pageNumber;
      if (signal?.aborted) throw new DOMException('OCR cancelled.', 'AbortError');
      const page = await session.renderDocument.getPage(pageNumber);
      try {
        const kind = await inspectPage(page);
        if (!options.force && (kind === 'text-present' || kind === 'mixed')) {
          examined += 1;
          onProgress?.({ stage: `Skipped page ${pageNumber}: text already present`, completed: examined, total: pages.length });
          continue;
        }
        const scale = options.quality === 'accurate' ? 3 : 2;
        const viewport = page.getViewport({ scale });
        const pixels = Math.ceil(viewport.width) * Math.ceil(viewport.height);
        if (pixels > MAX_RENDER_PIXELS) throw new Error(`Page ${pageNumber} exceeds the ${MAX_RENDER_PIXELS.toLocaleString()} pixel OCR limit.`);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('OCR canvas rendering is unavailable.');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        if (options.binarize) binarize(context);
        onProgress?.({ stage: `Recognizing page ${pageNumber}`, completed: results.length, total: pages.length });
        const recognized = await worker.recognize(canvas, { rotateAuto: true }, { text: true, blocks: true });
        const normalized = normalizeTesseractPage(recognized.data, pageNumber, kind, viewport);
        characters += normalized.text.length;
        if (characters > MAX_RESULT_CHARACTERS) throw new Error('OCR results exceed the bounded document text limit.');
        results.push(normalized);
        examined += 1;
        canvas.width = 1;
        canvas.height = 1;
        onProgress?.({ stage: `Recognized page ${pageNumber}`, completed: examined, total: pages.length });
      } finally {
        page.cleanup();
      }
    }
    if (signal?.aborted) throw new DOMException('OCR cancelled.', 'AbortError');
    return results;
  } catch (error) {
    if (signal?.aborted) throw new DOMException(`OCR cancelled while processing page ${activePage || 1}.`, 'AbortError');
    throw error;
  } finally {
    signal?.removeEventListener('abort', terminate);
    await worker?.terminate().catch(() => undefined);
  }
}

export async function makeSearchablePdf(
  sourceBytes: Uint8Array,
  results: readonly PdfOcrPageResult[],
  signal?: AbortSignal,
  onProgress?: (progress: PdfOcrProgress) => void,
): Promise<Uint8Array> {
  if (!results.length) throw new Error('Run OCR on at least one scanned page first.');
  const { fidelity } = await inspectPdfStructure(sourceBytes);
  if (fidelity.signatures)
    throw new Error('A searchable text layer cannot be added to a digitally signed PDF because it would invalidate the signature.');
  const pdfLib = await import('pdf-lib');
  const [{ default: fontkit }, fontResponse] = await Promise.all([
    import('@pdf-lib/fontkit'),
    fetch(getOcrRuntimeAssetUrls().fontPath, { cache: 'force-cache' }),
  ]);
  if (!fontResponse.ok) throw new Error('The bundled OCR text-layer font is unavailable.');
  const document = await pdfLib.PDFDocument.load(sourceBytes, { updateMetadata: false });
  document.registerFontkit(fontkit);
  const font = await document.embedFont(await fontResponse.arrayBuffer(), { subset: true });
  const total = results.length;
  for (let index = 0; index < results.length; index += 1) {
    if (signal?.aborted) throw new DOMException('Searchable PDF creation cancelled.', 'AbortError');
    const result = results[index];
    if (!Number.isInteger(result.pageNumber) || result.pageNumber < 1 || result.pageNumber > document.getPageCount())
      throw new Error(`OCR result references missing page ${result.pageNumber}.`);
    const page = document.getPage(result.pageNumber - 1);
    page.pushOperators(pdfLib.setTextRenderingMode(pdfLib.TextRenderingMode.Invisible));
    for (const line of result.lines) {
      for (const word of line.words) {
        const text = word.text.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '');
        if (!text.trim() || word.box.width <= 0 || word.box.height <= 0) continue;
        let size = Math.max(1, word.box.height * 0.82);
        const width = font.widthOfTextAtSize(text, size);
        if (width > word.box.width && width > 0) size *= word.box.width / width;
        page.drawText(text, { x: word.box.x, y: word.box.y, size: Math.max(0.5, size), font });
      }
    }
    page.pushOperators(pdfLib.setTextRenderingMode(pdfLib.TextRenderingMode.Fill));
    onProgress?.({ stage: `Building text layer ${index + 1} of ${total}`, completed: index + 1, total });
  }
  return document.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
}

export function mergeOcrText(
  extracted: readonly { page: number; text: string }[],
  ocr: readonly PdfOcrPageResult[],
): Array<{ page: number; text: string }> {
  const byPage = new Map(ocr.map((page) => [page.pageNumber, page.text]));
  return extracted.map((page) => ({ ...page, text: page.text.trim() || byPage.get(page.page)?.trim() || '' }));
}
