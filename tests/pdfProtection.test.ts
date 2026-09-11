import { describe, expect, test } from 'bun:test';
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import {
  createPdfRedactionMark,
  inspectPdfProtection,
  removePdfRedactionMark,
  replacePdfPagesWithRasters,
  sanitizePdfDocument,
} from '../src/components/pdf/pdfProtection';
import { decryptPdfDocument, encryptPdfDocument } from '../src/components/pdf/pdfCrypto';
import { createPdfAnnotation, removeAllPdfAnnotations } from '../src/components/pdf/pdfAnnotations';
import { DEFAULT_ANNOTATION_APPEARANCE } from '../src/components/pdf/annotationModel';

async function fixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 400]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('CONFIDENTIAL account 8842', { x: 30, y: 300, font, size: 14 });
  document.setTitle('Secret title');
  document.setAuthor('Private author');
  document.catalog.set(PDFName.of('Metadata'), document.context.register(document.context.flateStream(new TextEncoder().encode('<x:xmpmeta>PRIVATE-XMP</x:xmpmeta>'), { Type: 'Metadata', Subtype: 'XML' })));
  const jsAction = document.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("unsafe")') });
  document.catalog.set(PDFName.of('OpenAction'), document.context.register(jsAction));
  const names = document.context.obj({ JavaScript: { Names: [PDFString.of('script'), document.context.register(jsAction)] } });
  document.catalog.set(PDFName.of('Names'), names);
  return new Uint8Array(await document.save({ useObjectStreams: false }));
}

