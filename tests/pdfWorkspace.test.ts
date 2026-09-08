import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { PDF_COMMANDS, PDF_MENU_ORDER, commandsForMenu } from '../src/components/pdf/pdfCommands';
import {
  deletePdfPages,
  deletePdfPage,
  duplicatePdfPages,
  extractPdfPages,
  inspectPdfStructure,
  insertPdfPages,
  reorderPdfPages,
  rotatePdfPages,
  rotatePdfPage,
} from '../src/components/pdf/pdfEngine';
import type { PdfCommandContext } from '../src/components/pdf/pdfCommands';
import {
  buildPdfPageOrder,
  remapSelectedPages,
  selectAllPdfPages,
  selectPdfPage,
} from '../src/components/pdf/pageSelection';
import { appendPdfHistory, transitionPdfHistory } from '../src/components/pdf/pdfHistory';
import { registerWindowCloseGuard, requestManagedWindowClose } from '../src/lib/windowCloseGuards';
import { DEFAULT_ANNOTATION_APPEARANCE } from '../src/components/pdf/annotationModel';
import {
  createPdfAnnotation,
  deletePdfAnnotation,
  normalizePdfJsAnnotation,
  readPdfAnnotations,
  removeAllPdfAnnotations,
  updatePdfAnnotation,
} from '../src/components/pdf/pdfAnnotations';
import { buildPdfTextSelection } from '../src/components/pdf/annotationGeometry';
import {
  createPdfFormField,
  deletePdfFormField,
  duplicatePdfFormField,
  inspectPdfForms,
  updatePdfFormField,
} from '../src/components/pdf/pdfForms';

async function fixture(pageCount: number): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([600 + index, 800 + index]);
  }
  return new Uint8Array(await document.save());
}

async function inspect(bytes: Uint8Array) {
  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.load(bytes);
  return {
    pages: document.getPageCount(),
    rotations: document.getPages().map((page) => page.getRotation().angle),
  };
}

