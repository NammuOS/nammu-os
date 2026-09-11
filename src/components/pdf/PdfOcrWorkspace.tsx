'use client';

import { FileSearch, FileText, Play, RotateCcw, SearchCheck, X } from 'lucide-react';
import type { PdfCommandId } from './pdfCommands';
import type { PdfDocumentSession } from './model';
import type { PdfOcrOptions } from './ocrModel';
import type { PdfPageScope } from './conversionModel';
import styles from './PdfApp.module.css';

export function PdfOcrToolbar({ busy, execute }: { busy: boolean; execute(id: PdfCommandId): void }) {
  return <div className={styles.commentToolGroup} aria-label="OCR tools">
    <button type="button" className={styles.toolButton} disabled={busy} onClick={() => execute('ocr.recognizePages')} title="Recognize scanned pages"><FileSearch size={14} /><span className={styles.toolLabel}>Recognize</span></button>
    <button type="button" className={styles.toolButton} disabled={busy} onClick={() => execute('ocr.makeSearchable')} title="Create a searchable PDF copy"><SearchCheck size={14} /><span className={styles.toolLabel}>Searchable Copy</span></button>
  </div>;
}

export function PdfOcrInspector({ session, busy, onOptionsChange, onRecognize, onMakeSearchable, onExportText, onCancel, onClear, onNavigate }: {
  session: PdfDocumentSession;
  busy: boolean;
  onOptionsChange(options: PdfOcrOptions): void;
  onRecognize(): void;
  onMakeSearchable(): void;
  onExportText(): void;
  onCancel(): void;
  onClear(): void;
  onNavigate(pageNumber: number): void;
}) {
  const { options, status, stage, completed, total, results } = session.ocr;
  const running = status === 'loading' || status === 'recognizing' || status === 'building';
  const set = (patch: Partial<PdfOcrOptions>) => onOptionsChange({ ...options, ...patch });
  const scopeCounts: Record<PdfPageScope, number> = { all: session.pages.length, current: 1, selected: session.selectedPages.length };
  const average = results.length ? results.reduce((sum, page) => sum + page.confidence, 0) / results.length : 0;
  return <div className={styles.convertInspector} data-pdf-ocr-inspector data-ocr-status={status}>
    <section className={styles.protectSection}>
      <h2>Local OCR</h2>
      <p>Recognize scanned pages locally. English runtime assets are bundled and documents never leave this device.</p>
      <label className={styles.annotationInspectorField}>Language<select value={options.language} disabled={busy} onChange={() => set({ language: 'eng' })}><option value="eng">English · bundled offline</option></select></label>
      <label className={styles.annotationInspectorField}>Pages<select value={options.pageScope} disabled={busy} onChange={(event) => set({ pageScope: event.target.value as PdfPageScope })}><option value="all">All pages ({scopeCounts.all})</option><option value="current">Current page</option><option value="selected" disabled={!scopeCounts.selected}>Selected pages ({scopeCounts.selected})</option></select></label>
      <label className={styles.annotationInspectorField}>Recognition<select value={options.quality} disabled={busy} onChange={(event) => set({ quality: event.target.value as PdfOcrOptions['quality'] })}><option value="balanced">Balanced · 144 DPI</option><option value="accurate">High accuracy · 216 DPI</option></select></label>
      <label className={styles.ocrCheck}><input type="checkbox" checked={options.force} disabled={busy} onChange={(event) => set({ force: event.target.checked })} /><span>Force OCR on pages with existing text</span></label>
      <label className={styles.ocrCheck}><input type="checkbox" checked={options.binarize} disabled={busy} onChange={(event) => set({ binarize: event.target.checked })} /><span>Improve contrast for clean scans</span></label>
    </section>
    <section className={styles.protectSection}>
      {running ? <><div className={styles.convertProgress}><span style={{ width: `${total ? completed / total * 100 : 0}%` }} /></div><p>{stage || 'Preparing OCR'} · {completed} of {total}</p><button type="button" className={styles.dangerAction} onClick={onCancel}><X size={12} /> Cancel OCR</button></> : <button type="button" className={styles.primaryAction} disabled={busy} onClick={onRecognize}><Play size={12} /> Recognize {scopeCounts[options.pageScope]} page(s)</button>}
    </section>
    <section className={styles.protectSection}>
      <h2>Recognition results</h2>
      {results.length ? <><p>{results.length} page(s) recognized · average confidence {Math.round(average)}%</p><div className={styles.ocrResultList}>{results.map((page) => <button type="button" key={page.pageNumber} onClick={() => onNavigate(page.pageNumber)}><strong>Page {page.pageNumber}</strong><span>{page.text.slice(0, 120) || 'No text recognized'}</span><small>{Math.round(page.confidence)}% confidence</small></button>)}</div><button type="button" className={styles.primaryAction} disabled={busy || session.fidelity.signatures} onClick={onMakeSearchable}><SearchCheck size={12} /> Make Searchable Copy</button><button type="button" className={styles.secondaryAction} disabled={busy} onClick={onExportText}><FileText size={12} /> Export recognized text</button><button type="button" className={styles.secondaryAction} disabled={busy} onClick={onClear}><RotateCcw size={12} /> Clear results</button>{session.fidelity.signatures ? <p>A searchable derivative is disabled for signed documents because changing PDF bytes invalidates signatures.</p> : null}</> : <p>No OCR results yet. Pages with a useful text layer are skipped unless Force OCR is enabled.</p>}
    </section>
  </div>;
}
