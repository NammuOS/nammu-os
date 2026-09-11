import type { PdfRect } from './annotationModel';

export type PdfProtectionTool = 'protect-select' | 'redact-region';

export interface PdfRedactionMark {
  id: string;
  nativeRef: string;
  pageNumber: number;
  rect: PdfRect;
  quadPoints: readonly number[];
  reason: string;
  color: string;
}

export interface PdfSecurityInspection {
  encrypted: boolean;
  signatures: boolean;
  metadata: boolean;
  xmpMetadata: boolean;
  javascript: boolean;
  activeActions: boolean;
  attachments: boolean;
  forms: boolean;
  xfa: boolean;
  annotationCount: number;
  pendingRedactions: number;
}

export interface PdfProtectionModel {
  inspection: PdfSecurityInspection;
  redactions: readonly PdfRedactionMark[];
  selectedRedactionId: string | null;
}

export interface PdfSanitizeOptions {
  metadata: boolean;
  javascriptAndActions: boolean;
  attachments: boolean;
}

export const DEFAULT_SANITIZE_OPTIONS: PdfSanitizeOptions = {
  metadata: true,
  javascriptAndActions: true,
  attachments: true,
};
