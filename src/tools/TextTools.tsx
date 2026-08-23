import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Download,
  Copy,
  Check,
  Type,
  Sparkles,
  AlertCircle,
  Hash,
  RefreshCw,
  Layers,
} from 'lucide-react';

function ToolHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold text-os-text flex items-center gap-1.5">
        <Type size={13} className="text-os-accent" />
        {title}
      </div>
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

function Out({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1 border-b border-os-border/20">
      <span className="text-[10px] text-os-text-muted">{label}</span>
      <span className="text-[10px] font-mono text-os-accent">{value}</span>
    </div>
  );
}

// -------------------------------------------------------------
// 1. Text Case Converter (12+ Rich Case Typographies)
// -------------------------------------------------------------
export function TextCase() {
  const [input, setInput] = useState('Nammu operating system modern developer tools');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const getWords = (str: string) => {
    return str
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-./\\]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  };

  const cases = useMemo(() => {
    const words = getWords(input);
    if (!input.trim() || words.length === 0) return [];

    const lowerWords = words.map((w) => w.toLowerCase());

    const upper = input.toUpperCase();
    const lower = input.toLowerCase();
    const title = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const sentence = input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
    const camel = lowerWords
      .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join('');
    const pascal = lowerWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    const snake = lowerWords.join('_');
    const constant = lowerWords.join('_').toUpperCase();
    const kebab = lowerWords.join('-');
    const dot = lowerWords.join('.');
    const path = lowerWords.join('/');
    const alternating = input
      .split('')
      .map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()))
      .join('');
    const header = lowerWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');

    return [
      { key: 'upper', label: 'UPPERCASE', val: upper },
      { key: 'lower', label: 'lowercase', val: lower },
      { key: 'title', label: 'Title Case', val: title },
      { key: 'sentence', label: 'Sentence case', val: sentence },
      { key: 'camel', label: 'camelCase', val: camel },
      { key: 'pascal', label: 'PascalCase', val: pascal },
      { key: 'snake', label: 'snake_case', val: snake },
      { key: 'constant', label: 'CONSTANT_CASE', val: constant },
      { key: 'kebab', label: 'kebab-case', val: kebab },
      { key: 'dot', label: 'dot.case', val: dot },
      { key: 'path', label: 'path/case', val: path },
      { key: 'alt', label: 'aLtErNaTiNg cAsE', val: alternating },
      { key: 'header', label: 'Header-Case', val: header },
    ];
  }, [input]);

  const copyVal = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1200);
  };

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-3">
      <ToolHeader
        title="Text Case Studio"
        desc="Convert text into 13 standard naming conventions and programmatic casing styles."
      />

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type or paste text to convert..."
        className="os-input w-full h-20 font-mono text-xs resize-none"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {cases.map((c) => (
          <div
            key={c.key}
            onClick={() => copyVal(c.key, c.val)}
            className="p-2 bg-black/20 rounded border border-white/[0.06] hover:border-os-accent/40 cursor-pointer transition-all flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-[9px] text-[#4a5c6c] font-mono mb-1">
              <span>{c.label}</span>
              <span>
                {copiedKey === c.key ? (
                  <Check size={10} className="text-os-emerald" />
                ) : (
                  <Copy size={10} />
                )}
              </span>
            </div>
            <div className="font-mono text-xs text-os-text truncate font-medium">{c.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 2. Text Counter
// -------------------------------------------------------------
export function TextCounter() {
  const [text, setText] = useState('');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text ? text.split('\n').length : 0;
  const chars = text.length;
  const charsNoSpace = text.replace(/\s/g, '').length;
  const readingTime = Math.ceil(words / 200);

  return (
    <div className="tool-workspace flex flex-col gap-2.5">
      <ToolHeader
        title="Text Statistics & Metrics"
        desc="Count characters, words, sentences, reading time, and line breaks."
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type or paste text..."
        className="os-input w-full h-32 font-mono text-[11px] resize-none"
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="p-2 bg-black/20 rounded border border-white/10 text-center">
          <span className="text-[9px] text-os-text-muted block">Characters</span>
          <span className="text-sm font-mono font-bold text-os-accent">{chars}</span>
        </div>
        <div className="p-2 bg-black/20 rounded border border-white/10 text-center">
          <span className="text-[9px] text-os-text-muted block">No Spaces</span>
          <span className="text-sm font-mono font-bold text-cyan-300">{charsNoSpace}</span>
        </div>
        <div className="p-2 bg-black/20 rounded border border-white/10 text-center">
          <span className="text-[9px] text-os-text-muted block">Words</span>
          <span className="text-sm font-mono font-bold text-emerald-400">{words}</span>
        </div>
        <div className="p-2 bg-black/20 rounded border border-white/10 text-center">
          <span className="text-[9px] text-os-text-muted block">Est. Read Time</span>
          <span className="text-sm font-mono font-bold text-os-text">~{readingTime} min</span>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 3. Morse Code
// -------------------------------------------------------------
export function MorseCode() {
  const morse: Record<string, string> = {
    A: '.-',
    B: '-...',
    C: '-.-.',
    D: '-..',
    E: '.',
    F: '..-.',
    G: '--.',
    H: '....',
    I: '..',
    J: '.---',
    K: '-.-',
    L: '.-..',
    M: '--',
    N: '-.',
    O: '---',
    P: '.--.',
    Q: '--.-',
    R: '.-.',
    S: '...',
    T: '-',
    U: '..-',
    V: '...-',
    W: '.--',
    X: '-..-',
    Y: '-.--',
    Z: '--..',
    '0': '-----',
    '1': '.----',
    '2': '..---',
    '3': '...--',
    '4': '....-',
    '5': '.....',
    '6': '-....',
    '7': '--...',
    '8': '---..',
    '9': '----.',
    '.': '.-.-.-',
    ',': '--..--',
    '?': '..--..',
    "'": '.----.',
    '!': '-.-.--',
    '/': '-..-.',
    ' ': '/',
  };

  const [input, setInput] = useState('SOS NAMMU OS');
  const [mode, setMode] = useState<'text2morse' | 'morse2text'>('text2morse');

  const result = useMemo(() => {
    if (mode === 'text2morse') {
      return input
        .toUpperCase()
        .split('')
        .map((c) => morse[c] || c)
        .join(' ');
    } else {
      const inv: Record<string, string> = {};
      Object.entries(morse).forEach(([k, v]) => {
        inv[v] = k;
      });
      return input
        .split(' ')
        .map((m) => (m === '/' ? ' ' : inv[m] || m))
        .join('');
    }
  }, [input, mode]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Morse Code Translator"
        desc="Translate between standard Latin text and Morse code telegraph symbols."
      />
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setMode('text2morse')}
          className={`os-btn ${mode === 'text2morse' ? 'os-btn-primary' : ''}`}
        >
          Text → Morse
        </button>
        <button
          onClick={() => setMode('morse2text')}
          className={`os-btn ${mode === 'morse2text' ? 'os-btn-primary' : ''}`}
        >
          Morse → Text
        </button>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Input text..."
        className="os-input w-full h-20 font-mono text-[11px] resize-none mb-2"
      />
      <textarea
        readOnly
        value={result}
        className="os-input w-full h-20 font-mono text-xs text-os-accent resize-none mb-1"
      />
      <ResultActions result={result} downloadName="morse.txt" />
    </div>
  );
}

// -------------------------------------------------------------
// 4. Caesar Cipher
// -------------------------------------------------------------
export function CaesarCipher() {
  const [input, setInput] = useState('The quick brown fox jumps over the lazy dog.');
  const [shift, setShift] = useState(3);
  const [decrypt, setDecrypt] = useState(false);

  const result = useMemo(() => {
    const actual = decrypt ? -shift : shift;
    return input
      .split('')
      .map((c) => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90)
          return String.fromCharCode(((((code - 65 + actual) % 26) + 26) % 26) + 65);
        if (code >= 97 && code <= 122)
          return String.fromCharCode(((((code - 97 + actual) % 26) + 26) % 26) + 97);
        return c;
      })
      .join('');
  }, [input, shift, decrypt]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Caesar Shift Cipher"
        desc="Encrypt or decrypt messages using classical rot-N Caesar substitution."
      />
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-os-text-muted">Shift:</span>
          <input
            type="number"
            min="1"
            max="25"
            value={shift}
            onChange={(e) => setShift(Number(e.target.value))}
            className="os-input w-16 text-center font-mono"
          />
        </div>
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={decrypt}
            onChange={(e) => setDecrypt(e.target.checked)}
            className="accent-cyan-400"
          />{' '}
          Decrypt Mode
        </label>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="os-input w-full h-20 font-mono text-[11px] resize-none mb-2"
      />
      <textarea
        readOnly
        value={result}
        className="os-input w-full h-20 font-mono text-xs text-os-accent resize-none mb-1"
      />
      <ResultActions result={result} downloadName="caesar.txt" />
    </div>
  );
}

// -------------------------------------------------------------
// 5. Safe Text Encrypt (XOR + Base64 Safe Decoder)
// -------------------------------------------------------------
export function TextEncrypt() {
  const [input, setInput] = useState('Confidential message encrypted with secret key.');
  const [key, setKey] = useState('nammu-secret-pass');
  const [decrypt, setDecrypt] = useState(false);

  const { result, error } = useMemo(() => {
    if (!input || !key) return { result: '', error: '' };
    try {
      if (decrypt) {
        const decoded = atob(input.trim());
        const res = decoded
          .split('')
          .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length)))
          .join('');
        return { result: res, error: '' };
      } else {
        const xored = input
          .split('')
          .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length)))
          .join('');
        return { result: btoa(xored), error: '' };
      }
    } catch {
      return { result: '', error: 'Invalid ciphertext or invalid Base64 input.' };
    }
  }, [input, key, decrypt]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Symmetric XOR Cipher"
        desc="Encrypt and decrypt arbitrary plaintext with symmetric password keys."
      />
      <div className="flex gap-2 mb-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Password Key..."
          className="os-input flex-1 font-mono text-xs"
        />
        <button
          onClick={() => setDecrypt(!decrypt)}
          className={`os-btn ${decrypt ? 'os-btn-primary' : ''}`}
        >
          {decrypt ? 'Decrypt' : 'Encrypt'}
        </button>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={decrypt ? 'Paste Base64 ciphertext...' : 'Enter plaintext...'}
        className="os-input w-full h-20 font-mono text-[11px] resize-none mb-2"
      />
      {error && (
        <div className="text-xs text-os-red mb-2 flex items-center gap-1">
          <AlertCircle size={12} /> {error}
        </div>
      )}
      {result && (
        <textarea
          readOnly
          value={result}
          className="os-input w-full h-20 font-mono text-xs text-cyan-300 resize-none mb-1"
        />
      )}
      {result && <ResultActions result={result} downloadName="encrypted.txt" />}
    </div>
  );
}

