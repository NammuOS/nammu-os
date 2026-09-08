'use client';

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils';
import type { PdfRect } from './annotationModel';
import type {
  PdfFormField,
  PdfFormFieldDraft,
  PdfFormFieldPatch,
  PdfFormModel,
  PdfFormTool,
  PdfFormWidget,
} from './formModel';
import styles from './PdfApp.module.css';

interface Gesture {
  mode: 'create' | 'move' | 'resize';
  start: readonly [number, number];
  current: readonly [number, number];
  fieldId?: string;
  widget?: PdfFormWidget;
}

function viewportRect(viewport: PageViewport, rect: PdfRect) {
  const converted = viewport.convertToViewportRectangle([...rect]);
  return {
    left: Math.min(converted[0], converted[2]),
    top: Math.min(converted[1], converted[3]),
    width: Math.abs(converted[2] - converted[0]),
    height: Math.abs(converted[3] - converted[1]),
  };
}

function pointerPoint(event: ReactPointerEvent, viewport: PageViewport): readonly [number, number] {
  const bounds = event.currentTarget.getBoundingClientRect();
  const [x, y] = viewport.convertToPdfPoint(
    event.clientX - bounds.left,
    event.clientY - bounds.top,
  );
  return [x, y];
}

function normalizedRect(a: readonly [number, number], b: readonly [number, number]): PdfRect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

function toolType(tool: PdfFormTool): PdfFormFieldDraft['type'] | null {
  if (tool === 'form-text') return 'text';
  if (tool === 'form-checkbox') return 'checkbox';
  if (tool === 'form-radio') return 'radio';
  if (tool === 'form-dropdown') return 'dropdown';
  if (tool === 'form-listbox') return 'listbox';
  return null;
}

function valueFor(field: PdfFormField): string {
  return Array.isArray(field.value)
    ? (field.value[0] ?? '')
    : typeof field.value === 'string'
      ? field.value
      : '';
}

