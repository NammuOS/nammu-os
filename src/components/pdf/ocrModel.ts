import type { PdfPageScope } from './conversionModel';

export type PdfOcrPageKind = 'text-present' | 'image-only' | 'mixed' | 'unknown';
export type PdfOcrStatus = 'idle' | 'loading' | 'recognizing' | 'building' | 'completed' | 'failed' | 'cancelled';

export interface PdfOcrWord {
  text: string;
  confidence: number;
  /** PDF user-space coordinates, with the origin at the page's bottom-left. */
  box: { x: number; y: number; width: number; height: number };
}

export interface PdfOcrLine {
  text: string;
  confidence: number;
  words: readonly PdfOcrWord[];
}

export interface PdfOcrPageResult {
  pageNumber: number;
  kindBeforeOcr: PdfOcrPageKind;
  text: string;
  confidence: number;
  lines: readonly PdfOcrLine[];
  bitmap: { width: number; height: number };
}

export interface PdfOcrOptions {
  language: 'eng';
  pageScope: PdfPageScope;
  quality: 'balanced' | 'accurate';
  force: boolean;
  binarize: boolean;
}

export interface PdfOcrState {
  options: PdfOcrOptions;
  status: PdfOcrStatus;
  stage: string;
  completed: number;
  total: number;
  results: readonly PdfOcrPageResult[];
}

export const DEFAULT_OCR_STATE: PdfOcrState = {
  options: { language: 'eng', pageScope: 'all', quality: 'balanced', force: false, binarize: false },
  status: 'idle',
  stage: '',
  completed: 0,
  total: 0,
  results: [],
};