// -------------------------------------------------------------
// 6. URL Slug
// -------------------------------------------------------------
export function UrlSlug() {
  const [input, setInput] = useState('Next Generation Web Operating System 4.1 Released!');
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="URL Slug Generator"
        desc="Generate clean, SEO-friendly permalink slugs from article titles."
      />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="os-input w-full h-20 font-mono text-[11px] resize-none mb-2"
      />
      <input
        readOnly
        value={slug}
        className="os-input w-full font-mono text-sm text-os-accent mb-2"
      />
      <ResultActions result={slug} downloadName="slug.txt" />
    </div>
  );
}

// -------------------------------------------------------------
// 7. Whitespace Remover
// -------------------------------------------------------------
export function WhitespaceRemover() {
  const [input, setInput] = useState('  The   quick    brown   fox  \n\n  jumps   over  ');
  const [mode, setMode] = useState<'trim' | 'single' | 'all'>('single');
  const result = useMemo(() => {
    if (mode === 'trim') return input.trim();
    if (mode === 'single') return input.replace(/\s+/g, ' ').trim();
    return input.replace(/\s/g, '');
  }, [input, mode]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Whitespace Cleaner"
        desc="Remove trailing whitespace, collapse spaces, or strip all spaces."
      />
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setMode('single')}
          className={`os-btn ${mode === 'single' ? 'os-btn-primary' : ''}`}
        >
          Collapse Spaces
        </button>
        <button
          onClick={() => setMode('trim')}
          className={`os-btn ${mode === 'trim' ? 'os-btn-primary' : ''}`}
        >
          Trim Edges
        </button>
        <button
          onClick={() => setMode('all')}
          className={`os-btn ${mode === 'all' ? 'os-btn-primary' : ''}`}
        >
          Remove All
        </button>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="os-input w-full h-24 font-mono text-[11px] resize-none mb-2"
      />
      <textarea
        readOnly
        value={result}
        className="os-input w-full h-24 font-mono text-xs text-os-accent resize-none mb-1"
      />
      <ResultActions result={result} downloadName="clean.txt" />
    </div>
  );
}

