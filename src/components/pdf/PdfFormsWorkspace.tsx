'use client';

import {
  CheckSquare2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  CopyPlus,
  List,
  MousePointer2,
  PanelTop,
  TextCursorInput,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { PdfCommandId } from './pdfCommands';
import type { PdfDocumentSession } from './model';
import type { PdfFormField, PdfFormFieldPatch, PdfFormTool } from './formModel';
import { pdfFormFieldTypeLabel } from './formModel';
import styles from './PdfApp.module.css';

const FORM_TOOLS: readonly {
  id: PdfCommandId;
  tool: PdfFormTool;
  label: string;
  icon: typeof MousePointer2;
}[] = [
  { id: 'forms.select', tool: 'form-select', label: 'Select field', icon: MousePointer2 },
  { id: 'forms.text', tool: 'form-text', label: 'Text field', icon: TextCursorInput },
  { id: 'forms.checkbox', tool: 'form-checkbox', label: 'Checkbox', icon: CheckSquare2 },
  { id: 'forms.radio', tool: 'form-radio', label: 'Radio group', icon: CircleDot },
  { id: 'forms.dropdown', tool: 'form-dropdown', label: 'Dropdown', icon: PanelTop },
  { id: 'forms.listbox', tool: 'form-listbox', label: 'List box', icon: List },
];

export function PdfFormsToolbar({
  session,
  busy,
  execute,
}: {
  session: PdfDocumentSession;
  busy: boolean;
  execute(id: PdfCommandId): void;
}) {
  const locked = session.fidelity.signatures || !session.form.editable;
  return (
    <div className={styles.commentToolGroup} aria-label="Form field tools">
      {FORM_TOOLS.map(({ id, tool, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={`${styles.toolButton} ${session.tool === tool ? styles.toolButtonActive : ''}`}
          disabled={busy || (locked && tool !== 'form-select')}
          onClick={() => execute(id)}
          title={label}
          aria-pressed={session.tool === tool}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

interface FieldDraft {
  name: string;
  tooltip: string;
  required: boolean;
  readOnly: boolean;
  multiline: boolean;
  maxLength: string;
  alignment: 'left' | 'center' | 'right';
  options: string;
  value: string;
  checked: boolean;
}

function draftFor(field: PdfFormField): FieldDraft {
  return {
    name: field.name,
    tooltip: field.tooltip,
    required: field.required,
    readOnly: field.readOnly,
    multiline: field.multiline,
    maxLength: field.maxLength === null ? '' : String(field.maxLength),
    alignment: field.alignment,
    options: field.options.join('\n'),
    value: Array.isArray(field.value)
      ? field.value.join('\n')
      : typeof field.value === 'string'
        ? field.value
        : '',
    checked: field.value === true,
  };
}

function FieldProperties({
  field,
  busy,
  locked,
  onApply,
  onDelete,
  onDuplicate,
}: {
  field: PdfFormField;
  busy: boolean;
  locked: boolean;
  onApply(patch: PdfFormFieldPatch): void;
  onDelete(): void;
  onDuplicate(): void;
}) {
  const [draft, setDraft] = useState(() => draftFor(field));
  useEffect(() => setDraft(draftFor(field)), [field]);
  const editable = field.editable && !locked;
  const choice = field.type === 'dropdown' || field.type === 'listbox';
  return (
    <section className="border-b border-os-line p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-[10px] font-medium text-os-text">{field.name}</h2>
          <p className="mt-0.5 font-mono text-[8px] text-os-text-dim">
            {pdfFormFieldTypeLabel(field.type)} · {field.widgets.length} widget
            {field.widgets.length === 1 ? '' : 's'}
          </p>
        </div>
        <span className="flex">
          <button
            className={styles.toolButton}
            type="button"
            disabled={!editable || busy}
            onClick={onDuplicate}
            title="Duplicate field"
          >
            <CopyPlus size={13} />
          </button>
          <button
            className={styles.toolButton}
            type="button"
            disabled={locked || busy || field.type === 'signature'}
            onClick={onDelete}
            title="Delete field"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>
      {editable ? (
        <div className="grid gap-2.5">
          <label className={styles.annotationInspectorField}>
            Name
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label className={styles.annotationInspectorField}>
            Tooltip
            <input
              value={draft.tooltip}
              onChange={(event) =>
                setDraft((current) => ({ ...current, tooltip: event.target.value }))
              }
            />
          </label>
          {field.type === 'text' ? (
            <>
              <label className={styles.annotationInspectorField}>
                Value
                <textarea
                  rows={3}
                  value={draft.value}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, value: event.target.value }))
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className={styles.annotationInspectorField}>
                  Maximum length
                  <input
                    type="number"
                    min="1"
                    max="32768"
                    value={draft.maxLength}
                    placeholder="None"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, maxLength: event.target.value }))
                    }
                  />
                </label>
                <label className={styles.annotationInspectorField}>
                  Alignment
                  <select
                    value={draft.alignment}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        alignment: event.target.value as FieldDraft['alignment'],
                      }))
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-[9px] text-os-text-muted">
                <input
                  type="checkbox"
                  checked={draft.multiline}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, multiline: event.target.checked }))
                  }
                />{' '}
                Multiline
              </label>
            </>
          ) : null}
          {field.type === 'checkbox' ? (
            <label className="flex items-center gap-2 text-[9px] text-os-text-muted">
              <input
                type="checkbox"
                checked={draft.checked}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, checked: event.target.checked }))
                }
              />{' '}
              Checked
            </label>
          ) : null}
          {choice ? (
            <>
              <label className={styles.annotationInspectorField}>
                Options
                <textarea
                  rows={4}
                  value={draft.options}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, options: event.target.value }))
                  }
                />
              </label>
              <label className={styles.annotationInspectorField}>
                Selected value
                <input
                  value={draft.value}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, value: event.target.value }))
                  }
                />
              </label>
            </>
          ) : null}
          {field.type === 'radio' ? (
            <label className={styles.annotationInspectorField}>
              Selected option
              <select
                value={draft.value}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, value: event.target.value }))
                }
              >
                {field.options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-2 text-[9px] text-os-text-muted">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, required: event.target.checked }))
                }
              />{' '}
              Required
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.readOnly}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, readOnly: event.target.checked }))
                }
              />{' '}
              Read only
            </label>
          </div>
          <button
            type="button"
            className="h-7 border border-os-accent/45 bg-os-accent/10 text-[9px] text-os-text hover:bg-os-accent/15 disabled:opacity-40"
            disabled={busy}
            onClick={() =>
              onApply({
                name: draft.name,
                tooltip: draft.tooltip,
                required: draft.required,
                readOnly: draft.readOnly,
                multiline: field.type === 'text' ? draft.multiline : undefined,
                maxLength:
                  field.type === 'text'
                    ? draft.maxLength
                      ? Number(draft.maxLength)
                      : null
                    : undefined,
                alignment: field.type === 'text' ? draft.alignment : undefined,
                options: choice
                  ? draft.options
                      .split(/\r?\n/)
                      .map((entry) => entry.trim())
                      .filter(Boolean)
                  : undefined,
                value:
                  field.type === 'checkbox'
                    ? draft.checked
                    : ['text', 'radio', 'dropdown', 'listbox'].includes(field.type)
                      ? draft.value
                      : undefined,
              })
            }
          >
            Apply properties
          </button>
        </div>
      ) : (
        <p className="text-[9px] leading-4 text-os-text-dim">
          {locked
            ? 'This signed or XFA document is inspection-only.'
            : field.hasActions
              ? 'This action-bearing field is preserved read-only. Embedded PDF actions never execute in Nammu.'
              : `${pdfFormFieldTypeLabel(field.type)} is preserved but is not authorable in this phase.`}
        </p>
      )}
    </section>
  );
}

