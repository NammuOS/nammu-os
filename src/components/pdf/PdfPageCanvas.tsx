'use client';

import { GripVertical } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils';
import type {
  PdfAnnotation,
  PdfAnnotationAppearance,
  PdfAnnotationDraft,
  PdfTextSelection,
} from './annotationModel';
import type { PdfWorkspaceTool } from './model';
import type { PdfPageSelectionModifiers } from './pageSelection';
import { PdfAnnotationLayer } from './PdfAnnotationLayer';
import { PdfFormLayer } from './PdfFormLayer';
import type { PdfFormFieldDraft, PdfFormFieldPatch, PdfFormModel, PdfFormTool } from './formModel';

interface PageCanvasProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  selected: boolean;
  lazy?: boolean;
  commentMode: boolean;
  formsMode: boolean;
  formsVisible: boolean;
  form: PdfFormModel;
  tool: PdfWorkspaceTool;
  annotations: readonly PdfAnnotation[];
  selectedAnnotationId: string | null;
  annotationAppearance: PdfAnnotationAppearance;
  onSelect(pageNumber: number, modifiers?: PdfPageSelectionModifiers): void;
  onSelectAnnotation(id: string | null): void;
  onTextSelection(selection: PdfTextSelection | null): void;
  onCreateAnnotation(draft: PdfAnnotationDraft): void;
  selectedFormFieldId: string | null;
  selectedFormWidgetId: string | null;
  signed: boolean;
  onSelectFormField(fieldId: string | null, widgetId: string | null): void;
  onCreateFormField(draft: PdfFormFieldDraft): void;
  onUpdateFormField(fieldId: string, patch: PdfFormFieldPatch): void;
}

export function PdfPageCanvas({
  document,
  pageNumber,
  scale,
  selected,
  lazy = true,
  commentMode,
  formsMode,
  formsVisible,
  form,
  tool,
  annotations,
  selectedAnnotationId,
  annotationAppearance,
  onSelect,
  onSelectAnnotation,
  onTextSelection,
  onCreateAnnotation,
  selectedFormFieldId,
  selectedFormWidgetId,
  signed,
  onSelectFormField,
  onCreateFormField,
  onUpdateFormField,
}: PageCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const [visible, setVisible] = useState(!lazy);
  const [dimensions, setDimensions] = useState({ width: 612 * scale, height: 792 * scale });
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);
  const [pageViewport, setPageViewport] = useState<PageViewport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!lazy || visible || !hostRef.current || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '500px 0px' },
    );
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [lazy, visible]);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    let disposed = false;
    setFailed(false);
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (disposed || !canvasRef.current) return;
        const viewport = page.getViewport({ scale });
        setPageProxy(page);
        setPageViewport(viewport);
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas rendering is unavailable.');
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        setDimensions({ width: viewport.width, height: viewport.height });
        renderRef.current = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        return renderRef.current.promise;
      })
      .catch((error) => {
        if (
          !disposed &&
          !(error instanceof Error && error.name === 'RenderingCancelledException')
        ) {
          setFailed(true);
        }
      });
    return () => {
      disposed = true;
      renderRef.current?.cancel();
      renderRef.current = null;
    };
  }, [document, pageNumber, scale, visible]);

  return (
    <div
      ref={hostRef}
      role="button"
      tabIndex={0}
      data-pdf-page={pageNumber}
      aria-label={`Page ${pageNumber}`}
      aria-current={selected ? 'page' : undefined}
      onClick={(event) =>
        onSelect(pageNumber, {
          additive: event.ctrlKey || event.metaKey,
          range: event.shiftKey,
        })
      }
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect(pageNumber);
      }}
      className={`group relative shrink-0 border bg-white text-left shadow-[0_16px_46px_rgba(0,0,0,0.28)] transition-[border-color,box-shadow] ${
        selected
          ? 'border-os-accent shadow-[0_0_0_1px_var(--os-accent),0_18px_54px_rgba(0,0,0,0.34)]'
          : 'border-black/30 hover:border-os-text-dim'
      }`}
      style={{ width: dimensions.width, minHeight: dimensions.height }}
    >
      <canvas ref={canvasRef} className="block max-w-none" />
      {commentMode && pageProxy && pageViewport ? (
        <PdfAnnotationLayer
          page={pageProxy}
          viewport={pageViewport}
          pageNumber={pageNumber}
          tool={tool}
          annotations={annotations}
          selectedAnnotationId={selectedAnnotationId}
          appearance={annotationAppearance}
          onSelectAnnotation={onSelectAnnotation}
          onTextSelection={onTextSelection}
          onCreateAnnotation={onCreateAnnotation}
        />
      ) : null}
      {!commentMode &&
      formsVisible &&
      pageProxy &&
      pageViewport &&
      (formsMode || form.fields.length > 0) ? (
        <PdfFormLayer
          viewport={pageViewport}
          pageNumber={pageNumber}
          form={form}
          tool={String(tool).startsWith('form-') ? (tool as PdfFormTool) : null}
          authoring={formsMode}
          signed={signed}
          selectedFieldId={selectedFormFieldId}
          selectedWidgetId={selectedFormWidgetId}
          onSelect={onSelectFormField}
          onCreate={onCreateFormField}
          onUpdate={onUpdateFormField}
        />
      ) : null}
      {!visible ? <span className="absolute inset-0 bg-[#e7e7e7]" aria-hidden="true" /> : null}
      {failed ? (
        <span className="absolute inset-0 grid place-items-center bg-[#e7e7e7] px-6 text-center text-xs text-[#4b5563]">
          Page {pageNumber} could not be rendered.
        </span>
      ) : null}
      <span className="pointer-events-none absolute bottom-2 right-2 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">
        {pageNumber}
      </span>
    </div>
  );
}

