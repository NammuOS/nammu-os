'use client';

import { MessageSquareText } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils';
import type {
  PdfAnnotation,
  PdfAnnotationAppearance,
  PdfAnnotationDraft,
  PdfPoint,
  PdfRect,
  PdfTextSelection,
} from './annotationModel';
import type { PdfWorkspaceTool } from './model';
import { buildPdfTextSelection } from './annotationGeometry';
import styles from './PdfApp.module.css';

const MARKUP_TOOLS = new Set<PdfWorkspaceTool>(['highlight', 'underline', 'strikeout']);
const DRAWING_TOOLS = new Set<PdfWorkspaceTool>([
  'note',
  'freeText',
  'ink',
  'line',
  'arrow',
  'rectangle',
  'ellipse',
]);

interface GestureState {
  start: PdfPoint;
  current: PdfPoint;
  points: PdfPoint[];
}

interface PdfAnnotationLayerProps {
  page: PDFPageProxy;
  viewport: PageViewport;
  pageNumber: number;
  tool: PdfWorkspaceTool;
  annotations: readonly PdfAnnotation[];
  selectedAnnotationId: string | null;
  appearance: PdfAnnotationAppearance;
  onSelectAnnotation(id: string | null): void;
  onTextSelection(selection: PdfTextSelection | null): void;
  onCreateAnnotation(draft: PdfAnnotationDraft): void;
}

function viewportRect(viewport: PageViewport, rect: PdfRect): PdfRect {
  const converted = viewport.convertToViewportRectangle([...rect]);
  return [
    Math.min(converted[0], converted[2]),
    Math.min(converted[1], converted[3]),
    Math.max(converted[0], converted[2]),
    Math.max(converted[1], converted[3]),
  ];
}

function localPoint(event: ReactPointerEvent, host: HTMLElement): PdfPoint {
  const bounds = host.getBoundingClientRect();
  return [
    Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
    Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
  ];
}

function pdfPoint(viewport: PageViewport, point: PdfPoint): PdfPoint {
  const converted = viewport.convertToPdfPoint(point[0], point[1]);
  return [converted[0], converted[1]];
}

function pdfRect(viewport: PageViewport, first: PdfPoint, second: PdfPoint): PdfRect {
  const a = pdfPoint(viewport, first);
  const b = pdfPoint(viewport, second);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

function paddedBounds(points: readonly PdfPoint[], padding: number): PdfRect {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [
    Math.min(...xs) - padding,
    Math.min(...ys) - padding,
    Math.max(...xs) + padding,
    Math.max(...ys) + padding,
  ];
}

function normalizeTextSelection(
  container: HTMLElement,
  viewport: PageViewport,
  pageNumber: number,
): PdfTextSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const bounds = container.getBoundingClientRect();
  const clientRects = [...range.getClientRects()].filter(
    (rect) => rect.width > 0.5 && rect.height > 0.5,
  );
  if (!clientRects.length) return null;
  return buildPdfTextSelection(
    pageNumber,
    selection.toString(),
    clientRects.map((rect) => ({
      left: Math.max(0, rect.left - bounds.left),
      right: Math.min(bounds.width, rect.right - bounds.left),
      top: Math.max(0, rect.top - bounds.top),
      bottom: Math.min(bounds.height, rect.bottom - bounds.top),
    })),
    (x, y) => pdfPoint(viewport, [x, y]),
  );
}

function draftFromGesture(
  pageNumber: number,
  tool: PdfWorkspaceTool,
  gesture: GestureState,
  viewport: PageViewport,
  appearance: PdfAnnotationAppearance,
): PdfAnnotationDraft | null {
  if (!DRAWING_TOOLS.has(tool)) return null;
  const start = pdfPoint(viewport, gesture.start);
  const current = pdfPoint(viewport, gesture.current);
  if (tool === 'note') {
    const size = 24 / viewport.scale;
    return {
      pageNumber,
      type: 'note',
      rect: [start[0], start[1] - size, start[0] + size, start[1]],
      appearance,
    };
  }
  if (tool === 'ink') {
    const points = gesture.points.map((point) => pdfPoint(viewport, point));
    if (points.length < 2) return null;
    return {
      pageNumber,
      type: 'ink',
      rect: paddedBounds(points, Math.max(2, appearance.strokeWidth * 2)),
      inkPaths: [points],
      appearance,
    };
  }
  if (tool === 'line' || tool === 'arrow') {
    if (Math.hypot(current[0] - start[0], current[1] - start[1]) < 3 / viewport.scale) {
      return null;
    }
    return {
      pageNumber,
      type: tool,
      rect: paddedBounds([start, current], Math.max(2, appearance.strokeWidth * 2)),
      line: [start[0], start[1], current[0], current[1]],
      appearance,
    };
  }
  const rect = pdfRect(viewport, gesture.start, gesture.current);
  if (
    Math.abs(gesture.current[0] - gesture.start[0]) < 3 ||
    Math.abs(gesture.current[1] - gesture.start[1]) < 3
  ) {
    return null;
  }
  if (tool === 'freeText' || tool === 'rectangle' || tool === 'ellipse') {
    return { pageNumber, type: tool, rect, appearance };
  }
  return null;
}

