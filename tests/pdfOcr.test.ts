import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { decodePDFRawStream, degrees, PDFDocument, PDFRawStream } from 'pdf-lib';
import { createPdfAnnotation } from '../src/components/pdf/pdfAnnotations';
import { createPdfFormField, inspectPdfForms } from '../src/components/pdf/pdfForms';
import { createPdfContentObject, inspectEditablePdfContent } from '../src/components/pdf/pdfContentEditing';
import { inspectPdfStructure } from '../src/components/pdf/pdfEngine';
import { DEFAULT_ANNOTATION_APPEARANCE } from '../src/components/pdf/annotationModel';
import {
  classifyOcrPage,
  getOcrRuntimeAssetUrls,
  makeSearchablePdf,
  normalizeTesseractPage,
} from '../src/components/pdf/pdfOcr';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

async function fixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([300, 400]);
  return document.save();
}

function result(text = 'SEARCHABLE') {
  return [{
    pageNumber: 1,
    kindBeforeOcr: 'image-only' as const,
    text,
    confidence: 94,
    bitmap: { width: 800, height: 1067 },
    lines: [{ text, confidence: 94, words: [{ text, confidence: 94, box: { x: 40, y: 310, width: 110, height: 18 } }] }],
  }];
}

function useBundledFont(): void {
  const bytes = readFileSync('public/ocr/fonts/LiberationSans-Regular.ttf');
  globalThis.fetch = (async () => new Response(bytes, { status: 200 })) as unknown as typeof fetch;
}

describe('Nammu PDF local OCR pipeline', () => {
  test('uses only same-origin bundled worker, core, language, and font assets', () => {
    const assets = getOcrRuntimeAssetUrls('http://127.0.0.1:41821');
    expect(Object.values(assets).every((url) => url.startsWith('http://127.0.0.1:41821/ocr/'))).toBe(true);
    expect(Object.values(assets).some((url) => /cdn|jsdelivr|unpkg/i.test(url))).toBe(false);
  });

  test('classifies digital, mixed, scanned, and unknown pages without forcing OCR', () => {
    expect(classifyOcrPage('Useful digital text', 0)).toBe('text-present');
    expect(classifyOcrPage('Useful digital text', 1)).toBe('mixed');
    expect(classifyOcrPage('', 1)).toBe('image-only');
    expect(classifyOcrPage('', 0)).toBe('unknown');
  });

  test('maps OCR pixels through the PDF.js viewport, including rotated pages', async () => {
    const document = await PDFDocument.create();
    document.addPage([300, 400]).setRotation(degrees(90));
    const bytes = await document.save();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
    const rendered = await task.promise;
    try {
      const page = await rendered.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const normalized = normalizeTesseractPage({
        text: 'Turned', confidence: 91, blocks: [{ paragraphs: [{ lines: [{ text: 'Turned', confidence: 91, bbox: { x0: 20, y0: 30, x1: 180, y1: 70 }, words: [{ text: 'Turned', confidence: 91, bbox: { x0: 20, y0: 30, x1: 180, y1: 70 } }] }] }] }],
      } as never, 1, 'image-only', viewport);
      const box = normalized.lines[0].words[0].box;
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(300);
      expect(box.y + box.height).toBeLessThanOrEqual(400);
    } finally { await rendered.destroy(); }
  });

  test('writes a persistent invisible text layer independently extractable after save/reopen', async () => {
    useBundledFont();
    const source = await fixture();
    const output = await makeSearchablePdf(source, result());
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: output.slice(), isEvalSupported: false });
    const reopened = await task.promise;
    try {
      expect(reopened.numPages).toBe(1);
      const page = await reopened.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      expect([viewport.width, viewport.height]).toEqual([300, 400]);
      const content = await page.getTextContent();
      expect(content.items.some((item) => 'str' in item && item.str.includes('SEARCHABLE'))).toBe(true);
    } finally { await reopened.destroy(); }
    const structural = await PDFDocument.load(output);
    const streams = structural.getPage(0).node.Contents();
    expect(streams).toBeTruthy();
    expect(structural.context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFRawStream && new TextDecoder('latin1').decode(decodePDFRawStream(object).decode()).includes('3 Tr'))).toBe(true);
  });

  test('preserves existing annotations and AcroForm fields in the searchable copy', async () => {
    useBundledFont();
    let source = await fixture();
    source = await createPdfFormField(source, { pageNumber: 1, type: 'text', rect: [30, 30, 170, 58] });
    source = await createPdfAnnotation(source, { pageNumber: 1, type: 'note', rect: [220, 300, 244, 324], content: 'Preserve annotation', appearance: DEFAULT_ANNOTATION_APPEARANCE });
    const before = await PDFDocument.load(source);
    const beforeAnnots = before.getPage(0).node.Annots()?.size();
    const output = await makeSearchablePdf(source, result('PRESERVED'));
    const after = await PDFDocument.load(output);
    expect((await inspectPdfForms(output)).fields).toHaveLength(1);
    expect(after.getPage(0).node.Annots()?.size()).toBe(beforeAnnots);
  });

  test('preserves authored content, metadata, and attachments without rasterizing the document', async () => {
    useBundledFont();
    const document = await PDFDocument.create();
    document.addPage([300, 400]);
    document.setTitle('Preserved OCR source');
    await document.attach(new TextEncoder().encode('attachment payload'), 'evidence.txt');
    const withContent = await createPdfContentObject(await document.save(), {
      pageNumber: 1,
      kind: 'text',
      x: 20,
      y: 30,
      text: 'Authored P5 content',
    });
    const output = await makeSearchablePdf(withContent.bytes, result('OCR LAYER'));
    const profile = await inspectPdfStructure(output);
    expect(profile.metadata.title).toBe('Preserved OCR source');
    expect(profile.fidelity.attachments).toBe(true);
    expect((await inspectEditablePdfContent(output)).some((object) => object.kind === 'text')).toBe(true);
  });

  test('fails closed for empty results, missing local font, invalid pages, and cancellation', async () => {
    const source = await fixture();
    await expect(makeSearchablePdf(source, [])).rejects.toThrow('at least one');
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    await expect(makeSearchablePdf(source, result())).rejects.toThrow('bundled OCR');
    useBundledFont();
    await expect(makeSearchablePdf(source, [{ ...result()[0], pageNumber: 2 }])).rejects.toThrow('missing page');
    const controller = new AbortController();
    controller.abort();
    await expect(makeSearchablePdf(source, result(), controller.signal)).rejects.toThrow('cancelled');
  });

  test('fails closed at the engine boundary for digitally signed documents', async () => {
    const { PDFName } = await import('pdf-lib');
    const document = await PDFDocument.create();
    document.addPage([300, 400]);
    const signature = document.context.register(document.context.obj({ FT: 'Sig', T: 'Signature1' }));
    document.catalog.set(PDFName.of('AcroForm'), document.context.obj({ Fields: [signature] }));
    useBundledFont();
    await expect(makeSearchablePdf(await document.save(), result())).rejects.toThrow('digitally signed');
  });

  test('sanitizes recognized control characters and bounds empty engine structures', async () => {
    const viewport = { width: 100, height: 100, convertToPdfPoint: (x: number, y: number) => [x, 100 - y] } as never;
    const normalized = normalizeTesseractPage({ text: 'Safe\u0000 text', confidence: 0, blocks: null } as never, 1, 'unknown', viewport);
    expect(normalized.text).toBe('Safe text');
    expect(normalized.lines).toEqual([]);
  });
});
