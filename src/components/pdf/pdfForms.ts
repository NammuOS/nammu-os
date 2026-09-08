import type {
  PdfFormField,
  PdfFormFieldDraft,
  PdfFormFieldPatch,
  PdfFormFieldType,
  PdfFormModel,
  PdfFormWidget,
} from './formModel';
import type { PdfRect } from './annotationModel';

const MAX_FIELDS = 10_000;
const MAX_TEXT = 16_384;
const MAX_OPTIONS = 2_000;
const MIN_WIDGET_SIZE = 4;

function safeText(value: unknown, maximum = MAX_TEXT): string {
  return typeof value === 'string'
    ? [...value]
        .filter((character) => {
          const code = character.charCodeAt(0);
          return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
        })
        .join('')
        .slice(0, maximum)
    : '';
}

function normalizeOptions(options: readonly string[]): string[] {
  return [
    ...new Set(
      options
        .slice(0, MAX_OPTIONS)
        .map((option) => safeText(option, 512))
        .filter(Boolean),
    ),
  ];
}

function safeRect(rect: PdfRect, width: number, height: number): PdfRect {
  const values = rect.map((value) => (Number.isFinite(value) ? value : 0));
  const x1 = Math.max(0, Math.min(values[0], values[2], width));
  const y1 = Math.max(0, Math.min(values[1], values[3], height));
  const x2 = Math.max(0, Math.min(Math.max(values[0], values[2]), width));
  const y2 = Math.max(0, Math.min(Math.max(values[1], values[3]), height));
  if (x2 - x1 < MIN_WIDGET_SIZE || y2 - y1 < MIN_WIDGET_SIZE) {
    throw new Error('The form field area is too small.');
  }
  return [x1, y1, x2, y2];
}

function fieldType(pdf: typeof import('pdf-lib'), field: unknown): PdfFormFieldType {
  if (field instanceof pdf.PDFTextField) return 'text';
  if (field instanceof pdf.PDFCheckBox) return 'checkbox';
  if (field instanceof pdf.PDFRadioGroup) return 'radio';
  if (field instanceof pdf.PDFDropdown) return 'dropdown';
  if (field instanceof pdf.PDFOptionList) return 'listbox';
  if (field instanceof pdf.PDFButton) return 'button';
  if (field instanceof pdf.PDFSignature) return 'signature';
  return 'unsupported';
}

function fieldValue(
  pdf: typeof import('pdf-lib'),
  field: import('pdf-lib').PDFField,
): string | readonly string[] | boolean | null {
  try {
    if (field instanceof pdf.PDFTextField) return safeText(field.getText());
    if (field instanceof pdf.PDFCheckBox) return field.isChecked();
    if (field instanceof pdf.PDFRadioGroup) return safeText(field.getSelected());
    if (field instanceof pdf.PDFDropdown || field instanceof pdf.PDFOptionList) {
      return field
        .getSelected()
        .slice(0, MAX_OPTIONS)
        .map((entry) => safeText(entry, 512));
    }
  } catch {
    // Malformed values remain inspectable without preventing the PDF from opening.
  }
  return null;
}

function decodeText(value: unknown): string {
  if (!value || typeof value !== 'object' || !('decodeText' in value)) return '';
  try {
    return safeText((value as { decodeText(): string }).decodeText(), 2_048);
  } catch {
    return '';
  }
}

function widgetPageNumber(
  document: import('pdf-lib').PDFDocument,
  widget: import('pdf-lib').PDFWidgetAnnotation,
): number | null {
  const pages = document.getPages();
  const explicit = widget.P();
  if (explicit) {
    const index = pages.findIndex((page) => page.ref === explicit);
    if (index >= 0) return index + 1;
  }
  for (let index = 0; index < pages.length; index += 1) {
    const annotations = pages[index].node.Annots();
    if (!annotations) continue;
    for (let item = 0; item < annotations.size(); item += 1) {
      const candidate = document.context.lookup(annotations.get(item));
      if (candidate === widget.dict) return index + 1;
    }
  }
  return null;
}

