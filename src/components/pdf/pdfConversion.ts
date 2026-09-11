import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PickedPlatformFile } from '../../platform/contracts';
import type { PdfDocumentSession } from './model';
import type { PdfConversionOptions, PdfExportFormat } from './conversionModel';

const MAX_EXPORT_PAGES = 5_000;
const MAX_IMAGE_INPUTS = 1_000;
const MAX_RENDER_PIXELS = 100_000_000;

export interface PdfImageImportOptions {
  pageSize: 'original' | 'a4' | 'letter';
  orientation: 'auto' | 'portrait' | 'landscape';
  placement: 'fit' | 'fill';
  margin: 0 | 18 | 36;
}

export const DEFAULT_IMAGE_IMPORT_OPTIONS: PdfImageImportOptions = { pageSize: 'original', orientation: 'auto', placement: 'fit', margin: 0 };

export interface PdfConversionArtifact {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export type PdfConversionOutput =
  | { kind: 'single-file'; artifact: PdfConversionArtifact }
  | { kind: 'multi-file'; artifacts: readonly PdfConversionArtifact[] }
  | { kind: 'new-document'; name: string; bytes: Uint8Array };

export interface PdfConversionProgress {
  completed: number;
  total: number;
}

function cleanBaseName(name: string): string {
  return name.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*]/g, '_').split('').map((character) => character.charCodeAt(0) < 32 ? '_' : character).join('') || 'document';
}

export function resolvePdfPageScope(session: PdfDocumentSession, options: PdfConversionOptions): number[] {
  const pages = options.pageScope === 'current'
    ? [session.activePage]
    : options.pageScope === 'selected'
      ? [...session.selectedPages]
      : session.pages.map((page) => page.pageNumber);
  const normalized = [...new Set(pages)].filter((page) => Number.isInteger(page) && page >= 1 && page <= session.pages.length).sort((a, b) => a - b);
  if (!normalized.length) throw new Error('The selected page scope is empty.');
  if (normalized.length > MAX_EXPORT_PAGES) throw new Error(`A conversion is limited to ${MAX_EXPORT_PAGES.toLocaleString()} pages.`);
  return normalized;
}

function textLines(items: readonly unknown[]): string[] {
  const runs = items.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('str' in item) || typeof item.str !== 'string') return [];
    const transform = 'transform' in item && Array.isArray(item.transform) ? item.transform : [];
    return [{ text: item.str, x: Number(transform[4]) || 0, y: Number(transform[5]) || 0 }];
  });
  runs.sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);
  const lines: Array<{ y: number; words: string[] }> = [];
  for (const run of runs) {
    const line = lines.find((entry) => Math.abs(entry.y - run.y) <= 2);
    if (line) line.words.push(run.text);
    else lines.push({ y: run.y, words: [run.text] });
  }
  return lines.map((line) => line.words.join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export async function extractPdfTextPages(document: PDFDocumentProxy, pageNumbers: readonly number[]): Promise<Array<{ page: number; text: string }>> {
  const result: Array<{ page: number; text: string }> = [];
  for (const pageNumber of pageNumbers) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent({ disableNormalization: false });
    result.push({ page: pageNumber, text: textLines(content.items).join('\n') });
    page.cleanup();
  }
  return result;
}

export function serializeExtractedText(pages: readonly { page: number; text: string }[], format: 'text' | 'markdown' | 'json'): string {
  if (format === 'json') return `${JSON.stringify({ version: 1, pages }, null, 2)}\n`;
  if (format === 'markdown') return `${pages.map((page) => `## Page ${page.page}\n\n${page.text || '_No extractable text on this page._'}`).join('\n\n---\n\n')}\n`;
  return `${pages.map((page) => `--- Page ${page.page} ---\n${page.text}`).join('\n\n')}\n`;
}

async function canvasBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`${mimeType} encoding is unavailable in this runtime.`)), mimeType, quality));
}

