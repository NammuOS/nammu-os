import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  PdfAnnotation,
  PdfAnnotationAppearance,
  PdfAnnotationTool,
  PdfTextSelection,
} from './annotationModel';
import type { PdfFormModel, PdfFormTool } from './formModel';
import type { PdfContentEditModel, PdfContentTool } from './contentEditModel';
import type { PdfProtectionModel, PdfProtectionTool } from './protectionModel';
import type { PdfConversionState } from './conversionModel';
import type { PdfOcrState } from './ocrModel';

export type PdfZoomMode = 'custom' | 'actual' | 'fit-width' | 'fit-page';
export type PdfViewMode = 'continuous' | 'single-page';
export type PdfWorkspaceTool = 'select' | 'hand' | PdfAnnotationTool | PdfFormTool | PdfContentTool | PdfProtectionTool;
export type PdfWorkspaceMode = 'read' | 'organize' | 'comment' | 'forms' | 'edit' | 'protect' | 'convert' | 'ocr';

export interface PdfFidelityProfile {
  forms: boolean;
  signatures: boolean;
  annotations: boolean;
  outlines: boolean;
  attachments: boolean;
  xfa: boolean;
  incrementalUpdates: boolean;
  metadata: boolean;
  pageLabels: boolean;
  warnings: readonly string[];
}

export interface PdfPageInfo {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PdfDocumentMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
}

export type PdfDocumentSource =
  { kind: 'picker'; path?: string } | { kind: 'native-path'; path: string };

export interface PdfHistorySnapshot {
  label: string;
  bytes: Uint8Array;
}

export interface PdfDocumentSession {
  id: string;
  name: string;
  source: PdfDocumentSource;
  bytes: Uint8Array;
  size: number;
  renderDocument: PDFDocumentProxy;
  pages: readonly PdfPageInfo[];
  metadata: PdfDocumentMetadata;
  activePage: number;
  selectedPages: readonly number[];
  selectionAnchor: number;
  zoom: number;
  zoomMode: PdfZoomMode;
  viewMode: PdfViewMode;
  tool: PdfWorkspaceTool;
  workspaceMode: PdfWorkspaceMode;
  annotations: readonly PdfAnnotation[];
  selectedAnnotationId: string | null;
  textSelection: PdfTextSelection | null;
  annotationAppearance: PdfAnnotationAppearance;
  form: PdfFormModel;
  selectedFormFieldId: string | null;
  selectedFormWidgetId: string | null;
  contentEdit: PdfContentEditModel;
  protection: PdfProtectionModel;
  conversion: PdfConversionState;
  ocr: PdfOcrState;
  fidelity: PdfFidelityProfile;
  dirty: boolean;
  revision: number;
  history: {
    past: readonly PdfHistorySnapshot[];
    future: readonly PdfHistorySnapshot[];
  };
}

export interface PdfNativeOpenRequest {
  kind: 'native-path';
  path: string;
  name: string;
}

export interface PdfAppInitialData {
  openRequest?: PdfNativeOpenRequest;
}

export interface PdfSearchResult {
  pageNumber: number;
  excerpt: string;
  matches: number;
}