interface ThumbnailProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  pageWidth: number;
  selected: boolean;
  organize?: boolean;
  dragging?: boolean;
  dropPlacement?: 'before' | 'after' | null;
  onSelect(pageNumber: number, modifiers?: PdfPageSelectionModifiers): void;
  onContextMenu?(pageNumber: number, event: MouseEvent<HTMLButtonElement>): void;
  onDragStart?(pageNumber: number, event: DragEvent<HTMLButtonElement>): void;
  onDragOver?(pageNumber: number, event: DragEvent<HTMLButtonElement>): void;
  onDrop?(pageNumber: number, event: DragEvent<HTMLButtonElement>): void;
  onDragEnd?(): void;
}

export function PdfPageThumbnail({
  document,
  pageNumber,
  pageWidth,
  selected,
  organize = false,
  dragging = false,
  dropPlacement = null,
  onSelect,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: ThumbnailProps) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const [visible, setVisible] = useState(pageNumber <= 8);

  useEffect(() => {
    if (visible || !hostRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    let disposed = false;
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (disposed || !canvasRef.current) return;
        const unit = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: pageWidth / unit.width });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;
        const outputScale = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        taskRef.current = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        return taskRef.current.promise;
      })
      .catch((error) => {
        if (disposed || String(error?.name) === 'RenderingCancelledException') return;
        // A failed thumbnail remains blank; the primary page canvas owns the visible error state.
      });
    return () => {
      disposed = true;
      taskRef.current?.cancel();
    };
  }, [document, pageNumber, pageWidth, visible]);

  return (
    <button
      ref={hostRef}
      type="button"
      draggable={organize}
      data-pdf-thumbnail={pageNumber}
      aria-pressed={selected}
      onClick={(event) =>
        onSelect(pageNumber, {
          additive: event.ctrlKey || event.metaKey,
          range: event.shiftKey,
        })
      }
      onContextMenu={(event) => onContextMenu?.(pageNumber, event)}
      onDragStart={(event) => onDragStart?.(pageNumber, event)}
      onDragOver={(event) => onDragOver?.(pageNumber, event)}
      onDrop={(event) => onDrop?.(pageNumber, event)}
      onDragEnd={onDragEnd}
      className={`relative mx-auto block w-full text-center transition-colors ${
        organize ? 'px-4 py-3 cursor-grab active:cursor-grabbing' : 'px-3 py-2'
      } ${
        selected ? 'bg-os-accent/10 text-os-text' : 'text-os-text-muted hover:bg-white/[0.035]'
      } ${dragging ? 'opacity-45' : ''}`}
    >
      {dropPlacement === 'before' ? (
        <span className="absolute inset-x-2 top-0 h-px bg-os-accent shadow-[0_0_8px_var(--os-accent)]" />
      ) : null}
      <span
        className={`mx-auto block w-fit overflow-hidden border bg-white shadow-sm ${
          selected ? 'border-os-accent' : 'border-white/10'
        }`}
      >
        {visible ? (
          <canvas ref={canvasRef} className="block" />
        ) : (
          <span className="block h-36 w-28" />
        )}
      </span>
      <span className="mt-1.5 flex items-center justify-center gap-1.5 font-mono text-[9px]">
        {organize ? <GripVertical size={10} aria-hidden="true" /> : null}
        {pageNumber}
      </span>
      {dropPlacement === 'after' ? (
        <span className="absolute inset-x-2 bottom-0 h-px bg-os-accent shadow-[0_0_8px_var(--os-accent)]" />
      ) : null}
    </button>
  );
}