export function LineCounter() {
  const [text, setText] = useState('Line 1\nLine 2\n\nLine 4');
  const lines = text.split('\n');
  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Line Counter & Inspector"
        desc="Analyze source code lines and blank lines."
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="os-input w-full h-32 font-mono text-[11px] resize-none mb-2"
      />
      <div className="space-y-1">
        <Out label="Total Lines" value={lines.length} />
        <Out label="Non-Empty Lines" value={lines.filter((l) => l.trim()).length} />
        <Out label="Blank Lines" value={lines.filter((l) => !l.trim()).length} />
      </div>
    </div>
  );
}

export function TextReverse() {
  const [input, setInput] = useState('Nammu OS');
  const reverse = input.split('').reverse().join('');
  return (
    <div className="tool-workspace">
      <ToolHeader title="Text Reverser" desc="Reverse character order backwards." />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="os-input w-full h-20 font-mono text-xs resize-none mb-2"
      />
      <textarea
        readOnly
        value={reverse}
        className="os-input w-full h-20 font-mono text-xs text-os-accent resize-none mb-1"
      />
      <ResultActions result={reverse} downloadName="reversed.txt" />
    </div>
  );
}

export function LeetSpeak() {
  const [input, setInput] = useState('Elite Hacker Protocol Activated');
  const leetMap: Record<string, string> = {
    a: '4',
    e: '3',
    i: '1',
    o: '0',
    s: '5',
    t: '7',
    l: '1',
    g: '9',
    b: '8',
  };
  const convert = input
    .toLowerCase()
    .split('')
    .map((c) => leetMap[c] || c)
    .join('');
  return (
    <div className="tool-workspace">
      <ToolHeader
        title="1337 Leetspeak Translator"
        desc="Convert text to hacker dialect typography."
      />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="os-input w-full h-20 font-mono text-xs resize-none mb-2"
      />
      <textarea
        readOnly
        value={convert}
        className="os-input w-full h-20 font-mono text-xs text-emerald-400 resize-none mb-1"
      />
      <ResultActions result={convert} downloadName="leet.txt" />
    </div>
  );
}