async function renderPageArtifact(document: PDFDocumentProxy, pageNumber: number, format: 'png' | 'jpeg' | 'webp', dpi: number, quality: number, base: string): Promise<PdfConversionArtifact> {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: dpi / 72 });
  const pixels = Math.ceil(viewport.width) * Math.ceil(viewport.height);
  if (pixels > MAX_RENDER_PIXELS) throw new Error(`Page ${pageNumber} exceeds the ${MAX_RENDER_PIXELS.toLocaleString()} pixel safety limit at ${dpi} DPI.`);
  if (typeof globalThis.document === 'undefined') throw new Error('Page image export requires a browser canvas runtime.');
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d', { alpha: format !== 'jpeg' });
  if (!context) throw new Error('Canvas rendering is unavailable.');
  if (format === 'jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const mimeType = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  const blob = await canvasBlob(canvas, mimeType, format === 'png' ? undefined : quality);
  page.cleanup();
  canvas.width = 1; canvas.height = 1;
  return { name: `${base}-page-${String(pageNumber).padStart(3, '0')}.${format === 'jpeg' ? 'jpg' : format}`, mimeType, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

export async function convertPdf(session: PdfDocumentSession, options: PdfConversionOptions, signal?: AbortSignal, onProgress?: (progress: PdfConversionProgress) => void): Promise<PdfConversionOutput> {
  const pageNumbers = resolvePdfPageScope(session, options);
  const base = cleanBaseName(session.name);
  const format = options.format;
  if (format === 'text' || format === 'markdown' || format === 'json') {
    if (signal?.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
    const pages: Array<{ page: number; text: string }> = [];
    for (const pageNumber of pageNumbers) {
      if (signal?.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
      const extracted = await extractPdfTextPages(session.renderDocument, [pageNumber]);
      const ocrText = session.ocr.results.find((result) => result.pageNumber === pageNumber)?.text.trim();
      pages.push(...extracted.map((page) => ({ ...page, text: page.text.trim() || ocrText || '' })));
      onProgress?.({ completed: pages.length, total: pageNumbers.length });
    }
    const text = serializeExtractedText(pages, format);
    const extension = format === 'markdown' ? 'md' : format === 'text' ? 'txt' : 'json';
    const mimeType = format === 'markdown' ? 'text/markdown' : format === 'text' ? 'text/plain' : 'application/json';
    return { kind: 'single-file', artifact: { name: `${base}.${extension}`, mimeType: `${mimeType};charset=utf-8`, bytes: new TextEncoder().encode(text) } };
  }
  const artifacts: PdfConversionArtifact[] = [];
  for (const pageNumber of pageNumbers) {
    if (signal?.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
    artifacts.push(await renderPageArtifact(session.renderDocument, pageNumber, format, options.dpi, options.quality, base));
    onProgress?.({ completed: artifacts.length, total: pageNumbers.length });
  }
  return artifacts.length === 1 ? { kind: 'single-file', artifact: artifacts[0] } : { kind: 'multi-file', artifacts };
}

async function normalizeImage(file: PickedPlatformFile): Promise<{ bytes: Uint8Array; format: 'png' | 'jpeg'; width?: number; height?: number }> {
  const lower = file.name.toLowerCase();
  if (file.mimeType === 'image/png' || lower.endsWith('.png')) return { bytes: file.bytes, format: 'png' };
  if (file.mimeType === 'image/jpeg' || /\.jpe?g$/i.test(lower)) return { bytes: file.bytes, format: 'jpeg' };
  if (!(file.mimeType === 'image/webp' || lower.endsWith('.webp'))) throw new Error(`${file.name} is not a supported PNG, JPEG, or WebP image.`);
  const safeBytes = file.bytes.slice().buffer as ArrayBuffer;
  const bitmap = await createImageBitmap(new Blob([safeBytes], { type: 'image/webp' }));
  try {
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image conversion canvas is unavailable.');
    context.drawImage(bitmap, 0, 0);
    const blob = await canvasBlob(canvas, 'image/png');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'png', width: bitmap.width, height: bitmap.height };
  } finally { bitmap.close(); }
}

export function resolveImagePlacement(imageWidth: number, imageHeight: number, options: PdfImageImportOptions): { pageWidth: number; pageHeight: number; x: number; y: number; width: number; height: number } {
  if (!(imageWidth > 0 && imageHeight > 0)) throw new Error('Image dimensions must be positive.');
  let pageWidth: number; let pageHeight: number;
  if (options.pageSize === 'a4') [pageWidth, pageHeight] = [595.28, 841.89];
  else if (options.pageSize === 'letter') [pageWidth, pageHeight] = [612, 792];
  else [pageWidth, pageHeight] = [imageWidth + options.margin * 2, imageHeight + options.margin * 2];
  const desiredLandscape = options.orientation === 'landscape' || (options.orientation === 'auto' && imageWidth > imageHeight);
  if (desiredLandscape !== (pageWidth > pageHeight)) [pageWidth, pageHeight] = [pageHeight, pageWidth];
  const availableWidth = Math.max(1, pageWidth - options.margin * 2);
  const availableHeight = Math.max(1, pageHeight - options.margin * 2);
  const scale = options.placement === 'fill' ? Math.max(availableWidth / imageWidth, availableHeight / imageHeight) : Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
  const width = imageWidth * scale; const height = imageHeight * scale;
  return { pageWidth, pageHeight, x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

export async function createPdfFromImages(files: readonly PickedPlatformFile[], options: PdfImageImportOptions = DEFAULT_IMAGE_IMPORT_OPTIONS): Promise<PdfConversionOutput> {
  if (!files.length) throw new Error('Choose at least one image.');
  if (files.length > MAX_IMAGE_INPUTS) throw new Error(`Image import is limited to ${MAX_IMAGE_INPUTS.toLocaleString()} files.`);
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const normalized = await normalizeImage(file);
    const image = normalized.format === 'jpeg' ? await pdf.embedJpg(normalized.bytes) : await pdf.embedPng(normalized.bytes);
    const placement = resolveImagePlacement(image.width, image.height, options);
    const page = pdf.addPage([placement.pageWidth, placement.pageHeight]);
    page.drawImage(image, { x: placement.x, y: placement.y, width: placement.width, height: placement.height });
  }
  const base = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : 'Images';
  return { kind: 'new-document', name: `${cleanBaseName(base)}.pdf`, bytes: await pdf.save({ useObjectStreams: true }) };
}

export function isRasterExportFormat(format: PdfExportFormat): format is 'png' | 'jpeg' | 'webp' {
  return format === 'png' || format === 'jpeg' || format === 'webp';
}

export async function archiveConversionArtifacts(name: string, artifacts: readonly PdfConversionArtifact[]): Promise<PdfConversionArtifact> {
  if (!artifacts.length) throw new Error('There are no conversion results to archive.');
  const { zipSync } = await import('fflate');
  const entries: Record<string, Uint8Array> = {};
  for (const artifact of artifacts) {
    if (entries[artifact.name]) throw new Error(`Duplicate conversion output: ${artifact.name}`);
    entries[artifact.name] = artifact.bytes;
  }
  return { name: `${cleanBaseName(name)}-export.zip`, mimeType: 'application/zip', bytes: zipSync(entries, { level: 6 }) };
}
