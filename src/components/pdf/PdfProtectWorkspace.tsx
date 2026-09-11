'use client';

import { Eraser, Eye, MousePointer2, ScanSearch, Shield, ShieldAlert, Trash2 } from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils';
import type { PdfRect } from './annotationModel';
import type { PdfCommandId } from './pdfCommands';
import type { PdfDocumentSession } from './model';
import type { PdfEncryptionRequest } from './pdfCrypto';
import type { PdfRedactionMark, PdfSanitizeOptions } from './protectionModel';
import { DEFAULT_SANITIZE_OPTIONS } from './protectionModel';
import styles from './PdfApp.module.css';

function viewportRect(viewport: PageViewport, rect: PdfRect): PdfRect {
  const converted = viewport.convertToViewportRectangle([...rect]);
  return [Math.min(converted[0], converted[2]), Math.min(converted[1], converted[3]), Math.max(converted[0], converted[2]), Math.max(converted[1], converted[3])];
}

export function PdfProtectLayer({
  viewport, pageNumber, tool, marks, selectedId, onSelect, onCreate,
}: {
  viewport: PageViewport;
  pageNumber: number;
  tool: PdfDocumentSession['tool'];
  marks: readonly PdfRedactionMark[];
  selectedId: string | null;
  onSelect(id: string | null): void;
  onCreate(pageNumber: number, rect: PdfRect): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<readonly [number, number] | null>(null);
  const [current, setCurrent] = useState<readonly [number, number] | null>(null);
  const point = (event: ReactPointerEvent) => {
    const bounds = host.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))] as const;
  };
  const finish = (event: ReactPointerEvent) => {
    if (!start) return;
    event.preventDefault(); event.stopPropagation();
    const ending = point(event);
    const a = viewport.convertToPdfPoint(start[0], start[1]);
    const b = viewport.convertToPdfPoint(ending[0], ending[1]);
    setStart(null); setCurrent(null);
    if (Math.abs(a[0] - b[0]) >= 2 && Math.abs(a[1] - b[1]) >= 2)
      onCreate(pageNumber, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
  };
  return (
    <div
      ref={host}
      data-pdf-protect-layer={pageNumber}
      className={`${styles.protectLayer} ${tool === 'redact-region' ? styles.protectLayerDrawing : ''}`}
      onPointerDown={(event) => {
        if (tool !== 'redact-region') return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
        const next = point(event); setStart(next); setCurrent(next);
      }}
      onPointerMove={(event) => start && setCurrent(point(event))}
      onPointerUp={finish}
      onPointerCancel={() => { setStart(null); setCurrent(null); }}
    >
      {marks.filter((mark) => mark.pageNumber === pageNumber).map((mark) => {
        const rect = viewportRect(viewport, mark.rect);
        return <button key={mark.id} type="button" className={`${styles.redactionMark} ${selectedId === mark.id ? styles.redactionMarkSelected : ''}`} style={{ left: rect[0], top: rect[1], width: rect[2] - rect[0], height: rect[3] - rect[1] }} onClick={(event) => { event.stopPropagation(); onSelect(mark.id); }} aria-label="Pending redaction" />;
      })}
      {start && current ? <span className={styles.redactionPreview} style={{ left: Math.min(start[0], current[0]), top: Math.min(start[1], current[1]), width: Math.abs(current[0] - start[0]), height: Math.abs(current[1] - start[1]) }} /> : null}
    </div>
  );
}

export function PdfProtectToolbar({ session, busy, execute }: { session: PdfDocumentSession; busy: boolean; execute(id: PdfCommandId): void }) {
  return <div className={styles.commentToolGroup} aria-label="Protect tools">
    <button type="button" className={`${styles.toolButton} ${session.tool === 'protect-select' ? styles.toolButtonActive : ''}`} disabled={busy} onClick={() => execute('redact.select')} title="Review redaction marks"><MousePointer2 size={14} /></button>
    <button type="button" className={`${styles.toolButton} ${session.tool === 'redact-region' ? styles.toolButtonActive : ''}`} disabled={busy || session.fidelity.signatures} onClick={() => execute('redact.markRegion')} title="Mark a region for redaction"><ShieldAlert size={14} /></button>
    <button type="button" className={styles.toolButton} disabled={busy || session.fidelity.signatures || !session.textSelection} onClick={() => execute('redact.markSelection')} title="Mark selected text for redaction"><ScanSearch size={14} /></button>
    <span className={styles.toolSeparator} />
    <button type="button" className={styles.toolButton} disabled={busy || session.fidelity.signatures || !session.protection.redactions.length} onClick={() => execute('redact.apply')} title="Apply secure raster redactions"><Eraser size={14} /><span className={styles.toolLabel}>Apply</span></button>
  </div>;
}