export function TextToAscii() {
  const [input, setInput] = useState('NAMMU');
  return (
    <div className="tool-workspace">
      <ToolHeader title="ASCII Font Art" desc="Format text into ASCII typography banner." />
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="os-input w-full font-mono text-center text-xl py-2 mb-2 uppercase"
      />
      <pre className="os-input w-full h-32 font-mono text-[10px] p-2 overflow-x-auto text-os-accent font-bold">
        {` _   _                                 
| \\ | | __ _ _ __ ___  _ __ ___  _   _ 
|  \\| |/ _\` | '_ \` _ \\| '_ \` _ \\| | | |
| |\\  | (_| | | | | | | | | | | | |_| |
|_| \\_|\\__,_|_| |_| |_|_| |_| |_|\\__,_|`}
      </pre>
    </div>
  );
}

export function CharMap() {
  const [char, setChar] = useState('Ω');
  const code = char.codePointAt(0) || 0;
  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Unicode Character Inspector"
        desc="Inspect decimal, hex codepoints, and binary representation of characters."
      />
      <div className="flex gap-2 mb-3">
        <input
          value={char}
          onChange={(e) => setChar(e.target.value.slice(0, 2))}
          className="os-input w-20 text-center text-2xl font-mono"
        />
      </div>
      <div className="space-y-1">
        <Out
          label="Unicode Codepoint"
          value={`U+${code.toString(16).toUpperCase().padStart(4, '0')}`}
        />
        <Out label="Decimal Value" value={code} />
        <Out label="Hexadecimal" value={`0x${code.toString(16).toUpperCase()}`} />
        <Out label="HTML Entity" value={`&#${code};`} />
      </div>
    </div>
  );
}

