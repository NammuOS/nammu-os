import type {
  PdfDocumentSession,
  PdfViewMode,
  PdfWorkspaceMode,
  PdfWorkspaceTool,
  PdfZoomMode,
} from './model';
import type { PdfAnnotationDraft, PdfAnnotationPatch, PdfAnnotationTool } from './annotationModel';
import type { PdfFormFieldDraft, PdfFormFieldPatch, PdfFormTool } from './formModel';
import type {
  PdfContentObjectDraft,
  PdfContentObjectPatch,
  PdfContentTool,
} from './contentEditModel';
import type { PdfRect } from './annotationModel';
import type { PdfSanitizeOptions } from './protectionModel';
import type { PdfEncryptionRequest } from './pdfCrypto';
import type { PdfExportFormat } from './conversionModel';

export type PdfMenuId =
  'file' | 'edit' | 'view' | 'document' | 'comment' | 'forms' | 'protect' | 'convert' | 'tools' | 'help';

export type PdfCommandId =
  | 'file.open'
  | 'file.saveAs'
  | 'file.close'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.find'
  | 'edit.selectAllPages'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.actualSize'
  | 'view.fitWidth'
  | 'view.fitPage'
  | 'view.continuous'
  | 'view.singlePage'
  | 'view.selectTool'
  | 'view.handTool'
  | 'view.readWorkspace'
  | 'view.organizeWorkspace'
  | 'view.commentWorkspace'
  | 'view.formsWorkspace'
  | 'view.editWorkspace'
  | 'view.protectWorkspace'
  | 'view.convertWorkspace'
  | 'view.ocrWorkspace'
  | 'document.rotateLeft'
  | 'document.rotateRight'
  | 'document.deletePages'
  | 'document.duplicatePages'
  | 'document.extractPages'
  | 'document.insertBefore'
  | 'document.insertAfter'
  | 'document.reorderPages'
  | 'comment.select'
  | 'comment.highlight'
  | 'comment.underline'
  | 'comment.strikeout'
  | 'comment.note'
  | 'comment.freeText'
  | 'comment.ink'
  | 'comment.line'
  | 'comment.arrow'
  | 'comment.rectangle'
  | 'comment.ellipse'
  | 'comment.create'
  | 'comment.update'
  | 'comment.delete'
  | 'comment.previous'
  | 'comment.next'
  | 'comment.removeAll'
  | 'forms.select'
  | 'forms.text'
  | 'forms.checkbox'
  | 'forms.radio'
  | 'forms.dropdown'
  | 'forms.listbox'
  | 'forms.create'
  | 'forms.update'
  | 'forms.delete'
  | 'forms.duplicate'
  | 'forms.previous'
  | 'forms.next'
  | 'content.select'
  | 'content.addText'
  | 'content.addImage'
  | 'content.replaceImage'
  | 'content.create'
  | 'content.update'
  | 'content.delete'
  | 'redact.select'
  | 'redact.markRegion'
  | 'redact.markSelection'
  | 'redact.create'
  | 'redact.delete'
  | 'redact.apply'
  | 'security.inspect'
  | 'security.encrypt'
  | 'sanitize.document'
  | 'convert.run'
  | 'convert.toPng'
  | 'convert.toJpeg'
  | 'convert.toWebp'
  | 'convert.toText'
  | 'convert.toMarkdown'
  | 'convert.toJson'
  | 'convert.imagesToPdf'
  | 'ocr.recognizePages'
  | 'ocr.makeSearchable'
  | 'ocr.exportText'
  | 'ocr.cancel'
  | 'ocr.clearResults'
  | 'tools.commandPalette'
  | 'help.about';

