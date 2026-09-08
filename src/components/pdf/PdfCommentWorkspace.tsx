'use client';

import {
  ArrowDownRight,
  ChevronDown,
  ChevronUp,
  Circle,
  Highlighter,
  MessageSquareText,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  Strikethrough,
  Trash2,
  Type,
  Underline,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { PdfAnnotation, PdfAnnotationPatch } from './annotationModel';
import { annotationTypeLabel } from './annotationModel';
import type { PdfCommandId } from './pdfCommands';
import type { PdfDocumentSession } from './model';
import styles from './PdfApp.module.css';

const TOOLS: readonly {
  id: PdfCommandId;
  tool: PdfDocumentSession['tool'];
  label: string;
  icon: typeof MousePointer2;
}[] = [
  { id: 'comment.select', tool: 'select', label: 'Select annotation', icon: MousePointer2 },
  { id: 'comment.highlight', tool: 'highlight', label: 'Highlight text', icon: Highlighter },
  { id: 'comment.underline', tool: 'underline', label: 'Underline text', icon: Underline },
  { id: 'comment.strikeout', tool: 'strikeout', label: 'Strikethrough text', icon: Strikethrough },
  { id: 'comment.note', tool: 'note', label: 'Sticky note', icon: MessageSquareText },
  { id: 'comment.freeText', tool: 'freeText', label: 'Text box', icon: Type },
  { id: 'comment.ink', tool: 'ink', label: 'Freehand ink', icon: Pencil },
  { id: 'comment.line', tool: 'line', label: 'Line', icon: Minus },
  { id: 'comment.arrow', tool: 'arrow', label: 'Arrow', icon: ArrowDownRight },
  { id: 'comment.rectangle', tool: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'comment.ellipse', tool: 'ellipse', label: 'Ellipse', icon: Circle },
];

export function PdfCommentToolbar({
  session,
  busy,
  execute,
  onAppearanceChange,
}: {
  session: PdfDocumentSession;
  busy: boolean;
  execute(id: PdfCommandId): void;
  onAppearanceChange(color: string): void;
}) {
  return (
    <div className={styles.commentToolGroup} aria-label="Comment tools">
      {TOOLS.map(({ id, tool, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={`${styles.toolButton} ${session.tool === tool ? styles.toolButtonActive : ''}`}
          disabled={busy || (session.fidelity.signatures && tool !== 'select')}
          onClick={() => execute(id)}
          title={label}
          aria-pressed={session.tool === tool}
        >
          <Icon size={14} />
        </button>
      ))}
      <span className={styles.toolSeparator} />
      <label
        className="flex h-7 items-center gap-1 px-1 text-[8px] text-os-text-dim"
        title="Annotation color"
      >
        Color
        <input
          type="color"
          className="h-5 w-6 border-0 bg-transparent p-0"
          value={session.annotationAppearance.color}
          onChange={(event) => onAppearanceChange(event.target.value)}
        />
      </label>
    </div>
  );
}

interface DraftState {
  content: string;
  author: string;
  color: string;
  fillColor: string;
  opacity: number;
  strokeWidth: number;
  fontSize: number;
}

function draftFor(annotation: PdfAnnotation): DraftState {
  return {
    content: annotation.content,
    author: annotation.author,
    color: annotation.appearance.color,
    fillColor: annotation.appearance.fillColor ?? '',
    opacity: annotation.appearance.opacity,
    strokeWidth: annotation.appearance.strokeWidth,
    fontSize: annotation.appearance.fontSize,
  };
}

function Properties({
  annotation,
  busy,
  readOnly,
  onApply,
  onDelete,
}: {
  annotation: PdfAnnotation;
  busy: boolean;
  readOnly: boolean;
  onApply(patch: PdfAnnotationPatch): void;
  onDelete(): void;
}) {
  const [draft, setDraft] = useState(() => draftFor(annotation));
  useEffect(() => setDraft(draftFor(annotation)), [annotation]);
  const supportsFill = annotation.type === 'rectangle' || annotation.type === 'ellipse';
  const supportsWidth = [
    'ink',
    'line',
    'arrow',
    'rectangle',
    'ellipse',
    'polygon',
    'polyline',
  ].includes(annotation.type);
  return (
    <section className="border-b border-os-line p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[10px] font-medium text-os-text">
            {annotationTypeLabel(annotation.type)}
          </h2>
          <p className="mt-0.5 font-mono text-[8px] text-os-text-dim">
            Page {annotation.pageNumber}
          </p>
        </div>
        <button
          type="button"
          className={styles.toolButton}
          disabled={busy || readOnly}
          onClick={onDelete}
          title="Delete annotation"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {annotation.editable && !readOnly ? (
        <div className="grid gap-2.5">
          <label className={styles.annotationInspectorField}>
            Comment
            <textarea
              rows={3}
              value={draft.content}
              onChange={(event) =>
                setDraft((current) => ({ ...current, content: event.target.value }))
              }
            />
          </label>
          <label className={styles.annotationInspectorField}>
            Author
            <input
              value={draft.author}
              onChange={(event) =>
                setDraft((current) => ({ ...current, author: event.target.value }))
              }
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={styles.annotationInspectorField}>
              Color
              <input
                type="color"
                value={draft.color}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, color: event.target.value }))
                }
              />
            </label>
            {supportsFill ? (
              <label className={styles.annotationInspectorField}>
                Fill
                <input
                  type="color"
                  value={draft.fillColor || '#ffffff'}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, fillColor: event.target.value }))
                  }
                />
              </label>
            ) : null}
          </div>
          <label className={styles.annotationInspectorField}>
            Opacity · {Math.round(draft.opacity * 100)}%
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={draft.opacity}
              onChange={(event) =>
                setDraft((current) => ({ ...current, opacity: Number(event.target.value) }))
              }
            />
          </label>
          {supportsWidth ? (
            <label className={styles.annotationInspectorField}>
              Stroke · {draft.strokeWidth.toFixed(1)} pt
              <input
                type="range"
                min="0.5"
                max="12"
                step="0.5"
                value={draft.strokeWidth}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, strokeWidth: Number(event.target.value) }))
                }
              />
            </label>
          ) : null}
          {annotation.type === 'freeText' ? (
            <label className={styles.annotationInspectorField}>
              Font size
              <input
                type="number"
                min="6"
                max="96"
                value={draft.fontSize}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, fontSize: Number(event.target.value) }))
                }
              />
            </label>
          ) : null}
          <button
            type="button"
            className="h-7 border border-os-accent/45 bg-os-accent/10 text-[9px] text-os-text hover:bg-os-accent/15 disabled:opacity-40"
            disabled={busy}
            onClick={() =>
              onApply({
                content: draft.content,
                author: draft.author,
                appearance: {
                  color: draft.color,
                  fillColor: supportsFill
                    ? draft.fillColor || null
                    : annotation.appearance.fillColor,
                  opacity: draft.opacity,
                  strokeWidth: draft.strokeWidth,
                  fontSize: draft.fontSize,
                },
              })
            }
          >
            Apply properties
          </button>
        </div>
      ) : (
        <p className="text-[9px] leading-4 text-os-text-dim">
          {readOnly
            ? 'This signed document remains inspection-only because changing annotations can invalidate its signature.'
            : 'This existing annotation is preserved and shown read-only because its appearance cannot be regenerated safely.'}
        </p>
      )}
    </section>
  );
}

