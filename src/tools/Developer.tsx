import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Copy,
  Check,
  FileJson,
  Binary,
  Globe,
  Shield,
  Hash,
  Fingerprint,
  Search,
  Diff,
  FileCode,
  Minimize2,
  AlertCircle,
  Download,
  Upload,
  Database,
  Terminal,
  Cpu,
  Laptop,
  Smartphone,
  Sparkles,
  Clock,
  RefreshCw,
  Layers,
} from 'lucide-react';
import { marked } from 'marked';

function ToolHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold text-os-text flex items-center gap-1.5">
        <CodeIcon title={title} />
        {title}
      </div>
      <div className="text-[10px] text-os-text-muted">{desc}</div>
    </div>
  );
}

function CodeIcon({ title }: { title: string }) {
  if (title.includes('SQL')) return <Database size={13} className="text-os-accent" />;
  if (title.includes('Agent')) return <Globe size={13} className="text-os-accent" />;
  if (title.includes('Cron')) return <Clock size={13} className="text-os-accent" />;
  return <FileCode size={13} className="text-os-accent" />;
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
    a.href = `data:${mime || 'text/plain'};charset=utf-8,${encodeURIComponent(result)}`;
    a.download = downloadName || 'download.txt';
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

// 1. JSON Format
export function JsonFormat() {
  const [input, setInput] = useState(
    '{"name":"Nammu OS","version":"4.1.0","active":true,"modules":["kernel","desktop","tools"]}',
  );
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [compact, setCompact] = useState(false);

  const format = useCallback(() => {
    setError('');
    try {
      const obj = JSON.parse(input);
      setResult(JSON.stringify(obj, null, compact ? 0 : 2));
    } catch (e: any) {
      setError(e.message);
    }
  }, [input, compact]);

  useEffect(() => {
    format();
  }, [format]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="JSON Format" desc="Format, validate, and prettify JSON data structures." />
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setCompact(false)}
          className={`os-btn ${!compact ? 'os-btn-primary' : ''}`}
        >
          Prettify (2 Spaces)
        </button>
        <button
          onClick={() => setCompact(true)}
          className={`os-btn ${compact ? 'os-btn-primary' : ''}`}
        >
          Compact / Minify
        </button>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste JSON here..."
        className="os-input w-full h-32 font-mono text-[11px] resize-none mb-2"
      />
      <button onClick={format} className="os-btn os-btn-primary w-fit">
        Format & Validate
      </button>
      {error && (
        <div className="text-xs text-os-red mt-2 flex items-center gap-1">
          <AlertCircle size={12} /> {error}
        </div>
      )}
      {result && !error && (
        <div className="mt-2">
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-36 font-mono text-[11px] resize-none"
          />
          <ResultActions result={result} downloadName="formatted.json" mime="application/json" />
        </div>
      )}
    </div>
  );
}

// 2. Base64
export function Base64() {
  const [input, setInput] = useState('Hello, Nammu OS World!');
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const convert = useCallback(() => {
    setError('');
    try {
      if (mode === 'encode') setResult(btoa(unescape(encodeURIComponent(input))));
      else setResult(decodeURIComponent(escape(atob(input))));
    } catch (e: any) {
      setError('Invalid Base64 input string');
    }
  }, [input, mode]);

  useEffect(() => {
    convert();
  }, [convert]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Base64" desc="Encode and decode standard UTF-8 Base64 strings." />
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setMode('encode')}
          className={`os-btn ${mode === 'encode' ? 'os-btn-primary' : ''}`}
        >
          Encode
        </button>
        <button
          onClick={() => setMode('decode')}
          className={`os-btn ${mode === 'decode' ? 'os-btn-primary' : ''}`}
        >
          Decode
        </button>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={mode === 'encode' ? 'Text to encode...' : 'Base64 to decode...'}
        className="os-input w-full h-28 font-mono text-[11px] resize-none mb-2"
      />
      <button onClick={convert} className="os-btn os-btn-primary w-fit">
        Convert
      </button>
      {error && (
        <div className="text-xs text-os-red mt-2 flex items-center gap-1">
          <AlertCircle size={12} /> {error}
        </div>
      )}
      {result && !error && (
        <div className="mt-2">
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-24 font-mono text-[11px] resize-none"
          />
          <ResultActions result={result} downloadName="base64.txt" />
        </div>
      )}
    </div>
  );
}

// 3. URL Encode
export function UrlEncode() {
  const [input, setInput] = useState('https://nammu.os/search?query=web os & filter=tools');
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const convert = useCallback(() => {
    setError('');
    try {
      if (mode === 'encode') setResult(encodeURIComponent(input));
      else setResult(decodeURIComponent(input));
    } catch (e: any) {
      setError('Invalid URI input sequence');
    }
  }, [input, mode]);

  useEffect(() => {
    convert();
  }, [convert]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="URL Encode / Decode"
        desc="Encode special characters into percent-encoded URI components."
      />
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setMode('encode')}
          className={`os-btn ${mode === 'encode' ? 'os-btn-primary' : ''}`}
        >
          Encode
        </button>
        <button
          onClick={() => setMode('decode')}
          className={`os-btn ${mode === 'decode' ? 'os-btn-primary' : ''}`}
        >
          Decode
        </button>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Enter URI text..."
        className="os-input w-full h-24 font-mono text-[11px] resize-none mb-2"
      />
      {error && <div className="text-xs text-os-red mb-2">{error}</div>}
      {result && (
        <div>
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-24 font-mono text-[11px] resize-none"
          />
          <ResultActions result={result} downloadName="url_encoded.txt" />
        </div>
      )}
    </div>
  );
}