function FormControl({
  field,
  widget,
  disabled,
  onCommit,
}: {
  field: PdfFormField;
  widget: PdfFormWidget;
  disabled: boolean;
  onCommit(patch: PdfFormFieldPatch): void;
}) {
  if (field.type === 'text') {
    return (
      <input
        className={styles.formControl}
        defaultValue={valueFor(field)}
        disabled={disabled || field.readOnly}
        maxLength={field.maxLength ?? undefined}
        aria-label={field.tooltip || field.name}
        onBlur={(event) => {
          if (event.currentTarget.value !== valueFor(field))
            onCommit({ value: event.currentTarget.value });
        }}
      />
    );
  }
  if (field.type === 'checkbox') {
    return (
      <input
        className={styles.formCheckControl}
        type="checkbox"
        checked={field.value === true}
        disabled={disabled || field.readOnly}
        aria-label={field.tooltip || field.name}
        onChange={(event) => onCommit({ value: event.currentTarget.checked })}
      />
    );
  }
  if (field.type === 'radio') {
    return (
      <input
        className={styles.formCheckControl}
        type="radio"
        name={field.id}
        checked={field.value === widget.exportValue}
        disabled={disabled || field.readOnly || !widget.exportValue}
        aria-label={`${field.tooltip || field.name}: ${widget.exportValue ?? 'option'}`}
        onChange={() => widget.exportValue && onCommit({ value: widget.exportValue })}
      />
    );
  }
  if (field.type === 'dropdown') {
    return (
      <select
        className={styles.formControl}
        value={valueFor(field)}
        disabled={disabled || field.readOnly}
        aria-label={field.tooltip || field.name}
        onChange={(event) => onCommit({ value: event.currentTarget.value })}
      >
        {field.options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'listbox') {
    const selected = new Set(Array.isArray(field.value) ? field.value : []);
    return (
      <select
        className={styles.formControl}
        multiple
        value={[...selected]}
        disabled={disabled || field.readOnly}
        aria-label={field.tooltip || field.name}
        onChange={(event) =>
          onCommit({
            value: [...event.currentTarget.selectedOptions].map((option) => option.value),
          })
        }
      >
        {field.options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  }
  return <span className={styles.formReadOnlyBadge}>{field.type}</span>;
}

export function PdfFormLayer({
  viewport,
  pageNumber,
  form,
  tool,
  authoring,
  signed,
  selectedFieldId,
  selectedWidgetId,
  onSelect,
  onCreate,
  onUpdate,
}: {
  viewport: PageViewport;
  pageNumber: number;
  form: PdfFormModel;
  tool: PdfFormTool | null;
  authoring: boolean;
  signed: boolean;
  selectedFieldId: string | null;
  selectedWidgetId: string | null;
  onSelect(fieldId: string | null, widgetId: string | null): void;
  onCreate(draft: PdfFormFieldDraft): void;
  onUpdate(fieldId: string, patch: PdfFormFieldPatch): void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const widgets = useMemo(
    () =>
      form.fields.flatMap((field) =>
        field.widgets
          .filter((widget) => widget.pageNumber === pageNumber)
          .map((widget) => ({ field, widget })),
      ),
    [form.fields, pageNumber],
  );
  const readOnly = signed || !form.editable;

  const beginCreate = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!authoring || readOnly || !toolType(tool ?? 'form-select') || event.button !== 0) return;
    const point = pointerPoint(event, viewport);
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ mode: 'create', start: point, current: point });
    event.preventDefault();
  };

  const beginWidgetGesture = (
    event: ReactPointerEvent<HTMLElement>,
    field: PdfFormField,
    widget: PdfFormWidget,
    mode: 'move' | 'resize',
  ) => {
    if (!authoring || readOnly || tool !== 'form-select' || !field.editable || event.button !== 0)
      return;
    event.stopPropagation();
    onSelect(field.id, widget.id);
    const bounds = layerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const [x, y] = viewport.convertToPdfPoint(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    );
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ mode, start: [x, y], current: [x, y], fieldId: field.id, widget });
  };

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture) return;
    const current = pointerPoint(event, viewport);
    setGesture(null);
    if (gesture.mode === 'create') {
      const rect = normalizedRect(gesture.start, current);
      const type = toolType(tool ?? 'form-select');
      if (type && rect[2] - rect[0] >= 4 && rect[3] - rect[1] >= 4) {
        onCreate({ pageNumber, type, rect });
      }
      return;
    }
    if (!gesture.widget || !gesture.fieldId) return;
    const dx = current[0] - gesture.start[0];
    const dy = current[1] - gesture.start[1];
    const source = gesture.widget.rect;
    const rect: PdfRect =
      gesture.mode === 'move'
        ? [source[0] + dx, source[1] + dy, source[2] + dx, source[3] + dy]
        : [source[0], source[1], source[2] + dx, source[3] + dy];
    onUpdate(gesture.fieldId, { widgetId: gesture.widget.id, rect });
  };

  const preview = gesture
    ? viewportRect(viewport, normalizedRect(gesture.start, gesture.current))
    : null;

  return (
    <div
      ref={layerRef}
      data-pdf-form-layer={pageNumber}
      className={`${styles.formLayer} ${authoring ? styles.formLayerAuthoring : ''}`}
      onPointerDown={beginCreate}
      onPointerMove={(event) => {
        if (gesture) {
          const currentPoint = pointerPoint(event, viewport);
          setGesture((current) => (current ? { ...current, current: currentPoint } : null));
        }
      }}
      onPointerUp={finishGesture}
      onPointerCancel={() => setGesture(null)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelect(null, null);
      }}
    >
      {widgets.map(({ field, widget }) => {
        const rect = viewportRect(viewport, widget.rect);
        const selected =
          selectedWidgetId === widget.id || (!selectedWidgetId && selectedFieldId === field.id);
        return (
          <div
            key={widget.id}
            data-pdf-form-widget={widget.id}
            className={`${styles.formWidget} ${authoring ? styles.formWidgetAuthoring : ''} ${selected ? styles.formWidgetSelected : ''}`}
            style={rect}
            title={`${field.name} · ${field.type}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(field.id, widget.id);
            }}
            onPointerDown={(event) => beginWidgetGesture(event, field, widget, 'move')}
          >
            {authoring ? (
              <>
                <span className={styles.formWidgetLabel}>{field.name}</span>
                {selected && field.editable && !readOnly ? (
                  <span
                    className={styles.formResizeHandle}
                    onPointerDown={(event) => beginWidgetGesture(event, field, widget, 'resize')}
                    aria-hidden="true"
                  />
                ) : null}
              </>
            ) : (
              <FormControl
                field={field}
                widget={widget}
                disabled={!field.editable}
                onCommit={(patch) => onUpdate(field.id, patch)}
              />
            )}
          </div>
        );
      })}
      {preview && gesture?.mode === 'create' ? (
        <span className={styles.formGesturePreview} style={preview} />
      ) : null}
    </div>
  );
}