export interface PdfCommandActions {
  open(): void | Promise<void>;
  saveAs(): void | Promise<void>;
  close(): void;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  find(): void;
  selectAllPages(): void;
  zoomBy(delta: number): void;
  setZoomMode(mode: PdfZoomMode): void;
  setViewMode(mode: PdfViewMode): void;
  setTool(tool: PdfWorkspaceTool): void;
  setWorkspaceMode(mode: PdfWorkspaceMode): void;
  rotateSelected(angle: 90 | -90): void | Promise<void>;
  deleteSelected(): void | Promise<void>;
  duplicateSelected(): void | Promise<void>;
  extractPages(): void | Promise<void>;
  insertPages(placement: 'before' | 'after'): void | Promise<void>;
  reorderPages(pageOrder: readonly number[]): void | Promise<void>;
  createAnnotation(draft: PdfAnnotationDraft): void | Promise<void>;
  updateSelectedAnnotation(patch: PdfAnnotationPatch): void | Promise<void>;
  deleteSelectedAnnotation(): void | Promise<void>;
  removeAllAnnotations(): void | Promise<void>;
  navigateAnnotation(direction: -1 | 1): void;
  createFormField(draft: PdfFormFieldDraft): void | Promise<void>;
  updateFormField(fieldId: string, patch: PdfFormFieldPatch): void | Promise<void>;
  deleteSelectedFormField(): void | Promise<void>;
  duplicateSelectedFormField(): void | Promise<void>;
  navigateFormField(direction: -1 | 1): void;
  createContentObject(draft: PdfContentObjectDraft): void | Promise<void>;
  updateSelectedContentObject(patch: PdfContentObjectPatch): void | Promise<void>;
  deleteSelectedContentObject(): void | Promise<void>;
  addImage(): void | Promise<void>;
  replaceSelectedImage(): void | Promise<void>;
  createRedaction(pageNumber: number, rect: PdfRect, quadPoints?: readonly number[]): void | Promise<void>;
  deleteSelectedRedaction(): void | Promise<void>;
  applyRedactions(): void | Promise<void>;
  sanitize(options: PdfSanitizeOptions): void | Promise<void>;
  encrypt(request: PdfEncryptionRequest): void | Promise<void>;
  convert(format?: PdfExportFormat): void | Promise<void>;
  imagesToPdf(): void | Promise<void>;
  runOcr(): void | Promise<void>;
  makeSearchable(): void | Promise<void>;
  exportOcrText(): void | Promise<void>;
  cancelOcr(): void;
  clearOcrResults(): void;
  showCommandPalette(): void;
  showAbout(): void;
}

export interface PdfCommandContext {
  session: PdfDocumentSession | null;
  busy: boolean;
  actions: PdfCommandActions;
  reorderOrder?: readonly number[];
  annotationDraft?: PdfAnnotationDraft;
  annotationPatch?: PdfAnnotationPatch;
  formFieldDraft?: PdfFormFieldDraft;
  formFieldPatch?: PdfFormFieldPatch;
  formFieldId?: string;
  contentDraft?: PdfContentObjectDraft;
  contentPatch?: PdfContentObjectPatch;
  redactionPageNumber?: number;
  redactionRect?: PdfRect;
  redactionQuadPoints?: readonly number[];
  sanitizeOptions?: PdfSanitizeOptions;
  encryptionRequest?: PdfEncryptionRequest;
  conversionFormat?: PdfExportFormat;
}

export interface PdfCommandDefinition {
  id: PdfCommandId;
  label: string;
  menu: PdfMenuId;
  shortcut?: string;
  danger?: boolean;
  hidden?: boolean;
  dividerBefore?: boolean;
  enabled(context: PdfCommandContext): boolean;
  checked?(context: PdfCommandContext): boolean;
  execute(context: PdfCommandContext): void | Promise<void>;
}

const always = () => true;
const hasDocument = ({ session, busy }: PdfCommandContext) => Boolean(session) && !busy;
const hasPageSelection = ({ session, busy }: PdfCommandContext) =>
  Boolean(session?.selectedPages.length) && !busy;
const canRewriteSelectedPages = ({ session, busy }: PdfCommandContext) =>
  Boolean(session?.selectedPages.length && !session.fidelity.signatures) && !busy;
const canAnnotate = ({ session, busy }: PdfCommandContext) =>
  Boolean(session && !session.fidelity.signatures) && !busy;
const canAuthorForms = ({ session, busy }: PdfCommandContext) =>
  Boolean(session && session.form.editable && !session.fidelity.signatures) && !busy;
const canEditContent = ({ session, busy }: PdfCommandContext) =>
  Boolean(session && !session.fidelity.signatures) && !busy;

function contentToolCommand(
  id: PdfCommandId,
  label: string,
  tool: PdfContentTool,
): PdfCommandDefinition {
  return {
    id,
    label,
    menu: 'edit',
    enabled: canEditContent,
    checked: ({ session }) => session?.workspaceMode === 'edit' && session.tool === tool,
    execute: ({ actions }) => {
      actions.setWorkspaceMode('edit');
      actions.setTool(tool);
    },
  };
}

