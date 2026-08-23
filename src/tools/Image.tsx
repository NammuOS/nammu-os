import { useState, useRef, useCallback } from 'react';
import {
  Upload,
  Download,
  Copy,
  Check,
  AlertCircle,
  Shrink,
  Ruler,
  Crop,
  Layers,
  ScanLine,
  Palette,
  Sparkles,
  Wand2,
  FileImage,
  X,
  Plus,
  Minus,
} from 'lucide-react';

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
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
      className={`drop-zone p-6 text-center ${drag ? 'drag-over' : ''}`}
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
      <div className="text-xs text-os-text-muted">Drop files or click to select</div>
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
  onDownload,
  downloadName,
  mime,
}: {
  result: string;
  onDownload?: () => void;
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
    if (onDownload) {
      onDownload();
      return;
    }
    const a = document.createElement('a');
    a.href = result.startsWith('data:')
      ? result
      : `data:${mime || 'text/plain'};base64,${btoa(result)}`;
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

export function ImgCompress() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [quality, setQuality] = useState(80);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');
  const [originalSize, setOriginalSize] = useState(0);
  const [newSize, setNewSize] = useState(0);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const dataUrl = await readFile(file);
    setPreview(dataUrl);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            setResult(URL.createObjectURL(blob));
            setNewSize(blob.size);
          }
          setProcessing(false);
        },
        'image/jpeg',
        quality / 100,
      );
    };
    img.src = dataUrl;
    setOriginalSize(file.size);
  }, [file, quality]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Image Compress" desc="Compress images with configurable quality." />
      {!file ? (
        <DropZone
          onFile={(files) => {
            setFile(files[0]);
          }}
          accept="image/*"
        />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileImage size={14} className="text-os-accent" />
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
          {preview && (
            <img
              src={preview}
              alt="preview"
              className="max-h-32 object-contain rounded-sm border border-os-border/30"
            />
          )}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-os-text-muted">Quality</span>
            <input
              type="range"
              min="1"
              max="100"
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-32 accent-cyan-500"
            />
            <span className="text-xs text-os-accent w-8">{quality}%</span>
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Compressing...' : 'Compress'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <img src={result} alt="result" className="max-h-40 object-contain rounded-sm" />
              <div className="text-[10px] text-os-text-muted mt-1">
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
              <ResultActions
                result={result}
                downloadName={`compressed_${file.name}`}
                mime="image/jpeg"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ImgResize() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');
  const [maintainAspect, setMaintainAspect] = useState(true);
  const aspectRef = useRef(1);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const dataUrl = await readFile(file);
    setPreview(dataUrl);
    const img = new Image();
    img.onload = () => {
      aspectRef.current = img.width / img.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) setResult(URL.createObjectURL(blob));
        setProcessing(false);
      }, 'image/png');
    };
    img.src = dataUrl;
  }, [file, width, height]);

  const handleWidthChange = (w: number) => {
    setWidth(w);
    if (maintainAspect) setHeight(Math.round(w / aspectRef.current));
  };

  return (
    <div className="tool-workspace">
      <ToolHeader title="Image Resize" desc="Resize images to exact dimensions." />
      {!file ? (
        <DropZone
          onFile={(files) => {
            setFile(files[0]);
          }}
          accept="image/*"
        />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileImage size={14} className="text-os-accent" />
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
          {preview && (
            <img
              src={preview}
              alt="preview"
              className="max-h-32 object-contain rounded-sm border border-os-border/30"
            />
          )}
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={width}
              onChange={(e) => handleWidthChange(Number(e.target.value))}
              className="os-input w-20"
              placeholder="Width"
            />
            <span className="text-os-text-muted">×</span>
            <input
              type="number"
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              className="os-input w-20"
              placeholder="Height"
            />
            <button
              onClick={() => setMaintainAspect(!maintainAspect)}
              className={`text-[10px] px-2 py-1 rounded-sm border ${maintainAspect ? 'border-os-accent/40 text-os-accent' : 'border-os-border/30 text-os-text-muted'}`}
            >
              Aspect
            </button>
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Resizing...' : 'Resize'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <img src={result} alt="result" className="max-h-40 object-contain rounded-sm" />
              <ResultActions
                result={result}
                downloadName={`resized_${file.name}`}
                mime="image/png"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ImgCrop() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState('');
  const [coords, setCoords] = useState({ x: 0, y: 0, w: 200, h: 200 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const onFile = useCallback(async (f: File) => {
    const data = await readFile(f);
    setFile(f);
    setPreview(data);
  }, []);

  const doCrop = useCallback(() => {
    if (!imgRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = coords.w;
    canvas.height = coords.h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(imgRef.current, coords.x, coords.y, coords.w, coords.h, 0, 0, coords.w, coords.h);
    canvas.toBlob((blob) => {
      if (blob) setResult(URL.createObjectURL(blob));
    }, 'image/png');
  }, [coords]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Image Crop" desc="Crop images with coordinate controls." />
      {!file ? (
        <DropZone onFile={(files) => onFile(files[0])} accept="image/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileImage size={14} className="text-os-accent" />
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
          <div className="relative border border-os-border/30 rounded-sm overflow-hidden inline-block max-h-48">
            <img ref={imgRef} src={preview} alt="source" className="max-h-48 object-contain" />
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[10px] text-os-text-muted">X</span>
            <input
              type="number"
              value={coords.x}
              onChange={(e) => setCoords({ ...coords, x: Number(e.target.value) })}
              className="os-input w-16"
            />
            <span className="text-[10px] text-os-text-muted">Y</span>
            <input
              type="number"
              value={coords.y}
              onChange={(e) => setCoords({ ...coords, y: Number(e.target.value) })}
              className="os-input w-16"
            />
            <span className="text-[10px] text-os-text-muted">W</span>
            <input
              type="number"
              value={coords.w}
              onChange={(e) => setCoords({ ...coords, w: Number(e.target.value) })}
              className="os-input w-16"
            />
            <span className="text-[10px] text-os-text-muted">H</span>
            <input
              type="number"
              value={coords.h}
              onChange={(e) => setCoords({ ...coords, h: Number(e.target.value) })}
              className="os-input w-16"
            />
            <button onClick={doCrop} className="os-btn os-btn-primary">
              Crop
            </button>
          </div>
          {result && (
            <div className="tool-workspace-output">
              <img src={result} alt="cropped" className="max-h-40 object-contain rounded-sm" />
              <ResultActions
                result={result}
                downloadName={`cropped_${file?.name}`}
                mime="image/png"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BulkImgConvert() {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState('image/webp');
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{ name: string; url: string }[]>([]);

  const process = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    const out: { name: string; url: string }[] = [];
    for (const file of files) {
      const data = await readFile(file);
      const img = new Image();
      await new Promise<void>((r) => {
        img.onload = () => r();
        img.src = data;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const ext = format.split('/')[1];
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), format, 0.92));
      if (blob)
        out.push({ name: `${file.name.split('.')[0]}.${ext}`, url: URL.createObjectURL(blob) });
    }
    setResults(out);
    setProcessing(false);
  }, [files, format]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Bulk Image Convert" desc="Convert multiple images at once." />
      {files.length === 0 ? (
        <DropZone onFile={(f) => setFiles(f)} accept="image/*" multiple />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="text-xs text-os-text">{files.length} images selected</div>
          <div className="flex gap-2">
            <select value={format} onChange={(e) => setFormat(e.target.value)} className="os-input">
              <option value="image/webp">WebP</option>
              <option value="image/png">PNG</option>
              <option value="image/jpeg">JPEG</option>
              <option value="image/avif">AVIF</option>
            </select>
            <button onClick={process} disabled={processing} className="os-btn os-btn-primary">
              {processing ? 'Converting...' : 'Convert All'}
            </button>
            <button
              onClick={() => {
                setFiles([]);
                setResults([]);
              }}
              className="os-btn"
            >
              Clear
            </button>
          </div>
          {results.length > 0 && (
            <div className="tool-workspace-output overflow-y-auto max-h-48">
              <div className="grid grid-cols-2 gap-2">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2 bg-os-surface/30 rounded-sm border border-os-border/20"
                  >
                    <img src={r.url} alt={r.name} className="h-8 w-8 rounded-sm object-cover" />
                    <span className="text-[10px] text-os-text truncate">{r.name}</span>
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

export function ImgMetadataClean() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState('');
  const [processing, setProcessing] = useState(false);
  const [originalSize, setOriginalSize] = useState(0);
  const [newSize, setNewSize] = useState(0);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const data = await readFile(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          setResult(URL.createObjectURL(blob));
          setNewSize(blob.size);
        }
        setProcessing(false);
      }, file.type || 'image/png');
    };
    img.src = data;
    setOriginalSize(file.size);
  }, [file]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Metadata Clean"
        desc="Strip EXIF and metadata from images by canvas re-render."
      />
      {!file ? (
        <DropZone
          onFile={(files) => {
            setFile(files[0]);
          }}
          accept="image/*"
        />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ScanLine size={14} className="text-os-accent" />
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
            {processing ? 'Cleaning...' : 'Clean Metadata'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <img src={result} alt="cleaned" className="max-h-40 object-contain rounded-sm" />
              <div className="text-[10px] text-os-text-muted mt-1">
                {originalSize > 0 && (
                  <span>Original: {(originalSize / 1024).toFixed(1)} KB → </span>
                )}
                {newSize > 0 && (
                  <span className="text-os-emerald">Cleaned: {(newSize / 1024).toFixed(1)} KB</span>
                )}
              </div>
              <ResultActions result={result} downloadName={`clean_${file.name}`} mime={file.type} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ColorExtract() {
  const [file, setFile] = useState<File | null>(null);
  const [colors, setColors] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const data = await readFile(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 64, 64);
      const d = ctx.getImageData(0, 0, 64, 64).data;
      const freq = new Map<string, number>();
      for (let i = 0; i < d.length; i += 16) {
        const r = d[i],
          g = d[i + 1],
          b = d[i + 2];
        const key = `${Math.round(r / 16) * 16},${Math.round(g / 16) * 16},${Math.round(b / 16) * 16}`;
        freq.set(key, (freq.get(key) || 0) + 1);
      }
      const sorted = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      setColors(sorted.map(([k]) => `rgb(${k})`));
      setProcessing(false);
    };
    img.src = data;
  }, [file]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Color Extract" desc="Extract dominant colors from images." />
      {!file ? (
        <DropZone
          onFile={(files) => {
            setFile(files[0]);
          }}
          accept="image/*"
        />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Palette size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setColors([]);
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Extracting...' : 'Extract Colors'}
          </button>
          {colors.length > 0 && (
            <div className="tool-workspace-output">
              <div className="flex flex-wrap gap-2">
                {colors.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div
                      className="w-8 h-8 rounded-sm border border-os-border/30"
                      style={{ background: c }}
                    />
                    <span className="text-[10px] text-os-text-muted font-mono">{c}</span>
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

export function PaletteGen() {
  const [file, setFile] = useState<File | null>(null);
  const [palette, setPalette] = useState<{ color: string; hex: string }[]>([]);
  const [processing, setProcessing] = useState(false);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const data = await readFile(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 64, 64);
      const d = ctx.getImageData(0, 0, 64, 64).data;
      const points: number[][] = [];
      for (let i = 0; i < d.length; i += 32) {
        points.push([d[i], d[i + 1], d[i + 2]]);
      }
      const k = 5;
      const centroids = points.slice(0, k);
      for (let iter = 0; iter < 10; iter++) {
        const clusters: number[][][] = Array.from({ length: k }, () => []);
        for (const p of points) {
          let best = 0,
            bestDist = Infinity;
          for (let i = 0; i < k; i++) {
            const dist = Math.hypot(
              p[0] - centroids[i][0],
              p[1] - centroids[i][1],
              p[2] - centroids[i][2],
            );
            if (dist < bestDist) {
              bestDist = dist;
              best = i;
            }
          }
          clusters[best].push(p);
        }
        for (let i = 0; i < k; i++) {
          if (clusters[i].length === 0) continue;
          const avg = clusters[i]
            .reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0])
            .map((s) => s / clusters[i].length);
          centroids[i] = avg;
        }
      }
      const toHex = (v: number[]) =>
        `#${v.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
      setPalette(
        centroids.map((c) => ({
          color: `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`,
          hex: toHex(c),
        })),
      );
      setProcessing(false);
    };
    img.src = data;
  }, [file]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Palette Gen" desc="Generate color palettes using k-means clustering." />
      {!file ? (
        <DropZone
          onFile={(files) => {
            setFile(files[0]);
          }}
          accept="image/*"
        />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setPalette([]);
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Generating...' : 'Generate Palette'}
          </button>
          {palette.length > 0 && (
            <div className="tool-workspace-output">
              <div className="flex gap-2">
                {palette.map((p, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div
                      className="w-10 h-10 rounded-sm border border-os-border/30"
                      style={{ background: p.color }}
                    />
                    <span className="text-[10px] text-os-text-muted font-mono">{p.hex}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-1 flex-wrap">
                {palette.map((p, i) => (
                  <span
                    key={i}
                    className="text-[10px] font-mono text-os-text-muted bg-os-surface/40 px-1.5 py-0.5 rounded-sm"
                  >
                    {p.hex}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SvgOptimize() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');
  const [stats, setStats] = useState({ before: 0, after: 0 });

  const optimize = useCallback(() => {
    let s = input;
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/> </g, '><');
    s = s.replace(/ ;/g, ';');
    s = s.replace(/ 0\./g, '.');
    s = s.replace(/="\s+/g, '="');
    s = s.replace(/\s+"/g, '"');
    s = s.replace(/fill-opacity:/g, 'fill-opacity:'); // keep
    s = s.trim();
    setResult(s);
    setStats({ before: input.length, after: s.length });
  }, [input]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="SVG Optimize" desc="Minimize and optimize SVG markup." />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste SVG markup..."
        className="os-input w-full h-28 font-mono text-[11px] resize-none mb-2"
      />
      <button onClick={optimize} className="os-btn os-btn-primary w-fit">
        Optimize
      </button>
      {result && (
        <div className="mt-2">
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-28 font-mono text-[11px] resize-none mb-1"
          />
          <div className="text-[10px] text-os-text-muted">
            {stats.before > 0 && (
              <span>
                Before: {stats.before} bytes → After: {stats.after} bytes (
                {((1 - stats.after / stats.before) * 100).toFixed(1)}% smaller)
              </span>
            )}
          </div>
          <ResultActions result={result} />
        </div>
      )}
    </div>
  );
}
