import { useState, useRef, useCallback } from 'react';
import {
  Upload,
  Download,
  ArrowRight,
  Clock,
  Copy,
  Check,
  AlertCircle,
  FileImage,
  Film,
  Music,
  FileText,
  FileJson,
  FileCode,
} from 'lucide-react';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function useToolState() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const reset = useCallback(() => {
    setFile(null);
    setPreview('');
    setProcessing(false);
    setResult('');
    setError('');
    setCopied(false);
  }, []);

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  return {
    file,
    setFile,
    preview,
    setPreview,
    processing,
    setProcessing,
    result,
    setResult,
    error,
    setError,
    copied,
    setCopied,
    reset,
    copy,
  };
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

// Generic image converter using canvas
function useImageConverter(format: string, mime: string) {
  const state = useToolState();
  const process = useCallback(async () => {
    if (!state.file) return;
    state.setProcessing(true);
    state.setError('');
    try {
      const dataUrl = await readFile(state.file);
      state.setPreview(dataUrl);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        if (format === 'png') {
          canvas.toBlob((blob) => {
            if (blob) state.setResult(URL.createObjectURL(blob));
            state.setProcessing(false);
          }, 'image/png');
        } else if (format === 'jpg') {
          canvas.toBlob(
            (blob) => {
              if (blob) state.setResult(URL.createObjectURL(blob));
              state.setProcessing(false);
            },
            'image/jpeg',
            0.92,
          );
        } else if (format === 'webp') {
          canvas.toBlob(
            (blob) => {
              if (blob) state.setResult(URL.createObjectURL(blob));
              state.setProcessing(false);
            },
            'image/webp',
            0.92,
          );
        } else if (format === 'avif') {
          canvas.toBlob((blob) => {
            if (blob) state.setResult(URL.createObjectURL(blob));
            state.setProcessing(false);
          }, 'image/avif');
        } else {
          state.setProcessing(false);
        }
      };
      img.src = dataUrl;
    } catch (err: any) {
      state.setError(err.message);
      state.setProcessing(false);
    }
  }, [state.file, format]);
  return { ...state, process };
}

