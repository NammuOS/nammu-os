import type { PdfPoint, PdfTextSelection } from './annotationModel';

export interface PdfViewportSelectionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function buildPdfTextSelection(
  pageNumber: number,
  text: string,
  rects: readonly PdfViewportSelectionRect[],
  convertToPdfPoint: (x: number, y: number) => PdfPoint,
): PdfTextSelection | null {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || rects.length === 0) return null;
  const quads: number[] = [];
  const points: PdfPoint[] = [];
  for (const rect of rects) {
    if (
      ![rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite) ||
      rect.right <= rect.left ||
      rect.bottom <= rect.top
    ) {
      continue;
    }
    const topLeft = convertToPdfPoint(rect.left, rect.top);
    const topRight = convertToPdfPoint(rect.right, rect.top);
    const bottomLeft = convertToPdfPoint(rect.left, rect.bottom);
    const bottomRight = convertToPdfPoint(rect.right, rect.bottom);
    quads.push(...topLeft, ...topRight, ...bottomLeft, ...bottomRight);
    points.push(topLeft, topRight, bottomLeft, bottomRight);
  }
  if (!points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    pageNumber,
    text: [...text]
      .map((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 ? ' ' : character;
      })
      .join('')
      .trim()
      .slice(0, 16_384),
    quadPoints: quads,
    rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}
