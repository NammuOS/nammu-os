import { describe, expect, test } from 'bun:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { unzipSync } from 'fflate';
import {
  archiveConversionArtifacts,
  convertPdf,
  createPdfFromImages,
  extractPdfTextPages,
  resolvePdfPageScope,
  serializeExtractedText,
  resolveImagePlacement,
} from '../src/components/pdf/pdfConversion';
import type { PdfDocumentSession } from '../src/components/pdf/model';

async function textFixture(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([300, 400]).drawText('Nammu conversion page one', { x: 30, y: 330, size: 14, font });
  pdf.addPage([300, 400]).drawText('Second export page', { x: 30, y: 330, size: 14, font });
  return pdf.save();
}

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZcXcAAAAASUVORK5CYII=', 'base64'));
const jpeg = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64'));

describe('Nammu PDF conversion service', () => {
  test('reuses the authoritative page selection for all/current/selected scope', () => {
    const session = { activePage: 2, selectedPages: [3, 1], pages: [{ pageNumber: 1 }, { pageNumber: 2 }, { pageNumber: 3 }] } as unknown as PdfDocumentSession;
    const base = { format: 'png' as const, dpi: 144 as const, quality: 0.9 };
    expect(resolvePdfPageScope(session, { ...base, pageScope: 'all' })).toEqual([1, 2, 3]);
    expect(resolvePdfPageScope(session, { ...base, pageScope: 'current' })).toEqual([2]);
    expect(resolvePdfPageScope(session, { ...base, pageScope: 'selected' })).toEqual([1, 3]);
  });

  test('extracts deterministic page text and emits honest text, Markdown, and JSON artifacts', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: (await textFixture()).slice(), isEvalSupported: false });
    const document = await task.promise;
    try {
      const pages = await extractPdfTextPages(document, [1, 2]);
      expect(pages[0].text).toContain('Nammu conversion page one');
      expect(serializeExtractedText(pages, 'text')).toContain('--- Page 2 ---');
      expect(serializeExtractedText(pages, 'markdown')).toContain('## Page 1');
      expect(JSON.parse(serializeExtractedText(pages, 'json')).pages).toHaveLength(2);
    } finally { await document.destroy(); }
  });

  test('uses explicit OCR results for P7 Text and best-effort Markdown when a scanned page has no text layer', async () => {
    const session = {
      name: 'scan.pdf',
      activePage: 1,
      selectedPages: [1],
      pages: [{ pageNumber: 1 }],
      renderDocument: {
        getPage: async () => ({ getTextContent: async () => ({ items: [] }), cleanup: () => undefined }),
      },
      ocr: { results: [{ pageNumber: 1, text: 'Recognized scanned sentence' }] },
    } as unknown as PdfDocumentSession;
    const options = { format: 'text' as const, pageScope: 'all' as const, dpi: 144 as const, quality: 0.9 };
    const textOutput = await convertPdf(session, options);
    const markdownOutput = await convertPdf(session, { ...options, format: 'markdown' });
    expect(textOutput.kind).toBe('single-file');
    expect(markdownOutput.kind).toBe('single-file');
    if (textOutput.kind !== 'single-file' || markdownOutput.kind !== 'single-file') return;
    expect(new TextDecoder().decode(textOutput.artifact.bytes)).toContain('Recognized scanned sentence');
    expect(new TextDecoder().decode(markdownOutput.artifact.bytes)).toContain('Recognized scanned sentence');
  });

  test('creates a real ordered PDF from PNG and JPEG inputs and independently reopens it', async () => {
    const output = await createPdfFromImages([
      { name: 'first.png', mimeType: 'image/png', size: png.length, bytes: png },
      { name: 'second.jpg', mimeType: 'image/jpeg', size: jpeg.length, bytes: jpeg },
    ]);
    expect(output.kind).toBe('new-document');
    if (output.kind !== 'new-document') return;
    const reopened = await PDFDocument.load(output.bytes);
    expect(reopened.getPageCount()).toBe(2);
    expect(reopened.getPage(0).getWidth()).toBe(1);
    expect(reopened.getPage(1).getWidth()).toBe(1);
  });

  test('applies real page-size, orientation, fit/fill, and margin geometry', () => {
    const fitted = resolveImagePlacement(1600, 900, { pageSize: 'a4', orientation: 'landscape', placement: 'fit', margin: 36 });
    expect(fitted.pageWidth).toBeGreaterThan(fitted.pageHeight);
    expect(fitted.width).toBeLessThanOrEqual(fitted.pageWidth - 72);
    expect(fitted.height).toBeLessThanOrEqual(fitted.pageHeight - 72);
    const filled = resolveImagePlacement(1600, 900, { pageSize: 'a4', orientation: 'portrait', placement: 'fill', margin: 0 });
    expect(filled.pageHeight).toBeGreaterThan(filled.pageWidth);
    expect(filled.width >= filled.pageWidth || filled.height >= filled.pageHeight).toBe(true);
  });

  test('packages multi-file outputs into a deterministic ZIP without duplicate names', async () => {
    const archive = await archiveConversionArtifacts('sample.pdf', [
      { name: 'sample-page-001.png', mimeType: 'image/png', bytes: png },
      { name: 'sample-page-002.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('page two') },
    ]);
    const entries = unzipSync(archive.bytes);
    expect(Object.keys(entries).sort()).toEqual(['sample-page-001.png', 'sample-page-002.txt']);
    expect(new TextDecoder().decode(entries['sample-page-002.txt'])).toBe('page two');
    await expect(archiveConversionArtifacts('x', [{ name: 'same', mimeType: 'x', bytes: png }, { name: 'same', mimeType: 'x', bytes: png }])).rejects.toThrow('Duplicate');
  });

  test('rejects empty image jobs and unsupported formats', async () => {
    await expect(createPdfFromImages([])).rejects.toThrow('at least one');
    await expect(createPdfFromImages([{ name: 'unsafe.svg', mimeType: 'image/svg+xml', size: 4, bytes: new Uint8Array(4) }])).rejects.toThrow('not a supported');
  });
});
