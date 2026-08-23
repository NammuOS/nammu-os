import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload,
  Download,
  Copy,
  Check,
  AlertCircle,
  Music,
  Scissors,
  FileAudio,
  BarChart3,
  Minus,
  Plus,
} from 'lucide-react';

function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
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
      <div className="text-xs text-os-text-muted">Drop audio or click to select</div>
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

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
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
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, 16, true);
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

export function AudioCompress() {
  const [file, setFile] = useState<File | null>(null);
  const [bitrate, setBitrate] = useState(128);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const ctx = new AudioContext();
    const buffer = await readFile(file);
    const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
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
  }, [file, bitrate]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Audio Compress"
        desc="Convert to WAV with reduced sample depth (lossy re-encode)."
      />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="audio/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileAudio size={14} className="text-os-accent" />
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
          <div className="text-[10px] text-os-amber">
            Note: Browser audio compression is limited. Tool re-encodes to WAV.
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Processing...' : 'Re-encode to WAV'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <audio src={result} controls className="w-full" />
              <ResultActions result={result} downloadName="compressed.wav" mime="audio/wav" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AudioTrim() {
  const [file, setFile] = useState<File | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(5);
  const [duration, setDuration] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const ctx = new AudioContext();
    const buffer = await readFile(file);
    const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.floor(end * sampleRate);
    const length = endSample - startSample;
    const trimmed = ctx.createBuffer(audioBuffer.numberOfChannels, length, sampleRate);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      trimmed.copyToChannel(audioBuffer.getChannelData(ch).slice(startSample, endSample), ch);
    }
    const wavData = audioBufferToWav(trimmed);
    const blob = new Blob([wavData], { type: 'audio/wav' });
    setResult(URL.createObjectURL(blob));
    setProcessing(false);
  }, [file, start, end]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Audio Trim" desc="Trim audio by time range using AudioBuffer slice." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="audio/*" />
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
          <audio
            ref={audioRef}
            src={URL.createObjectURL(file)}
            controls
            className="w-full"
            onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-os-text-muted">Start (s)</span>
            <input
              type="number"
              value={start}
              onChange={(e) => setStart(Math.max(0, Number(e.target.value)))}
              className="os-input w-20"
              step="0.1"
            />
            <span className="text-[10px] text-os-text-muted">End (s)</span>
            <input
              type="number"
              value={end}
              onChange={(e) => setEnd(Math.min(duration, Number(e.target.value)))}
              className="os-input w-20"
              step="0.1"
            />
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Trimming...' : 'Trim'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <audio src={result} controls className="w-full" />
              <ResultActions result={result} downloadName="trimmed.wav" mime="audio/wav" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Id3Edit() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [year, setYear] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');

  const process = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    const buffer = await readFile(file);
    const bytes = new Uint8Array(buffer);
    let id3v1Offset = bytes.length - 128;
    if (id3v1Offset < 0) id3v1Offset = 0;
    const hasId3v1 =
      bytes.length >= 128 &&
      String.fromCharCode(...bytes.slice(id3v1Offset, id3v1Offset + 3)) === 'TAG';

    const encoder = new TextEncoder();
    const pad = (str: string, len: number) => {
      const b = encoder.encode(str);
      const out = new Uint8Array(len);
      out.set(b.slice(0, len));
      return out;
    };

    const id3v1 = new Uint8Array(128);
    id3v1.set(encoder.encode('TAG'));
    id3v1.set(pad(title, 30), 3);
    id3v1.set(pad(artist, 30), 33);
    id3v1.set(pad(album, 30), 63);
    id3v1.set(pad(year, 4), 93);

    let out: Uint8Array;
    if (hasId3v1) {
      out = new Uint8Array(bytes.length);
      out.set(bytes.slice(0, id3v1Offset));
      out.set(id3v1, id3v1Offset);
    } else {
      out = new Uint8Array(bytes.length + 128);
      out.set(bytes);
      out.set(id3v1, bytes.length);
    }

    const blob = new Blob([out as unknown as BlobPart], { type: 'audio/mpeg' });
    setResult(URL.createObjectURL(blob));
    setProcessing(false);
  }, [file, title, artist, album, year]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="ID3 Edit" desc="Edit MP3 metadata tags (ID3v1)." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="audio/mpeg" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileAudio size={14} className="text-os-accent" />
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
          <div className="grid grid-cols-2 gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="os-input"
              maxLength={30}
            />
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Artist"
              className="os-input"
              maxLength={30}
            />
            <input
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              placeholder="Album"
              className="os-input"
              maxLength={30}
            />
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="Year"
              className="os-input"
              maxLength={4}
            />
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Writing...' : 'Write Tags'}
          </button>
          {result && (
            <div className="tool-workspace-output">
              <audio src={result} controls className="w-full" />
              <ResultActions
                result={result}
                downloadName={`tagged_${file.name}`}
                mime="audio/mpeg"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function WaveformGen() {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const process = useCallback(async () => {
    if (!file || !canvasRef.current) return;
    setProcessing(true);
    const ctx = new AudioContext();
    const buffer = await readFile(file);
    const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
    const data = audioBuffer.getChannelData(0);
    const canvas = canvasRef.current;
    const w = (canvas.width = 600);
    const h = (canvas.height = 120);
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(6,182,212,0.1)';
    c.strokeStyle = '#06b6d4';
    c.lineWidth = 1;

    const step = Math.ceil(data.length / w);
    const amp = h / 2;

    c.beginPath();
    for (let i = 0; i < w; i++) {
      let min = 1,
        max = -1;
      for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      c.moveTo(i, (1 + min) * amp);
      c.lineTo(i, (1 + max) * amp);
    }
    c.stroke();
    c.fillRect(0, amp - 0.5, w, 1);
    setProcessing(false);
  }, [file]);

  const downloadCanvas = useCallback(() => {
    if (!canvasRef.current) return;
    const a = document.createElement('a');
    a.href = canvasRef.current.toDataURL('image/png');
    a.download = 'waveform.png';
    a.click();
  }, []);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Waveform Gen" desc="Generate audio waveform visualization." />
      {!file ? (
        <DropZone onFile={(files) => setFile(files[0])} accept="audio/*" />
      ) : (
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 size={14} className="text-os-accent" />
            <span className="text-xs text-os-text">{file.name}</span>
            <button
              onClick={() => {
                setFile(null);
              }}
              className="text-[10px] text-os-red ml-auto"
            >
              Clear
            </button>
          </div>
          <button onClick={process} disabled={processing} className="os-btn os-btn-primary w-fit">
            {processing ? 'Generating...' : 'Generate Waveform'}
          </button>
          <canvas
            ref={canvasRef}
            className="w-full rounded-sm border border-os-border/30 bg-os-bg"
            style={{ maxHeight: 120 }}
          />
          <button onClick={downloadCanvas} className="os-btn w-fit">
            Download PNG
          </button>
        </div>
      )}
    </div>
  );
}
