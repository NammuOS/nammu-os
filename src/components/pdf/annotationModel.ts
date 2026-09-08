export type PdfAnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'freeText'
  | 'ink'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'polyline'
  | 'stamp'
  | 'signature'
  | 'unknown';

export type PdfAnnotationTool =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'freeText'
  | 'ink'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'ellipse';

export type PdfPoint = readonly [x: number, y: number];
export type PdfRect = readonly [x1: number, y1: number, x2: number, y2: number];

export interface PdfTextSelection {
  pageNumber: number;
  text: string;
  quadPoints: readonly number[];
  rect: PdfRect;
}

export interface PdfAnnotationAppearance {
  color: string;
  fillColor: string | null;
  opacity: number;
  strokeWidth: number;
  fontSize: number;
}

export interface PdfAnnotation {
  id: string;
  nativeRef: string | null;
  pageNumber: number;
  type: PdfAnnotationType;
  rect: PdfRect;
  quadPoints: readonly number[];
  line: readonly number[];
  vertices: readonly number[];
  inkPaths: readonly (readonly PdfPoint[])[];
  content: string;
  author: string;
  createdAt: string | null;
  modifiedAt: string | null;
  appearance: PdfAnnotationAppearance;
  hasAppearance: boolean;
  editable: boolean;
  source: 'existing' | 'nammu';
}

export interface PdfAnnotationDraft {
  pageNumber: number;
  type: Exclude<PdfAnnotationType, 'unknown' | 'stamp' | 'signature'>;
  rect: PdfRect;
  quadPoints?: readonly number[];
  line?: readonly number[];
  vertices?: readonly number[];
  inkPaths?: readonly (readonly PdfPoint[])[];
  content?: string;
  author?: string;
  appearance: PdfAnnotationAppearance;
}

export interface PdfAnnotationPatch {
  content?: string;
  author?: string;
  appearance?: Partial<PdfAnnotationAppearance>;
}

export const DEFAULT_ANNOTATION_APPEARANCE: PdfAnnotationAppearance = {
  color: '#ffcf3d',
  fillColor: null,
  opacity: 0.55,
  strokeWidth: 2,
  fontSize: 12,
};

export const PDF_ANNOTATION_TYPES: readonly PdfAnnotationType[] = [
  'highlight',
  'underline',
  'strikeout',
  'note',
  'freeText',
  'ink',
  'line',
  'arrow',
  'rectangle',
  'ellipse',
  'polygon',
  'polyline',
  'stamp',
  'signature',
  'unknown',
];

export function annotationTypeLabel(type: PdfAnnotationType): string {
  const labels: Record<PdfAnnotationType, string> = {
    highlight: 'Highlight',
    underline: 'Underline',
    strikeout: 'Strikethrough',
    note: 'Sticky Note',
    freeText: 'Text Box',
    ink: 'Ink',
    line: 'Line',
    arrow: 'Arrow',
    rectangle: 'Rectangle',
    ellipse: 'Ellipse',
    polygon: 'Polygon',
    polyline: 'Polyline',
    stamp: 'Stamp',
    signature: 'Visual Signature',
    unknown: 'Unsupported Annotation',
  };
  return labels[type];
}
