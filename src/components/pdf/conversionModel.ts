export type PdfExportFormat = 'png' | 'jpeg' | 'webp' | 'text' | 'markdown' | 'json';
export type PdfPageScope = 'all' | 'current' | 'selected';
export type PdfConversionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface PdfConversionOptions {
  format: PdfExportFormat;
  pageScope: PdfPageScope;
  dpi: 96 | 144 | 300;
  quality: number;
}

export interface PdfConversionState {
  options: PdfConversionOptions;
  status: PdfConversionStatus;
  completed: number;
  total: number;
}

export const DEFAULT_CONVERSION_STATE: PdfConversionState = {
  options: { format: 'png', pageScope: 'all', dpi: 144, quality: 0.9 },
  status: 'idle',
  completed: 0,
  total: 0,
};