export function ImgToWebp() {
  const { file, setFile, preview, processing, result, error, reset, process } = useImageConverter(
    'webp',
    'image/webp',
  );
  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Image → WebP"
        desc="Convert raster images to WebP format for smaller file sizes."
      />
      {!file ? (
        <DropZone
          onFile={(files) => {
            setFile(files[0]);
            readFile(files[0]).then(setFile as any);
          }}
          accept="image/*"
        />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileImage size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button onClick={reset} className="text-[10px] text-os-red ml-auto">
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
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Processing...' : 'Convert to WebP'}
          </button>
          {error && (
            <div className="text-xs text-os-red flex items-center gap-1">
              <AlertCircle size={12} /> {error}
            </div>
          )}
          {result && (
            <div className="tool-workspace-output">
              <img src={result} alt="result" className="max-h-40 object-contain rounded-sm" />
              <ResultActions
                result={result}
                downloadName={`${file.name.split('.')[0]}.webp`}
                mime="image/webp"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ImgToAvif() {
  const { file, setFile, preview, processing, result, error, reset, process } = useImageConverter(
    'avif',
    'image/avif',
  );
  return (
    <div className="tool-workspace">
      <ToolHeader title="Image → AVIF" desc="Convert images to next-gen AVIF format." />
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
            <button onClick={reset} className="text-[10px] text-os-red ml-auto">
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
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Processing...' : 'Convert to AVIF'}
          </button>
          {error && (
            <div className="text-xs text-os-red flex items-center gap-1">
              <AlertCircle size={12} /> {error}
            </div>
          )}
          {result && (
            <div className="tool-workspace-output">
              <img src={result} alt="result" className="max-h-40 object-contain rounded-sm" />
              <ResultActions
                result={result}
                downloadName={`${file.name.split('.')[0]}.avif`}
                mime="image/avif"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ImgToPng() {
  const { file, setFile, preview, processing, result, error, reset, process } = useImageConverter(
    'png',
    'image/png',
  );
  return (
    <div className="tool-workspace">
      <ToolHeader title="Image → PNG" desc="Convert images to PNG with transparency support." />
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
            <button onClick={reset} className="text-[10px] text-os-red ml-auto">
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
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Processing...' : 'Convert to PNG'}
          </button>
          {error && (
            <div className="text-xs text-os-red flex items-center gap-1">
              <AlertCircle size={12} /> {error}
            </div>
          )}
          {result && (
            <div className="tool-workspace-output">
              <img src={result} alt="result" className="max-h-40 object-contain rounded-sm" />
              <ResultActions
                result={result}
                downloadName={`${file.name.split('.')[0]}.png`}
                mime="image/png"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ImgToJpg() {
  const { file, setFile, preview, processing, result, error, reset, process } = useImageConverter(
    'jpg',
    'image/jpeg',
  );
  return (
    <div className="tool-workspace">
      <ToolHeader title="Image → JPG" desc="Convert images to JPEG format." />
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
            <button onClick={reset} className="text-[10px] text-os-red ml-auto">
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
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Processing...' : 'Convert to JPG'}
          </button>
          {error && (
            <div className="text-xs text-os-red flex items-center gap-1">
              <AlertCircle size={12} /> {error}
            </div>
          )}
          {result && (
            <div className="tool-workspace-output">
              <img src={result} alt="result" className="max-h-40 object-contain rounded-sm" />
              <ResultActions
                result={result}
                downloadName={`${file.name.split('.')[0]}.jpg`}
                mime="image/jpeg"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SvgToPng() {
  const [svg, setSvg] = useState('');
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');

  const process = useCallback(() => {
    if (!svg.trim()) return;
    setProcessing(true);
    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) setResult(URL.createObjectURL(blob));
        setProcessing(false);
      }, 'image/png');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [svg, width, height]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="SVG → PNG" desc="Render SVG markup to PNG raster." />
      <textarea
        value={svg}
        onChange={(e) => setSvg(e.target.value)}
        placeholder="Paste SVG markup..."
        className="os-input w-full h-28 font-mono text-[11px] resize-none mb-2"
      />
      <div className="flex gap-2 mb-2">
        <input
          type="number"
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          className="os-input w-20"
          placeholder="Width"
        />
        <input
          type="number"
          value={height}
          onChange={(e) => setHeight(Number(e.target.value))}
          className="os-input w-20"
          placeholder="Height"
        />
      </div>
      <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
        {processing ? 'Rendering...' : 'Render to PNG'}
      </button>
      {result && (
        <div className="mt-3">
          <img
            src={result}
            alt="result"
            className="max-h-40 rounded-sm border border-os-border/30"
          />
          <ResultActions result={result} downloadName="rendered.png" mime="image/png" />
        </div>
      )}
    </div>
  );
}

export function SvgToWebp() {
  const [svg, setSvg] = useState('');
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');

  const process = useCallback(() => {
    if (!svg.trim()) return;
    setProcessing(true);
    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) setResult(URL.createObjectURL(blob));
          setProcessing(false);
        },
        'image/webp',
        0.92,
      );
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [svg, width, height]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="SVG → WebP" desc="Render SVG markup to WebP raster." />
      <textarea
        value={svg}
        onChange={(e) => setSvg(e.target.value)}
        placeholder="Paste SVG markup..."
        className="os-input w-full h-28 font-mono text-[11px] resize-none mb-2"
      />
      <div className="flex gap-2 mb-2">
        <input
          type="number"
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          className="os-input w-20"
          placeholder="Width"
        />
        <input
          type="number"
          value={height}
          onChange={(e) => setHeight(Number(e.target.value))}
          className="os-input w-20"
          placeholder="Height"
        />
      </div>
      <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
        {processing ? 'Rendering...' : 'Render to WebP'}
      </button>
      {result && (
        <div className="mt-3">
          <img
            src={result}
            alt="result"
            className="max-h-40 rounded-sm border border-os-border/30"
          />
          <ResultActions result={result} downloadName="rendered.webp" mime="image/webp" />
        </div>
      )}
    </div>
  );
}

export function VideoConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState('video/webm');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');

  const process = useCallback(async () => {
    if (!file || !videoRef.current) return;
    setProcessing(true);
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream();
    const audioStream = (video as any).captureStream
      ? (video as any).captureStream().getAudioTracks()
      : [];
    audioStream.forEach((t: any) => stream.addTrack(t));
    const recorder = new MediaRecorder(stream, { mimeType: format });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: format });
      setResult(URL.createObjectURL(blob));
      setProcessing(false);
    };

    video.currentTime = 0;
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    recorder.start(100);

    const draw = () => {
      if (video.paused || video.ended) {
        recorder.stop();
        return;
      }
      ctx.drawImage(video, 0, 0);
      requestAnimationFrame(draw);
    };
    draw();
  }, [file, format]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Video Converter"
        desc="Convert video container format using MediaRecorder."
      />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="video/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Film size={14} className="text-os-accent" />
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
          <video
            ref={videoRef}
            src={URL.createObjectURL(file)}
            className="max-h-40 rounded-sm border border-os-border/30"
            controls
          />
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="os-input w-fit"
          >
            <option value="video/webm">WebM</option>
            <option value="video/mp4">MP4 (experimental)</option>
          </select>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Recording...' : 'Convert Video'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <video src={result} className="max-h-40 rounded-sm" controls />
              <ResultActions
                result={result}
                downloadName={`converted.${format.split('/')[1]}`}
                mime={format}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function VideoToHls() {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [segments, setSegments] = useState<string[]>([]);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    // Simulated HLS segmentation using canvas frame extraction
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    await new Promise<void>((resolve) => {
      video.onloadeddata = () => resolve();
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    const segs: string[] = [];
    const duration = video.duration || 10;
    const segDuration = 2;
    for (let t = 0; t < duration; t += segDuration) {
      video.currentTime = t;
      await new Promise<void>((r) => {
        video.onseeked = () => r();
      });
      ctx.drawImage(video, 0, 0);
      segs.push(canvas.toDataURL('image/jpeg', 0.8));
    }
    setSegments(segs);
    setProcessing(false);
    URL.revokeObjectURL(video.src);
  }, [file]);

  const m3u8 = segments.map((_, i) => `#EXTINF:2.0,\nsegment_${i}.jpg`).join('\n');

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Video → HLS/M3U8"
        desc="Generate HLS playlist structure with segment thumbnails."
      />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="video/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Film size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setSegments([]);
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Segmenting...' : 'Generate HLS Structure'}
          </button>
          {segments.length > 0 && (
            <div className="tool-workspace-output">
              <div className="text-[10px] text-os-text-muted mb-1">
                Generated {segments.length} segments
              </div>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {segments.map((s, i) => (
                  <img
                    key={i}
                    src={s}
                    alt={`seg${i}`}
                    className="h-16 rounded-sm border border-os-border/30"
                  />
                ))}
              </div>
              <textarea
                readOnly
                value={`#EXTM3U\n#EXT-X-TARGETDURATION:2\n${m3u8}\n#EXT-X-ENDLIST`}
                className="os-input w-full h-24 font-mono text-[10px] mt-2"
              />
              <ResultActions
                result={`#EXTM3U\n#EXT-X-TARGETDURATION:2\n${m3u8}\n#EXT-X-ENDLIST`}
                downloadName="playlist.m3u8"
                mime="application/vnd.apple.mpegurl"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function VideoToGif() {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    await new Promise<void>((resolve) => {
      video.onloadeddata = () => resolve();
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth, 480);
    canvas.height = Math.min(video.videoHeight, 480) * (canvas.width / video.videoWidth);
    const ctx = canvas.getContext('2d')!;
    const extracted: string[] = [];
    const duration = video.duration || 3;
    for (let t = 0; t < Math.min(duration, 3); t += 0.3) {
      video.currentTime = t;
      await new Promise<void>((r) => {
        video.onseeked = () => r();
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      extracted.push(canvas.toDataURL('image/png'));
    }
    setFrames(extracted);
    setProcessing(false);
    URL.revokeObjectURL(video.src);
  }, [file]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Video → GIF" desc="Extract key frames from video for GIF creation." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="video/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Film size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setFrames([]);
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Extracting...' : 'Extract Frames'}
          </button>
          {frames.length > 0 && (
            <div className="tool-workspace-output">
              <div className="text-[10px] text-os-text-muted mb-1">
                {frames.length} frames extracted (first 3 seconds)
              </div>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {frames.map((f, i) => (
                  <img
                    key={i}
                    src={f}
                    alt={`frame${i}`}
                    className="h-20 rounded-sm border border-os-border/30"
                  />
                ))}
              </div>
              <div className="text-[10px] text-os-amber mt-1">
                Note: Browser GIF encoding requires external assembly. Use frames in a GIF tool.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function GifToVideo() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState('');
  const [processing, setProcessing] = useState(false);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.src = url;
    await new Promise<void>((r) => {
      img.onload = () => r();
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const stream = canvas.captureStream();
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      setResult(URL.createObjectURL(blob));
      setProcessing(false);
    };
    recorder.start();
    setTimeout(() => recorder.stop(), 2000);
    URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="GIF → Video" desc="Convert GIF to WebM video using canvas capture." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="image/gif" />
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
          <img
            src={URL.createObjectURL(file)}
            alt="gif"
            className="max-h-40 rounded-sm border border-os-border/30"
          />
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Converting...' : 'Convert to Video'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <video src={result} className="max-h-40 rounded-sm" controls loop />
              <ResultActions result={result} downloadName="converted.webm" mime="video/webm" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function VideoToAudio() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState('');
  const [processing, setProcessing] = useState(false);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    await new Promise<void>((resolve) => {
      video.onloadeddata = () => resolve();
    });
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaElementSource(video);
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);
    video.play();
    const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      setResult(URL.createObjectURL(blob));
      setProcessing(false);
      video.pause();
    };
    recorder.start();
    setTimeout(() => recorder.stop(), (video.duration || 5) * 1000);
  }, [file]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Video → Audio" desc="Extract audio track from video." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="video/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Film size={14} className="text-os-accent" />
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
            {processing ? 'Extracting...' : 'Extract Audio'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <audio src={result} controls className="w-full" />
              <ResultActions result={result} downloadName="audio.webm" mime="audio/webm" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AudioConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState('');
  const [processing, setProcessing] = useState(false);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const audioCtx = new AudioContext();
    const buffer = await readFileBuffer(file);
    const audioBuffer = await audioCtx.decodeAudioData(buffer.slice(0));
    const offline = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate,
    );
    const source = offline.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const wavData = audioBufferToWav(rendered);
    const blob = new Blob([wavData], { type: 'audio/wav' });
    setResult(URL.createObjectURL(blob));
    setProcessing(false);
  }, [file]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Audio Converter" desc="Convert audio to WAV using Web Audio API." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="audio/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Music size={14} className="text-os-accent" />
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
            {processing ? 'Converting...' : 'Convert to WAV'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <audio src={result} controls className="w-full" />
              <ResultActions result={result} downloadName="converted.wav" mime="audio/wav" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PdfToImages() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    // PDF rendering requires pdfjs-dist library.
    // Install with: npm install pdfjs-dist
    setPages([]);
    setProcessing(false);
  }, [file]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="PDF → Images" desc="Render PDF pages to images." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="application/pdf" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setPages([]);
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Rendering...' : 'Render Pages'}
          </button>
          <div className="text-[10px] text-os-amber">
            Note: PDF rendering requires pdf.js. Install with npm i pdfjs-dist.
          </div>
        </div>
      )}
    </div>
  );
}

export function ImagesToPdf() {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');

  const process = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF();
      for (let i = 0; i < files.length; i++) {
        if (i > 0) pdf.addPage();
        const dataUrl = await readFile(files[i]);
        const img = new Image();
        await new Promise<void>((r) => {
          img.onload = () => r();
          img.src = dataUrl;
        });
        const ratio = img.width / img.height;
        const w = 190,
          h = w / ratio;
        pdf.addImage(dataUrl, 'JPEG', 10, 10, w, Math.min(h, 270));
      }
      const blob = pdf.output('blob');
      setResult(URL.createObjectURL(blob));
    } catch (e: any) {}
    setProcessing(false);
  }, [files]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Images → PDF" desc="Combine multiple images into a single PDF." />
      {files.length === 0 ? (
        <DropZone onFile={(f) => setFiles(f)} accept="image/*" multiple />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="text-xs text-os-text">{files.length} images selected</div>
          <div className="flex gap-1 overflow-x-auto">
            {files.map((f, i) => (
              <div
                key={i}
                className="text-[10px] text-os-text-muted px-2 py-1 bg-os-surface/40 rounded-sm border border-os-border/20"
              >
                {f.name}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={process} disabled={processing} className="os-btn os-btn-primary">
              {processing ? 'Building...' : 'Build PDF'}
            </button>
            <button onClick={() => setFiles([])} className="os-btn">
              Clear
            </button>
          </div>
          {result && (
            <div className="tool-workspace-output">
              <ResultActions result={result} downloadName="combined.pdf" mime="application/pdf" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function JsonYaml() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'json-to-yaml' | 'yaml-to-json'>('json-to-yaml');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const convert = useCallback(() => {
    setError('');
    try {
      if (mode === 'json-to-yaml') {
        const obj = JSON.parse(input);
        setResult(yamlDump(obj));
      } else {
        const obj = yamlLoad(input);
        setResult(JSON.stringify(obj, null, 2));
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [input, mode]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="JSON ↔ YAML" desc="Convert between JSON and YAML formats." />
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setMode('json-to-yaml')}
          className={`os-btn ${mode === 'json-to-yaml' ? 'os-btn-primary' : ''}`}
        >
          JSON → YAML
        </button>
        <button
          onClick={() => setMode('yaml-to-json')}
          className={`os-btn ${mode === 'yaml-to-json' ? 'os-btn-primary' : ''}`}
        >
          YAML → JSON
        </button>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={mode === 'json-to-yaml' ? 'Paste JSON...' : 'Paste YAML...'}
        className="os-input w-full h-32 font-mono text-[11px] resize-none mb-2"
      />
      <button onClick={convert} className="os-btn os-btn-primary w-fit">
        Convert
      </button>
      {error && <div className="text-xs text-os-red mt-1">{error}</div>}
      {result && (
        <div className="mt-2">
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-32 font-mono text-[11px] resize-none"
          />
          <ResultActions
            result={result}
            downloadName={mode === 'json-to-yaml' ? 'output.yaml' : 'output.json'}
          />
        </div>
      )}
    </div>
  );
}

export function JsonCsv() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'json-to-csv' | 'csv-to-json'>('json-to-csv');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const convert = useCallback(() => {
    setError('');
    try {
      if (mode === 'json-to-csv') {
        const arr = JSON.parse(input);
        if (!Array.isArray(arr)) throw new Error('JSON must be an array of objects');
        const keys = Object.keys(arr[0] || {});
        const csv = [
          keys.join(','),
          ...arr.map((row: any) => keys.map((k) => JSON.stringify(row[k] || '')).join(',')),
        ].join('\n');
        setResult(csv);
      } else {
        const lines = input.trim().split('\n');
        const keys = lines[0].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
        const json = lines.slice(1).map((line) => {
          const vals = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
          const obj: any = {};
          keys.forEach((k, i) => (obj[k] = vals[i]));
          return obj;
        });
        setResult(JSON.stringify(json, null, 2));
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [input, mode]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="JSON ↔ CSV" desc="Convert between JSON and CSV formats." />
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setMode('json-to-csv')}
          className={`os-btn ${mode === 'json-to-csv' ? 'os-btn-primary' : ''}`}
        >
          JSON → CSV
        </button>
        <button
          onClick={() => setMode('csv-to-json')}
          className={`os-btn ${mode === 'csv-to-json' ? 'os-btn-primary' : ''}`}
        >
          CSV → JSON
        </button>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={mode === 'json-to-csv' ? 'Paste JSON array...' : 'Paste CSV...'}
        className="os-input w-full h-32 font-mono text-[11px] resize-none mb-2"
      />
      <button onClick={convert} className="os-btn os-btn-primary w-fit">
        Convert
      </button>
      {error && <div className="text-xs text-os-red mt-1">{error}</div>}
      {result && (
        <div className="mt-2">
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-32 font-mono text-[11px] resize-none"
          />
          <ResultActions
            result={result}
            downloadName={mode === 'json-to-csv' ? 'output.csv' : 'output.json'}
          />
        </div>
      )}
    </div>
  );
}

export function UnixTimestamp() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');

  const convert = useCallback(() => {
    const val = input.trim();
    if (!val) return;
    if (/^\d+$/.test(val)) {
      const num = val.length === 10 ? parseInt(val) * 1000 : parseInt(val);
      const d = new Date(num);
      setResult(d.toISOString() + '\n' + d.toLocaleString() + '\nUTC: ' + d.toUTCString());
    } else {
      const d = new Date(val);
      setResult('Unix (ms): ' + d.getTime() + '\nUnix (s): ' + Math.floor(d.getTime() / 1000));
    }
  }, [input]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Unix / Timestamp"
        desc="Convert between Unix timestamps and human dates."
      />
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste timestamp or date..."
        className="os-input w-full mb-2"
      />
      <button onClick={convert} className="os-btn os-btn-primary w-fit">
        Convert
      </button>
      {result && (
        <div className="mt-2">
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-24 font-mono text-[11px] resize-none"
          />
          <ResultActions result={result} />
        </div>
      )}
    </div>
  );
}

export function OvenTemp() {
  const [val, setVal] = useState('350');
  const [unit, setUnit] = useState<'F' | 'C'>('F');

  const num = parseFloat(val) || 0;
  const fahrenheit = unit === 'F' ? num : Math.round((num * 9) / 5 + 32);
  const celsius = unit === 'C' ? num : Math.round(((num - 32) * 5) / 9);
  const gasMark = Math.max(1, Math.min(10, Math.round((fahrenheit - 250) / 25)));

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Oven Temperature Converter"
        desc="Convert baking and cooking temperatures between Fahrenheit, Celsius, and Gas Mark."
      />
      <div className="flex gap-2 mb-3">
        <input
          type="number"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="os-input flex-1 font-mono text-lg"
          placeholder="Enter temperature"
        />
        <button
          onClick={() => setUnit((u) => (u === 'F' ? 'C' : 'F'))}
          className="os-btn os-btn-primary px-4 font-mono font-bold"
        >
          °{unit}
        </button>
      </div>
      <div className="space-y-2 p-3 bg-black/20 border border-os-border/30 rounded">
        <div className="flex justify-between text-xs">
          <span className="text-os-text-muted">Fahrenheit:</span>
          <span className="font-mono font-semibold text-os-text">{fahrenheit}°F</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-os-text-muted">Celsius:</span>
          <span className="font-mono font-semibold text-os-text">{celsius}°C</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-os-text-muted">Gas Mark (approx):</span>
          <span className="font-mono font-semibold text-os-accent">Gas Mark {gasMark}</span>
        </div>
      </div>
    </div>
  );
}

// WAV encoder helper
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const headerLength = 44;
  const arrayBuffer = new ArrayBuffer(headerLength + dataLength);
  const view = new DataView(arrayBuffer);
  let offset = 0;
  const writeString = (str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset++, str.charCodeAt(i));
  };
  writeString('RIFF');
  view.setUint32(offset, 36 + dataLength, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, format, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bitDepth, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataLength, true);
  offset += 4;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return arrayBuffer;
}