describe('Nammu PDF workspace foundation', () => {
  test('keeps menu actions backed by one unique command registry', () => {
    expect(PDF_MENU_ORDER.map((menu) => menu.id)).toEqual([
      'file',
      'edit',
      'view',
      'document',
      'comment',
      'forms',
      'tools',
      'help',
    ]);
    expect(new Set(PDF_COMMANDS.map((command) => command.id)).size).toBe(PDF_COMMANDS.length);
    for (const menu of PDF_MENU_ORDER) {
      expect(commandsForMenu(menu.id).every((command) => command.menu === menu.id)).toBe(true);
    }
  });

  test('does not enable document transforms without an active session', () => {
    const context = { session: null, busy: false, actions: {} } as PdfCommandContext;
    expect(
      PDF_COMMANDS.filter((command) => command.id.startsWith('document.')).every(
        (command) => !command.enabled(context),
      ),
    ).toBe(true);
  });

  test('rotates, deletes, extracts and inserts pages through the engine boundary', async () => {
    const source = await fixture(3);
    const rotated = await rotatePdfPage(source, 2, 90);
    expect((await inspect(rotated)).rotations).toEqual([0, 90, 0]);

    const deleted = await deletePdfPage(rotated, 1);
    expect(await inspect(deleted)).toEqual({ pages: 2, rotations: [90, 0] });

    const extracted = await extractPdfPages(source, [3, 1, 3]);
    expect((await inspect(extracted)).pages).toBe(2);

    const inserted = await insertPdfPages(deleted, extracted, 1);
    expect((await inspect(inserted)).pages).toBe(4);
  });

  test('rejects unsafe page operations instead of corrupting the document', async () => {
    const onePage = await fixture(1);
    await expect(deletePdfPage(onePage, 1)).rejects.toThrow('retain at least one page');
    await expect(rotatePdfPage(onePage, 2, 90)).rejects.toThrow('no longer exists');
    await expect(extractPdfPages(onePage, [])).rejects.toThrow('Select at least one');
    await expect(deletePdfPages(await fixture(3), [1, 2, 3])).rejects.toThrow(
      'retain at least one page',
    );
  });

  test('owns additive, range and select-all page selection in one model', () => {
    const initial = { activePage: 2, selectedPages: [2], selectionAnchor: 2 };
    const additive = selectPdfPage(initial, 5, 8, { additive: true });
    expect(additive).toEqual({ activePage: 5, selectedPages: [2, 5], selectionAnchor: 5 });
    const range = selectPdfPage(additive, 7, 8, { range: true });
    expect(range).toEqual({ activePage: 7, selectedPages: [5, 6, 7], selectionAnchor: 5 });
    expect(selectAllPdfPages(4).selectedPages).toEqual([1, 2, 3, 4]);
  });

  test('builds stable block moves without duplication and remaps the selection', () => {
    const order = buildPdfPageOrder(6, [2, 3], 5, 'after');
    expect(order).toEqual([1, 4, 5, 2, 3, 6]);
    expect(remapSelectedPages(order!, [2, 3])).toEqual([4, 5]);
    expect(buildPdfPageOrder(4, [2, 3], 3, 'after')).toBeNull();
  });

  test('reorders, rotates, duplicates and deletes multi-page selections', async () => {
    const source = await fixture(5);
    const reordered = await reorderPdfPages(source, [1, 4, 5, 2, 3]);
    const { PDFDocument } = await import('pdf-lib');
    const reorderedDoc = await PDFDocument.load(reordered);
    expect(reorderedDoc.getPages().map((page) => page.getWidth())).toEqual([
      600, 603, 604, 601, 602,
    ]);

    const rotated = await rotatePdfPages(reordered, [2, 4], -90);
    expect((await inspect(rotated)).rotations).toEqual([0, 270, 0, 270, 0]);

    const duplicated = await duplicatePdfPages(source, [2, 3]);
    const duplicatedDoc = await PDFDocument.load(duplicated);
    expect(duplicatedDoc.getPages().map((page) => page.getWidth())).toEqual([
      600, 601, 602, 601, 602, 603, 604,
    ]);

    const deleted = await deletePdfPages(duplicated, [2, 5]);
    expect((await inspect(deleted)).pages).toBe(5);
  });

  test('inserts before and after the selected location deterministically', async () => {
    const source = await fixture(3);
    const extra = await fixture(2);
    const { PDFDocument } = await import('pdf-lib');
    const before = await PDFDocument.load(await insertPdfPages(source, extra, 2, 'before'));
    expect(before.getPages().map((page) => page.getWidth())).toEqual([600, 600, 601, 601, 602]);
    const after = await PDFDocument.load(await insertPdfPages(source, extra, 2, 'after'));
    expect(after.getPages().map((page) => page.getWidth())).toEqual([600, 601, 600, 601, 602]);
  });

  test('extracts selected pages without changing the source document', async () => {
    const source = await fixture(4);
    const extracted = await extractPdfPages(source, [2, 4]);
    expect((await inspect(source)).pages).toBe(4);
    expect((await inspect(extracted)).pages).toBe(2);
  });

  test('keeps bounded transform history usable for undo and redo', () => {
    const original = new Uint8Array([1]);
    const changed = new Uint8Array([2]);
    const past = appendPdfHistory([], { label: 'Rotate selected pages', bytes: original });
    const undo = transitionPdfHistory({ past, future: [] }, changed, 'undo');
    expect([...undo!.snapshot.bytes]).toEqual([1]);
    const redo = transitionPdfHistory(undo!.history, original, 'redo');
    expect([...redo!.snapshot.bytes]).toEqual([2]);
  });

  test('detects form fidelity risk before structural operations', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const document = await PDFDocument.create();
    const page = document.addPage();
    const field = document.getForm().createTextField('name');
    field.addToPage(page, { x: 20, y: 20, width: 100, height: 20 });
    const profile = (await inspectPdfStructure(new Uint8Array(await document.save()))).fidelity;
    expect(profile.forms).toBe(true);
    expect(profile.warnings.some((warning) => warning.includes('forms'))).toBe(true);
  });

  test('allows or cancels a managed host-window close through a scoped guard', async () => {
    const calls: string[] = [];
    const unregister = registerWindowCloseGuard('pdf-test', () => false);
    expect(await requestManagedWindowClose('pdf-test', () => calls.push('closed'))).toBe(false);
    expect(calls).toEqual([]);
    unregister();
    expect(await requestManagedWindowClose('pdf-test', () => calls.push('closed'))).toBe(true);
    expect(calls).toEqual(['closed']);
  });

  test('keeps a guarded window alive until an asynchronous dirty decision resolves', async () => {
    let decide: ((allow: boolean) => void) | null = null;
    const unregister = registerWindowCloseGuard(
      'pdf-dirty-test',
      () => new Promise<boolean>((resolve) => (decide = resolve)),
    );
    let closed = false;
    const request = requestManagedWindowClose('pdf-dirty-test', () => {
      closed = true;
    });
    expect(closed).toBe(false);
    decide!(false);
    expect(await request).toBe(false);
    expect(closed).toBe(false);
    unregister();
  });

  test('accounts for every BentoPDF capability page in the permanent migration ledger', () => {
    const ledger = readFileSync('docs/nammu-pdf-capability-migration.md', 'utf8');
    const recorded = [...ledger.matchAll(/`src\/pages\/([^`]+\.html)`/g)].map((match) => match[1]);
    const donor = readdirSync('bentopdf/src/pages')
      .filter((name) => name.endsWith('.html'))
      .sort();
    expect(donor).toHaveLength(125);
    expect(new Set(recorded).size).toBe(125);
    expect([...new Set(recorded)].sort()).toEqual(donor);
  });
});

describe('Nammu PDF interoperable AcroForm adapter', () => {
  async function emptyFormFixture() {
    return fixture(2);
  }

  async function pdfJsWidgets(bytes: Uint8Array) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
    const document = await task.promise;
    try {
      const pages = await Promise.all(
        Array.from({ length: document.numPages }, (_, index) =>
          document.getPage(index + 1).then((page) => page.getAnnotations({ intent: 'display' })),
        ),
      );
      return pages.flat().filter((annotation) => annotation.subtype === 'Widget');
    } finally {
      await document.destroy();
    }
  }

  test('creates five real AcroForm field types and preserves radio group widgets', async () => {
    let bytes = await emptyFormFixture();
    bytes = await createPdfFormField(bytes, {
      pageNumber: 1,
      type: 'text',
      rect: [40, 700, 240, 730],
    });
    bytes = await createPdfFormField(bytes, {
      pageNumber: 1,
      type: 'checkbox',
      rect: [40, 650, 60, 670],
    });
    bytes = await createPdfFormField(bytes, {
      pageNumber: 1,
      type: 'radio',
      rect: [80, 640, 140, 660],
    });
    bytes = await createPdfFormField(bytes, {
      pageNumber: 2,
      type: 'dropdown',
      rect: [40, 700, 240, 730],
    });
    bytes = await createPdfFormField(bytes, {
      pageNumber: 2,
      type: 'listbox',
      rect: [40, 600, 240, 680],
    });

    const model = await inspectPdfForms(bytes);
    expect(model.kind).toBe('acroform');
    expect(model.fields.map((field) => field.type)).toEqual([
      'text',
      'checkbox',
      'radio',
      'dropdown',
      'listbox',
    ]);
    expect(model.fields.find((field) => field.type === 'radio')?.widgets).toHaveLength(2);
    expect(model.fields.find((field) => field.type === 'radio')?.options).toEqual([
      'Option 1',
      'Option 2',
    ]);

    const independent = await pdfJsWidgets(bytes);
    expect(independent).toHaveLength(6);
    expect(new Set(independent.map((widget) => widget.fieldType))).toEqual(
      new Set(['Tx', 'Btn', 'Ch']),
    );
  }, 20_000);

  test('fills values and persists field properties through save and independent reload', async () => {
    let bytes = await emptyFormFixture();
    bytes = await createPdfFormField(bytes, {
      pageNumber: 1,
      type: 'text',
      name: 'CustomerName',
      rect: [50, 700, 260, 730],
    });
    bytes = await createPdfFormField(bytes, {
      pageNumber: 1,
      type: 'checkbox',
      name: 'Approved',
      rect: [50, 650, 72, 672],
    });
    bytes = await createPdfFormField(bytes, {
      pageNumber: 1,
      type: 'dropdown',
      name: 'Country',
      rect: [50, 600, 240, 630],
    });
    let model = await inspectPdfForms(bytes);
    const text = model.fields.find((field) => field.name === 'CustomerName')!;
    const checkbox = model.fields.find((field) => field.name === 'Approved')!;
    const dropdown = model.fields.find((field) => field.name === 'Country')!;
    bytes = await updatePdfFormField(bytes, text.id, {
      value: '<b>Navneet</b>\u0000',
      required: true,
      multiline: true,
      maxLength: 200,
      alignment: 'center',
      tooltip: 'Customer name',
      widgetId: text.widgets[0].id,
      rect: [70, 680, 300, 720],
    });
    bytes = await updatePdfFormField(bytes, checkbox.id, { value: true });
    bytes = await updatePdfFormField(bytes, dropdown.id, {
      options: ['India', 'Japan', 'Germany'],
      value: 'India',
    });
    model = await inspectPdfForms(bytes);
    const reloaded = model.fields.find((field) => field.name === 'CustomerName')!;
    expect(reloaded.value).toBe('<b>Navneet</b>');
    expect(reloaded.required).toBe(true);
    expect(reloaded.multiline).toBe(true);
    expect(reloaded.maxLength).toBe(200);
    expect(reloaded.alignment).toBe('center');
    expect(reloaded.tooltip).toBe('Customer name');
    expect(reloaded.widgets[0].rect[0]).toBeCloseTo(70, 0);
    expect(model.fields.find((field) => field.name === 'Approved')?.value).toBe(true);
    expect(model.fields.find((field) => field.name === 'Country')?.options).toEqual([
      'India',
      'Japan',
      'Germany',
    ]);
    const independent = await pdfJsWidgets(bytes);
    expect(independent.find((widget) => widget.fieldName === 'CustomerName')?.fieldValue).toBe(
      '<b>Navneet</b>',
    );
  }, 20_000);

  test('duplicates and deletes through the same document operation boundary', async () => {
    let bytes = await emptyFormFixture();
    bytes = await createPdfFormField(bytes, {
      pageNumber: 1,
      type: 'text',
      name: 'Reference',
      rect: [40, 700, 220, 730],
    });
    const source = (await inspectPdfForms(bytes)).fields[0];
    bytes = await duplicatePdfFormField(bytes, source.id);
    let fields = (await inspectPdfForms(bytes)).fields;
    expect(fields.map((field) => field.name)).toEqual(['Reference', 'Reference Copy']);
    bytes = await duplicatePdfFormField(bytes, source.id);
    fields = (await inspectPdfForms(bytes)).fields;
    expect(fields.map((field) => field.name)).toEqual([
      'Reference',
      'Reference Copy',
      'Reference Copy 2',
    ]);
    bytes = await deletePdfFormField(bytes, source.id);
    expect((await inspectPdfForms(bytes)).fields.map((field) => field.name)).toEqual([
      'Reference Copy',
      'Reference Copy 2',
    ]);
  });

  test('renames a field without breaking its inherited field hierarchy', async () => {
    const pdf = await import('pdf-lib');
    const source = await pdf.PDFDocument.create();
    const page = source.addPage([600, 800]);
    source.getForm().createTextField('Customer.Name').addToPage(page, {
      x: 40,
      y: 700,
      width: 180,
      height: 30,
    });
    let bytes: Uint8Array = new Uint8Array(await source.save());
    const field = (await inspectPdfForms(bytes)).fields[0];
    bytes = await updatePdfFormField(bytes, field.id, { name: 'Customer.FullName' });
    expect((await inspectPdfForms(bytes)).fields[0].name).toBe('Customer.FullName');
    await expect(
      updatePdfFormField(bytes, (await inspectPdfForms(bytes)).fields[0].id, {
        name: 'Other.FullName',
      }),
    ).rejects.toThrow('field hierarchies');
  });

  test('preserves XFA and action-bearing fields without executing or editing them', async () => {
    const pdf = await import('pdf-lib');
    const xfa = await pdf.PDFDocument.create();
    const page = xfa.addPage();
    const xfaField = xfa.getForm().createTextField('Legacy');
    xfaField.addToPage(page, { x: 20, y: 20, width: 100, height: 20 });
    const baseXfaBytes = new Uint8Array(await xfa.save());
    const xfaContainer = await pdf.PDFDocument.load(baseXfaBytes);
    const acroForm = xfaContainer.catalog.lookup(pdf.PDFName.of('AcroForm'));
    if (!(acroForm instanceof pdf.PDFDict)) throw new Error('AcroForm fixture was not created.');
    acroForm.set(pdf.PDFName.of('XFA'), xfaContainer.context.obj(['template', 'safe']));
    const xfaBytes = new Uint8Array(await xfaContainer.save());
    const xfaModel = await inspectPdfForms(xfaBytes);
    expect(xfaModel.kind).toBe('hybrid');
    expect(xfaModel.editable).toBe(false);
    await expect(
      updatePdfFormField(xfaBytes, xfaModel.fields[0].id, { value: 'blocked' }),
    ).rejects.toThrow('XFA');

    const action = await pdf.PDFDocument.create();
    const actionPage = action.addPage();
    const actionField = action.getForm().createTextField('Calculated');
    actionField.addToPage(actionPage, { x: 20, y: 20, width: 100, height: 20 });
    actionField.acroField.dict.set(
      pdf.PDFName.of('AA'),
      action.context.obj({ K: { S: 'JavaScript', JS: 'app.alert(1)' } }),
    );
    const actionBytes = new Uint8Array(await action.save());
    const actionModel = await inspectPdfForms(actionBytes);
    expect(actionModel.fields[0].hasActions).toBe(true);
    expect(actionModel.fields[0].editable).toBe(false);
    await expect(
      updatePdfFormField(actionBytes, actionModel.fields[0].id, { value: 'blocked' }),
    ).rejects.toThrow('read-only');
  });

  test('fails closed for signed documents at the engine boundary', async () => {
    const pdf = await import('pdf-lib');
    const document = await pdf.PDFDocument.create();
    document.addPage();
    document.context.register(document.context.obj({ FT: 'Sig', T: 'ExistingSignature' }));
    const bytes = new Uint8Array(await document.save());
    await expect(
      createPdfFormField(bytes, { pageNumber: 1, type: 'text', rect: [20, 20, 140, 45] }),
    ).rejects.toThrow('signed PDFs');
  });

  test('registers every Forms action once and denies creation without a mutable document', () => {
    const formCommands = PDF_COMMANDS.filter((command) => command.id.startsWith('forms.'));
    expect(formCommands.length).toBeGreaterThanOrEqual(12);
    expect(new Set(formCommands.map((command) => command.id)).size).toBe(formCommands.length);
    const context = { session: null, busy: false, actions: {} } as PdfCommandContext;
    expect(
      formCommands
        .filter((command) =>
          [
            'forms.text',
            'forms.checkbox',
            'forms.radio',
            'forms.dropdown',
            'forms.listbox',
          ].includes(command.id),
        )
        .every((command) => !command.enabled(context)),
    ).toBe(true);
  });
});

describe('Nammu PDF real annotation adapter', () => {
  const style = { ...DEFAULT_ANNOTATION_APPEARANCE, color: '#ffcc22' };

  async function pdfJsAnnotations(bytes: Uint8Array) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
    const document = await task.promise;
    try {
      const annotations = await readPdfAnnotations(document);
      const raw = await (await document.getPage(1)).getAnnotations({ intent: 'display' });
      return { annotations, raw };
    } finally {
      await document.destroy();
    }
  }

  test('serializes multi-line text markup as interoperable PDF annotations', async () => {
    const source = await fixture(1);
    const quadPoints = [40, 740, 220, 740, 40, 724, 220, 724, 40, 718, 160, 718, 40, 702, 160, 702];
    let bytes = await createPdfAnnotation(source, {
      pageNumber: 1,
      type: 'highlight',
      rect: [40, 702, 220, 740],
      quadPoints,
      content: 'Two lines',
      appearance: style,
    });
    bytes = await createPdfAnnotation(bytes, {
      pageNumber: 1,
      type: 'underline',
      rect: [40, 670, 220, 690],
      quadPoints: [40, 690, 220, 690, 40, 670, 220, 670],
      appearance: style,
    });
    bytes = await createPdfAnnotation(bytes, {
      pageNumber: 1,
      type: 'strikeout',
      rect: [40, 640, 220, 660],
      quadPoints: [40, 660, 220, 660, 40, 640, 220, 640],
      appearance: style,
    });
    const { annotations, raw } = await pdfJsAnnotations(bytes);
    expect(annotations.map((annotation) => annotation.type)).toEqual([
      'highlight',
      'underline',
      'strikeout',
    ]);
    expect(annotations[0].quadPoints).toHaveLength(16);
    expect(raw.every((annotation) => Boolean(annotation.hasAppearance))).toBe(true);
  }, 15_000);

  test('converts multi-line viewport selection into canonical PDF quad geometry', () => {
    const selection = buildPdfTextSelection(
      2,
      'First line\nSecond line',
      [
        { left: 10, right: 110, top: 20, bottom: 35 },
        { left: 10, right: 85, top: 40, bottom: 55 },
      ],
      (x, y) => [x, 800 - y],
    );
    expect(selection?.quadPoints).toEqual([
      10, 780, 110, 780, 10, 765, 110, 765, 10, 760, 85, 760, 10, 745, 85, 745,
    ]);
    expect(selection?.rect).toEqual([10, 745, 110, 780]);
  });

  test('normalizes malformed and untrusted annotation metadata without HTML execution', () => {
    const annotation = normalizePdfJsAnnotation(
      {
        id: '12R',
        subtype: 'Text',
        rect: { invalid: true },
        contentsObj: { str: '<img src=x onerror=alert(1)>\u0000unsafe' },
        titleObj: { str: '<script>author</script>' },
        opacity: Number.POSITIVE_INFINITY,
        color: [999, -4, Number.NaN],
        borderStyle: { width: 99_999 },
      },
      1,
    );
    expect(annotation.rect).toEqual([0, 0, 1, 1]);
    expect(annotation.content).toBe('<img src=x onerror=alert(1)>unsafe');
    expect(annotation.author).toBe('<script>author</script>');
    expect(annotation.appearance.strokeWidth).toBe(24);
    expect(annotation.nativeRef).toBe('12R');
  });

  test('persists notes, free text, ink and shared shape semantics across reload', async () => {
    let bytes = await fixture(1);
    bytes = await createPdfAnnotation(bytes, {
      pageNumber: 1,
      type: 'note',
      rect: [35, 710, 59, 734],
      content: 'Review this safely',
      author: 'Nammu Reviewer',
      appearance: style,
    });
    bytes = await createPdfAnnotation(bytes, {
      pageNumber: 1,
      type: 'freeText',
      rect: [70, 650, 250, 700],
      content: 'Actual PDF text box',
      appearance: { ...style, fontSize: 14 },
    });
    bytes = await createPdfAnnotation(bytes, {
      pageNumber: 1,
      type: 'ink',
      rect: [40, 580, 180, 630],
      inkPaths: [
        [
          [45, 590],
          [90, 625],
          [175, 595],
        ],
      ],
      appearance: { ...style, color: '#2f8fff', opacity: 0.8 },
    });
    for (const [type, y] of [
      ['line', 540],
      ['arrow', 500],
    ] as const) {
      bytes = await createPdfAnnotation(bytes, {
        pageNumber: 1,
        type,
        rect: [40, y - 5, 210, y + 25],
        line: [45, y, 205, y + 20],
        appearance: style,
      });
    }
    bytes = await createPdfAnnotation(bytes, {
      pageNumber: 1,
      type: 'rectangle',
      rect: [260, 520, 380, 600],
      appearance: { ...style, fillColor: '#ffeeaa', opacity: 0.4 },
    });
    bytes = await createPdfAnnotation(bytes, {
      pageNumber: 1,
      type: 'ellipse',
      rect: [400, 520, 520, 600],
      appearance: style,
    });
    const { annotations } = await pdfJsAnnotations(bytes);
    expect(annotations.map((annotation) => annotation.type)).toEqual([
      'note',
      'freeText',
      'ink',
      'line',
      'arrow',
      'rectangle',
      'ellipse',
    ]);
    expect(annotations[0].content).toBe('Review this safely');
    expect(annotations[0].author).toBe('Nammu Reviewer');
    expect(annotations.every((annotation) => Boolean(annotation.nativeRef))).toBe(true);
  });

  test('edits and deletes by stable PDF reference without touching sibling annotations', async () => {
    const pdf = await import('pdf-lib');
    const withUnknown = await pdf.PDFDocument.load(await fixture(1));
    const link = withUnknown.context.register(
      withUnknown.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [300, 700, 420, 724],
        A: { S: 'URI', URI: 'https://example.com/' },
      }),
    );
    withUnknown.getPage(0).node.addAnnot(link);
    let bytes = await createPdfAnnotation(new Uint8Array(await withUnknown.save()), {
      pageNumber: 1,
      type: 'note',
      rect: [30, 700, 54, 724],
      content: 'Original',
      appearance: style,
    });
    bytes = await createPdfAnnotation(bytes, {
      pageNumber: 1,
      type: 'rectangle',
      rect: [100, 600, 200, 680],
      appearance: style,
    });
    const first = (await pdfJsAnnotations(bytes)).annotations[0];
    bytes = await updatePdfAnnotation(bytes, first, {
      content: 'Updated\u0000 comment',
      appearance: { color: '#22aa66', opacity: 0.7 },
    });
    const updated = (await pdfJsAnnotations(bytes)).annotations;
    expect(updated[0].content).toBe('Updated comment');
    expect(updated[0].appearance.color).toBe('#22aa66');
    bytes = await deletePdfAnnotation(bytes, updated[0]);
    const remaining = (await pdfJsAnnotations(bytes)).annotations;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].type).toBe('rectangle');
    const preserved = await pdf.PDFDocument.load(bytes);
    expect(preserved.getPage(0).node.Annots()?.size()).toBe(2);
  });

  test('remove-all strips comments but preserves form widgets', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const source = await PDFDocument.create();
    const page = source.addPage([600, 800]);
    source.getForm().createTextField('preserved').addToPage(page, {
      x: 30,
      y: 30,
      width: 120,
      height: 24,
    });
    let bytes = await createPdfAnnotation(new Uint8Array(await source.save()), {
      pageNumber: 1,
      type: 'note',
      rect: [30, 700, 54, 724],
      content: 'Remove me',
      appearance: style,
    });
    bytes = await removeAllPdfAnnotations(bytes);
    const result = await PDFDocument.load(bytes);
    expect(result.getForm().getField('preserved')).toBeTruthy();
    const annots = result.getPage(0).node.Annots();
    expect(annots?.size()).toBe(1);
  });

  test('fails closed when a PDF contains a digital-signature field', async () => {
    const pdf = await import('pdf-lib');
    const document = await pdf.PDFDocument.create();
    document.addPage([600, 800]);
    document.context.register(document.context.obj({ FT: 'Sig', T: 'signed' }));
    const bytes = new Uint8Array(await document.save());
    await expect(
      createPdfAnnotation(bytes, {
        pageNumber: 1,
        type: 'note',
        rect: [30, 700, 54, 724],
        appearance: style,
      }),
    ).rejects.toThrow('digital signature');
  });
});