export function PdfAnnotationLayer({
  page,
  viewport,
  pageNumber,
  tool,
  annotations,
  selectedAnnotationId,
  appearance,
  onSelectAnnotation,
  onTextSelection,
  onCreateAnnotation,
}: PdfAnnotationLayerProps) {
  const textLayerRef = useRef<HTMLDivElement>(null);
  const gestureLayerRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<GestureState | null>(null);
  const pageAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.pageNumber === pageNumber),
    [annotations, pageNumber],
  );

  useEffect(() => {
    const container = textLayerRef.current;
    if (!container) return;
    container.replaceChildren();
    container.style.setProperty('--total-scale-factor', String(viewport.scale));
    container.style.setProperty('--scale-factor', String(viewport.scale));
    let cancelled = false;
    let layer: { cancel(): void; render(): Promise<unknown> } | null = null;
    void Promise.all([page.getTextContent(), import('pdfjs-dist')])
      .then(async ([textContent, pdfjs]) => {
        if (cancelled) return;
        layer = new pdfjs.TextLayer({ textContentSource: textContent, container, viewport });
        await layer.render();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      layer?.cancel();
      container.replaceChildren();
    };
  }, [page, viewport]);

  const finishTextSelection = () => {
    if (!textLayerRef.current) return;
    onTextSelection(normalizeTextSelection(textLayerRef.current, viewport, pageNumber));
  };

  const beginGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!DRAWING_TOOLS.has(tool) || !gestureLayerRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPoint(event, gestureLayerRef.current);
    setGesture({ start: point, current: point, points: [point] });
  };

  const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture || !gestureLayerRef.current) return;
    const point = localPoint(event, gestureLayerRef.current);
    setGesture((current) =>
      current
        ? {
            ...current,
            current: point,
            points:
              tool === 'ink' &&
              Math.hypot(point[0] - current.current[0], point[1] - current.current[1]) >= 2
                ? [...current.points, point]
                : current.points,
          }
        : null,
    );
  };

  const endGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture) return;
    event.preventDefault();
    event.stopPropagation();
    const draft = draftFromGesture(pageNumber, tool, gesture, viewport, appearance);
    setGesture(null);
    if (draft) onCreateAnnotation(draft);
  };

  const preview = gesture
    ? {
        left: Math.min(gesture.start[0], gesture.current[0]),
        top: Math.min(gesture.start[1], gesture.current[1]),
        width: Math.max(1, Math.abs(gesture.current[0] - gesture.start[0])),
        height: Math.max(1, Math.abs(gesture.current[1] - gesture.start[1])),
      }
    : null;

  return (
    <>
      <div
        ref={textLayerRef}
        className={`${styles.pdfTextLayer} ${MARKUP_TOOLS.has(tool) || tool === 'select' ? styles.pdfTextLayerActive : ''}`}
        onPointerUp={finishTextSelection}
        aria-hidden="true"
      />
      <div className={styles.annotationHitLayer} aria-label={`Annotations on page ${pageNumber}`}>
        {pageAnnotations.map((annotation) => {
          const rect = viewportRect(viewport, annotation.rect);
          return (
            <button
              key={annotation.id}
              type="button"
              className={`${styles.annotationHit} ${selectedAnnotationId === annotation.id ? styles.annotationHitSelected : ''}`}
              style={{
                left: rect[0],
                top: rect[1],
                width: Math.max(12, rect[2] - rect[0]),
                height: Math.max(12, rect[3] - rect[1]),
              }}
              aria-label={`${annotation.type} annotation`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectAnnotation(annotation.id);
              }}
            >
              {annotation.type === 'note' ? <MessageSquareText size={12} /> : null}
            </button>
          );
        })}
      </div>
      <div
        ref={gestureLayerRef}
        data-pdf-annotation-gesture={pageNumber}
        className={`${styles.annotationGestureLayer} ${DRAWING_TOOLS.has(tool) ? styles.annotationGestureLayerActive : ''}`}
        onPointerDown={beginGesture}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={() => setGesture(null)}
      >
        {preview ? (
          <span
            className={styles.annotationPreview}
            style={{
              ...preview,
              borderColor: appearance.color,
              opacity: appearance.opacity,
              borderRadius: tool === 'ellipse' ? '50%' : undefined,
            }}
          />
        ) : null}
      </div>
    </>
  );
}
