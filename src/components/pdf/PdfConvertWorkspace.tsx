'use client';

import { FileImage, FileJson, FileText, Images, Play, X } from 'lucide-react';
import type { PdfCommandId } from './pdfCommands';
import type { PdfDocumentSession } from './model';
import type { PdfConversionOptions, PdfExportFormat, PdfPageScope } from './conversionModel';
import { isRasterExportFormat } from './pdfConversion';
import styles from './PdfApp.module.css';

const FORMATS: readonly { id: PdfExportFormat; label: string; detail: string; icon: typeof FileImage }[] = [
  { id: 'png', label: 'PNG', detail: 'Lossless page images', icon: FileImage },
  { id: 'jpeg', label: 'JPEG', detail: 'Compact page images', icon: FileImage },
  { id: 'webp', label: 'WebP', detail: 'Modern page images', icon: FileImage },
  { id: 'text', label: 'Text', detail: 'Extracted reading order', icon: FileText },
  { id: 'markdown', label: 'Markdown', detail: 'Best-effort page structure', icon: FileText },
  { id: 'json', label: 'JSON', detail: 'Structured page text', icon: FileJson },
];

export function PdfConvertToolbar({ busy, execute }: { session: PdfDocumentSession; busy: boolean; execute(id: PdfCommandId): void }) {
  return <div className={styles.commentToolGroup} aria-label="Convert tools">
    <button type="button" className={styles.toolButton} disabled={busy} onClick={() => execute('convert.run')} title="Run configured export"><Play size={14} /><span className={styles.toolLabel}>Export</span></button>
    <button type="button" className={styles.toolButton} disabled={busy} onClick={() => execute('convert.imagesToPdf')} title="Create a new PDF from images"><Images size={14} /><span className={styles.toolLabel}>Images to PDF</span></button>
  </div>;
}

export function PdfConvertInspector({ session, busy, onOptionsChange, onExport, onCancel, onImagesToPdf }: {
  session: PdfDocumentSession;
  busy: boolean;
  onOptionsChange(options: PdfConversionOptions): void;
  onExport(): void;
  onCancel(): void;
  onImagesToPdf(): void;
}) {
  const options = session.conversion.options;
  const set = (patch: Partial<PdfConversionOptions>) => onOptionsChange({ ...options, ...patch });
  const raster = isRasterExportFormat(options.format);
  const scopeCounts: Record<PdfPageScope, number> = { all: session.pages.length, current: 1, selected: session.selectedPages.length };
  return <div className={styles.convertInspector} data-pdf-convert-inspector data-conversion-status={session.conversion.status}>
    <section className={styles.protectSection}>
      <h2>Export active PDF</h2>
      <div className={styles.convertFormatGrid}>
        {FORMATS.map(({ id, label, detail, icon: Icon }) => <button key={id} type="button" className={`${styles.convertFormat} ${options.format === id ? styles.convertFormatActive : ''}`} disabled={busy} onClick={() => set({ format: id })}><Icon size={14} /><span><strong>{label}</strong><small>{detail}</small></span></button>)}
      </div>
    </section>
    <section className={styles.protectSection}>
      <h2>Page scope</h2>
      <label className={styles.annotationInspectorField}>Pages<select value={options.pageScope} disabled={busy} onChange={(event) => set({ pageScope: event.target.value as PdfPageScope })}><option value="all">All pages ({scopeCounts.all})</option><option value="current">Current page</option><option value="selected" disabled={!scopeCounts.selected}>Selected pages ({scopeCounts.selected})</option></select></label>
      {raster ? <><label className={styles.annotationInspectorField}>Resolution<select value={options.dpi} disabled={busy} onChange={(event) => set({ dpi: Number(event.target.value) as PdfConversionOptions['dpi'] })}><option value={96}>96 DPI · Small</option><option value={144}>144 DPI · Balanced</option><option value={300}>300 DPI · High quality</option></select></label>{options.format !== 'png' ? <label className={styles.annotationInspectorField}>Quality <span>{Math.round(options.quality * 100)}%</span><input type="range" min="0.4" max="1" step="0.05" value={options.quality} disabled={busy} onChange={(event) => set({ quality: Number(event.target.value) })} /></label> : null}</> : <p>Text exports use the PDF text layer. Scanned pages require the future OCR workflow.</p>}
    </section>
    <section className={styles.protectSection}>
      {session.conversion.status === 'running' ? <><div className={styles.convertProgress}><span style={{ width: `${session.conversion.total ? session.conversion.completed / session.conversion.total * 100 : 0}%` }} /></div><p>{session.conversion.completed} of {session.conversion.total} pages completed</p><button type="button" className={styles.dangerAction} onClick={onCancel}><X size={12} /> Cancel after current stage</button></> : <button type="button" className={styles.primaryAction} disabled={busy} onClick={onExport}><Play size={12} /> Export {scopeCounts[options.pageScope]} page(s)</button>}
    </section>
    <section className={styles.protectSection}>
      <h2>Create PDF</h2>
      <p>Choose ordered PNG, JPEG, or WebP images. The result opens as a new unsaved document tab.</p>
      <button type="button" className={styles.primaryAction} disabled={busy} onClick={onImagesToPdf}><Images size={12} /> Choose images</button>
    </section>
  </div>;
}
