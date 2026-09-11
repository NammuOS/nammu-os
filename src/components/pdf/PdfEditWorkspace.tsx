'use client';

import { ImagePlus, MousePointer2, Trash2, Type } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils';
import type {
  PdfContentObjectDraft,
  PdfContentObjectPatch,
  PdfEditableContentObject,
} from './contentEditModel';
import type { PdfCommandId } from './pdfCommands';
import type { PdfDocumentSession } from './model';
import styles from './PdfApp.module.css';

export function PdfEditToolbar({
  session,
  busy,
  execute,
}: {
  session: PdfDocumentSession;
  busy: boolean;
  execute(id: PdfCommandId): void;
}) {
  return (
    <div className={styles.commentToolGroup} aria-label="Edit content tools">
      <button
        type="button"
        className={`${styles.toolButton} ${session.tool === 'edit-select' ? styles.toolButtonActive : ''}`}
        disabled={busy}
        onClick={() => execute('content.select')}
        title="Select Nammu-authored page content"
      >
        <MousePointer2 size={14} />
        <span className={styles.toolLabel}>Select</span>
      </button>
      <button
        type="button"
        className={`${styles.toolButton} ${session.tool === 'edit-text' ? styles.toolButtonActive : ''}`}
        disabled={busy || session.fidelity.signatures}
        onClick={() => execute('content.addText')}
        title="Click the page to add real PDF text"
      >
        <Type size={14} />
        <span className={styles.toolLabel}>Text</span>
      </button>
      <button
        type="button"
        className={styles.toolButton}
        disabled={busy || session.fidelity.signatures}
        onClick={() => execute('content.addImage')}
        title="Place a PNG or JPEG on the active page"
      >
        <ImagePlus size={14} />
        <span className={styles.toolLabel}>Image</span>
      </button>
      <button
        type="button"
        className={styles.toolButton}
        disabled={busy || !session.contentEdit.selectedObjectId || session.fidelity.signatures}
        onClick={() => execute('content.delete')}
        title="Delete selected authored content"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function PdfEditLayer({
  viewport,
  pageNumber,
  objects,
  selectedId,
  tool,
  onSelect,
  onPlaceText,
  onUpdate,
}: {
  viewport: PageViewport;
  pageNumber: number;
  objects: readonly PdfEditableContentObject[];
  selectedId: string | null;
  tool: string;
  onSelect(id: string | null): void;
  onPlaceText(draft: PdfContentObjectDraft): void;
  onUpdate(patch: PdfContentObjectPatch): void;
}) {
  return (
    <div
      data-pdf-edit-layer={pageNumber}
      className={`${styles.editLayer} ${tool === 'edit-text' ? styles.editLayerPlacement : ''}`}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.target !== event.currentTarget) return;
        if (tool !== 'edit-text') return onSelect(null);
        const bounds = event.currentTarget.getBoundingClientRect();
        const [x, y] = viewport.convertToPdfPoint(
          event.clientX - bounds.left,
          event.clientY - bounds.top,
        );
        onPlaceText({
          pageNumber,
          kind: 'text',
          x,
          y,
          text: 'New text',
          fontSize: 18,
          color: '#111827',
        });
      }}
    >
      {objects
        .filter((object) => object.pageNumber === pageNumber)
        .map((object) => {
          const [leftA, topA, rightA, bottomA] = viewport.convertToViewportRectangle([
            object.x,
            object.y,
            object.x + object.width,
            object.y + object.height,
          ]);
          const left = Math.min(leftA, rightA);
          const top = Math.min(topA, bottomA);
          const width = Math.max(8, Math.abs(rightA - leftA));
          const height = Math.max(8, Math.abs(bottomA - topA));
          return (
            <button
              key={object.id}
              data-pdf-content-object={object.id}
              type="button"
              aria-label={`Select ${object.kind} content`}
              className={`${styles.editObjectHit} ${selectedId === object.id ? styles.editObjectSelected : ''}`}
              style={{ left, top, width, height }}
              onPointerDown={(event) => {
                if (event.button !== 0 || tool !== 'edit-select') return;
                event.stopPropagation();
                onSelect(object.id);
                const target = event.currentTarget;
                const layerBounds = target.parentElement!.getBoundingClientRect();
                const start = viewport.convertToPdfPoint(
                  event.clientX - layerBounds.left,
                  event.clientY - layerBounds.top,
                );
                const origin = { x: object.x, y: object.y };
                const startClient = { x: event.clientX, y: event.clientY };
                target.setPointerCapture(event.pointerId);
                const move = (next: PointerEvent) => {
                  target.style.transform = `translate(${next.clientX - startClient.x}px, ${next.clientY - startClient.y}px)`;
                };
                const complete = (finish: PointerEvent) => {
                  if (target.hasPointerCapture(event.pointerId))
                    target.releasePointerCapture(event.pointerId);
                  target.style.transform = '';
                  target.removeEventListener('pointermove', move);
                  target.removeEventListener('pointerup', complete);
                  target.removeEventListener('pointercancel', complete);
                  if (finish.type === 'pointercancel') return;
                  const end = viewport.convertToPdfPoint(
                    finish.clientX - layerBounds.left,
                    finish.clientY - layerBounds.top,
                  );
                  const dx = end[0] - start[0];
                  const dy = end[1] - start[1];
                  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
                    onUpdate({ x: origin.x + dx, y: origin.y + dy });
                };
                target.addEventListener('pointermove', move);
                target.addEventListener('pointerup', complete);
                target.addEventListener('pointercancel', complete);
              }}
            />
          );
        })}
    </div>
  );
}