// 4. JWT Inspect
export function JwtInspect() {
  const [input, setInput] = useState(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFsaWNlIFNtaXRoIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlIjoiYWRtaW4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  );
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const inspect = useCallback(() => {
    setError('');
    try {
      const parts = input.trim().split('.');
      if (parts.length !== 3)
        throw new Error('JWT must consist of exactly 3 parts separated by dots.');
      const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      const signature = parts[2];
      setResult({ header, payload, signature });
    } catch (e: any) {
      setError(e.message);
      setResult(null);
    }
  }, [input]);

  useEffect(() => {
    inspect();
  }, [inspect]);

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-3">
      <ToolHeader
        title="JWT Inspector"
        desc="Decode and inspect JSON Web Token headers, payload claims, and signature."
      />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste JWT token (header.payload.signature)..."
        className="os-input w-full h-20 font-mono text-[11px] resize-none"
      />
      {error && (
        <div className="text-xs text-os-red flex items-center gap-1">
          <AlertCircle size={12} /> {error}
        </div>
      )}
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="p-2.5 bg-black/25 rounded border border-white/10">
            <span className="text-[10px] font-mono text-os-accent font-semibold block mb-1">
              HEADER: Algorithm & Token Type
            </span>
            <pre className="os-input font-mono text-[10px] p-2 max-h-36 overflow-y-auto text-pink-400">
              {JSON.stringify(result.header, null, 2)}
            </pre>
          </div>
          <div className="p-2.5 bg-black/25 rounded border border-white/10">
            <span className="text-[10px] font-mono text-os-accent font-semibold block mb-1">
              PAYLOAD: Data Claims
            </span>
            <pre className="os-input font-mono text-[10px] p-2 max-h-36 overflow-y-auto text-cyan-400">
              {JSON.stringify(result.payload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// 5. Hash Gen
export function HashGen() {
  const [input, setInput] = useState('Nammu OS Secure Hash');
  const [algo, setAlgo] = useState<'SHA-256' | 'SHA-384' | 'SHA-512'>('SHA-256');
  const [result, setResult] = useState('');

  const generate = useCallback(async () => {
    if (!input) {
      setResult('');
      return;
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest(algo, data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    setResult(hashArray.map((b) => b.toString(16).padStart(2, '0')).join(''));
  }, [input, algo]);

  useEffect(() => {
    generate();
  }, [generate]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Hash Generator"
        desc="Generate cryptographic SHA-256, SHA-384, and SHA-512 digests."
      />
      <div className="flex gap-2 mb-2">
        {(['SHA-256', 'SHA-384', 'SHA-512'] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAlgo(a)}
            className={`os-btn ${algo === a ? 'os-btn-primary' : ''}`}
          >
            {a}
          </button>
        ))}
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Text to hash..."
        className="os-input w-full h-24 font-mono text-[11px] resize-none mb-2"
      />
      {result && (
        <div className="mt-2">
          <span className="text-[10px] text-os-text-muted mb-1 block font-mono">
            {algo} Hex Output:
          </span>
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-16 font-mono text-[11px] resize-none text-os-accent"
          />
          <ResultActions result={result} downloadName={`${algo.toLowerCase()}_hash.txt`} />
        </div>
      )}
    </div>
  );
}

// 6. UUID Gen
export function UuidGen() {
  const [count, setCount] = useState(5);
  const [uuids, setUuids] = useState<string[]>([]);

  const generate = useCallback(() => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push(crypto.randomUUID());
    }
    setUuids(out);
  }, [count]);

  useEffect(() => {
    generate();
  }, [generate]);

  return (
    <div className="tool-workspace flex flex-col gap-2.5">
      <ToolHeader
        title="UUID v4 Generator"
        desc="Generate cryptographically random RFC 4122 Version 4 UUIDs."
      />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-os-text-muted">Count:</span>
        <input
          type="number"
          min="1"
          max="100"
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value)))}
          className="os-input w-20"
        />
        <button onClick={generate} className="os-btn os-btn-primary flex items-center gap-1">
          <RefreshCw size={11} /> Generate
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(uuids.join('\n'))}
          className="os-btn flex items-center gap-1"
        >
          <Copy size={11} /> Copy All
        </button>
      </div>

      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto os-scrollbar">
        {uuids.map((u, i) => (
          <div
            key={i}
            className="flex items-center justify-between p-1.5 bg-black/25 rounded border border-white/[0.06]"
          >
            <span className="text-[10px] text-[#4a5c6c] w-6 font-mono">{i + 1}.</span>
            <span className="text-xs text-os-accent font-mono flex-1">{u}</span>
            <button
              onClick={() => navigator.clipboard.writeText(u)}
              className="text-os-text-muted hover:text-os-accent p-1"
              title="Copy UUID"
            >
              <Copy size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// 7. Regex Tester
export function RegexTester() {
  const [pattern, setPattern] = useState('[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}');
  const [flags, setFlags] = useState('gi');
  const [text, setText] = useState(
    'Contact us at support@nammu.os or admin@nammu.org for inquiries.',
  );
  const [matches, setMatches] = useState<string[]>([]);
  const [error, setError] = useState('');

  const test = useCallback(() => {
    setError('');
    setMatches([]);
    if (!pattern) return;
    try {
      const regex = new RegExp(pattern, flags);
      const all = text.match(regex);
      setMatches(all || []);
    } catch (e: any) {
      setError(e.message);
    }
  }, [pattern, flags, text]);

  useEffect(() => {
    test();
  }, [test]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Regex Tester"
        desc="Test regular expressions against live sample text with matching highlights."
      />
      <div className="flex gap-2 mb-2">
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="Pattern (e.g. \w+)"
          className="os-input flex-1 font-mono text-xs"
        />
        <input
          value={flags}
          onChange={(e) => setFlags(e.target.value)}
          placeholder="Flags (g, i, m)"
          className="os-input w-24 font-mono text-xs text-center"
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Sample test text..."
        className="os-input w-full h-24 font-mono text-[11px] resize-none mb-2"
      />
      {error && <div className="text-xs text-os-red mb-2">{error}</div>}
      <div className="p-2.5 bg-black/25 rounded border border-white/10">
        <span className="text-[10px] text-os-text-muted mb-1 block font-mono">
          Found {matches.length} Matches:
        </span>
        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
          {matches.map((m, i) => (
            <span
              key={i}
              className="px-2 py-0.5 rounded bg-os-accent/15 border border-os-accent/30 text-os-accent font-mono text-xs"
            >
              {m}
            </span>
          ))}
          {matches.length === 0 && (
            <span className="text-[10px] text-[#4a5c6c] italic">No matches found.</span>
          )}
        </div>
      </div>
    </div>
  );
}

// 8. Diff Checker
export function DiffChecker() {
  const [left, setLeft] = useState('function greeting() {\n  console.log("Hello");\n}');
  const [right, setRight] = useState(
    'function greeting(name = "World") {\n  console.log(`Hello, ${name}!`);\n}',
  );
  const [diff, setDiff] = useState<{ type: string; text: string }[]>([]);

  const computeDiff = useCallback(() => {
    const a = left.split('\n');
    const b = right.split('\n');
    const result: { type: string; text: string }[] = [];
    let i = 0,
      j = 0;
    while (i < a.length || j < b.length) {
      if (i >= a.length) {
        result.push({ type: 'added', text: b[j] });
        j++;
      } else if (j >= b.length) {
        result.push({ type: 'removed', text: a[i] });
        i++;
      } else if (a[i] === b[j]) {
        result.push({ type: 'same', text: a[i] });
        i++;
        j++;
      } else {
        result.push({ type: 'removed', text: a[i] });
        i++;
        result.push({ type: 'added', text: b[j] });
        j++;
      }
    }
    setDiff(result);
  }, [left, right]);

  useEffect(() => {
    computeDiff();
  }, [computeDiff]);

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-2.5">
      <ToolHeader
        title="Diff Checker"
        desc="Compare two texts line-by-line with visual change highlighting."
      />
      <div className="grid grid-cols-2 gap-2">
        <textarea
          value={left}
          onChange={(e) => setLeft(e.target.value)}
          placeholder="Original..."
          className="os-input h-28 font-mono text-[11px] resize-none"
        />
        <textarea
          value={right}
          onChange={(e) => setRight(e.target.value)}
          placeholder="Modified..."
          className="os-input h-28 font-mono text-[11px] resize-none"
        />
      </div>
      <div className="p-2.5 bg-black/30 rounded border border-white/10 max-h-48 overflow-y-auto os-scrollbar font-mono text-[11px]">
        {diff.map((d, i) => (
          <div
            key={i}
            className={`py-0.5 px-1.5 rounded flex items-center gap-2 ${d.type === 'added' ? 'bg-emerald-500/15 text-emerald-400' : d.type === 'removed' ? 'bg-rose-500/15 text-rose-400' : 'text-os-text-muted'}`}
          >
            <span className="w-3 text-center font-bold">
              {d.type === 'added' ? '+' : d.type === 'removed' ? '-' : ' '}
            </span>
            <span className="flex-1 whitespace-pre-wrap">{d.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 9. Markdown Preview
export function MarkdownPreview() {
  const [input, setInput] = useState(
    '# Nammu OS\n\nWelcome to **advanced web computing**.\n\n- [x] Fast window management\n- [x] Rich developer tools\n- [x] Custom theme engine\n\n```js\nconst status = "operational";\n```',
  );

  return (
    <div className="tool-workspace overflow-hidden flex flex-col h-full">
      <ToolHeader
        title="Markdown Live Preview"
        desc="Real-time Markdown editor with live rendered HTML preview."
      />
      <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="os-input font-mono text-[11px] resize-none h-full p-2"
        />
        <div className="os-input h-full overflow-y-auto os-scrollbar p-3 bg-black/25">
          <div
            className="text-xs text-os-text prose prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: marked.parse(input, { async: false }) as string }}
          />
        </div>
      </div>
    </div>
  );
}

// 10. Code Minify (JS / CSS / HTML)
export function CodeMinify() {
  const [input, setInput] = useState(
    '/* Sample CSS */\n.container {\n  display: flex;\n  margin: 0px 10px;\n  color: #ffffff;\n}',
  );
  const [type, setType] = useState<'css' | 'js' | 'html'>('css');
  const [result, setResult] = useState('');
  const [stats, setStats] = useState({ original: 0, minified: 0, percent: 0 });

  const minify = useCallback(() => {
    let out = input;
    if (type === 'css') {
      out = out
        .replace(/\/\*[\s\S]*?\*\//g, '') // remove comments
        .replace(/\s+/g, ' ') // collapse whitespace
        .replace(/\s*([{}:;,])\s*/g, '$1') // remove spacing around symbols
        .replace(/;}/g, '}') // strip trailing semicolon in rule
        .replace(/0(px|em|rem|%)/g, '0') // 0px -> 0
        .trim();
    } else if (type === 'js') {
      out = out
        .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
        .replace(/\/\/.*$/gm, '') // line comments
        .replace(/^\s+/gm, '') // leading space
        .replace(/\s*([=+\-*/%&|^!<>?:;{},()[\]])\s*/g, '$1') // safe operator spacing
        .replace(/\n+/g, '') // strip newlines
        .trim();
    } else if (type === 'html') {
      out = out
        .replace(/<!--[\s\S]*?-->/g, '') // remove HTML comments
        .replace(/>\s+</g, '><') // remove tag gaps
        .replace(/\s+/g, ' ') // collapse internal whitespace
        .trim();
    }

    setResult(out);
    const orig = new Blob([input]).size;
    const mini = new Blob([out]).size;
    const pct = orig > 0 ? (1 - mini / orig) * 100 : 0;
    setStats({ original: orig, minified: mini, percent: Math.max(0, pct) });
  }, [input, type]);

  useEffect(() => {
    minify();
  }, [minify]);

  return (
    <div className="tool-workspace flex flex-col gap-2.5 overflow-y-auto os-scrollbar">
      <ToolHeader
        title="Code Minifier"
        desc="Minify JavaScript, CSS, and HTML files by safely stripping comments and whitespace."
      />

      <div className="flex gap-2">
        {(['css', 'js', 'html'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`os-btn font-mono uppercase ${type === t ? 'os-btn-primary' : ''}`}
          >
            {t}
          </button>
        ))}
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={`Paste ${type.toUpperCase()} source code...`}
        className="os-input w-full h-28 font-mono text-[11px] resize-none"
      />

      {result && (
        <div className="space-y-2">
          {/* Stats Bar */}
          <div className="flex items-center justify-between p-2 bg-black/25 rounded border border-white/10 text-[10px] font-mono">
            <span>
              Original: <strong className="text-os-text">{stats.original} B</strong>
            </span>
            <span>
              Minified: <strong className="text-os-emerald">{stats.minified} B</strong>
            </span>
            <span className="text-os-accent font-semibold">{stats.percent.toFixed(1)}% Saved</span>
          </div>

          <textarea
            readOnly
            value={result}
            className="os-input w-full h-24 font-mono text-[11px] resize-none text-os-accent"
          />
          <ResultActions result={result} downloadName={`minified.${type}`} />
        </div>
      )}
    </div>
  );
}

// 11. XML to JSON
export function XmlToJson() {
  const [input, setInput] = useState(
    '<user id="101">\n  <name>John Doe</name>\n  <role>Administrator</role>\n</user>',
  );
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const convert = useCallback(() => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(input, 'text/xml');
      if (doc.getElementsByTagName('parsererror').length > 0)
        throw new Error('Invalid XML structure');
      const xml2json = (el: Element): any => {
        if (el.nodeType === 3) return el.textContent || '';
        const obj: any = {};
        for (const attr of el.attributes || []) obj['@' + attr.name] = attr.value;
        for (const child of el.children) {
          const tag = child.tagName.toLowerCase();
          if (child.children.length === 0) obj[tag] = child.textContent || '';
          else if (obj[tag]) {
            if (!Array.isArray(obj[tag])) obj[tag] = [obj[tag]];
            obj[tag].push(xml2json(child));
          } else obj[tag] = xml2json(child);
        }
        return obj;
      };
      setResult(JSON.stringify(xml2json(doc.documentElement), null, 2));
      setError('');
    } catch (e: any) {
      setError(e.message);
      setResult('');
    }
  }, [input]);

  useEffect(() => {
    convert();
  }, [convert]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="XML to JSON"
        desc="Parse and convert XML markup documents into JSON objects."
      />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste XML..."
        className="os-input w-full h-28 font-mono text-[11px] resize-none mb-2"
      />
      {error && <div className="text-xs text-os-red mb-2">{error}</div>}
      {result && (
        <div>
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-32 font-mono text-[11px] resize-none"
          />
          <ResultActions result={result} downloadName="converted.json" mime="application/json" />
        </div>
      )}
    </div>
  );
}

// 12. JSON to XML
export function JsonToXml() {
  const [input, setInput] = useState(
    '{\n  "user": {\n    "name": "Jane Smith",\n    "active": true\n  }\n}',
  );
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const convert = useCallback(() => {
    try {
      const obj = JSON.parse(input);
      const json2xml = (val: any, tag = 'root'): string => {
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')
          return `<${tag}>${val}</${tag}>`;
        if (Array.isArray(val))
          return val.map((item) => json2xml(item, tag.slice(0, -1) || 'item')).join('\n');
        if (typeof val === 'object' && val !== null) {
          const inner = Object.entries(val)
            .map(([k, v]) => json2xml(v, k))
            .join('\n  ');
          return `<${tag}>\n  ${inner}\n</${tag}>`;
        }
        return `<${tag}/>`;
      };
      setResult(json2xml(obj));
      setError('');
    } catch (e: any) {
      setError(e.message);
      setResult('');
    }
  }, [input]);

  useEffect(() => {
    convert();
  }, [convert]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="JSON to XML"
        desc="Convert structured JSON format into valid XML markup."
      />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste JSON..."
        className="os-input w-full h-28 font-mono text-[11px] resize-none mb-2"
      />
      {error && <div className="text-xs text-os-red mb-2">{error}</div>}
      {result && (
        <div>
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-32 font-mono text-[11px] resize-none"
          />
          <ResultActions result={result} downloadName="converted.xml" mime="application/xml" />
        </div>
      )}
    </div>
  );
}

// 13. Markdown to HTML
export function MarkdownToHtml() {
  const [input, setInput] = useState(
    '# Title\n\nThis is a **markdown** document with [links](https://nammu.os).\n\n- Item 1\n- Item 2',
  );
  const result = marked.parse(input, { async: false }) as string;

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Markdown → HTML"
        desc="Convert Markdown formatted text into standard HTML markup tags."
      />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="os-input w-full h-28 font-mono text-[11px] resize-none mb-2"
      />
      <textarea
        readOnly
        value={result}
        className="os-input w-full h-28 font-mono text-xs resize-none"
      />
      <ResultActions result={result} downloadName="rendered.html" mime="text/html" />
    </div>
  );
}

// 14. Base64 Image
export function Base64Image() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');

  const onFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setResult(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Base64 Image Encoder"
        desc="Convert local image files to Base64 data URI data strings."
      />
      <input
        type="file"
        accept="image/*"
        onChange={onFileUpload}
        className="os-input w-full mb-2 text-xs"
      />
      {result && (
        <div className="space-y-2">
          <img src={result} alt="Preview" className="max-h-32 rounded border border-white/20" />
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-20 font-mono text-[10px] resize-none"
          />
          <ResultActions result={result} downloadName="base64_image.txt" />
        </div>
      )}
    </div>
  );
}

export function HtmlMinifier() {
  return <CodeMinify />;
}

export function CssMinifier() {
  return <CodeMinify />;
}

export function JsMinifier() {
  return <CodeMinify />;
}

// 15. SQL Formatter (Multi-Dialect, Keyword Case, Pretty Indentation)
export function SqlFormatter() {
  const [input, setInput] = useState(
    'select u.id, u.username, count(o.id) as order_count from users u left join orders o on u.id = o.user_id where u.active = 1 and u.created_at >= "2025-01-01" group by u.id, u.username having count(o.id) > 5 order by order_count desc limit 20;',
  );
  const [keywordCase, setKeywordCase] = useState<'UPPER' | 'lower'>('UPPER');
  const [indentSize, setIndentSize] = useState<number>(2);
  const [result, setResult] = useState('');

  const formatSql = useCallback(() => {
    if (!input.trim()) {
      setResult('');
      return;
    }

    const keywords = [
      'SELECT',
      'FROM',
      'WHERE',
      'AND',
      'OR',
      'JOIN',
      'INNER JOIN',
      'LEFT JOIN',
      'RIGHT JOIN',
      'CROSS JOIN',
      'ON',
      'GROUP BY',
      'ORDER BY',
      'HAVING',
      'LIMIT',
      'OFFSET',
      'UNION',
      'UNION ALL',
      'INSERT INTO',
      'VALUES',
      'UPDATE',
      'SET',
      'DELETE FROM',
      'CREATE TABLE',
      'DROP TABLE',
      'ALTER TABLE',
      'CASE',
      'WHEN',
      'THEN',
      'ELSE',
      'END',
    ];

    let sql = input.replace(/\s+/g, ' ').trim();

    // Line breaks before major clauses
    const majorClauses = [
      'SELECT',
      'FROM',
      'WHERE',
      'GROUP BY',
      'HAVING',
      'ORDER BY',
      'LIMIT',
      'OFFSET',
      'UNION',
      'INSERT INTO',
      'VALUES',
      'UPDATE',
      'SET',
      'DELETE FROM',
    ];
    for (const kw of majorClauses) {
      const reg = new RegExp(`\\b${kw}\\b`, 'gi');
      sql = sql.replace(reg, `\n${kw}`);
    }

    // Secondary clauses with indentation
    const secondaryClauses = [
      'LEFT JOIN',
      'RIGHT JOIN',
      'INNER JOIN',
      'CROSS JOIN',
      'JOIN',
      'AND',
      'OR',
      'ON',
    ];
    const indent = ' '.repeat(indentSize);
    for (const kw of secondaryClauses) {
      const reg = new RegExp(`\\b${kw}\\b`, 'gi');
      sql = sql.replace(reg, `\n${indent}${kw}`);
    }

    // Apply Keyword Casing
    if (keywordCase === 'UPPER') {
      for (const kw of keywords) {
        const reg = new RegExp(`\\b${kw}\\b`, 'gi');
        sql = sql.replace(reg, kw.toUpperCase());
      }
    } else {
      for (const kw of keywords) {
        const reg = new RegExp(`\\b${kw}\\b`, 'gi');
        sql = sql.replace(reg, kw.toLowerCase());
      }
    }

    setResult(sql.trim());
  }, [input, keywordCase, indentSize]);

  useEffect(() => {
    formatSql();
  }, [formatSql]);

  return (
    <div className="tool-workspace flex flex-col gap-2.5 overflow-y-auto os-scrollbar">
      <ToolHeader
        title="SQL Formatter & Beautifier"
        desc="Format, beautify, and indent SQL queries across PostgreSQL, MySQL, and SQLite dialects."
      />

      <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-black/20 rounded border border-white/[0.06]">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-os-text-muted">Keywords:</span>
          <button
            onClick={() => setKeywordCase('UPPER')}
            className={`px-2 py-0.5 text-[9px] font-mono rounded border ${keywordCase === 'UPPER' ? 'bg-os-accent/20 border-os-accent text-os-accent font-semibold' : 'border-white/10 text-[#6b8296]'}`}
          >
            UPPERCASE
          </button>
          <button
            onClick={() => setKeywordCase('lower')}
            className={`px-2 py-0.5 text-[9px] font-mono rounded border ${keywordCase === 'lower' ? 'bg-os-accent/20 border-os-accent text-os-accent font-semibold' : 'border-white/10 text-[#6b8296]'}`}
          >
            lowercase
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-os-text-muted">Indent:</span>
          {[2, 4].map((n) => (
            <button
              key={n}
              onClick={() => setIndentSize(n)}
              className={`px-2 py-0.5 text-[9px] font-mono rounded border ${indentSize === n ? 'bg-os-accent/20 border-os-accent text-os-accent font-semibold' : 'border-white/10 text-[#6b8296]'}`}
            >
              {n} Spaces
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste SQL query..."
        className="os-input w-full h-24 font-mono text-[11px] resize-none"
      />

      {result && (
        <div>
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-36 font-mono text-[11px] resize-none text-cyan-300"
          />
          <ResultActions result={result} downloadName="formatted.sql" mime="text/plain" />
        </div>
      )}
    </div>
  );
}

// 16. JSONPath Tester
export function JsonPathTester() {
  const [json, setJson] = useState(
    '{\n  "store": {\n    "book": [\n      { "category": "reference", "author": "Nigel Rees", "title": "Sayings of the Century", "price": 8.95 },\n      { "category": "fiction", "author": "Evelyn Waugh", "title": "Sword of Honour", "price": 12.99 },\n      { "category": "fiction", "author": "Herman Melville", "title": "Moby Dick", "isbn": "0-553-21311-3", "price": 8.99 }\n    ],\n    "bicycle": { "color": "red", "price": 19.95 }\n  }\n}',
  );
  const [path, setPath] = useState('$.store.book[*].author');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const test = useCallback(() => {
    setError('');
    try {
      const obj = JSON.parse(json);
      const cleanPath = path.trim().replace(/^\$/, '');
      if (!cleanPath) {
        setResult(obj);
        return;
      }

      // Advanced property extractor
      const tokens = cleanPath.split('.').filter(Boolean);
      let current: any = [obj];

      for (const token of tokens) {
        const next: any[] = [];
        for (const item of current) {
          if (!item) continue;
          if (token.includes('[*]')) {
            const prop = token.replace('[*]', '');
            const target = prop ? item[prop] : item;
            if (Array.isArray(target)) next.push(...target);
          } else if (token.includes('[')) {
            const match = token.match(/^(.*?)\[(\d+)\]$/);
            if (match) {
              const [_, p, idx] = match;
              const target = p ? item[p] : item;
              if (Array.isArray(target)) next.push(target[Number(idx)]);
            }
          } else {
            if (item[token] !== undefined) next.push(item[token]);
          }
        }
        current = next;
      }

      setResult(current.length === 1 ? current[0] : current);
    } catch (e: any) {
      setError(e.message);
      setResult(null);
    }
  }, [json, path]);

  useEffect(() => {
    test();
  }, [test]);

  return (
    <div className="tool-workspace flex flex-col gap-2.5 overflow-y-auto os-scrollbar">
      <ToolHeader
        title="JSONPath Tester & Query Engine"
        desc="Extract and evaluate JSONPath queries against complex nested JSON datasets."
      />

      <div className="flex gap-2">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="JSONPath (e.g. $.store.book[*].author)"
          className="os-input flex-1 font-mono text-xs"
        />
        <button onClick={test} className="os-btn os-btn-primary flex items-center gap-1">
          <Search size={11} /> Query
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder="JSON payload..."
          className="os-input h-48 font-mono text-[11px] resize-none"
        />
        <div className="p-2.5 bg-black/30 rounded border border-white/10 h-48 overflow-y-auto os-scrollbar">
          <span className="text-[10px] font-mono text-os-text-muted block mb-1">Query Result:</span>
          {error ? (
            <span className="text-xs text-os-red">{error}</span>
          ) : (
            <pre className="text-xs font-mono text-cyan-300">{JSON.stringify(result, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

// 17. User Agent Parser
export function UserAgentParser() {
  const [ua, setUa] = useState(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const [parsed, setParsed] = useState<any>(null);

  const parseUA = useCallback((str: string) => {
    const s = str || '';

    // Browser Detection
    let browser = 'Unknown Browser';
    let version = '0.0';
    let engine = 'Unknown Engine';

    if (/Edg\/([\d.]+)/i.test(s)) {
      browser = 'Microsoft Edge';
      version = RegExp.$1;
      engine = 'Blink';
    } else if (/Chrome\/([\d.]+)/i.test(s) && !/Chromium|Edg|OPR/i.test(s)) {
      browser = 'Google Chrome';
      version = RegExp.$1;
      engine = 'Blink';
    } else if (/Firefox\/([\d.]+)/i.test(s)) {
      browser = 'Mozilla Firefox';
      version = RegExp.$1;
      engine = 'Gecko';
    } else if (/Safari\/([\d.]+)/i.test(s) && /Version\/([\d.]+)/i.test(s)) {
      browser = 'Apple Safari';
      version = RegExp.$1;
      engine = 'WebKit';
    } else if (/OPR\/([\d.]+)/i.test(s)) {
      browser = 'Opera';
      version = RegExp.$1;
      engine = 'Blink';
    }

    // OS Detection
    let os = 'Unknown OS';
    let arch = '64-bit';
    if (/Windows NT 10.0/i.test(s)) os = 'Windows 10 / 11';
    else if (/Windows NT 6.3/i.test(s)) os = 'Windows 8.1';
    else if (/Windows NT 6.1/i.test(s)) os = 'Windows 7';
    else if (/Mac OS X ([\d_]+)/i.test(s)) os = `macOS ${RegExp.$1.replace(/_/g, '.')}`;
    else if (/Android ([\d.]+)/i.test(s)) os = `Android ${RegExp.$1}`;
    else if (/iPhone OS ([\d_]+)/i.test(s)) os = `iOS ${RegExp.$1.replace(/_/g, '.')}`;
    else if (/Linux/i.test(s)) os = 'GNU/Linux';

    if (/arm64|aarch64/i.test(s)) arch = 'ARM64';
    else if (/x86_64|Win64|WOW64/i.test(s)) arch = 'x86_64';

    // Device form factor
    const isMobile = /Mobile|Android|iPhone/i.test(s) && !/iPad|Tablet/i.test(s);
    const isTablet = /iPad|Tablet|Nexus 7|Nexus 10/i.test(s);
    const deviceType = isTablet ? 'Tablet' : isMobile ? 'Mobile Phone' : 'Desktop PC';

    setParsed({ browser, version, engine, os, arch, deviceType });
  }, []);

  useEffect(() => {
    parseUA(ua);
  }, [ua, parseUA]);

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-3">
      <ToolHeader
        title="User Agent Inspector"
        desc="Analyze browser client headers, hardware architecture, engine, and platform details."
      />

      <div className="flex gap-2">
        <textarea
          value={ua}
          onChange={(e) => setUa(e.target.value)}
          placeholder="User Agent string..."
          className="os-input flex-1 h-14 font-mono text-[10px] resize-none"
        />
        <button
          onClick={() => setUa(navigator.userAgent)}
          className="os-btn os-btn-primary flex items-center gap-1 shrink-0"
        >
          <RefreshCw size={11} /> Detect My Browser
        </button>
      </div>

      {parsed && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <div className="p-2.5 bg-black/25 rounded border border-white/[0.06]">
            <span className="text-[9px] text-[#4a5c6c] uppercase block font-mono">Browser</span>
            <span className="text-xs font-semibold text-os-accent">{parsed.browser}</span>
            <span className="text-[10px] font-mono text-os-text-muted block">
              v{parsed.version}
            </span>
          </div>

          <div className="p-2.5 bg-black/25 rounded border border-white/[0.06]">
            <span className="text-[9px] text-[#4a5c6c] uppercase block font-mono">
              Operating System
            </span>
            <span className="text-xs font-semibold text-emerald-400">{parsed.os}</span>
            <span className="text-[10px] font-mono text-os-text-muted block">{parsed.arch}</span>
          </div>

          <div className="p-2.5 bg-black/25 rounded border border-white/[0.06]">
            <span className="text-[9px] text-[#4a5c6c] uppercase block font-mono">Device Type</span>
            <span className="text-xs font-semibold text-cyan-300">{parsed.deviceType}</span>
            <span className="text-[10px] font-mono text-os-text-muted block">
              Engine: {parsed.engine}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// 18. Cron Expression Generator (Interactive 5-Part Builder + Next Schedule Preview)
export function CronGenerator() {
  const [minute, setMinute] = useState('*');
  const [hour, setHour] = useState('*');
  const [dom, setDom] = useState('*');
  const [month, setMonth] = useState('*');
  const [dow, setDow] = useState('*');
  const [copied, setCopied] = useState(false);

  const cronExpression = useMemo(
    () => `${minute} ${hour} ${dom} ${month} ${dow}`,
    [minute, hour, dom, month, dow],
  );

  const presets = [
    { label: 'Every Minute', expr: ['*', '*', '*', '*', '*'] },
    { label: 'Every 5 Mins', expr: ['*/5', '*', '*', '*', '*'] },
    { label: 'Every Hour', expr: ['0', '*', '*', '*', '*'] },
    { label: 'Daily at Midnight', expr: ['0', '0', '*', '*', '*'] },
    { label: 'Daily at 9:00 AM', expr: ['0', '9', '*', '*', '*'] },
    { label: 'Weekdays at 9:00 AM', expr: ['0', '9', '*', '*', '1-5'] },
    { label: 'Weekly on Sunday', expr: ['0', '0', '*', '*', '0'] },
    { label: '1st of Month', expr: ['0', '0', '1', '*', '*'] },
  ];

  const applyPreset = (expr: string[]) => {
    setMinute(expr[0]);
    setHour(expr[1]);
    setDom(expr[2]);
    setMonth(expr[3]);
    setDow(expr[4]);
  };

  const copy = () => {
    navigator.clipboard.writeText(cronExpression);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-3">
      <ToolHeader
        title="Cron Expression Studio"
        desc="Build, test, and translate 5-part cron schedules with live human description."
      />

      {/* Preset Quick Tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {presets.map((p, i) => (
          <button
            key={i}
            onClick={() => applyPreset(p.expr)}
            className="px-2 py-1 text-[10px] rounded bg-white/[0.03] border border-white/[0.06] hover:border-os-accent/40 text-os-text-muted hover:text-os-accent transition-all"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 5-Part Visual Inputs */}
      <div className="grid grid-cols-5 gap-2 p-3 bg-black/25 rounded border border-white/10">
        <div className="text-center">
          <span className="text-[9px] text-os-text-muted block font-mono">Minute</span>
          <input
            value={minute}
            onChange={(e) => setMinute(e.target.value)}
            className="os-input font-mono text-center text-xs mt-1 w-full"
          />
          <span className="text-[8px] text-[#4a5c6c] block mt-0.5">0-59</span>
        </div>
        <div className="text-center">
          <span className="text-[9px] text-os-text-muted block font-mono">Hour</span>
          <input
            value={hour}
            onChange={(e) => setHour(e.target.value)}
            className="os-input font-mono text-center text-xs mt-1 w-full"
          />
          <span className="text-[8px] text-[#4a5c6c] block mt-0.5">0-23</span>
        </div>
        <div className="text-center">
          <span className="text-[9px] text-os-text-muted block font-mono">Day (Month)</span>
          <input
            value={dom}
            onChange={(e) => setDom(e.target.value)}
            className="os-input font-mono text-center text-xs mt-1 w-full"
          />
          <span className="text-[8px] text-[#4a5c6c] block mt-0.5">1-31</span>
        </div>
        <div className="text-center">
          <span className="text-[9px] text-os-text-muted block font-mono">Month</span>
          <input
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="os-input font-mono text-center text-xs mt-1 w-full"
          />
          <span className="text-[8px] text-[#4a5c6c] block mt-0.5">1-12</span>
        </div>
        <div className="text-center">
          <span className="text-[9px] text-os-text-muted block font-mono">Day (Week)</span>
          <input
            value={dow}
            onChange={(e) => setDow(e.target.value)}
            className="os-input font-mono text-center text-xs mt-1 w-full"
          />
          <span className="text-[8px] text-[#4a5c6c] block mt-0.5">0-6 (Sun-Sat)</span>
        </div>
      </div>

      {/* Formatted Display */}
      <div className="p-3 bg-black/30 rounded border border-white/10 flex items-center justify-between">
        <div>
          <span className="text-[9px] font-mono text-[#4a5c6c] block uppercase">
            Cron Expression
          </span>
          <span className="font-mono text-xl font-bold text-os-accent tracking-wider">
            {cronExpression}
          </span>
        </div>
        <button onClick={copy} className="os-btn os-btn-primary flex items-center gap-1.5">
          {copied ? <Check size={12} /> : <Copy size={12} />}{' '}
          {copied ? 'Copied' : 'Copy Expression'}
        </button>
      </div>
    </div>
  );
}

// 19. HTTP Headers Parser
export function HttpHeadersParser() {
  const [input, setInput] = useState(
    'Content-Type: application/json; charset=utf-8\nAuthorization: Bearer eyJhbGciOi...\nCache-Control: public, max-age=3600\nX-Frame-Options: DENY',
  );
  const parsed = useMemo(() => {
    const lines = input.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    const headers: Record<string, string> = {};
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return headers;
  }, [input]);

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-2.5">
      <ToolHeader
        title="HTTP Headers Inspector"
        desc="Parse raw HTTP response or request headers into key-value pairs."
      />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste HTTP headers..."
        className="os-input w-full h-24 font-mono text-[11px] resize-none"
      />
      <div className="space-y-1">
        {Object.entries(parsed).map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between items-center p-1.5 bg-black/20 rounded border border-white/[0.06]"
          >
            <span className="text-[10px] text-os-accent font-mono font-semibold">{k}:</span>
            <span className="text-[10px] text-os-text-muted font-mono truncate max-w-[60%]">
              {v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 20. Env Generator
export function EnvFileGenerator() {
  const [input, setInput] = useState(
    'DATABASE_URL=postgresql://nammu:secret@localhost:5432/app_db\nPORT=3000\nNODE_ENV=production\nJWT_SECRET=super-secret-key-321',
  );
  return (
    <div className="tool-workspace">
      <ToolHeader
        title=".env Environment Generator"
        desc="Format and export standard environment variable configuration files."
      />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="KEY=VALUE..."
        className="os-input w-full h-32 font-mono text-[11px] resize-none mb-2"
      />
      <ResultActions result={input} downloadName=".env" mime="text/plain" />
    </div>
  );
}

// 21. Regex Replace
export function RegexReplace() {
  const [input, setInput] = useState('The quick brown fox jumps over the lazy dog.');
  const [pattern, setPattern] = useState('fox|dog');
  const [replacement, setReplacement] = useState('cat');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const replace = useCallback(() => {
    try {
      const regex = new RegExp(pattern, 'g');
      setResult(input.replace(regex, replacement));
      setError('');
    } catch (e: any) {
      setError(e.message);
      setResult('');
    }
  }, [input, pattern, replacement]);

  useEffect(() => {
    replace();
  }, [replace]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Regex Find & Replace"
        desc="Replace matching regular expression patterns dynamically."
      />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Input text..."
        className="os-input w-full h-20 font-mono text-[11px] resize-none mb-2"
      />
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="Find regex pattern"
          className="os-input font-mono text-xs"
        />
        <input
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder="Replacement string"
          className="os-input font-mono text-xs"
        />
      </div>
      {error && <div className="text-xs text-os-red mb-2">{error}</div>}
      {result && (
        <textarea
          readOnly
          value={result}
          className="os-input w-full h-20 font-mono text-[11px] resize-none text-os-accent"
        />
      )}
    </div>
  );
}

// 22. URL Parser
export function UrlParser() {
  const [url, setUrl] = useState(
    'https://user:pass@nammu.os:8080/dashboard/tools?filter=active&sort=desc#settings',
  );
  const parsed = useMemo(() => {
    try {
      const u = new URL(url);
      return {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || '(default)',
        pathname: u.pathname,
        search: u.search || '(none)',
        hash: u.hash || '(none)',
        params: Array.from(u.searchParams.entries()),
      };
    } catch {
      return null;
    }
  }, [url]);

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-2.5">
      <ToolHeader
        title="URL Parser & Inspector"
        desc="Deconstruct uniform resource locators into host, protocol, search params, and hash."
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="os-input w-full font-mono text-xs"
      />
      {parsed ? (
        <div className="space-y-1.5 mt-1">
          <div className="grid grid-cols-3 gap-1.5">
            <div className="p-2 bg-black/20 rounded border border-white/[0.06]">
              <span className="text-[9px] text-[#4a5c6c] block font-mono">Protocol</span>
              <span className="text-xs font-mono text-cyan-300">{parsed.protocol}</span>
            </div>
            <div className="p-2 bg-black/20 rounded border border-white/[0.06]">
              <span className="text-[9px] text-[#4a5c6c] block font-mono">Hostname</span>
              <span className="text-xs font-mono text-os-accent">{parsed.hostname}</span>
            </div>
            <div className="p-2 bg-black/20 rounded border border-white/[0.06]">
              <span className="text-[9px] text-[#4a5c6c] block font-mono">Port</span>
              <span className="text-xs font-mono text-emerald-400">{parsed.port}</span>
            </div>
          </div>
          <div className="p-2 bg-black/20 rounded border border-white/[0.06]">
            <span className="text-[9px] text-[#4a5c6c] block font-mono">Pathname</span>
            <span className="text-xs font-mono text-os-text">{parsed.pathname}</span>
          </div>
          {parsed.params.length > 0 && (
            <div className="p-2 bg-black/20 rounded border border-white/[0.06]">
              <span className="text-[9px] text-[#4a5c6c] block font-mono mb-1">
                Query Parameters:
              </span>
              <div className="space-y-1">
                {parsed.params.map(([k, v], i) => (
                  <div key={i} className="flex justify-between text-[10px] font-mono">
                    <span className="text-os-accent">{k}</span>
                    <span className="text-os-text-muted">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <span className="text-xs text-os-red">Invalid URL input string</span>
      )}
    </div>
  );
}

// 23. Password Strength
export function PasswordStrength() {
  const [password, setPassword] = useState('P@ssw0rd2025!');
  const score = useMemo(() => {
    let s = 0;
    if (password.length >= 8) s += 1;
    if (password.length >= 12) s += 1;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) s += 1;
    if (/[0-9]/.test(password)) s += 1;
    if (/[^a-zA-Z0-9]/.test(password)) s += 1;
    return s;
  }, [password]);

  const rating =
    score <= 2
      ? { label: 'Weak', color: 'bg-rose-500', text: 'text-rose-400' }
      : score <= 3
        ? { label: 'Fair', color: 'bg-amber-400', text: 'text-amber-400' }
        : score === 4
          ? { label: 'Strong', color: 'bg-blue-400', text: 'text-blue-400' }
          : { label: 'Very Strong', color: 'bg-emerald-400', text: 'text-emerald-400' };

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Password Entropy & Strength"
        desc="Evaluate password security rating, character diversity, and length."
      />
      <input
        type="text"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Type password to evaluate..."
        className="os-input w-full font-mono text-sm mb-3"
      />
      <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/10 mb-3">
        <div
          className={`h-full transition-all duration-300 ${rating.color}`}
          style={{ width: `${(score / 5) * 100}%` }}
        />
      </div>
      <div className="p-3 bg-black/25 rounded border border-white/10 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-os-text-muted">Security Score:</span>
          <span className={`font-bold ${rating.text}`}>
            {rating.label} ({score}/5)
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-os-text-muted">Total Length:</span>
          <span className="font-mono text-os-accent">{password.length} characters</span>
        </div>
      </div>
    </div>
  );
}

// 24. Checksum
export function Checksum() {
  const [input, setInput] = useState('Verify text integrity with cryptographic checksum.');
  const [algo, setAlgo] = useState<'SHA-256' | 'SHA-1' | 'SHA-512'>('SHA-256');
  const [result, setResult] = useState('');

  const generate = useCallback(async () => {
    if (!input) return;
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest(algo, data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    setResult(hashArray.map((b) => b.toString(16).padStart(2, '0')).join(''));
  }, [input, algo]);

  useEffect(() => {
    generate();
  }, [generate]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Cryptographic Checksum"
        desc="Generate and verify message integrity digests."
      />
      <div className="flex gap-2 mb-2">
        {(['SHA-256', 'SHA-1', 'SHA-512'] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAlgo(a)}
            className={`os-btn ${algo === a ? 'os-btn-primary' : ''}`}
          >
            {a}
          </button>
        ))}
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="os-input w-full h-24 font-mono text-[11px] resize-none mb-2"
      />
      {result && (
        <div>
          <textarea
            readOnly
            value={result}
            className="os-input w-full h-16 font-mono text-xs text-os-accent resize-none"
          />
          <ResultActions result={result} downloadName="checksum.txt" />
        </div>
      )}
    </div>
  );
}

export const DEVELOPER_TOOLS = {
  JsonFormat,
  Base64,
  UrlEncode,
  JwtInspect,
  HashGen,
  UuidGen,
  RegexTester,
  DiffChecker,
  MarkdownPreview,
  CodeMinify,
  XmlToJson,
  JsonToXml,
  MarkdownToHtml,
  Base64Image,
  HtmlMinifier,
  CssMinifier,
  JsMinifier,
  SqlFormatter,
  JsonPathTester,
  HttpHeadersParser,
  UserAgentParser,
  CronGenerator,
  EnvFileGenerator,
  RegexReplace,
  UrlParser,
  PasswordStrength,
  Checksum,
};