export function PdfFormsFieldList({
  session,
  busy,
  onSelect,
  onNavigate,
}: {
  session: PdfDocumentSession;
  busy: boolean;
  onSelect(fieldId: string, widgetId: string | null): void;
  onNavigate(direction: -1 | 1): void;
}) {
  const fields = useMemo(
    () => [...session.form.fields].sort((a, b) => a.name.localeCompare(b.name)),
    [session.form.fields],
  );
  return (
    <div className="h-[calc(100%-31px)] overflow-auto text-[10px]">
      <div className="flex h-9 items-center justify-between border-b border-os-line px-3">
        <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-os-text-dim">
          {fields.length} field{fields.length === 1 ? '' : 's'}
        </span>
        <span className="flex">
          <button
            className={styles.toolButton}
            type="button"
            disabled={!fields.length || busy}
            onClick={() => onNavigate(-1)}
            title="Previous field"
          >
            <ChevronUp size={12} />
          </button>
          <button
            className={styles.toolButton}
            type="button"
            disabled={!fields.length || busy}
            onClick={() => onNavigate(1)}
            title="Next field"
          >
            <ChevronDown size={12} />
          </button>
        </span>
      </div>
      <div className={`${styles.commentList} p-2`}>
        {fields.map((field) => {
          const widget = field.widgets[0] ?? null;
          return (
            <button
              key={field.id}
              type="button"
              className={`${styles.commentItem} ${field.id === session.selectedFormFieldId ? styles.commentItemActive : ''}`}
              onClick={() => onSelect(field.id, widget?.id ?? null)}
            >
              <span className="grid h-6 w-6 place-items-center border border-os-line text-os-accent">
                <TextCursorInput size={12} />
              </span>
              <span className="min-w-0">
                <span className="flex justify-between gap-2 text-[9px] text-os-text">
                  <span className="truncate">{field.name}</span>
                  <span className="font-mono text-[8px] text-os-text-dim">
                    {widget ? `P${widget.pageNumber}` : '—'}
                  </span>
                </span>
                <span className="mt-1 block truncate text-[8px] text-os-text-dim">
                  {pdfFormFieldTypeLabel(field.type)}
                  {field.required ? ' · required' : ''}
                </span>
              </span>
            </button>
          );
        })}
        {!fields.length ? (
          <p className="px-2 py-5 text-center text-[9px] leading-4 text-os-text-dim">
            Choose a field tool, then drag on a page to create the first interoperable AcroForm
            field.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function PdfFormPropertiesInspector({
  session,
  busy,
  onApply,
  onDelete,
  onDuplicate,
}: {
  session: PdfDocumentSession;
  busy: boolean;
  onApply(patch: PdfFormFieldPatch): void;
  onDelete(): void;
  onDuplicate(): void;
}) {
  const selected =
    session.form.fields.find((field) => field.id === session.selectedFormFieldId) ?? null;
  const locked = session.fidelity.signatures || !session.form.editable;
  return (
    <div className="h-[calc(100%-31px)] overflow-auto text-[10px]">
      {session.form.warnings.length ? (
        <div className="border-b border-os-line bg-amber-400/[0.04] p-3 text-[9px] leading-4 text-amber-200/80">
          {session.form.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      {selected ? (
        <FieldProperties
          field={selected}
          busy={busy}
          locked={locked}
          onApply={onApply}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      ) : (
        <p className="p-3 text-[9px] leading-4 text-os-text-dim">
          Select a field to inspect its real AcroForm properties. Field values remain editable in
          Read workspace.
        </p>
      )}
    </div>
  );
}
