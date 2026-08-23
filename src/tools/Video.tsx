import { useState, useRef, useCallback } from 'react';
import {
  Upload,
  Download,
  Copy,
  Check,
  AlertCircle,
  Film,
  Scissors,
  Image,
  LayoutGrid,
  BadgeCheck,
  FileVideo,
} from 'lucide-react';

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function DropZone({ onFile, accept }: { onFile: (files: File[]) => void; accept?: string }) {
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
      <div className="text-xs text-os-text-muted">Drop video or click to select</div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
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

export function VideoCompress() {
  const [file, setFile] = useState<File | null>(null);
  const [bitrate, setBitrate] = useState(1000);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const process = useCallback(async () => {
    if (!file || !videoRef.current) return;
    setProcessing(true);
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream();
    const videoStream = (video as any).captureStream ? (video as any).captureStream() : null;
    if (videoStream && videoStream.getAudioTracks().length > 0)
      stream.addTrack(videoStream.getAudioTracks()[0]);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm',
      videoBitsPerSecond: bitrate * 1000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
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
  }, [file, bitrate]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Video Compress" desc="Re-record video with reduced bitrate." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="video/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileVideo size={14} className="text-os-accent" />
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
            className="max-h-32 rounded-sm border border-os-border/30"
            controls
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-os-text-muted">Bitrate (kbps)</span>
            <input
              type="range"
              min="100"
              max="5000"
              value={bitrate}
              onChange={(e) => setBitrate(Number(e.target.value))}
              className="w-32 accent-cyan-500"
            />
            <span className="text-xs text-os-accent w-12">{bitrate}k</span>
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Compressing...' : 'Compress'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <video src={result} className="max-h-40 rounded-sm" controls />
              <ResultActions result={result} downloadName="compressed.webm" mime="video/webm" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function VideoTrim() {
  const [file, setFile] = useState<File | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(5);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const process = useCallback(async () => {
    if (!file || !videoRef.current) return;
    setProcessing(true);
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream();
    const videoStream = (video as any).captureStream ? (video as any).captureStream() : null;
    if (videoStream && videoStream.getAudioTracks().length > 0)
      stream.addTrack(videoStream.getAudioTracks()[0]);
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
    video.currentTime = start;
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    recorder.start(100);
    const draw = () => {
      if (video.currentTime >= end || video.ended) {
        recorder.stop();
        video.pause();
        return;
      }
      ctx.drawImage(video, 0, 0);
      requestAnimationFrame(draw);
    };
    draw();
  }, [file, start, end]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Video Trim" desc="Trim video to a specific time range." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="video/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Scissors size={14} className="text-os-accent" />
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
            className="max-h-32 rounded-sm border border-os-border/30"
            controls
            onLoadedMetadata={(e) => setEnd(Math.min(5, (e.target as HTMLVideoElement).duration))}
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-os-text-muted">Start</span>
            <input
              type="number"
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
              className="os-input w-20"
              step="0.1"
            />
            <span className="text-[10px] text-os-text-muted">End</span>
            <input
              type="number"
              value={end}
              onChange={(e) => setEnd(Number(e.target.value))}
              className="os-input w-20"
              step="0.1"
            />
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Trimming...' : 'Trim'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <video src={result} className="max-h-40 rounded-sm" controls />
              <ResultActions result={result} downloadName="trimmed.webm" mime="video/webm" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FrameExtract() {
  const [file, setFile] = useState<File | null>(null);
  const [time, setTime] = useState(0);
  const [result, setResult] = useState('');

  const process = useCallback(async () => {
    if (!file) return;
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    await new Promise<void>((r) => {
      video.onloadeddata = () => r();
    });
    video.currentTime = time;
    await new Promise<void>((r) => {
      video.onseeked = () => r();
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) setResult(URL.createObjectURL(blob));
    }, 'image/png');
    URL.revokeObjectURL(video.src);
  }, [file, time]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Frame Extract" desc="Extract a single frame at a specific time." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="video/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Image size={14} className="text-os-accent" />
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
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-os-text-muted">Time (s)</span>
            <input
              type="number"
              value={time}
              onChange={(e) => setTime(Number(e.target.value))}
              className="os-input w-24"
              step="0.1"
            />
            <button onClick={process} className="os-btn os-btn-primary">
              Extract Frame
            </button>
          </div>
          {result && (
            <div className="tool-workspace-output">
              <img
                src={result}
                alt="frame"
                className="max-h-40 rounded-sm border border-os-border/30"
              />
              <ResultActions result={result} downloadName="frame.png" mime="image/png" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function VideoThumbnails() {
  const [file, setFile] = useState<File | null>(null);
  const [count, setCount] = useState(6);
  const [processing, setProcessing] = useState(false);
  const [thumbs, setThumbs] = useState<string[]>([]);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    await new Promise<void>((r) => {
      video.onloadeddata = () => r();
    });
    const duration = video.duration || 1;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d')!;
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      video.currentTime = (duration / (count + 1)) * (i + 1);
      await new Promise<void>((r) => {
        video.onseeked = () => r();
      });
      ctx.drawImage(video, 0, 0, 160, 90);
      out.push(canvas.toDataURL('image/jpeg', 0.8));
    }
    setThumbs(out);
    setProcessing(false);
    URL.revokeObjectURL(video.src);
  }, [file, count]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Video Thumbnails" desc="Generate thumbnail grid from video." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="video/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <LayoutGrid size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setThumbs([]);
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-os-text-muted">Thumbnails</span>
            <input
              type="range"
              min="1"
              max="12"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-24 accent-cyan-500"
            />
            <span className="text-xs text-os-accent w-6">{count}</span>
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Generating...' : 'Generate'}
          </button>
          {thumbs.length > 0 && (
            <div className="tool-workspace-output">
              <div className="grid grid-cols-3 gap-1">
                {thumbs.map((t, i) => (
                  <img
                    key={i}
                    src={t}
                    alt={`thumb${i}`}
                    className="rounded-sm border border-os-border/30"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function VideoMetadata() {
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const videoRef = useRef<HTMLVideoElement>(null);

  const onLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setMetadata({
      Duration: v.duration.toFixed(2) + 's',
      Width: v.videoWidth.toString(),
      Height: v.videoHeight.toString(),
      'Aspect Ratio': (v.videoWidth / v.videoHeight).toFixed(2),
      'Frame Rate': 'Unknown',
      'Video Codec': 'Browser decoded',
      'Audio Tracks': '1',
      'Ready State': v.readyState.toString(),
      'Network State': v.networkState.toString(),
      'Source Size': file ? (file.size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A',
      Type: file?.type || 'N/A',
    });
  }, [file]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Video Metadata" desc="Inspect video codec and metadata info." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="video/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <BadgeCheck size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
                setMetadata({});
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <video
            ref={videoRef}
            src={URL.createObjectURL(file)}
            className="hidden"
            onLoadedMetadata={onLoaded}
          />
          <div className="tool-workspace-output overflow-y-auto max-h-64">
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(metadata).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between p-1.5 bg-os-surface/30 rounded-sm border border-os-border/20"
                >
                  <span className="text-[10px] text-os-text-muted">{k}</span>
                  <span className="text-[10px] text-os-accent font-mono">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