export function PdfCommentsInspector({
  session,
  busy,
  onSelect,
  onApply,
  onDelete,
  onNavigate,
}: {
  session: PdfDocumentSession;
  busy: boolean;
  onSelect(id: string): void;
  onApply(patch: PdfAnnotationPatch): void;
  onDelete(): void;
  onNavigate(direction: -1 | 1): void;
}) {
  const annotations = useMemo(
    () =>
      [...session.annotations].sort(
        (a, b) => a.pageNumber - b.pageNumber || a.id.localeCompare(b.id),
      ),
    [session.annotations],
  );
  const selected =
    annotations.find((annotation) => annotation.id === session.selectedAnnotationId) ?? null;
  return (
    <div className="h-[calc(100%-31px)] overflow-auto text-[10px]">
      {selected ? (
        <Properties
          annotation={selected}
          busy={busy}
          readOnly={session.fidelity.signatures}
          onApply={onApply}
          onDelete={onDelete}
        />
      ) : null}
      <div className="flex h-9 items-center justify-between border-b border-os-line px-3">
        <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-os-text-dim">
          {annotations.length} annotation{annotations.length === 1 ? '' : 's'}
        </span>
        <span className="flex">
          <button
            type="button"
            className={styles.toolButton}
            disabled={!annotations.length || busy}
            onClick={() => onNavigate(-1)}
            title="Previous annotation"
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            className={styles.toolButton}
            disabled={!annotations.length || busy}
            onClick={() => onNavigate(1)}
            title="Next annotation"
          >
            <ChevronDown size={12} />
          </button>
        </span>
      </div>
      <div className={`${styles.commentList} p-2`}>
        {annotations.map((annotation) => (
          <button
            key={annotation.id}
            type="button"
            className={`${styles.commentItem} ${annotation.id === session.selectedAnnotationId ? styles.commentItemActive : ''}`}
            onClick={() => onSelect(annotation.id)}
          >
            <span className="grid h-6 w-6 place-items-center border border-os-line text-os-accent">
              <MessageSquareText size={12} />
            </span>
            <span className="min-w-0">
              <span className="flex justify-between gap-2 text-[9px] text-os-text">
                <span>{annotationTypeLabel(annotation.type)}</span>
                <span className="font-mono text-[8px] text-os-text-dim">
                  P{annotation.pageNumber}
                </span>
              </span>
              <span className="mt-1 block truncate text-[8px] text-os-text-dim">
                {annotation.content || annotation.author || 'No comment'}
              </span>
            </span>
          </button>
        ))}
        {!annotations.length ? (
          <p className="px-2 py-5 text-center text-[9px] leading-4 text-os-text-dim">
            Select text or choose a drawing tool to add the first annotation.
          </p>
        ) : null}
      </div>
    </div>
  );
}
