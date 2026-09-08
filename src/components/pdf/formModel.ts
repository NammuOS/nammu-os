import type { PdfRect } from './annotationModel';

export type PdfFormFieldType =
  'text' | 'checkbox' | 'radio' | 'dropdown' | 'listbox' | 'button' | 'signature' | 'unsupported';

export type PdfFormTool =
  'form-select' | 'form-text' | 'form-checkbox' | 'form-radio' | 'form-dropdown' | 'form-listbox';

export type PdfFormKind = 'none' | 'acroform' | 'xfa' | 'hybrid';

export interface PdfFormWidget {
  id: string;
  pageNumber: number;
  rect: PdfRect;
  exportValue: string | null;
}

export interface PdfFormField {
  id: string;
  name: string;
  type: PdfFormFieldType;
  value: string | readonly string[] | boolean | null;
  options: readonly string[];
  required: boolean;
  readOnly: boolean;
  multiline: boolean;
  maxLength: number | null;
  alignment: 'left' | 'center' | 'right';
  tooltip: string;
  widgets: readonly PdfFormWidget[];
  editable: boolean;
  hasActions: boolean;
}

export interface PdfFormModel {
  kind: PdfFormKind;
  fields: readonly PdfFormField[];
  xfa: boolean;
  editable: boolean;
  warnings: readonly string[];
}

export interface PdfFormFieldDraft {
  pageNumber: number;
  type: Extract<PdfFormFieldType, 'text' | 'checkbox' | 'radio' | 'dropdown' | 'listbox'>;
  rect: PdfRect;
  name?: string;
}

export interface PdfFormFieldPatch {
  name?: string;
  value?: string | readonly string[] | boolean | null;
  options?: readonly string[];
  required?: boolean;
  readOnly?: boolean;
  multiline?: boolean;
  maxLength?: number | null;
  alignment?: 'left' | 'center' | 'right';
  tooltip?: string;
  widgetId?: string;
  rect?: PdfRect;
}

export const EMPTY_PDF_FORM_MODEL: PdfFormModel = {
  kind: 'none',
  fields: [],
  xfa: false,
  editable: true,
  warnings: [],
};

export function pdfFormFieldTypeLabel(type: PdfFormFieldType): string {
  const labels: Record<PdfFormFieldType, string> = {
    text: 'Text Field',
    checkbox: 'Checkbox',
    radio: 'Radio Group',
    dropdown: 'Dropdown',
    listbox: 'List Box',
    button: 'Button',
    signature: 'Signature Field',
    unsupported: 'Unsupported Field',
  };
  return labels[type];
}