function fieldActions(pdf: typeof import('pdf-lib'), field: import('pdf-lib').PDFField): boolean {
  if (
    field.acroField.dict.has(pdf.PDFName.of('A')) ||
    field.acroField.dict.has(pdf.PDFName.of('AA'))
  ) {
    return true;
  }
  return field.acroField
    .getWidgets()
    .some(
      (widget) => widget.dict.has(pdf.PDFName.of('A')) || widget.dict.has(pdf.PDFName.of('AA')),
    );
}

function hasRawXfa(
  document: import('pdf-lib').PDFDocument,
  pdf: typeof import('pdf-lib'),
): boolean {
  const acroForm = document.catalog.lookup(pdf.PDFName.of('AcroForm'));
  return acroForm instanceof pdf.PDFDict && acroForm.has(pdf.PDFName.of('XFA'));
}

function alignment(pdf: typeof import('pdf-lib'), field: import('pdf-lib').PDFField) {
  if (!(field instanceof pdf.PDFTextField)) return 'left' as const;
  try {
    const value = field.getAlignment();
    if (value === pdf.TextAlignment.Center) return 'center' as const;
    if (value === pdf.TextAlignment.Right) return 'right' as const;
  } catch {
    // Retain a safe default for malformed appearance data.
  }
  return 'left' as const;
}

export async function inspectPdfForms(bytes: Uint8Array): Promise<PdfFormModel> {
  const pdf = await import('pdf-lib');
  const document = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  const xfa = hasRawXfa(document, pdf);
  const form = document.getForm();
  const sourceFields = form.getFields().slice(0, MAX_FIELDS);
  const fields: PdfFormField[] = sourceFields.map((field) => {
    const type = fieldType(pdf, field);
    const id = field.ref.toString();
    const options =
      field instanceof pdf.PDFRadioGroup ||
      field instanceof pdf.PDFDropdown ||
      field instanceof pdf.PDFOptionList
        ? normalizeOptions(field.getOptions())
        : [];
    const widgets: PdfFormWidget[] = field.acroField.getWidgets().flatMap((widget, index) => {
      const pageNumber = widgetPageNumber(document, widget);
      if (!pageNumber) return [];
      const rect = widget.getRectangle();
      const exportValues = field instanceof pdf.PDFRadioGroup ? field.getOptions() : [];
      return [
        {
          id: `${id}:${index}`,
          pageNumber,
          rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height] as PdfRect,
          exportValue: safeText(exportValues[index], 512) || null,
        },
      ];
    });
    const hasActions = fieldActions(pdf, field);
    const structurallyEditable =
      !xfa && type !== 'signature' && type !== 'unsupported' && type !== 'button';
    return {
      id,
      name: safeText(field.getName(), 512),
      type,
      value: fieldValue(pdf, field),
      options,
      required: field.isRequired(),
      readOnly: field.isReadOnly(),
      multiline: field instanceof pdf.PDFTextField ? field.isMultiline() : false,
      maxLength: field instanceof pdf.PDFTextField ? (field.getMaxLength() ?? null) : null,
      alignment: alignment(pdf, field),
      tooltip: decodeText(field.acroField.dict.get(pdf.PDFName.of('TU'))),
      widgets,
      editable: structurallyEditable && !hasActions,
      hasActions,
    };
  });
  const kind = xfa ? (fields.length ? 'hybrid' : 'xfa') : fields.length ? 'acroform' : 'none';
  const warnings: string[] = [];
  if (xfa) warnings.push('XFA content is preserved but remains read-only in Nammu PDF.');
  if (sourceFields.length > MAX_FIELDS)
    warnings.push(`Only the first ${MAX_FIELDS} fields are shown.`);
  if (fields.some((field) => field.hasActions)) {
    warnings.push(
      'Action-bearing fields are preserved but remain read-only; embedded actions never execute.',
    );
  }
  if (fields.some((field) => field.type === 'signature')) {
    warnings.push(
      'Existing signature fields are inspectable only. Nammu does not create or sign them in Forms.',
    );
  }
  return { kind, fields, xfa, editable: !xfa, warnings };
}