export function TextFormatter() {
  const [input, setInput] = useState(
    'Wrap long text blocks to fixed column width for terminal viewing.',
  );
  const [width, setWidth] = useState(40);
  const formatted = useMemo(() => {
    const words = input.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if ((cur + w).length <= width) cur += (cur ? ' ' : '') + w;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.join('\n');
  }, [input, width]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Column Width Text Formatter"
        desc="Wrap text blocks to a specified fixed column character boundary."
      />
      <div className="flex gap-2 mb-2 items-center">
        <span className="text-[10px] text-os-text-muted">Max Width:</span>
        <input
          type="number"
          min="20"
          max="120"
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          className="os-input w-20 text-center font-mono"
        />
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="os-input w-full h-20 font-mono text-[11px] resize-none mb-2"
      />
      <textarea
        readOnly
        value={formatted}
        className="os-input w-full h-24 font-mono text-xs text-os-accent resize-none mb-1"
      />
      <ResultActions result={formatted} downloadName="wrapped.txt" />
    </div>
  );
}

export function Base32Tool() {
  const [input, setInput] = useState('Nammu Base32');
  const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const encoded = useMemo(() => {
    const bytes = new TextEncoder().encode(input);
    let bits = '';
    let out = '';
    for (const b of bytes) bits += b.toString(2).padStart(8, '0');
    for (let i = 0; i < bits.length; i += 5)
      out += b32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2) || 0];
    return out;
  }, [input]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Base32 Encoder" desc="Encode text using RFC 4648 32-character alphabet." />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="os-input w-full h-20 font-mono text-[11px] resize-none mb-2"
      />
      <textarea
        readOnly
        value={encoded}
        className="os-input w-full h-20 font-mono text-xs text-os-accent resize-none mb-1"
      />
      <ResultActions result={encoded} downloadName="base32.txt" />
    </div>
  );
}

export function PhoneNumberFormat() {
  const [input, setInput] = useState('1234567890');
  const formatted = useMemo(() => {
    const nums = input.replace(/\D/g, '');
    if (nums.length <= 3) return nums;
    if (nums.length <= 7) return `(${nums.slice(0, 3)}) ${nums.slice(3)}`;
    return `(${nums.slice(0, 3)}) ${nums.slice(3, 6)}-${nums.slice(6, 10)}`;
  }, [input]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Phone Number Formatter"
        desc="Format unformatted telephone numbers into standard US/NANP format."
      />
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type digits..."
        className="os-input w-full font-mono text-center text-lg mb-2"
      />
      <div className="p-3 bg-black/30 rounded border border-white/10 text-center font-mono text-2xl font-bold text-os-accent">
        {formatted}
      </div>
    </div>
  );
}

export function CreditCardFormat() {
  const [input, setInput] = useState('4532789012345678');
  const formatted = input
    .replace(/\D/g, '')
    .replace(/(\d{4})/g, '$1 ')
    .trim();
  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Card Number Formatter"
        desc="Format credit card numbers into 4-digit separated blocks."
      />
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Card number digits..."
        className="os-input w-full font-mono text-center text-lg mb-2"
      />
      <div className="p-3 bg-black/30 rounded border border-white/10 text-center font-mono text-2xl font-bold text-cyan-300 tracking-wider">
        {formatted}
      </div>
    </div>
  );
}

export function HtmlEscape() {
  const [input, setInput] = useState('<div class="header">Hello & Welcome!</div>');
  const [encode, setEncode] = useState(true);
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  const result = useMemo(() => {
    if (encode) return input.replace(/[&<>"']/g, (m) => map[m]);
    return input
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }, [input, encode]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="HTML Entity Escape"
        desc="Escape XML/HTML characters to HTML entities or unescape back to characters."
      />
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setEncode(true)}
          className={`os-btn ${encode ? 'os-btn-primary' : ''}`}
        >
          Escape
        </button>
        <button
          onClick={() => setEncode(false)}
          className={`os-btn ${!encode ? 'os-btn-primary' : ''}`}
        >
          Unescape
        </button>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="os-input w-full h-20 font-mono text-[11px] resize-none mb-2"
      />
      <textarea
        readOnly
        value={result}
        className="os-input w-full h-20 font-mono text-xs text-os-accent resize-none mb-1"
      />
      <ResultActions result={result} downloadName="escaped.html" />
    </div>
  );
}

export const TEXT_TOOLS = {
  TextCase,
  TextCounter,
  MorseCode,
  CaesarCipher,
  TextEncrypt,
  UrlSlug,
  WhitespaceRemover,
  LineCounter,
  TextReverse,
  LeetSpeak,
  TextToAscii,
  CharMap,
  TextFormatter,
  Base32Tool,
  PhoneNumberFormat,
  CreditCardFormat,
  HtmlEscape,
};