export function PdfEditInspector({
  session,
  busy,
  onSelect,
  onApply,
  onDelete,
  onReplaceImage,
}: {
  session: PdfDocumentSession;
  busy: boolean;
  onSelect(id: string): void;
  onApply(patch: PdfContentObjectPatch): void;
  onDelete(): void;
  onReplaceImage(): void;
}) {
  const selected = session.contentEdit.objects.find(
    (object) => object.id === session.contentEdit.selectedObjectId,
  );
  const [draft, setDraft] = useState<PdfContentObjectPatch>({});
  useEffect(() => {
    setDraft(
      selected
        ? {
            x: selected.x,
            y: selected.y,
            width: selected.width,
            height: selected.height,
            rotation: selected.rotation,
            opacity: selected.opacity,
            text: selected.text,
            fontSize: selected.fontSize,
            color: selected.color,
          }
        : {},
    );
  }, [selected]);
  const numeric = (key: keyof PdfContentObjectPatch, value: string) =>
    setDraft((current) => ({ ...current, [key]: Number(value) }));

  if (!selected)
    return (
      <div className="h-[calc(100%-31px)] overflow-auto p-3 text-[9px] leading-5 text-os-text-muted">
        <p>Select authored text or an image to edit its geometry and appearance.</p>
        <p className="mt-3 border-t border-os-line pt-3 text-os-text-dim">
          Existing arbitrary page objects are preserved but remain inspection-only with the current
          compatible engine.
        </p>
        <div className="mt-3 grid gap-1">
          {session.contentEdit.objects.map((object) => (
            <button
              key={object.id}
              type="button"
              onClick={() => onSelect(object.id)}
              className={styles.commentItem}
            >
              <span className="uppercase text-os-accent">{object.kind}</span>
              <span>
                Page {object.pageNumber}
                {object.text ? ` · ${object.text.slice(0, 42)}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="h-[calc(100%-31px)] overflow-auto p-3">
      <p className="mb-3 text-[9px] uppercase tracking-[0.12em] text-os-accent">
        {selected.kind} · Page {selected.pageNumber}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(['x', 'y', 'width', 'height', 'rotation'] as const).map((key) => (
          <label key={key} className={styles.annotationInspectorField}>
            <span className="capitalize">{key}</span>
            <input
              type="number"
              value={String(draft[key] ?? '')}
              onChange={(event) => numeric(key, event.target.value)}
            />
          </label>
        ))}
        <label className={styles.annotationInspectorField}>
          <span>Opacity</span>
          <input
            type="number"
            min="0.05"
            max="1"
            step="0.05"
            value={String(draft.opacity ?? 1)}
            onChange={(event) => numeric('opacity', event.target.value)}
          />
        </label>
      </div>
      {selected.kind === 'text' ? (
        <div className="mt-3 grid gap-2">
          <label className={styles.annotationInspectorField}>
            <span>Text</span>
            <textarea
              rows={4}
              value={draft.text ?? ''}
              onChange={(event) =>
                setDraft((current) => ({ ...current, text: event.target.value }))
              }
            />
          </label>
          <label className={styles.annotationInspectorField}>
            <span>Font size</span>
            <input
              type="number"
              min="4"
              max="512"
              value={String(draft.fontSize ?? 18)}
              onChange={(event) => numeric('fontSize', event.target.value)}
            />
          </label>
          <label className={styles.annotationInspectorField}>
            <span>Color</span>
            <input
              type="color"
              value={draft.color ?? '#111827'}
              onChange={(event) =>
                setDraft((current) => ({ ...current, color: event.target.value }))
              }
            />
          </label>
        </div>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onApply(draft)}
          className="border border-os-accent/50 bg-os-accent/10 px-3 py-1.5 text-[9px] disabled:opacity-40"
        >
          Apply
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="border border-red-400/30 px-3 py-1.5 text-[9px] text-red-300 disabled:opacity-40"
        >
          Delete
        </button>
        {selected.kind === 'image' ? (
          <button
            type="button"
            disabled={busy}
            onClick={onReplaceImage}
            className="border border-os-line-strong px-3 py-1.5 text-[9px] disabled:opacity-40"
          >
            Replace…
          </button>
        ) : null}
      </div>
    </div>
  );
}