function annotationToolCommand(
  id: PdfCommandId,
  label: string,
  tool: PdfAnnotationTool,
  shortcut?: string,
): PdfCommandDefinition {
  return {
    id,
    label,
    menu: 'comment',
    shortcut,
    enabled: canAnnotate,
    checked: ({ session }) => session?.workspaceMode === 'comment' && session.tool === tool,
    execute: ({ actions, session }) => {
      actions.setWorkspaceMode('comment');
      if (
        session?.textSelection &&
        (tool === 'highlight' || tool === 'underline' || tool === 'strikeout')
      ) {
        return actions.createAnnotation({
          pageNumber: session.textSelection.pageNumber,
          type: tool,
          rect: session.textSelection.rect,
          quadPoints: session.textSelection.quadPoints,
          content: session.textSelection.text,
          appearance: session.annotationAppearance,
        });
      }
      actions.setTool(tool);
    },
  };
}

function formToolCommand(id: PdfCommandId, label: string, tool: PdfFormTool): PdfCommandDefinition {
  return {
    id,
    label,
    menu: 'forms',
    enabled: tool === 'form-select' ? hasDocument : canAuthorForms,
    checked: ({ session }) => session?.workspaceMode === 'forms' && session.tool === tool,
    execute: ({ actions }) => {
      actions.setWorkspaceMode('forms');
      actions.setTool(tool);
    },
  };
}