describe('PDF Protect engine', () => {
  test('creates, independently discovers, and removes a real /Redact annotation', async () => {
    const source = await fixture();
    const marked = await createPdfRedactionMark(source, {
      pageNumber: 1,
      rect: [25, 290, 230, 315],
      quadPoints: [25, 315, 230, 315, 25, 290, 230, 290],
      reason: 'Account number',
    });
    const inspection = await inspectPdfProtection(marked);
    expect(inspection.redactions).toHaveLength(1);
    expect(inspection.redactions[0].reason).toBe('Account number');
    const parsed = await PDFDocument.load(marked, { updateMetadata: false });
    const annot = parsed.context.lookup(parsed.getPage(0).node.Annots()!.get(0));
    expect(annot?.toString()).toContain('/Subtype /Redact');

    const removed = await removePdfRedactionMark(marked, inspection.redactions[0].nativeRef);
    expect((await inspectPdfProtection(removed)).redactions).toHaveLength(0);
  });

  test('keeps pending /Redact marks outside ordinary comment removal', async () => {
    const source = await fixture();
    const marked = await createPdfRedactionMark(source, { pageNumber: 1, rect: [25, 290, 230, 315] });
    const commented = await createPdfAnnotation(marked, {
      pageNumber: 1,
      type: 'note',
      rect: [20, 20, 44, 44],
      content: 'review',
      appearance: DEFAULT_ANNOTATION_APPEARANCE,
    });
    const cleaned = await removeAllPdfAnnotations(commented);
    const inspection = await inspectPdfProtection(cleaned);
    expect(inspection.redactions).toHaveLength(1);
    expect(inspection.inspection.annotationCount).toBe(1);
  });

  test('raster replacement removes the affected page content from independent text extraction', async () => {
    const source = await fixture();
    const onePixelPng = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZcXcAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const output = await replacePdfPagesWithRasters(source, new Map([[1, onePixelPng]]));
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: output.slice(), isEvalSupported: false });
    const rendered = await task.promise;
    try {
      const text = await (await rendered.getPage(1)).getTextContent();
      expect(text.items.some((item) => 'str' in item && item.str.includes('CONFIDENTIAL'))).toBe(false);
    } finally {
      await rendered.destroy();
    }
  });

  test('sanitizes metadata, XMP, JavaScript and active actions transactionally', async () => {
    const source = await fixture();
    const before = await inspectPdfProtection(source);
    expect(before.inspection.metadata || before.inspection.xmpMetadata).toBe(true);
    expect(before.inspection.javascript || before.inspection.activeActions).toBe(true);
    const output = await sanitizePdfDocument(source, {
      metadata: true,
      javascriptAndActions: true,
      attachments: false,
    });
    const after = await inspectPdfProtection(output);
    expect(after.inspection.metadata).toBe(false);
    expect(after.inspection.xmpMetadata).toBe(false);
    expect(after.inspection.javascript).toBe(false);
    expect(after.inspection.activeActions).toBe(false);
    expect(new TextDecoder().decode(output)).not.toContain('PRIVATE-XMP');
  });

  test('removes attachment references and detached embedded payload objects', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    await document.attach(new TextEncoder().encode('NAMMU ATTACHMENT PAYLOAD'), 'private.txt');
    const source = new Uint8Array(await document.save({ useObjectStreams: false }));
    expect((await inspectPdfProtection(source)).inspection.attachments).toBe(true);
    const output = await sanitizePdfDocument(source, {
      metadata: false,
      javascriptAndActions: false,
      attachments: true,
    });
    expect((await inspectPdfProtection(output)).inspection.attachments).toBe(false);
    const parsed = await PDFDocument.load(output, { updateMetadata: false });
    const embedded = parsed.context.enumerateIndirectObjects().filter(([, object]) => {
      if (!object || typeof object !== 'object' || !('dict' in object)) return false;
      const dictionary = (object as { dict: import('pdf-lib').PDFDict }).dict;
      return dictionary.get(PDFName.of('Subtype'))?.toString() === '/EmbeddedFile';
    });
    expect(embedded).toHaveLength(0);
  });

  test('rejects invalid redaction geometry and empty sanitization requests', async () => {
    const source = await fixture();
    await expect(createPdfRedactionMark(source, { pageNumber: 1, rect: [2, 2, 2, 2] })).rejects.toThrow('too small');
    await expect(sanitizePdfDocument(source, { metadata: false, javascriptAndActions: false, attachments: false })).rejects.toThrow('Select at least one');
  });

  test('fails closed for signed PDFs', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const field = document.context.obj({ FT: 'Sig', T: PDFHexString.fromText('Approval') });
    document.context.register(field);
    const bytes = new Uint8Array(await document.save({ useObjectStreams: false }));
    await expect(createPdfRedactionMark(bytes, { pageNumber: 1, rect: [10, 10, 30, 30] })).rejects.toThrow('signed');
    await expect(sanitizePdfDocument(bytes, { metadata: true, javascriptAndActions: false, attachments: false })).rejects.toThrow('signed');
  });

  test('creates real AES-256 encrypted output and requires the correct password', async () => {
    const source = await fixture();
    const encrypted = await encryptPdfDocument(source, {
      userPassword: 'open-8842',
      ownerPassword: 'owner-8842',
      permissions: { printing: 'low', extract: false, modify: 'annotate' },
    });
    const raw = new TextDecoder('latin1').decode(encrypted);
    expect(raw).toContain('/Encrypt');
    expect(raw).toMatch(/\/R\s+[56]/);
    expect(raw).toContain('/Length 256');
    await expect(PDFDocument.load(encrypted, { updateMetadata: false })).rejects.toThrow();
    await expect(decryptPdfDocument(encrypted, 'wrong-password')).rejects.toThrow(
      'security operation failed',
    );
    const decrypted = await decryptPdfDocument(encrypted, 'open-8842');
    const reopened = await PDFDocument.load(decrypted, { updateMetadata: false });
    expect(reopened.getPageCount()).toBe(1);
    expect(new TextDecoder('latin1').decode(decrypted)).not.toContain('/Encrypt');
  });

  test('rejects empty or malformed passwords before invoking qpdf', async () => {
    const source = await fixture();
    await expect(encryptPdfDocument(source, {
      userPassword: '', ownerPassword: '', permissions: { printing: 'full', extract: true, modify: 'all' },
    })).rejects.toThrow('Enter');
    await expect(encryptPdfDocument(source, {
      userPassword: 'ok', ownerPassword: `owner\0bad`, permissions: { printing: 'full', extract: true, modify: 'all' },
    })).rejects.toThrow('unsupported');
  });
});