function assertMutable(
  document: import('pdf-lib').PDFDocument,
  pdf: typeof import('pdf-lib'),
): void {
  if (hasRawXfa(document, pdf)) throw new Error('XFA and hybrid forms are read-only in Nammu PDF.');
  const signed = document.context
    .enumerateIndirectObjects()
    .some(
      ([, object]) =>
        object instanceof pdf.PDFDict && object.get(pdf.PDFName.of('FT'))?.toString() === '/Sig',
    );
  if (signed) {
    throw new Error(
      'Form changes are disabled for signed PDFs because they invalidate signatures.',
    );
  }
}

function assertUniqueName(
  form: import('pdf-lib').PDFForm,
  name: string,
  except?: import('pdf-lib').PDFField,
) {
  const normalized = safeText(name, 128).trim();
  if (!normalized || normalized.includes('.')) {
    throw new Error('Field names must be 1–128 characters and cannot contain periods.');
  }
  const duplicate = form
    .getFields()
    .find((field) => field !== except && field.getName() === normalized);
  if (duplicate) throw new Error(`A form field named “${normalized}” already exists.`);
  return normalized;
}

function assertUniqueRenamedFieldName(
  form: import('pdf-lib').PDFForm,
  field: import('pdf-lib').PDFField,
  requestedName: string,
): string {
  const currentName = field.getName();
  const separator = currentName.lastIndexOf('.');
  const parentPrefix = separator >= 0 ? currentName.slice(0, separator + 1) : '';
  const normalized = safeText(requestedName, 128).trim();
  const partialName =
    parentPrefix && normalized.startsWith(parentPrefix)
      ? normalized.slice(parentPrefix.length)
      : normalized;
  if (!partialName || partialName.includes('.')) {
    throw new Error(
      'Field names must be 1–128 characters and cannot move between field hierarchies.',
    );
  }
  const fullName = `${parentPrefix}${partialName}`;
  const duplicate = form
    .getFields()
    .find((candidate) => candidate !== field && candidate.getName() === fullName);
  if (duplicate) throw new Error(`A form field named “${fullName}” already exists.`);
  return partialName;
}

function nextFieldName(form: import('pdf-lib').PDFForm, type: PdfFormFieldDraft['type']): string {
  const base = type === 'listbox' ? 'ListBox' : `${type[0].toUpperCase()}${type.slice(1)}`;
  const names = new Set(form.getFields().map((field) => field.getName()));
  for (let index = 1; index < 100_000; index += 1) {
    const candidate = `${base}${index}`;
    if (!names.has(candidate)) return candidate;
  }
  throw new Error('A unique field name could not be allocated.');
}

function fieldById(form: import('pdf-lib').PDFForm, id: string): import('pdf-lib').PDFField {
  const field = form.getFields().find((candidate) => candidate.ref.toString() === id);
  if (!field) throw new Error('The selected form field no longer exists.');
  return field;
}

async function saveFormDocument(document: import('pdf-lib').PDFDocument): Promise<Uint8Array> {
  const font = await document.embedFont((await import('pdf-lib')).StandardFonts.Helvetica);
  document.getForm().updateFieldAppearances(font);
  return new Uint8Array(await document.save());
}