export const PDF_COMMANDS: readonly PdfCommandDefinition[] = [
  {
    id: 'file.open',
    label: 'Open PDF…',
    menu: 'file',
    shortcut: 'Ctrl+O',
    enabled: always,
    execute: ({ actions }) => actions.open(),
  },
  {
    id: 'file.saveAs',
    label: 'Save As…',
    menu: 'file',
    shortcut: 'Ctrl+Shift+S',
    enabled: hasDocument,
    execute: ({ actions }) => actions.saveAs(),
  },
  {
    id: 'file.close',
    label: 'Close Document',
    menu: 'file',
    shortcut: 'Ctrl+W',
    dividerBefore: true,
    enabled: ({ session }) => Boolean(session),
    execute: ({ actions }) => actions.close(),
  },
  {
    id: 'edit.undo',
    label: 'Undo',
    menu: 'edit',
    shortcut: 'Ctrl+Z',
    enabled: ({ session, busy }) => Boolean(session?.history.past.length) && !busy,
    execute: ({ actions }) => actions.undo(),
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    menu: 'edit',
    shortcut: 'Ctrl+Y',
    enabled: ({ session, busy }) => Boolean(session?.history.future.length) && !busy,
    execute: ({ actions }) => actions.redo(),
  },
  {
    id: 'edit.find',
    label: 'Find in Document…',
    menu: 'edit',
    shortcut: 'Ctrl+F',
    dividerBefore: true,
    enabled: hasDocument,
    execute: ({ actions }) => actions.find(),
  },
  {
    id: 'edit.selectAllPages',
    label: 'Select All Pages',
    menu: 'edit',
    shortcut: 'Ctrl+A',
    enabled: hasDocument,
    execute: ({ actions }) => actions.selectAllPages(),
  },
  {
    id: 'view.zoomIn',
    label: 'Zoom In',
    menu: 'view',
    shortcut: 'Ctrl++',
    enabled: hasDocument,
    execute: ({ actions }) => actions.zoomBy(0.1),
  },
  {
    id: 'view.zoomOut',
    label: 'Zoom Out',
    menu: 'view',
    shortcut: 'Ctrl+-',
    enabled: hasDocument,
    execute: ({ actions }) => actions.zoomBy(-0.1),
  },
  {
    id: 'view.actualSize',
    label: 'Actual Size',
    menu: 'view',
    shortcut: 'Ctrl+1',
    dividerBefore: true,
    enabled: hasDocument,
    checked: ({ session }) => session?.zoomMode === 'actual',
    execute: ({ actions }) => actions.setZoomMode('actual'),
  },
  {
    id: 'view.fitWidth',
    label: 'Fit Width',
    menu: 'view',
    shortcut: 'Ctrl+2',
    enabled: hasDocument,
    checked: ({ session }) => session?.zoomMode === 'fit-width',
    execute: ({ actions }) => actions.setZoomMode('fit-width'),
  },
  {
    id: 'view.fitPage',
    label: 'Fit Page',
    menu: 'view',
    shortcut: 'Ctrl+3',
    enabled: hasDocument,
    checked: ({ session }) => session?.zoomMode === 'fit-page',
    execute: ({ actions }) => actions.setZoomMode('fit-page'),
  },
  {
    id: 'view.continuous',
    label: 'Continuous View',
    menu: 'view',
    dividerBefore: true,
    enabled: hasDocument,
    checked: ({ session }) => session?.viewMode === 'continuous',
    execute: ({ actions }) => actions.setViewMode('continuous'),
  },
  {
    id: 'view.singlePage',
    label: 'Single Page View',
    menu: 'view',
    enabled: hasDocument,
    checked: ({ session }) => session?.viewMode === 'single-page',
    execute: ({ actions }) => actions.setViewMode('single-page'),
  },
  {
    id: 'view.selectTool',
    label: 'Select Tool',
    menu: 'view',
    shortcut: 'V',
    dividerBefore: true,
    enabled: hasDocument,
    checked: ({ session }) => session?.tool === 'select',
    execute: ({ actions }) => actions.setTool('select'),
  },
  {
    id: 'view.handTool',
    label: 'Hand Tool',
    menu: 'view',
    shortcut: 'H',
    enabled: hasDocument,
    checked: ({ session }) => session?.tool === 'hand',
    execute: ({ actions }) => actions.setTool('hand'),
  },
  {
    id: 'view.readWorkspace',
    label: 'Read Workspace',
    menu: 'view',
    dividerBefore: true,
    enabled: hasDocument,
    checked: ({ session }) => session?.workspaceMode === 'read',
    execute: ({ actions }) => actions.setWorkspaceMode('read'),
  },
  {
    id: 'view.organizeWorkspace',
    label: 'Organize Workspace',
    menu: 'view',
    shortcut: 'Ctrl+Shift+O',
    enabled: hasDocument,
    checked: ({ session }) => session?.workspaceMode === 'organize',
    execute: ({ actions }) => actions.setWorkspaceMode('organize'),
  },
  {
    id: 'view.commentWorkspace',
    label: 'Comment Workspace',
    menu: 'view',
    shortcut: 'Ctrl+Shift+C',
    enabled: hasDocument,
    checked: ({ session }) => session?.workspaceMode === 'comment',
    execute: ({ actions }) => actions.setWorkspaceMode('comment'),
  },
  {
    id: 'view.formsWorkspace',
    label: 'Forms Workspace',
    menu: 'view',
    shortcut: 'Ctrl+Shift+F',
    enabled: hasDocument,
    checked: ({ session }) => session?.workspaceMode === 'forms',
    execute: ({ actions }) => actions.setWorkspaceMode('forms'),
  },
  {
    id: 'view.editWorkspace',
    label: 'Edit Workspace',
    menu: 'view',
    shortcut: 'Ctrl+Shift+E',
    enabled: hasDocument,
    checked: ({ session }) => session?.workspaceMode === 'edit',
    execute: ({ actions }) => actions.setWorkspaceMode('edit'),
  },
  {
    id: 'view.protectWorkspace',
    label: 'Protect Workspace',
    menu: 'view',
    shortcut: 'Ctrl+Shift+R',
    enabled: hasDocument,
    checked: ({ session }) => session?.workspaceMode === 'protect',
    execute: ({ actions }) => actions.setWorkspaceMode('protect'),
  },
  {
    id: 'view.convertWorkspace', label: 'Convert Workspace', menu: 'view', shortcut: 'Ctrl+Shift+X',
    enabled: hasDocument, checked: ({ session }) => session?.workspaceMode === 'convert',
    execute: ({ actions }) => actions.setWorkspaceMode('convert'),
  },
  {
    id: 'view.ocrWorkspace', label: 'OCR Workspace', menu: 'view', shortcut: 'Ctrl+Shift+G',
    enabled: hasDocument, checked: ({ session }) => session?.workspaceMode === 'ocr',
    execute: ({ actions }) => actions.setWorkspaceMode('ocr'),
  },
  {
    id: 'document.rotateLeft',
    label: 'Rotate Selected Pages Left',
    menu: 'document',
    enabled: canRewriteSelectedPages,
    execute: ({ actions }) => actions.rotateSelected(-90),
  },
  {
    id: 'document.rotateRight',
    label: 'Rotate Selected Pages Right',
    menu: 'document',
    enabled: canRewriteSelectedPages,
    execute: ({ actions }) => actions.rotateSelected(90),
  },
  {
    id: 'document.duplicatePages',
    label: 'Duplicate Selected Pages',
    menu: 'document',
    enabled: canRewriteSelectedPages,
    execute: ({ actions }) => actions.duplicateSelected(),
  },
  {
    id: 'document.deletePages',
    label: 'Delete Selected Pages',
    menu: 'document',
    danger: true,
    enabled: ({ session, busy }) =>
      Boolean(
        session?.selectedPages.length &&
        session.selectedPages.length < session.pages.length &&
        !session.fidelity.signatures,
      ) && !busy,
    execute: ({ actions }) => actions.deleteSelected(),
  },
  {
    id: 'document.extractPages',
    label: 'Extract Selected Pages to New Tab',
    menu: 'document',
    dividerBefore: true,
    enabled: hasPageSelection,
    execute: ({ actions }) => actions.extractPages(),
  },
  {
    id: 'document.insertBefore',
    label: 'Insert PDF Before Selection…',
    menu: 'document',
    enabled: canRewriteSelectedPages,
    execute: ({ actions }) => actions.insertPages('before'),
  },
  {
    id: 'document.insertAfter',
    label: 'Insert PDF After Selection…',
    menu: 'document',
    enabled: canRewriteSelectedPages,
    execute: ({ actions }) => actions.insertPages('after'),
  },
  {
    id: 'document.reorderPages',
    label: 'Reorder Selected Pages',
    menu: 'document',
    enabled: ({ session, busy, reorderOrder }) =>
      Boolean(
        session?.selectedPages.length &&
        !session.fidelity.signatures &&
        reorderOrder?.length === session.pages.length,
      ) && !busy,
    execute: ({ actions, reorderOrder }) => {
      if (reorderOrder) return actions.reorderPages(reorderOrder);
    },
  },
  {
    id: 'comment.select',
    label: 'Select Annotation',
    menu: 'comment',
    shortcut: 'V',
    enabled: hasDocument,
    checked: ({ session }) => session?.workspaceMode === 'comment' && session.tool === 'select',
    execute: ({ actions }) => {
      actions.setWorkspaceMode('comment');
      actions.setTool('select');
    },
  },
  annotationToolCommand('comment.highlight', 'Highlight Text', 'highlight', 'H'),
  annotationToolCommand('comment.underline', 'Underline Text', 'underline', 'U'),
  annotationToolCommand('comment.strikeout', 'Strikethrough Text', 'strikeout'),
  annotationToolCommand('comment.note', 'Sticky Note', 'note', 'N'),
  annotationToolCommand('comment.freeText', 'Text Box', 'freeText', 'T'),
  annotationToolCommand('comment.ink', 'Freehand Ink', 'ink', 'P'),
  annotationToolCommand('comment.line', 'Line', 'line'),
  annotationToolCommand('comment.arrow', 'Arrow', 'arrow', 'A'),
  annotationToolCommand('comment.rectangle', 'Rectangle', 'rectangle', 'R'),
  annotationToolCommand('comment.ellipse', 'Ellipse', 'ellipse', 'E'),
  {
    id: 'comment.create',
    label: 'Add Annotation',
    menu: 'comment',
    hidden: true,
    enabled: ({ annotationDraft, ...context }) => Boolean(annotationDraft) && canAnnotate(context),
    execute: ({ actions, annotationDraft }) => {
      if (annotationDraft) return actions.createAnnotation(annotationDraft);
    },
  },
  {
    id: 'comment.update',
    label: 'Apply Annotation Properties',
    menu: 'comment',
    hidden: true,
    enabled: ({ session, annotationPatch, busy }) =>
      Boolean(
        annotationPatch &&
        !session?.fidelity.signatures &&
        session?.annotations.some(
          (annotation) => annotation.id === session.selectedAnnotationId && annotation.editable,
        ),
      ) && !busy,
    execute: ({ actions, annotationPatch }) => {
      if (annotationPatch) return actions.updateSelectedAnnotation(annotationPatch);
    },
  },
  {
    id: 'comment.delete',
    label: 'Delete Selected Annotation',
    menu: 'comment',
    shortcut: 'Delete',
    danger: true,
    enabled: ({ session, busy }) =>
      Boolean(
        !session?.fidelity.signatures &&
        session?.annotations.some(
          (annotation) =>
            annotation.id === session.selectedAnnotationId && Boolean(annotation.nativeRef),
        ),
      ) && !busy,
    execute: ({ actions }) => actions.deleteSelectedAnnotation(),
  },
  {
    id: 'comment.previous',
    label: 'Previous Annotation',
    menu: 'comment',
    dividerBefore: true,
    enabled: ({ session, busy }) => Boolean(session?.annotations.length) && !busy,
    execute: ({ actions }) => actions.navigateAnnotation(-1),
  },
  {
    id: 'comment.next',
    label: 'Next Annotation',
    menu: 'comment',
    enabled: ({ session, busy }) => Boolean(session?.annotations.length) && !busy,
    execute: ({ actions }) => actions.navigateAnnotation(1),
  },
  {
    id: 'comment.removeAll',
    label: 'Remove All Annotations',
    menu: 'comment',
    dividerBefore: true,
    danger: true,
    enabled: ({ session, busy }) =>
      Boolean(session?.annotations.length && !session.fidelity.signatures) && !busy,
    execute: ({ actions }) => actions.removeAllAnnotations(),
  },
  formToolCommand('forms.select', 'Select Form Field', 'form-select'),
  formToolCommand('forms.text', 'Text Field', 'form-text'),
  formToolCommand('forms.checkbox', 'Checkbox', 'form-checkbox'),
  formToolCommand('forms.radio', 'Radio Group', 'form-radio'),
  formToolCommand('forms.dropdown', 'Dropdown', 'form-dropdown'),
  formToolCommand('forms.listbox', 'List Box', 'form-listbox'),
  {
    id: 'forms.create',
    label: 'Create Form Field',
    menu: 'forms',
    hidden: true,
    enabled: ({ formFieldDraft, ...context }) => Boolean(formFieldDraft) && canAuthorForms(context),
    execute: ({ actions, formFieldDraft }) => {
      if (formFieldDraft) return actions.createFormField(formFieldDraft);
    },
  },
  {
    id: 'forms.update',
    label: 'Apply Field Properties',
    menu: 'forms',
    hidden: true,
    enabled: ({ session, formFieldPatch, formFieldId, busy }) =>
      Boolean(
        formFieldPatch &&
        session?.form.editable &&
        !session.fidelity.signatures &&
        session.form.fields.some(
          (field) => field.id === (formFieldId ?? session.selectedFormFieldId) && field.editable,
        ),
      ) && !busy,
    execute: ({ actions, session, formFieldPatch, formFieldId }) => {
      const id = formFieldId ?? session?.selectedFormFieldId;
      if (formFieldPatch && id) return actions.updateFormField(id, formFieldPatch);
    },
  },
  {
    id: 'forms.duplicate',
    label: 'Duplicate Selected Field',
    menu: 'forms',
    enabled: ({ session, busy }) =>
      Boolean(
        session?.form.editable &&
        !session.fidelity.signatures &&
        session.form.fields.some(
          (field) => field.id === session.selectedFormFieldId && field.editable,
        ),
      ) && !busy,
    execute: ({ actions }) => actions.duplicateSelectedFormField(),
  },
  {
    id: 'forms.delete',
    label: 'Delete Selected Field',
    menu: 'forms',
    shortcut: 'Delete',
    danger: true,
    enabled: ({ session, busy }) =>
      Boolean(
        session?.form.editable &&
        !session.fidelity.signatures &&
        session.form.fields.some(
          (field) => field.id === session.selectedFormFieldId && field.type !== 'signature',
        ),
      ) && !busy,
    execute: ({ actions }) => actions.deleteSelectedFormField(),
  },
  {
    id: 'forms.previous',
    label: 'Previous Form Field',
    menu: 'forms',
    dividerBefore: true,
    enabled: ({ session, busy }) => Boolean(session?.form.fields.length) && !busy,
    execute: ({ actions }) => actions.navigateFormField(-1),
  },
  {
    id: 'forms.next',
    label: 'Next Form Field',
    menu: 'forms',
    enabled: ({ session, busy }) => Boolean(session?.form.fields.length) && !busy,
    execute: ({ actions }) => actions.navigateFormField(1),
  },
  contentToolCommand('content.select', 'Select Content', 'edit-select'),
  contentToolCommand('content.addText', 'Add Text', 'edit-text'),
  {
    id: 'content.addImage',
    label: 'Add Image…',
    menu: 'edit',
    enabled: canEditContent,
    execute: ({ actions }) => actions.addImage(),
  },
  {
    id: 'content.replaceImage',
    label: 'Replace Selected Image…',
    menu: 'edit',
    enabled: (context) =>
      Boolean(
        context.session?.contentEdit.objects.some(
          (object) =>
            object.id === context.session?.contentEdit.selectedObjectId && object.kind === 'image',
        ),
      ) && canEditContent(context),
    execute: ({ actions }) => actions.replaceSelectedImage(),
  },
  {
    id: 'content.create',
    label: 'Create Content Object',
    menu: 'edit',
    hidden: true,
    enabled: (context) => Boolean(context.contentDraft) && canEditContent(context),
    execute: ({ actions, contentDraft }) => {
      if (contentDraft) return actions.createContentObject(contentDraft);
    },
  },
  {
    id: 'content.update',
    label: 'Update Selected Content',
    menu: 'edit',
    hidden: true,
    enabled: (context) =>
      Boolean(context.session?.contentEdit.selectedObjectId && context.contentPatch) &&
      canEditContent(context),
    execute: ({ actions, contentPatch }) => {
      if (contentPatch) return actions.updateSelectedContentObject(contentPatch);
    },
  },
  {
    id: 'content.delete',
    label: 'Delete Selected Content',
    menu: 'edit',
    shortcut: 'Delete',
    danger: true,
    enabled: (context) =>
      Boolean(context.session?.contentEdit.selectedObjectId) && canEditContent(context),
    execute: ({ actions }) => actions.deleteSelectedContentObject(),
  },
  {
    id: 'redact.select', label: 'Review Redaction Marks', menu: 'protect', enabled: hasDocument,
    checked: ({ session }) => session?.workspaceMode === 'protect' && session.tool === 'protect-select',
    execute: ({ actions }) => { actions.setWorkspaceMode('protect'); actions.setTool('protect-select'); },
  },
  {
    id: 'redact.markRegion', label: 'Mark Region for Redaction', menu: 'protect',
    enabled: canAnnotate,
    checked: ({ session }) => session?.workspaceMode === 'protect' && session.tool === 'redact-region',
    execute: ({ actions }) => { actions.setWorkspaceMode('protect'); actions.setTool('redact-region'); },
  },
  {
    id: 'redact.markSelection', label: 'Mark Selected Text for Redaction', menu: 'protect',
    enabled: ({ session, busy }) => Boolean(session?.textSelection && !session.fidelity.signatures) && !busy,
    execute: ({ actions, session }) => {
      if (session?.textSelection) return actions.createRedaction(session.textSelection.pageNumber, session.textSelection.rect, session.textSelection.quadPoints);
    },
  },
  {
    id: 'redact.create', label: 'Create Redaction Mark', menu: 'protect', hidden: true,
    enabled: ({ redactionPageNumber, redactionRect, ...context }) => Boolean(redactionPageNumber && redactionRect) && canAnnotate(context),
    execute: ({ actions, redactionPageNumber, redactionRect, redactionQuadPoints }) => {
      if (redactionPageNumber && redactionRect) return actions.createRedaction(redactionPageNumber, redactionRect, redactionQuadPoints);
    },
  },
  {
    id: 'redact.delete', label: 'Remove Selected Redaction Mark', menu: 'protect', danger: true,
    enabled: ({ session, busy }) => Boolean(session?.protection.selectedRedactionId && !session.fidelity.signatures) && !busy,
    execute: ({ actions }) => actions.deleteSelectedRedaction(),
  },
  {
    id: 'redact.apply', label: 'Apply Secure Raster Redactions…', menu: 'protect', danger: true, dividerBefore: true,
    enabled: ({ session, busy }) => Boolean(session?.protection.redactions.length && !session.fidelity.signatures) && !busy,
    execute: ({ actions }) => actions.applyRedactions(),
  },
  {
    id: 'security.inspect', label: 'Inspect Document Security', menu: 'protect', dividerBefore: true,
    enabled: hasDocument, execute: ({ actions }) => actions.setWorkspaceMode('protect'),
  },
  {
    id: 'security.encrypt', label: 'Protect a Copy with Password…', menu: 'protect',
    enabled: ({ encryptionRequest, ...context }) => Boolean(encryptionRequest) && canAnnotate(context),
    hidden: true,
    execute: ({ actions, encryptionRequest }) => { if (encryptionRequest) return actions.encrypt(encryptionRequest); },
  },
  {
    id: 'sanitize.document', label: 'Remove Selected Document Data', menu: 'protect', hidden: true,
    enabled: ({ sanitizeOptions, ...context }) => Boolean(sanitizeOptions && Object.values(sanitizeOptions).some(Boolean)) && canAnnotate(context),
    execute: ({ actions, sanitizeOptions }) => { if (sanitizeOptions) return actions.sanitize(sanitizeOptions); },
  },
  {
    id: 'convert.run', label: 'Run Configured Export', menu: 'convert', hidden: true,
    enabled: hasDocument, execute: ({ actions }) => actions.convert(),
  },
  ...([
    ['convert.toPng', 'Export Pages as PNG', 'png'],
    ['convert.toJpeg', 'Export Pages as JPEG', 'jpeg'],
    ['convert.toWebp', 'Export Pages as WebP', 'webp'],
    ['convert.toText', 'Export Text', 'text'],
    ['convert.toMarkdown', 'Export Markdown', 'markdown'],
    ['convert.toJson', 'Export Structured JSON', 'json'],
  ] as const).map(([id, label, format], index) => ({
    id, label, menu: 'convert' as const, dividerBefore: index === 3,
    enabled: hasDocument,
    execute: ({ actions }: PdfCommandContext) => actions.convert(format),
  })),
  {
    id: 'convert.imagesToPdf', label: 'Create PDF from Images…', menu: 'convert', dividerBefore: true,
    enabled: always, execute: ({ actions }) => actions.imagesToPdf(),
  },
  {
    id: 'ocr.recognizePages', label: 'Recognize Scanned Pages', menu: 'tools', dividerBefore: true,
    enabled: hasDocument, execute: ({ actions }) => actions.runOcr(),
  },
  {
    id: 'ocr.makeSearchable', label: 'Make Searchable Copy', menu: 'tools',
    enabled: ({ session, busy }) => Boolean(session?.ocr.results.length && !session.fidelity.signatures) && !busy,
    execute: ({ actions }) => actions.makeSearchable(),
  },
  {
    id: 'ocr.exportText', label: 'Export OCR Text', menu: 'tools',
    enabled: ({ session, busy }) => Boolean(session?.ocr.results.length) && !busy,
    execute: ({ actions }) => actions.exportOcrText(),
  },
  {
    id: 'ocr.cancel', label: 'Cancel OCR', menu: 'tools', hidden: true,
    enabled: ({ session }) => session?.ocr.status === 'loading' || session?.ocr.status === 'recognizing' || session?.ocr.status === 'building',
    execute: ({ actions }) => actions.cancelOcr(),
  },
  {
    id: 'ocr.clearResults', label: 'Clear OCR Results', menu: 'tools', hidden: true,
    enabled: ({ session, busy }) => Boolean(session?.ocr.results.length) && !busy,
    execute: ({ actions }) => actions.clearOcrResults(),
  },
  {
    id: 'tools.commandPalette',
    label: 'Command Palette…',
    menu: 'tools',
    shortcut: 'Ctrl+Shift+P',
    enabled: always,
    execute: ({ actions }) => actions.showCommandPalette(),
  },
  {
    id: 'help.about',
    label: 'About Nammu PDF',
    menu: 'help',
    enabled: always,
    execute: ({ actions }) => actions.showAbout(),
  },
] as const;

export const PDF_MENU_ORDER: readonly { id: PdfMenuId; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'document', label: 'Document' },
  { id: 'comment', label: 'Comment' },
  { id: 'forms', label: 'Forms' },
  { id: 'protect', label: 'Protect' },
  { id: 'convert', label: 'Convert' },
  { id: 'tools', label: 'Tools' },
  { id: 'help', label: 'Help' },
];

export function commandsForMenu(menu: PdfMenuId): readonly PdfCommandDefinition[] {
  return PDF_COMMANDS.filter(
    (command) => command.menu === menu && !command.hidden && command.id !== 'document.reorderPages',
  );
}

export function findPdfCommand(id: PdfCommandId): PdfCommandDefinition | undefined {
  return PDF_COMMANDS.find((command) => command.id === id);
}
