import { useState, useRef, useCallback } from 'react';
import {
  Upload,
  Download,
  Copy,
  Check,
  AlertCircle,
  FileText,
  Merge,
  Split,
  Shrink,
  Repeat,
  BadgeCheck,
  Lock,
  Unlock,
  Droplets,
} from 'lucide-react';

function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function DropZone({
  onFile,
  accept,
  multiple = false,
}: {
  onFile: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`drop-zone p-6 text-center cursor-pointer ${drag ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onFile(Array.from(e.dataTransfer.files));
      }}
      onClick={() => inputRef.current?.click()}
    >
      <Upload size={20} className="text-os-text-muted mx-auto mb-2" />
      <div className="text-xs text-os-text-muted">Drop PDF or click to select</div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onFile(Array.from(e.target.files));
        }}
      />
    </div>
  );
}

function ToolHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold text-os-text">{title}</div>
      <div className="text-[10px] text-os-text-muted">{desc}</div>
    </div>
  );
}

function ResultActions({
  result,
  downloadName,
  mime,
}: {
  result: string;
  downloadName?: string;
  mime?: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = result.startsWith('data:') ? result : result;
    a.download = downloadName || 'download';
    a.click();
  };
  return (
    <div className="flex gap-2 mt-2">
      <button onClick={handleDownload} className="os-btn os-btn-primary flex items-center gap-1.5">
        <Download size={12} /> Download
      </button>
      <button onClick={handleCopy} className="os-btn flex items-center gap-1.5">
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function PdfMerge() {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');

  const process = useCallback(async () => {
    if (files.length < 2) return;
    setProcessing(true);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const merged = await PDFDocument.create();
      for (const file of files) {
        const buf = await readFileBuffer(file);
        const pdf = await PDFDocument.load(buf);
        const pages = await merged.copyPages(pdf, pdf.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }
      const bytes = await merged.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      setResult(URL.createObjectURL(blob));
    } catch (e: any) {
      setResult('');
    }
    setProcessing(false);
  }, [files]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="PDF Merge" desc="Combine multiple PDFs into one." />
      {files.length === 0 ? (
        <DropZone onFile={(f) => setFiles(f)} accept="application/pdf" multiple />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="text-xs text-os-text">{files.length} PDFs selected</div>
          <div className="flex gap-1 flex-wrap">
            {files.map((f, i) => (
              <span
                key={i}
                className="text-[10px] bg-os-surface/40 px-2 py-1 rounded-sm border border-os-border/20"
              >
                {f.name}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={process}
              disabled={processing || files.length < 2}
              className="os-btn os-btn-primary"
            >
              {processing ? 'Merging...' : 'Merge'}
            </button>
            <button
              onClick={() => {
                setFiles([]);
                setResult('');
              }}
              className="os-btn"
            >
              Clear
            </button>
          </div>
          {result && (
            <div className="tool-workspace-output">
              <ResultActions result={result} downloadName="merged.pdf" mime="application/pdf" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PdfSplit() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState('');
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{ name: string; url: string }[]>([]);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const buf = await readFileBuffer(file);
      const pdf = await PDFDocument.load(buf);
      const total = pdf.getPageCount();
      const indices = pages
        .split(',')
        .flatMap((p) => {
          if (p.includes('-')) {
            const [a, b] = p.split('-').map(Number);
            return Array.from({ length: Math.min(b, total) - a + 1 }, (_, i) => a - 1 + i);
          }
          return [Number(p) - 1];
        })
        .filter((i) => i >= 0 && i < total);

      const out: { name: string; url: string }[] = [];
      for (const idx of indices) {
        const newPdf = await PDFDocument.create();
        const [page] = await newPdf.copyPages(pdf, [idx]);
        newPdf.addPage(page);
        const bytes = await newPdf.save();
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
        out.push({ name: `page_${idx + 1}.pdf`, url: URL.createObjectURL(blob) });
      }
      setResults(out);
    } catch (e: any) {}
    setProcessing(false);
  }, [file, pages]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="PDF Split" desc="Split PDF into separate pages by range." />
      {!file ? (
        <DropZone onFile={(f) => setFile(f[0])} accept="application/pdf" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setResults([]);
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <input
            value={pages}
            onChange={(e) => setPages(e.target.value)}
            placeholder="e.g. 1,3,5-7"
            className="os-input w-full"
          />
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Splitting...' : 'Split'}
          </button>
          {results.length > 0 && (
            <div className="tool-workspace-output overflow-y-auto max-h-48">
              <div className="flex flex-col gap-1">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-1.5 bg-os-surface/30 rounded-sm border border-os-border/20"
                  >
                    <span className="text-[10px] text-os-text">{r.name}</span>
                    <a
                      href={r.url}
                      download={r.name}
                      className="ml-auto text-os-accent text-[10px]"
                    >
                      ↓
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PdfCompress() {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');
  const [originalSize, setOriginalSize] = useState(0);
  const [newSize, setNewSize] = useState(0);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const buf = await readFileBuffer(file);
      const pdf = await PDFDocument.load(buf);
      const bytes = await pdf.save({ useObjectStreams: true });
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      setOriginalSize(file.size);
      setNewSize(blob.size);
      setResult(URL.createObjectURL(blob));
    } catch (e: any) {}
    setProcessing(false);
  }, [file]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="PDF Compress" desc="Re-save PDF with object streams for smaller size." />
      {!file ? (
        <DropZone onFile={(f) => setFile(f[0])} accept="application/pdf" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Shrink size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setResult('');
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Compressing...' : 'Compress'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <div className="text-[10px] text-os-text-muted mb-1">
                {originalSize > 0 && (
                  <span>Original: {(originalSize / 1024).toFixed(1)} KB → </span>
                )}
                {newSize > 0 && (
                  <span className="text-os-emerald">
                    Compressed: {(newSize / 1024).toFixed(1)} KB (
                    {((1 - newSize / originalSize) * 100).toFixed(0)}% reduction)
                  </span>
                )}
              </div>
              <ResultActions result={result} downloadName="compressed.pdf" mime="application/pdf" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PdfExtractReorder() {
  const [file, setFile] = useState<File | null>(null);
  const [order, setOrder] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const buf = await readFileBuffer(file);
      const pdf = await PDFDocument.load(buf);
      const indices = order
        .split(',')
        .map(Number)
        .map((n) => n - 1)
        .filter((n) => n >= 0);
      const newPdf = await PDFDocument.create();
      for (const idx of indices) {
        if (idx >= pdf.getPageCount()) continue;
        const [page] = await newPdf.copyPages(pdf, [idx]);
        newPdf.addPage(page);
      }
      const bytes = await newPdf.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      setResult(URL.createObjectURL(blob));
    } catch (e: any) {}
    setProcessing(false);
  }, [file, order]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="PDF Extract / Reorder" desc="Extract and reorder pages from a PDF." />
      {!file ? (
        <DropZone onFile={(f) => setFile(f[0])} accept="application/pdf" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Repeat size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setResult('');
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <input
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            placeholder="New order, e.g. 3,1,2,5,4"
            className="os-input w-full"
          />
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Reordering...' : 'Reorder'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <ResultActions result={result} downloadName="reordered.pdf" mime="application/pdf" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PdfMetadata() {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<{
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
  }>({});
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');

  const load = useCallback(async () => {
    if (!file) return;
    try {
      const { PDFDocument } = await import('pdf-lib');
      const buf = await readFileBuffer(file);
      const pdf = await PDFDocument.load(buf);
      setMeta({
        title: pdf.getTitle() || '',
        author: pdf.getAuthor() || '',
        subject: pdf.getSubject() || '',
        keywords: pdf.getKeywords() || '',
        creator: pdf.getCreator() || '',
        producer: pdf.getProducer() || '',
      });
    } catch (e: any) {}
  }, [file]);

  const save = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const buf = await readFileBuffer(file);
      const pdf = await PDFDocument.load(buf);
      if (meta.title) pdf.setTitle(meta.title);
      if (meta.author) pdf.setAuthor(meta.author);
      if (meta.subject) pdf.setSubject(meta.subject);
      if (meta.keywords) pdf.setKeywords(meta.keywords.split(','));
      if (meta.creator) pdf.setCreator(meta.creator);
      if (meta.producer) pdf.setProducer(meta.producer);
      const bytes = await pdf.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      setResult(URL.createObjectURL(blob));
    } catch (e: any) {}
    setProcessing(false);
  }, [file, meta]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="PDF Metadata" desc="View and edit PDF metadata." />
      {!file ? (
        <DropZone onFile={(f) => setFile(f[0])} accept="application/pdf" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <BadgeCheck size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setMeta({});
                setResult('');
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <button onClick={load} className="os-btn w-fit">
            Load Metadata
          </button>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={meta.title || ''}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
              placeholder="Title"
              className="os-input"
            />
            <input
              value={meta.author || ''}
              onChange={(e) => setMeta({ ...meta, author: e.target.value })}
              placeholder="Author"
              className="os-input"
            />
            <input
              value={meta.subject || ''}
              onChange={(e) => setMeta({ ...meta, subject: e.target.value })}
              placeholder="Subject"
              className="os-input"
            />
            <input
              value={meta.keywords || ''}
              onChange={(e) => setMeta({ ...meta, keywords: e.target.value })}
              placeholder="Keywords (comma sep)"
              className="os-input"
            />
            <input
              value={meta.creator || ''}
              onChange={(e) => setMeta({ ...meta, creator: e.target.value })}
              placeholder="Creator"
              className="os-input"
            />
            <input
              value={meta.producer || ''}
              onChange={(e) => setMeta({ ...meta, producer: e.target.value })}
              placeholder="Producer"
              className="os-input"
            />
          </div>
          <button onClick={save} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Saving...' : 'Save Metadata'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <ResultActions result={result} downloadName="metadata.pdf" mime="application/pdf" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PdfPassword() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'protect' | 'unlock'>('protect');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    setError('');
    try {
      const { PDFDocument } = await import('pdf-lib');
      const buf = await readFileBuffer(file);
      if (mode === 'protect') {
        // Note: pdf-lib standard build does not support encryption. Requires @pdf-lib/core or custom build.
        setError('Encryption requires pdf-lib premium build. Using unlock mode.');
      } else {
        const pdf = await PDFDocument.load(buf, { password } as any);
        const bytes = await pdf.save();
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
        setResult(URL.createObjectURL(blob));
      }
    } catch (e: any) {
      setError(e.message);
    }
    setProcessing(false);
  }, [file, password, mode]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="PDF Password" desc="Protect or unlock PDF files with password." />
      {!file ? (
        <DropZone onFile={(f) => setFile(f[0])} accept="application/pdf" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Lock size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setResult('');
                setError('');
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('protect')}
              className={`os-btn ${mode === 'protect' ? 'os-btn-primary' : ''}`}
            >
              Protect
            </button>
            <button
              onClick={() => setMode('unlock')}
              className={`os-btn ${mode === 'unlock' ? 'os-btn-primary' : ''}`}
            >
              Unlock
            </button>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'protect' ? 'Set password' : 'Enter password'}
            className="os-input w-full"
          />
          <button
            onClick={process}
            disabled={processing || !password}
            className="os-btn os-btn-primary w-fit"
          >
            {processing ? 'Processing...' : mode === 'protect' ? 'Protect' : 'Unlock'}
          </button>
          {error && <div className="text-xs text-os-red">{error}</div>}
          {result && (
            <div className="tool-workspace-output">
              <ResultActions
                result={result}
                downloadName={mode === 'protect' ? 'protected.pdf' : 'unlocked.pdf'}
                mime="application/pdf"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PdfWatermark() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [opacity, setOpacity] = useState(0.3);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');

  const process = useCallback(async () => {
    if (!file || !text) return;
    setProcessing(true);
    try {
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
      const buf = await readFileBuffer(file);
      const pdf = await PDFDocument.load(buf);
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const pages = pdf.getPages();
      for (const page of pages) {
        const { width, height } = page.getSize();
        page.drawText(text, {
          x: width / 2 - text.length * 3,
          y: height / 2,
          size: 40,
          font,
          color: rgb(0.8, 0.8, 0.8),
          opacity,
        });
      }
      const bytes = await pdf.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      setResult(URL.createObjectURL(blob));
    } catch (e: any) {}
    setProcessing(false);
  }, [file, text, opacity]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="PDF Watermark" desc="Add text watermark to all pages." />
      {!file ? (
        <DropZone onFile={(f) => setFile(f[0])} accept="application/pdf" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Droplets size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setResult('');
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Watermark text"
            className="os-input w-full"
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-os-text-muted">Opacity</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-32 accent-cyan-500"
            />
            <span className="text-xs text-os-accent w-8">{opacity}</span>
          </div>
          <button
            onClick={process}
            disabled={processing || !text}
            className="os-btn os-btn-primary w-fit"
          >
            {processing ? 'Adding...' : 'Add Watermark'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <ResultActions
                result={result}
                downloadName="watermarked.pdf"
                mime="application/pdf"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