function SecurityRow({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className={styles.securityRow}><span>{label}</span><strong className={alert ? styles.securityAlert : ''}>{value}</strong></div>;
}

export function PdfProtectInspector({
  session, busy, onSelect, onDelete, onSanitize, onEncrypt,
}: {
  session: PdfDocumentSession;
  busy: boolean;
  onSelect(id: string): void;
  onDelete(): void;
  onSanitize(options: PdfSanitizeOptions): void;
  onEncrypt(request: PdfEncryptionRequest): void;
}) {
  const [options, setOptions] = useState(DEFAULT_SANITIZE_OPTIONS);
  const [openPassword, setOpenPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const { inspection, redactions, selectedRedactionId } = session.protection;
  const selected = redactions.find((mark) => mark.id === selectedRedactionId);
  return <div className={styles.protectInspector}>
    <section className={styles.protectSection}>
      <h2><Shield size={12} /> Security inspection</h2>
      <SecurityRow label="Encrypted" value={inspection.encrypted ? 'Yes' : 'No'} />
      <SecurityRow label="Digital signatures" value={inspection.signatures ? 'Detected' : 'None detected'} alert={inspection.signatures} />
      <SecurityRow label="JavaScript" value={inspection.javascript ? 'Detected' : 'None detected'} alert={inspection.javascript} />
      <SecurityRow label="Active actions" value={inspection.activeActions ? 'Detected' : 'None detected'} alert={inspection.activeActions} />
      <SecurityRow label="Attachments" value={inspection.attachments ? 'Detected' : 'None detected'} />
      <SecurityRow label="Metadata / XMP" value={inspection.metadata || inspection.xmpMetadata ? 'Present' : 'Not detected'} />
      <SecurityRow label="Forms / XFA" value={inspection.xfa ? 'XFA detected' : inspection.forms ? 'AcroForm' : 'None detected'} />
    </section>
    <section className={styles.protectSection}>
      <h2><Eye size={12} /> Pending redactions <span>{redactions.length}</span></h2>
      {!redactions.length ? <p>No pending marks. Nothing is removed until Apply is run.</p> : redactions.map((mark) => <button key={mark.id} type="button" className={`${styles.redactionListItem} ${selectedRedactionId === mark.id ? styles.redactionListItemActive : ''}`} onClick={() => onSelect(mark.id)}><span>Page {mark.pageNumber}</span><small>{Math.round(mark.rect[2] - mark.rect[0])} × {Math.round(mark.rect[3] - mark.rect[1])} pt</small></button>)}
      {selected ? <button type="button" className={styles.dangerAction} disabled={busy || session.fidelity.signatures} onClick={onDelete}><Trash2 size={12} /> Remove selected mark</button> : null}
    </section>
    <section className={styles.protectSection}>
      <h2>Remove specific document data</h2>
      {([['metadata', 'Metadata and XMP'], ['javascriptAndActions', 'JavaScript and active actions'], ['attachments', 'Embedded attachments']] as const).map(([key, label]) => <label key={key} className={styles.sanitizeOption}><input type="checkbox" checked={options[key]} onChange={(event) => setOptions((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}
      <button type="button" className={styles.primaryAction} disabled={busy || session.fidelity.signatures || !Object.values(options).some(Boolean)} onClick={() => onSanitize(options)}>Sanitize selected data</button>
      <p>This is a scoped removal operation, not a malware-clean guarantee.</p>
    </section>
    <section className={styles.protectSection}>
      <h2>Protect a copy with AES-256</h2>
      <label className={styles.annotationInspectorField}>Open password<input type="password" autoComplete="new-password" value={openPassword} maxLength={127} onChange={(event) => setOpenPassword(event.target.value)} /></label>
      <label className={styles.annotationInspectorField}>Owner password<input type="password" autoComplete="new-password" value={ownerPassword} maxLength={127} onChange={(event) => setOwnerPassword(event.target.value)} /></label>
      <button type="button" className={styles.primaryAction} disabled={busy || session.fidelity.signatures || !ownerPassword} onClick={() => {
        onEncrypt({ userPassword: openPassword, ownerPassword, permissions: { printing: 'full', extract: true, modify: 'all' } });
        setOpenPassword(''); setOwnerPassword('');
      }}>Create encrypted copy</button>
      <p>Passwords stay in this form only until the operation is dispatched. PDF permission flags are policy hints, not universal DRM.</p>
    </section>
  </div>;
}