export async function createPdfFormField(
  bytes: Uint8Array,
  draft: PdfFormFieldDraft,
): Promise<Uint8Array> {
  const pdf = await import('pdf-lib');
  const document = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  assertMutable(document, pdf);
  const page = document.getPage(draft.pageNumber - 1);
  if (!page) throw new Error('The selected page no longer exists.');
  const [x1, y1, x2, y2] = safeRect(draft.rect, page.getWidth(), page.getHeight());
  const form = document.getForm();
  const name = assertUniqueName(form, draft.name || nextFieldName(form, draft.type));
  const options = {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    borderWidth: 1,
    borderColor: pdf.rgb(0.3, 0.45, 0.62),
    backgroundColor: pdf.rgb(0.96, 0.98, 1),
    textColor: pdf.rgb(0.08, 0.12, 0.18),
  };
  if (draft.type === 'text') {
    form.createTextField(name).addToPage(page, options);
  } else if (draft.type === 'checkbox') {
    form.createCheckBox(name).addToPage(page, options);
  } else if (draft.type === 'dropdown') {
    const field = form.createDropdown(name);
    field.setOptions(['Option 1', 'Option 2']);
    field.select('Option 1');
    field.addToPage(page, options);
  } else if (draft.type === 'listbox') {
    const field = form.createOptionList(name);
    field.setOptions(['Option 1', 'Option 2', 'Option 3']);
    field.select('Option 1');
    field.addToPage(page, options);
  } else {
    const field = form.createRadioGroup(name);
    const width = x2 - x1;
    const height = y2 - y1;
    const horizontal = width >= height * 2;
    const first = horizontal
      ? { ...options, width: Math.min(height, width / 2), height }
      : { ...options, width, height: Math.min(width, height / 2), y: y1 + height / 2 };
    const second = horizontal ? { ...first, x: x1 + width / 2 } : { ...first, y: y1 };
    field.addOptionToPage('Option 1', page, first);
    field.addOptionToPage('Option 2', page, second);
    field.select('Option 1');
  }
  return saveFormDocument(document);
}

function setBooleanFlag(
  field: import('pdf-lib').PDFField,
  enabled: boolean,
  kind: 'required' | 'readOnly',
) {
  if (kind === 'required') {
    if (enabled) field.enableRequired();
    else field.disableRequired();
  } else if (enabled) field.enableReadOnly();
  else field.disableReadOnly();
}

export async function updatePdfFormField(
  bytes: Uint8Array,
  fieldId: string,
  patch: PdfFormFieldPatch,
): Promise<Uint8Array> {
  const pdf = await import('pdf-lib');
  const document = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  assertMutable(document, pdf);
  const form = document.getForm();
  const field = fieldById(form, fieldId);
  if (
    fieldActions(pdf, field) ||
    field instanceof pdf.PDFSignature ||
    field instanceof pdf.PDFButton
  ) {
    throw new Error(
      'This field is preserved as read-only because its behavior cannot be edited safely.',
    );
  }
  if (patch.name !== undefined) {
    field.acroField.setPartialName(assertUniqueRenamedFieldName(form, field, patch.name));
  }
  if (patch.required !== undefined) setBooleanFlag(field, patch.required, 'required');
  if (patch.readOnly !== undefined) setBooleanFlag(field, patch.readOnly, 'readOnly');
  if (patch.tooltip !== undefined) {
    const tooltip = safeText(patch.tooltip, 2_048);
    if (tooltip) field.acroField.dict.set(pdf.PDFName.of('TU'), pdf.PDFHexString.fromText(tooltip));
    else field.acroField.dict.delete(pdf.PDFName.of('TU'));
  }
  if (field instanceof pdf.PDFTextField) {
    if (patch.value !== undefined) field.setText(safeText(patch.value));
    if (patch.multiline !== undefined) {
      if (patch.multiline) field.enableMultiline();
      else field.disableMultiline();
    }
    if (patch.maxLength !== undefined) {
      const length =
        patch.maxLength === null ? undefined : Math.max(1, Math.min(32_768, patch.maxLength));
      field.setMaxLength(length);
    }
    if (patch.alignment !== undefined) {
      field.setAlignment(
        patch.alignment === 'center'
          ? pdf.TextAlignment.Center
          : patch.alignment === 'right'
            ? pdf.TextAlignment.Right
            : pdf.TextAlignment.Left,
      );
    }
  } else if (field instanceof pdf.PDFCheckBox && typeof patch.value === 'boolean') {
    if (patch.value) field.check();
    else field.uncheck();
  } else if (field instanceof pdf.PDFRadioGroup && typeof patch.value === 'string') {
    if (patch.value) field.select(safeText(patch.value, 512));
    else field.clear();
  } else if (field instanceof pdf.PDFDropdown || field instanceof pdf.PDFOptionList) {
    if (patch.options) {
      const options = normalizeOptions(patch.options);
      if (!options.length) throw new Error('Choice fields must retain at least one option.');
      field.setOptions(options);
    }
    if (patch.value !== undefined) {
      const selected = Array.isArray(patch.value)
        ? patch.value.map((value) => safeText(value, 512))
        : typeof patch.value === 'string'
          ? [safeText(patch.value, 512)]
          : [];
      if (selected.length) field.select(selected);
      else field.clear();
    }
  }
  if (patch.widgetId && patch.rect) {
    const widgetIndex = Number.parseInt(
      patch.widgetId.slice(patch.widgetId.lastIndexOf(':') + 1),
      10,
    );
    const widget = field.acroField.getWidgets()[widgetIndex];
    if (!widget) throw new Error('The selected field widget no longer exists.');
    const pageNumber = widgetPageNumber(document, widget);
    if (!pageNumber) throw new Error('The selected field widget has no valid page.');
    const page = document.getPage(pageNumber - 1);
    const [x1, y1, x2, y2] = safeRect(patch.rect, page.getWidth(), page.getHeight());
    widget.setRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
  }
  return saveFormDocument(document);
}

export async function deletePdfFormField(bytes: Uint8Array, fieldId: string): Promise<Uint8Array> {
  const pdf = await import('pdf-lib');
  const document = await pdf.PDFDocument.load(bytes, { updateMetadata: false });
  assertMutable(document, pdf);
  const form = document.getForm();
  const field = fieldById(form, fieldId);
  if (field instanceof pdf.PDFSignature)
    throw new Error('Signature fields cannot be removed in Forms.');
  form.removeField(field);
  return saveFormDocument(document);
}

export async function duplicatePdfFormField(
  bytes: Uint8Array,
  fieldId: string,
): Promise<Uint8Array> {
  const model = await inspectPdfForms(bytes);
  const source = model.fields.find((field) => field.id === fieldId);
  const widget = source?.widgets[0];
  if (
    !source ||
    !widget ||
    !['text', 'checkbox', 'radio', 'dropdown', 'listbox'].includes(source.type)
  ) {
    throw new Error('This field type cannot be duplicated safely.');
  }
  const names = new Set(model.fields.map((field) => field.name));
  let copyName = `${source.name} Copy`;
  for (let index = 2; names.has(copyName); index += 1) copyName = `${source.name} Copy ${index}`;
  const offset = 12;
  const draft: PdfFormFieldDraft = {
    type: source.type as PdfFormFieldDraft['type'],
    pageNumber: widget.pageNumber,
    name: copyName,
    rect: [
      widget.rect[0] + offset,
      widget.rect[1] - offset,
      widget.rect[2] + offset,
      widget.rect[3] - offset,
    ],
  };
  const created = await createPdfFormField(bytes, draft);
  const createdModel = await inspectPdfForms(created);
  const duplicate = createdModel.fields.find((field) => field.name === draft.name);
  if (!duplicate) return created;
  return updatePdfFormField(created, duplicate.id, {
    required: source.required,
    readOnly: source.readOnly,
    multiline: source.multiline,
    maxLength: source.maxLength,
    alignment: source.alignment,
    tooltip: source.tooltip,
    options: source.options,
    value: source.value,
  });
}

export const PDF_FORM_LIMITS = {
  maxFields: MAX_FIELDS,
  maxOptions: MAX_OPTIONS,
  maxText: MAX_TEXT,
};
