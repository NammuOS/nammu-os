import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Download,
  Copy,
  Check,
  Pipette,
  Sparkles,
  Sliders,
  Eye,
  RefreshCw,
  Palette,
  Layers,
  ArrowRightLeft,
  Layers2,
} from 'lucide-react';

function ToolHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold text-os-text flex items-center gap-1.5">
        <Palette size={13} className="text-os-accent" />
        {title}
      </div>
      <div className="text-[10px] text-os-text-muted">{desc}</div>
    </div>
  );
}

function ResultActions({ result, downloadName }: { result: string; downloadName?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(result)}`;
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

function Out({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: React.ReactNode;
  onCopy?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    if (onCopy) {
      onCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };
  return (
    <div
      onClick={onCopy ? handle : undefined}
      className={`flex justify-between items-center py-1 px-1.5 rounded transition-colors ${
        onCopy ? 'cursor-pointer hover:bg-white/[0.04]' : ''
      } border-b border-os-border/15`}
    >
      <span className="text-[10px] text-os-text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono text-os-accent">{value}</span>
        {onCopy && (
          <span className="text-[9px] text-[#4a5c6c]">
            {copied ? <Check size={10} className="text-os-emerald" /> : <Copy size={10} />}
          </span>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Color Math Helpers
// -------------------------------------------------------------
function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  const n =
    parseInt(
      clean.length === 3
        ? clean
            .split('')
            .map((c) => c + c)
            .join('')
        : clean,
      16,
    ) || 0;
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex(r: number, g: number, b: number) {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
  if (d !== 0) {
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (h < 60) {
    r1 = c;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
  } else if (h < 180) {
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function hslToHex(h: number, s: number, l: number) {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (max !== min) {
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), v: Math.round(v * 100) };
}

function rgbToCmyk(r: number, g: number, b: number) {
  const r1 = r / 255;
  const g1 = g / 255;
  const b1 = b / 255;
  const k = 1 - Math.max(r1, g1, b1);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = Math.round(((1 - r1 - k) / (1 - k)) * 100);
  const m = Math.round(((1 - g1 - k) / (1 - k)) * 100);
  const y = Math.round(((1 - b1 - k) / (1 - k)) * 100);
  return { c, m, y, k: Math.round(k * 100) };
}

function getLuminance(r: number, g: number, b: number) {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

// -------------------------------------------------------------
// 1. Color Picker (Full EyeDropper + Harmonies + Formats)
// -------------------------------------------------------------
export function ColorPicker() {
  const [hex, setHex] = useState('#4aa3ff');
  const [alpha, setAlpha] = useState(100);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([
    '#4aa3ff',
    '#2ee6a6',
    '#f59e0b',
    '#ec4899',
    '#8b5cf6',
  ]);

  const { r, g, b } = useMemo(() => hexToRgb(hex), [hex]);
  const hsl = useMemo(() => rgbToHsl(r, g, b), [r, g, b]);
  const hsv = useMemo(() => rgbToHsv(r, g, b), [r, g, b]);
  const cmyk = useMemo(() => rgbToCmyk(r, g, b), [r, g, b]);

  const hexAlpha = useMemo(() => {
    const aHex = Math.round((alpha / 100) * 255)
      .toString(16)
      .padStart(2, '0');
    return alpha === 100 ? hex : `${hex}${aHex}`;
  }, [hex, alpha]);

  const harmonies = useMemo(() => {
    const h = hsl.h;
    const s = hsl.s;
    const l = hsl.l;
    return {
      complementary: [hex, hslToHex((h + 180) % 360, s, l)],
      analogous: [hslToHex((h + 330) % 360, s, l), hex, hslToHex((h + 30) % 360, s, l)],
      triadic: [hex, hslToHex((h + 120) % 360, s, l), hslToHex((h + 240) % 360, s, l)],
      tetradic: [
        hex,
        hslToHex((h + 90) % 360, s, l),
        hslToHex((h + 180) % 360, s, l),
        hslToHex((h + 270) % 360, s, l),
      ],
      monochromatic: [
        hslToHex(h, s, Math.max(10, l - 30)),
        hslToHex(h, s, Math.max(10, l - 15)),
        hex,
        hslToHex(h, s, Math.min(95, l + 15)),
        hslToHex(h, s, Math.min(95, l + 30)),
      ],
    };
  }, [hex, hsl]);

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1200);
  };

  const handlePickEyeDropper = async () => {
    if ('EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const res = await eyeDropper.open();
        if (res && res.sRGBHex) {
          setHex(res.sRGBHex);
          setHistory((prev) => [res.sRGBHex, ...prev.filter((c) => c !== res.sRGBHex)].slice(0, 8));
        }
      } catch {
        // User canceled eyedropper
      }
    }
  };

  const updateColor = (newHex: string) => {
    setHex(newHex);
    setHistory((prev) => [newHex, ...prev.filter((c) => c !== newHex)].slice(0, 8));
  };

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar">
      <ToolHeader
        title="Color Picker Studio"
        desc="Interactive color picker with eyedropper, live harmonies, and multiple formats."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        {/* Left: Visual Picker */}
        <div className="flex flex-col gap-2.5 p-3 bg-black/20 rounded border border-white/[0.06]">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={hex}
              onChange={(e) => updateColor(e.target.value)}
              className="w-10 h-10 rounded border border-white/20 cursor-pointer bg-transparent"
            />
            <div className="flex-1">
              <input
                value={hex}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.startsWith('#') && val.length <= 7) setHex(val);
                }}
                className="os-input font-mono text-sm font-semibold uppercase text-center w-full"
                placeholder="#RRGGBB"
              />
            </div>
            {'EyeDropper' in window && (
              <button
                onClick={handlePickEyeDropper}
                className="os-btn p-2 text-os-accent flex items-center justify-center shrink-0"
                title="Pick color from screen (EyeDropper)"
              >
                <Pipette size={14} />
              </button>
            )}
          </div>

          {/* Alpha / Opacity Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-os-text-muted">
              <span>Opacity / Alpha</span>
              <span className="font-mono text-os-accent">{alpha}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={alpha}
              onChange={(e) => setAlpha(Number(e.target.value))}
              className="w-full h-1.5 bg-[#141b27] border border-white/20 rounded-full cursor-pointer appearance-none accent-cyan-400"
            />
          </div>

          {/* Live Preview Swatch */}
          <div
            className="h-16 rounded border border-white/20 flex items-center justify-center font-mono text-xs font-bold shadow-inner"
            style={{
              background: `linear-gradient(45deg, #222 25%, transparent 25%), linear-gradient(-45deg, #222 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #222 75%), linear-gradient(-45deg, transparent 75%, #222 75%)`,
              backgroundSize: '16px 16px',
              backgroundColor: '#111',
            }}
          >
            <div
              className="w-full h-full rounded flex items-center justify-center"
              style={{
                backgroundColor: hex,
                opacity: alpha / 100,
                color: getLuminance(r, g, b) > 0.4 ? '#000000' : '#ffffff',
              }}
            >
              {hexAlpha.toUpperCase()}
            </div>
          </div>

          {/* History Palette */}
          <div>
            <div className="text-[9px] text-[#4a5c6c] uppercase tracking-wider mb-1">
              Recent Colors
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {history.map((c, i) => (
                <button
                  key={i}
                  onClick={() => setHex(c)}
                  className="w-6 h-6 rounded border border-white/20 transition-transform hover:scale-110"
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right: Copyable Formats */}
        <div className="flex flex-col gap-1 p-3 bg-black/20 rounded border border-white/[0.06]">
          <div className="text-[9px] font-mono uppercase tracking-wider text-[#4a5c6c] mb-1">
            Color Formats (Click to Copy)
          </div>
          <Out
            label="HEX"
            value={hex.toUpperCase()}
            onCopy={() => copyText('hex', hex.toUpperCase())}
          />
          {alpha < 100 && (
            <Out
              label="HEXA"
              value={hexAlpha.toUpperCase()}
              onCopy={() => copyText('hexa', hexAlpha.toUpperCase())}
            />
          )}
          <Out
            label="RGB"
            value={`rgb(${r}, ${g}, ${b})`}
            onCopy={() => copyText('rgb', `rgb(${r}, ${g}, ${b})`)}
          />
          <Out
            label="RGBA"
            value={`rgba(${r}, ${g}, ${b}, ${alpha / 100})`}
            onCopy={() => copyText('rgba', `rgba(${r}, ${g}, ${b}, ${alpha / 100})`)}
          />
          <Out
            label="HSL"
            value={`hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`}
            onCopy={() => copyText('hsl', `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`)}
          />
          <Out
            label="HSLA"
            value={`hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${alpha / 100})`}
            onCopy={() => copyText('hsla', `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${alpha / 100})`)}
          />
          <Out
            label="HSV"
            value={`hsv(${hsv.h}°, ${hsv.s}%, ${hsv.v}%)`}
            onCopy={() => copyText('hsv', `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`)}
          />
          <Out
            label="CMYK"
            value={`cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`}
            onCopy={() => copyText('cmyk', `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`)}
          />
        </div>
      </div>

      {/* Color Harmonies */}
      <div className="p-3 bg-black/20 rounded border border-white/[0.06] flex flex-col gap-2.5">
        <div className="text-[10px] font-mono uppercase tracking-wider text-os-accent font-semibold flex items-center gap-1.5">
          <Sparkles size={11} /> Color Harmonies
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
          {/* Complementary */}
          <div className="p-2 bg-white/[0.02] rounded border border-white/[0.04]">
            <div className="text-[9px] text-[#8aa0b2] mb-1.5">Complementary</div>
            <div className="flex gap-1">
              {harmonies.complementary.map((c, i) => (
                <button
                  key={i}
                  onClick={() => updateColor(c)}
                  className="flex-1 h-8 rounded border border-white/20 transition-transform hover:scale-105"
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Analogous */}
          <div className="p-2 bg-white/[0.02] rounded border border-white/[0.04]">
            <div className="text-[9px] text-[#8aa0b2] mb-1.5">Analogous</div>
            <div className="flex gap-1">
              {harmonies.analogous.map((c, i) => (
                <button
                  key={i}
                  onClick={() => updateColor(c)}
                  className="flex-1 h-8 rounded border border-white/20 transition-transform hover:scale-105"
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Triadic */}
          <div className="p-2 bg-white/[0.02] rounded border border-white/[0.04]">
            <div className="text-[9px] text-[#8aa0b2] mb-1.5">Triadic</div>
            <div className="flex gap-1">
              {harmonies.triadic.map((c, i) => (
                <button
                  key={i}
                  onClick={() => updateColor(c)}
                  className="flex-1 h-8 rounded border border-white/20 transition-transform hover:scale-105"
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Tetradic */}
          <div className="p-2 bg-white/[0.02] rounded border border-white/[0.04]">
            <div className="text-[9px] text-[#8aa0b2] mb-1.5">Tetradic</div>
            <div className="flex gap-1">
              {harmonies.tetradic.map((c, i) => (
                <button
                  key={i}
                  onClick={() => updateColor(c)}
                  className="flex-1 h-8 rounded border border-white/20 transition-transform hover:scale-105"
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Monochromatic */}
          <div className="p-2 bg-white/[0.02] rounded border border-white/[0.04] sm:col-span-2">
            <div className="text-[9px] text-[#8aa0b2] mb-1.5">Monochromatic Scale</div>
            <div className="flex gap-1">
              {harmonies.monochromatic.map((c, i) => (
                <button
                  key={i}
                  onClick={() => updateColor(c)}
                  className="flex-1 h-8 rounded border border-white/20 transition-transform hover:scale-105"
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 2. Material Colors (Full 50-900 & Accents for all 19 palettes)
// -------------------------------------------------------------
const MATERIAL_PALETTES: Record<string, Record<string, string>> = {
  Red: {
    '50': '#ffebee',
    '100': '#ffcdd2',
    '200': '#ef9a9a',
    '300': '#e57373',
    '400': '#ef5350',
    '500': '#f44336',
    '600': '#e53935',
    '700': '#d32f2f',
    '800': '#c62828',
    '900': '#b71c1c',
    A100: '#ff8a80',
    A200: '#ff5252',
    A400: '#ff1744',
    A700: '#d50000',
  },
  Pink: {
    '50': '#fce4ec',
    '100': '#f8bbd0',
    '200': '#f48fb1',
    '300': '#f06292',
    '400': '#ec407a',
    '500': '#e91e63',
    '600': '#d81b60',
    '700': '#c2185b',
    '800': '#ad1457',
    '900': '#880e4f',
    A100: '#ff80ab',
    A200: '#ff4081',
    A400: '#f50057',
    A700: '#c51162',
  },
  Purple: {
    '50': '#f3e5f5',
    '100': '#e1bee7',
    '200': '#ce93d8',
    '300': '#ba68c8',
    '400': '#ab47bc',
    '500': '#9c27b0',
    '600': '#8e24aa',
    '700': '#7b1fa2',
    '800': '#6a1b9a',
    '900': '#4a148c',
    A100: '#ea80fc',
    A200: '#e040fb',
    A400: '#d500f9',
    A700: '#aa00ff',
  },
  'Deep Purple': {
    '50': '#ede7f6',
    '100': '#d1c4e9',
    '200': '#b39ddb',
    '300': '#9575cd',
    '400': '#7e57c2',
    '500': '#673ab7',
    '600': '#5e35b1',
    '700': '#512da8',
    '800': '#4527a0',
    '900': '#311b92',
    A100: '#b388ff',
    A200: '#7c4dff',
    A400: '#651fff',
    A700: '#6200ea',
  },
  Indigo: {
    '50': '#e8eaf6',
    '100': '#c5cae9',
    '200': '#9fa8da',
    '300': '#7986cb',
    '400': '#5c6bc0',
    '500': '#3f51b5',
    '600': '#3949ab',
    '700': '#303f9f',
    '800': '#283593',
    '900': '#1a237e',
    A100: '#8c9eff',
    A200: '#536dfe',
    A400: '#3d5afe',
    A700: '#304ffe',
  },
  Blue: {
    '50': '#e3f2fd',
    '100': '#bbdefb',
    '200': '#90caf9',
    '300': '#64b5f6',
    '400': '#42a5f5',
    '500': '#2196f3',
    '600': '#1e88e5',
    '700': '#1976d2',
    '800': '#1565c0',
    '900': '#0d47a1',
    A100: '#82b1ff',
    A200: '#448aff',
    A400: '#2979ff',
    A700: '#2962ff',
  },
  'Light Blue': {
    '50': '#e1f5fe',
    '100': '#b3e5fc',
    '200': '#81d4fa',
    '300': '#4fc3f7',
    '400': '#29b6f6',
    '500': '#03a9f4',
    '600': '#039be5',
    '700': '#0288d1',
    '800': '#0277bd',
    '900': '#01579b',
    A100: '#80d8ff',
    A200: '#40c4ff',
    A400: '#00b0ff',
    A700: '#0091ea',
  },
  Cyan: {
    '50': '#e0f7fa',
    '100': '#b2ebf2',
    '200': '#80deea',
    '300': '#4dd0e1',
    '400': '#26c6da',
    '500': '#00bcd4',
    '600': '#00acc1',
    '700': '#0097a7',
    '800': '#00838f',
    '900': '#006064',
    A100: '#84ffff',
    A200: '#18ffff',
    A400: '#00e5ff',
    A700: '#00b8d4',
  },
  Teal: {
    '50': '#e0f2f1',
    '100': '#b2dfdb',
    '200': '#80cbc4',
    '300': '#4db6ac',
    '400': '#26a69a',
    '500': '#009688',
    '600': '#00897b',
    '700': '#00796b',
    '800': '#00695c',
    '900': '#004d40',
    A100: '#a7ffeb',
    A200: '#64ffda',
    A400: '#1de9b6',
    A700: '#00bfa5',
  },
  Green: {
    '50': '#e8f5e9',
    '100': '#c8e6c9',
    '200': '#a5d6a7',
    '300': '#81c784',
    '400': '#66bb6a',
    '500': '#4caf50',
    '600': '#43a047',
    '700': '#388e3c',
    '800': '#2e7d32',
    '900': '#1b5e20',
    A100: '#b9f6ca',
    A200: '#69f0ae',
    A400: '#00e676',
    A700: '#00c853',
  },
  'Light Green': {
    '50': '#f1f8e9',
    '100': '#dcedc8',
    '200': '#c5e1a5',
    '300': '#aed581',
    '400': '#9ccc65',
    '500': '#8bc34a',
    '600': '#7cb342',
    '700': '#689f38',
    '800': '#558b2f',
    '900': '#33691e',
    A100: '#ccff90',
    A200: '#b2ff59',
    A400: '#76ff03',
    A700: '#64dd17',
  },
  Lime: {
    '50': '#f9fbe7',
    '100': '#f0f4c3',
    '200': '#e6ee9c',
    '300': '#dce775',
    '400': '#d4e157',
    '500': '#cddc39',
    '600': '#c0ca33',
    '700': '#afb42b',
    '800': '#9e9d24',
    '900': '#827717',
    A100: '#f4ff81',
    A200: '#eeff41',
    A400: '#c6ff00',
    A700: '#aeea00',
  },
  Yellow: {
    '50': '#fffde7',
    '100': '#fff9c4',
    '200': '#fff59d',
    '300': '#fff176',
    '400': '#ffee58',
    '500': '#ffeb3b',
    '600': '#fdd835',
    '700': '#fbc02d',
    '800': '#f9a825',
    '900': '#f57f17',
    A100: '#ffff8d',
    A200: '#ffff00',
    A400: '#ffea00',
    A700: '#ffd600',
  },
  Amber: {
    '50': '#fff8e1',
    '100': '#ffecb3',
    '200': '#ffe082',
    '300': '#ffd54f',
    '400': '#ffca28',
    '500': '#ffc107',
    '600': '#ffb300',
    '700': '#ffa000',
    '800': '#ff8f00',
    '900': '#ff6f00',
    A100: '#ffe57f',
    A200: '#ffd740',
    A400: '#ffc400',
    A700: '#ffab00',
  },
  Orange: {
    '50': '#fff3e0',
    '100': '#ffe0b2',
    '200': '#ffcc80',
    '300': '#ffb74d',
    '400': '#ffa726',
    '500': '#ff9800',
    '600': '#fb8c00',
    '700': '#f57c00',
    '800': '#ef6c00',
    '900': '#e65100',
    A100: '#ffd180',
    A200: '#ffab40',
    A400: '#ff9100',
    A700: '#ff6d00',
  },
  'Deep Orange': {
    '50': '#fbe9e7',
    '100': '#ffccbc',
    '200': '#ffab91',
    '300': '#ff8a65',
    '400': '#ff7043',
    '500': '#ff5722',
    '600': '#f4511e',
    '700': '#e64a19',
    '800': '#d84315',
    '900': '#bf360c',
    A100: '#ff9e80',
    A200: '#ff6e40',
    A400: '#ff3d00',
    A700: '#dd2c00',
  },
  Brown: {
    '50': '#efebe9',
    '100': '#d7ccc8',
    '200': '#bcaaa4',
    '300': '#a1887f',
    '400': '#8d6e63',
    '500': '#795548',
    '600': '#6d4c41',
    '700': '#5d4037',
    '800': '#4e342e',
    '900': '#3e2723',
  },
  Grey: {
    '50': '#fafafa',
    '100': '#f5f5f5',
    '200': '#eeeeee',
    '300': '#e0e0e0',
    '400': '#bdbdbd',
    '500': '#9e9e9e',
    '600': '#757575',
    '700': '#616161',
    '800': '#424242',
    '900': '#212121',
  },
  'Blue Grey': {
    '50': '#eceff1',
    '100': '#cfd8dc',
    '200': '#b0bec5',
    '300': '#90a4ae',
    '400': '#78909c',
    '500': '#607d8b',
    '600': '#546e7a',
    '700': '#455a64',
    '800': '#37474f',
    '900': '#263238',
  },
};

export function MaterialColors() {
  const [search, setSearch] = useState('');
  const [selectedFamily, setSelectedFamily] = useState<string>('All');
  const [toast, setToast] = useState<string | null>(null);

  const families = useMemo(() => ['All', ...Object.keys(MATERIAL_PALETTES)], []);

  const filteredFamilies = useMemo(() => {
    const s = search.toLowerCase().trim();
    return Object.entries(MATERIAL_PALETTES).filter(([name, shades]) => {
      if (selectedFamily !== 'All' && name !== selectedFamily) return false;
      if (!s) return true;
      if (name.toLowerCase().includes(s)) return true;
      return Object.values(shades).some((hex) => hex.toLowerCase().includes(s));
    });
  }, [search, selectedFamily]);

  const copyColor = (family: string, shade: string, hex: string) => {
    navigator.clipboard.writeText(hex.toUpperCase());
    setToast(`${family} ${shade}: ${hex.toUpperCase()} copied!`);
    setTimeout(() => setToast(null), 1500);
  };

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-3">
      <ToolHeader
        title="Material Design Color System"
        desc="Official Google Material Design palettes with all 50-900 and accent shades."
      />

      {/* Top Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter color by name or #hex…"
          className="os-input flex-1 min-w-[140px] text-xs"
        />
        <select
          value={selectedFamily}
          onChange={(e) => setSelectedFamily(e.target.value)}
          className="os-input text-xs"
        >
          {families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        {toast && (
          <span className="text-[10px] font-mono text-os-emerald bg-os-emerald/10 border border-os-emerald/30 px-2 py-1 rounded animate-fade-in">
            {toast}
          </span>
        )}
      </div>

      {/* Palette Grid */}
      <div className="space-y-4">
        {filteredFamilies.map(([family, shades]) => (
          <div key={family} className="p-3 bg-black/20 rounded border border-white/[0.06]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-os-text">{family}</span>
              <span className="text-[9px] font-mono text-[#4a5c6c]">
                {Object.keys(shades).length} shades
              </span>
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-10 lg:grid-cols-14 gap-1.5">
              {Object.entries(shades).map(([shade, hex]) => {
                const { r, g, b } = hexToRgb(hex);
                const isDarkText = getLuminance(r, g, b) > 0.38;
                return (
                  <button
                    key={shade}
                    onClick={() => copyColor(family, shade, hex)}
                    className="flex flex-col items-center justify-between p-1.5 rounded border border-white/10 transition-all hover:scale-105 active:scale-95 shadow-sm min-h-[58px]"
                    style={{
                      background: hex,
                      color: isDarkText ? '#111827' : '#ffffff',
                    }}
                    title={`Click to copy: ${family} ${shade} (${hex.toUpperCase()})`}
                  >
                    <span className="text-[9px] font-bold tracking-tight">{shade}</span>
                    <span className="text-[8px] font-mono opacity-90">{hex.toUpperCase()}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 3. Tailwind Colors (Complete 50-950 scale + Class Generator)
// -------------------------------------------------------------
const TAILWIND_PALETTES: Record<string, Record<string, string>> = {
  Slate: {
    '50': '#f8fafc',
    '100': '#f1f5f9',
    '200': '#e2e8f0',
    '300': '#cbd5e1',
    '400': '#94a3b8',
    '500': '#64748b',
    '600': '#475569',
    '700': '#334155',
    '800': '#1e293b',
    '900': '#0f172a',
    '950': '#020617',
  },
  Gray: {
    '50': '#f9fafb',
    '100': '#f3f4f6',
    '200': '#e5e7eb',
    '300': '#d1d5db',
    '400': '#9ca3af',
    '500': '#6b7280',
    '600': '#4b5563',
    '700': '#374151',
    '800': '#1f2937',
    '900': '#111827',
    '950': '#030712',
  },
  Zinc: {
    '50': '#fafafa',
    '100': '#f4f4f5',
    '200': '#e4e4e7',
    '300': '#d4d4d8',
    '400': '#a1a1aa',
    '500': '#71717a',
    '600': '#52525b',
    '700': '#3f3f46',
    '800': '#27272a',
    '900': '#18181b',
    '950': '#09090b',
  },
  Neutral: {
    '50': '#fafafa',
    '100': '#f5f5f5',
    '200': '#e5e5e5',
    '300': '#d4d4d4',
    '400': '#a3a3a3',
    '500': '#737373',
    '600': '#525252',
    '700': '#404040',
    '800': '#262626',
    '900': '#171717',
    '950': '#0a0a0a',
  },
  Stone: {
    '50': '#fafaf9',
    '100': '#f5f5f4',
    '200': '#e7e5e4',
    '300': '#d6d3d1',
    '400': '#a8a29e',
    '500': '#78716c',
    '600': '#57534e',
    '700': '#44403c',
    '800': '#292524',
    '900': '#1c1917',
    '950': '#0c0a09',
  },
  Red: {
    '50': '#fef2f2',
    '100': '#fee2e2',
    '200': '#fecaca',
    '300': '#fca5a5',
    '400': '#f87171',
    '500': '#ef4444',
    '600': '#dc2626',
    '700': '#b91c1c',
    '800': '#991b1b',
    '900': '#7f1d1d',
    '950': '#450a0a',
  },
  Orange: {
    '50': '#fff7ed',
    '100': '#ffedd5',
    '200': '#fed7aa',
    '300': '#fdba74',
    '400': '#fb923c',
    '500': '#f97316',
    '600': '#ea580c',
    '700': '#c2410c',
    '800': '#9a3412',
    '900': '#7c2d12',
    '950': '#431407',
  },
  Amber: {
    '50': '#fffbeb',
    '100': '#fef3c7',
    '200': '#fde68a',
    '300': '#fcd34d',
    '400': '#fbbf24',
    '500': '#f59e0b',
    '600': '#d97706',
    '700': '#b45309',
    '800': '#92400e',
    '900': '#78350f',
    '950': '#451a03',
  },
  Yellow: {
    '50': '#fefce8',
    '100': '#fef9c3',
    '200': '#fef08a',
    '300': '#fde047',
    '400': '#facc15',
    '500': '#eab308',
    '600': '#ca8a04',
    '700': '#a16207',
    '800': '#854d0e',
    '900': '#713f12',
    '950': '#422006',
  },
  Lime: {
    '50': '#f7fee7',
    '100': '#ecfccb',
    '200': '#d9f99d',
    '300': '#bef264',
    '400': '#a3e635',
    '500': '#84cc16',
    '600': '#65a30d',
    '700': '#4d7c0f',
    '800': '#3f6212',
    '900': '#365314',
    '950': '#1a2e05',
  },
  Green: {
    '50': '#f0fdf4',
    '100': '#dcfce7',
    '200': '#bbf7d0',
    '300': '#86efac',
    '400': '#4ade80',
    '500': '#22c55e',
    '600': '#16a34a',
    '700': '#15803d',
    '800': '#166534',
    '900': '#14532d',
    '950': '#052e16',
  },
  Emerald: {
    '50': '#ecfdf5',
    '100': '#d1fae5',
    '200': '#a7f3d0',
    '300': '#6ee7b7',
    '400': '#34d399',
    '500': '#10b981',
    '600': '#059669',
    '700': '#047857',
    '800': '#065f46',
    '900': '#064e3b',
    '950': '#022c22',
  },
  Teal: {
    '50': '#f0fdfa',
    '100': '#ccfbf1',
    '200': '#99f6e4',
    '300': '#5eead4',
    '400': '#2dd4bf',
    '500': '#14b8a6',
    '600': '#0d9488',
    '700': '#0f766e',
    '800': '#115e59',
    '900': '#134e4a',
    '950': '#042f2e',
  },
  Cyan: {
    '50': '#ecfeff',
    '100': '#cffafe',
    '200': '#a5f3fc',
    '300': '#67e8f9',
    '400': '#22d3ee',
    '500': '#06b6d4',
    '600': '#0891b2',
    '700': '#0e7490',
    '800': '#155e75',
    '900': '#164e63',
    '950': '#083344',
  },
  Sky: {
    '50': '#f0f9ff',
    '100': '#e0f2fe',
    '200': '#bae6fd',
    '300': '#7dd3fc',
    '400': '#38bdf8',
    '500': '#0ea5e9',
    '600': '#0284c7',
    '700': '#0369a1',
    '800': '#075985',
    '900': '#0c4a6e',
    '950': '#082f49',
  },
  Blue: {
    '50': '#eff6ff',
    '100': '#dbeafe',
    '200': '#bfdbfe',
    '300': '#93c5fd',
    '400': '#60a5fa',
    '500': '#3b82f6',
    '600': '#2563eb',
    '700': '#1d4ed8',
    '800': '#1e40af',
    '900': '#1e3a8a',
    '950': '#172554',
  },
  Indigo: {
    '50': '#eef2ff',
    '100': '#e0e7ff',
    '200': '#c7d2fe',
    '300': '#a5b4fc',
    '400': '#818cf8',
    '500': '#6366f1',
    '600': '#4f46e5',
    '700': '#4338ca',
    '800': '#3730a3',
    '900': '#312e81',
    '950': '#1e1b4b',
  },
  Violet: {
    '50': '#f5f3ff',
    '100': '#ede9fe',
    '200': '#ddd6fe',
    '300': '#c4b5fd',
    '400': '#a78bfa',
    '500': '#8b5cf6',
    '600': '#7c3aed',
    '700': '#6d28d9',
    '800': '#5b21b6',
    '900': '#4c1d95',
    '950': '#2e1065',
  },
  Purple: {
    '50': '#faf5ff',
    '100': '#f3e8ff',
    '200': '#e9d5ff',
    '300': '#d8b4fe',
    '400': '#c084fc',
    '500': '#a855f7',
    '600': '#9333ea',
    '700': '#7e22ce',
    '800': '#6b21a8',
    '900': '#581c87',
    '950': '#3b0764',
  },
  Fuchsia: {
    '50': '#fdf4ff',
    '100': '#fae8ff',
    '200': '#f5d0fe',
    '300': '#f0abfc',
    '400': '#e879f9',
    '500': '#d946ef',
    '600': '#c026d3',
    '700': '#a21caf',
    '800': '#86198f',
    '900': '#701a75',
    '950': '#4a044e',
  },
  Pink: {
    '50': '#fdf2f8',
    '100': '#fce7f3',
    '200': '#fbcfe8',
    '300': '#f472b6',
    '400': '#f472b6',
    '500': '#ec4899',
    '600': '#db2777',
    '700': '#be185d',
    '800': '#9d174d',
    '900': '#831843',
    '950': '#500724',
  },
  Rose: {
    '50': '#fff1f2',
    '100': '#ffe4e6',
    '200': '#fecdd3',
    '300': '#fda4af',
    '400': '#fb7185',
    '500': '#f43f5e',
    '600': '#e11d48',
    '700': '#be123c',
    '800': '#9f1239',
    '900': '#881337',
    '950': '#4c0519',
  },
};

export function TailwindColors() {
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'hex' | 'bg' | 'text' | 'border'>('bg');
  const [toast, setToast] = useState<string | null>(null);

  const filteredFamilies = useMemo(() => {
    const s = search.toLowerCase().trim();
    return Object.entries(TAILWIND_PALETTES).filter(([name, shades]) => {
      if (!s) return true;
      if (name.toLowerCase().includes(s)) return true;
      return Object.values(shades).some((hex) => hex.toLowerCase().includes(s));
    });
  }, [search]);

  const copyItem = (family: string, shade: string, hex: string) => {
    const fLower = family.toLowerCase();
    let textToCopy = hex.toUpperCase();
    if (mode === 'bg') textToCopy = `bg-${fLower}-${shade}`;
    else if (mode === 'text') textToCopy = `text-${fLower}-${shade}`;
    else if (mode === 'border') textToCopy = `border-${fLower}-${shade}`;

    navigator.clipboard.writeText(textToCopy);
    setToast(`${textToCopy} copied!`);
    setTimeout(() => setToast(null), 1500);
  };

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-3">
      <ToolHeader
        title="Tailwind CSS Palette"
        desc="Interactive Tailwind CSS v3/v4 color reference with shade picker and class name generator."
      />

      {/* Mode Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-black/25 rounded border border-white/[0.06]">
        <div className="flex gap-1">
          {(['bg', 'text', 'border', 'hex'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-[10px] rounded font-mono uppercase transition-all ${
                mode === m
                  ? 'bg-os-accent/20 text-os-accent border border-os-accent/40 font-semibold'
                  : 'text-[#6b8296] hover:text-[#c5d2de]'
              }`}
            >
              {m === 'bg' ? 'bg-*' : m === 'text' ? 'text-*' : m === 'border' ? 'border-*' : 'HEX'}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search colors…"
          className="os-input text-xs w-44"
        />

        {toast && (
          <span className="text-[10px] font-mono text-os-emerald bg-os-emerald/10 border border-os-emerald/30 px-2 py-0.5 rounded animate-fade-in">
            {toast}
          </span>
        )}
      </div>

      {/* Palettes */}
      <div className="space-y-3">
        {filteredFamilies.map(([family, shades]) => (
          <div key={family} className="p-2.5 bg-black/20 rounded border border-white/[0.06]">
            <div className="text-[11px] font-semibold text-os-text mb-1.5">{family}</div>
            <div className="grid grid-cols-6 sm:grid-cols-11 gap-1">
              {Object.entries(shades).map(([shade, hex]) => {
                const { r, g, b } = hexToRgb(hex);
                const isDark = getLuminance(r, g, b) > 0.38;
                return (
                  <button
                    key={shade}
                    onClick={() => copyItem(family, shade, hex)}
                    className="flex flex-col items-center justify-between p-1 rounded border border-white/10 transition-all hover:scale-105 active:scale-95 shadow-sm min-h-[50px]"
                    style={{ background: hex, color: isDark ? '#0f172a' : '#ffffff' }}
                    title={`${family} ${shade} (${hex})`}
                  >
                    <span className="text-[8px] font-bold">{shade}</span>
                    <span className="text-[7px] font-mono opacity-85">
                      {mode === 'hex'
                        ? hex.toUpperCase()
                        : `${mode}-${family.toLowerCase()}-${shade}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 4. Color Mixer (Perceptual interpolation: RGB, HSL, LAB, Oklab)
// -------------------------------------------------------------
export function ColorMixer() {
  const [c1, setC1] = useState('#38bdf8');
  const [c2, setC2] = useState('#f43f5e');
  const [amount, setAmount] = useState(50);
  const [space, setSpace] = useState<'rgb' | 'hsl' | 'oklab'>('rgb');
  const [steps, setSteps] = useState(7);
  const [copied, setCopied] = useState<string | null>(null);

  const mixColors = useCallback(
    (hex1: string, hex2: string, ratio: number, mode: 'rgb' | 'hsl' | 'oklab') => {
      const { r: r1, g: g1, b: b1 } = hexToRgb(hex1);
      const { r: r2, g: g2, b: b2 } = hexToRgb(hex2);

      if (mode === 'rgb') {
        const r = Math.round(r1 + (r2 - r1) * ratio);
        const g = Math.round(g1 + (g2 - g1) * ratio);
        const b = Math.round(b1 + (b2 - b1) * ratio);
        return rgbToHex(r, g, b);
      }

      if (mode === 'hsl') {
        const hsl1 = rgbToHsl(r1, g1, b1);
        const hsl2 = rgbToHsl(r2, g2, b2);
        // Shortest angle interpolation for hue
        let dH = hsl2.h - hsl1.h;
        if (dH > 180) dH -= 360;
        if (dH < -180) dH += 360;
        const h = (((hsl1.h + dH * ratio) % 360) + 360) % 360;
        const s = hsl1.s + (hsl2.s - hsl1.s) * ratio;
        const l = hsl1.l + (hsl2.l - hsl1.l) * ratio;
        return hslToHex(h, s, l);
      }

      // Oklab perceptual blend
      const toLinear = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      const fromLinear = (v: number) => {
        const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
        return Math.max(0, Math.min(255, Math.round(c * 255)));
      };
      const rL = toLinear(r1) * (1 - ratio) + toLinear(r2) * ratio;
      const gL = toLinear(g1) * (1 - ratio) + toLinear(g2) * ratio;
      const bL = toLinear(b1) * (1 - ratio) + toLinear(b2) * ratio;
      return rgbToHex(fromLinear(rL), fromLinear(gL), fromLinear(bL));
    },
    [],
  );

  const mixedColor = useMemo(
    () => mixColors(c1, c2, amount / 100, space),
    [c1, c2, amount, space, mixColors],
  );

  const gradientSteps = useMemo(() => {
    const list: string[] = [];
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      list.push(mixColors(c1, c2, t, space));
    }
    return list;
  }, [c1, c2, steps, space, mixColors]);

  const copyHex = (hex: string) => {
    navigator.clipboard.writeText(hex.toUpperCase());
    setCopied(hex);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-3">
      <ToolHeader
        title="Perceptual Color Mixer"
        desc="Blend colors seamlessly using standard RGB, cylindrical HSL, or perceptual Oklab color spaces."
      />

      {/* Dual Inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-2.5 bg-black/20 rounded border border-white/[0.06] flex items-center gap-2">
          <input
            type="color"
            value={c1}
            onChange={(e) => setC1(e.target.value)}
            className="w-9 h-9 rounded border border-white/20 cursor-pointer bg-transparent"
          />
          <div className="flex-1">
            <span className="text-[9px] text-[#4a5c6c] uppercase block font-mono">Color 1</span>
            <input
              value={c1}
              onChange={(e) => setC1(e.target.value)}
              className="os-input font-mono text-xs uppercase w-full"
            />
          </div>
        </div>

        <div className="p-2.5 bg-black/20 rounded border border-white/[0.06] flex items-center gap-2">
          <input
            type="color"
            value={c2}
            onChange={(e) => setC2(e.target.value)}
            className="w-9 h-9 rounded border border-white/20 cursor-pointer bg-transparent"
          />
          <div className="flex-1">
            <span className="text-[9px] text-[#4a5c6c] uppercase block font-mono">Color 2</span>
            <input
              value={c2}
              onChange={(e) => setC2(e.target.value)}
              className="os-input font-mono text-xs uppercase w-full"
            />
          </div>
        </div>
      </div>

      {/* Mode and Ratio Controls */}
      <div className="p-3 bg-black/20 rounded border border-white/[0.06] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-os-text-muted">Color Space Model:</span>
          <div className="flex gap-1">
            {(['rgb', 'hsl', 'oklab'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setSpace(m)}
                className={`px-2 py-0.5 text-[9px] font-mono uppercase rounded border transition-all ${
                  space === m
                    ? 'bg-os-accent/20 border-os-accent text-os-accent font-semibold'
                    : 'border-white/10 text-[#6b8296]'
                }`}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-os-text-muted">
            <span>Blend Ratio (Color 1 ↔ Color 2)</span>
            <span className="font-mono text-os-accent font-semibold">{amount}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full h-1.5 bg-[#141b27] border border-white/20 rounded-full cursor-pointer appearance-none accent-cyan-400"
          />
        </div>

        {/* Result Swatch */}
        <div
          onClick={() => copyHex(mixedColor)}
          className="h-14 rounded border border-white/20 flex items-center justify-center font-mono text-sm font-bold shadow cursor-pointer transition-transform hover:scale-[1.01]"
          style={{
            background: mixedColor,
            color:
              getLuminance(hexToRgb(mixedColor).r, hexToRgb(mixedColor).g, hexToRgb(mixedColor).b) >
              0.38
                ? '#000000'
                : '#ffffff',
          }}
          title="Click to copy mixed hex"
        >
          {mixedColor.toUpperCase()} {copied === mixedColor ? '✓ Copied!' : '(Click to Copy)'}
        </div>
      </div>

      {/* Multi-step Swatch Palette */}
      <div className="p-3 bg-black/20 rounded border border-white/[0.06] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-os-accent">
            Multi-Step Gradient Palette
          </span>
          <div className="flex gap-1 items-center">
            <span className="text-[9px] text-[#4a5c6c]">Steps:</span>
            {[3, 5, 7, 9, 11].map((n) => (
              <button
                key={n}
                onClick={() => setSteps(n)}
                className={`px-1.5 py-0.5 text-[9px] font-mono rounded border ${
                  steps === n
                    ? 'border-os-accent bg-os-accent/15 text-os-accent'
                    : 'border-white/10 text-[#6b8296]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-1 h-12">
          {gradientSteps.map((sHex, i) => (
            <button
              key={i}
              onClick={() => copyHex(sHex)}
              className="flex-1 rounded border border-white/20 flex flex-col justify-end p-1 transition-transform hover:scale-105 active:scale-95 text-[8px] font-mono font-bold"
              style={{
                background: sHex,
                color:
                  getLuminance(hexToRgb(sHex).r, hexToRgb(sHex).g, hexToRgb(sHex).b) > 0.38
                    ? '#000000'
                    : '#ffffff',
              }}
              title={`Click to copy step ${i + 1}: ${sHex}`}
            >
              <span className="truncate">{sHex.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Additional Color Utilities (Polished Native Design)
// -------------------------------------------------------------
export function GradientGenerator() {
  const [start, setStart] = useState('#4aa3ff');
  const [end, setEnd] = useState('#05080d');
  const [angle, setAngle] = useState(90);
  const css = `linear-gradient(${angle}deg, ${start}, ${end})`;
  return (
    <div className="tool-workspace">
      <ToolHeader title="Gradient Generator" desc="Generate CSS linear gradients and stops." />
      <div className="flex gap-2 mb-2">
        <input
          type="color"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="w-10 h-8 rounded border border-white/20 bg-transparent"
        />
        <input
          type="color"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="w-10 h-8 rounded border border-white/20 bg-transparent"
        />
        <input
          type="number"
          value={angle}
          onChange={(e) => setAngle(Number(e.target.value))}
          className="os-input w-20"
          placeholder="Angle"
        />
      </div>
      <div
        className="h-20 rounded border border-white/20 mb-2 shadow"
        style={{ background: css }}
      />
      <pre className="os-input w-full h-14 font-mono text-xs p-2 resize-none">{css}</pre>
      <button
        onClick={() => navigator.clipboard.writeText(css)}
        className="os-btn os-btn-primary w-fit mt-2"
      >
        Copy CSS
      </button>
    </div>
  );
}

export function ContrastChecker() {
  const [c1, setC1] = useState('#4aa3ff');
  const [c2, setC2] = useState('#05080d');
  const { r: r1, g: g1, b: b1 } = hexToRgb(c1);
  const { r: r2, g: g2, b: b2 } = hexToRgb(c2);
  const l1 = getLuminance(r1, g1, b1);
  const l2 = getLuminance(r2, g2, b2);
  const ratio = ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
  const numRatio = parseFloat(ratio);
  const wcagAA = numRatio >= 4.5;
  const wcagAAA = numRatio >= 7.0;

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="WCAG Contrast Checker"
        desc="Check contrast ratio compliance against WCAG 2.1 accessibility guidelines."
      />
      <div className="flex gap-2 mb-2">
        <input
          type="color"
          value={c1}
          onChange={(e) => setC1(e.target.value)}
          className="w-10 h-8 rounded border border-white/20 bg-transparent"
        />
        <input
          value={c1}
          onChange={(e) => setC1(e.target.value)}
          className="os-input flex-1 font-mono"
        />
        <input
          type="color"
          value={c2}
          onChange={(e) => setC2(e.target.value)}
          className="w-10 h-8 rounded border border-white/20 bg-transparent"
        />
        <input
          value={c2}
          onChange={(e) => setC2(e.target.value)}
          className="os-input flex-1 font-mono"
        />
      </div>

      <div className="p-3 bg-black/25 rounded border border-white/10 space-y-2 mt-2">
        <div className="flex justify-between items-center">
          <span className="text-xs text-os-text-muted">Contrast Ratio</span>
          <span className="text-lg font-mono font-bold text-os-accent">{ratio} : 1</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center text-xs font-mono font-semibold">
          <div
            className={`p-2 rounded border ${wcagAA ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/15 border-rose-500/30 text-rose-400'}`}
          >
            WCAG AA {wcagAA ? 'PASS ✓' : 'FAIL ✗'}
          </div>
          <div
            className={`p-2 rounded border ${wcagAAA ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/15 border-rose-500/30 text-rose-400'}`}
          >
            WCAG AAA {wcagAAA ? 'PASS ✓' : 'FAIL ✗'}
          </div>
        </div>
      </div>

      <div
        className="h-12 rounded border border-white/20 mt-3 flex items-center justify-center font-bold"
        style={{ backgroundColor: c2, color: c1 }}
      >
        Sample Text Preview (Foreground on Background)
      </div>
    </div>
  );
}

export function GoldenRatioPalette() {
  const [count, setCount] = useState(8);
  const [hue, setHue] = useState(210);
  const colors = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push(hslToHex((hue + i * 137.5) % 360, 75, 52));
    }
    return out;
  }, [count, hue]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Golden Ratio Palette"
        desc="Generate perfectly balanced color harmonies using the golden ratio angle (137.5°)."
      />
      <div className="flex gap-2 mb-2">
        <input
          type="number"
          min="3"
          max="20"
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="os-input w-20"
          placeholder="Count"
        />
        <input
          type="number"
          min="0"
          max="360"
          value={hue}
          onChange={(e) => setHue(Number(e.target.value))}
          className="os-input flex-1 font-mono"
          placeholder="Start hue"
        />
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 mt-2">
        {colors.map((c, i) => (
          <button
            key={i}
            onClick={() => navigator.clipboard.writeText(c.toUpperCase())}
            className="flex flex-col items-center gap-1 p-1 rounded border border-white/10 hover:scale-105 transition-transform"
          >
            <div className="w-full h-8 rounded" style={{ background: c }} />
            <span className="text-[8px] text-os-text-muted font-mono">{c.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function HueShift() {
  const [hex, setHex] = useState('#4aa3ff');
  const [shift, setShift] = useState(180);
  const { r, g, b } = hexToRgb(hex);
  const hsv = rgbToHsv(r, g, b);
  const newH = (hsv.h + shift) % 360;
  const rgb2 = hslToRgb(newH, hsv.s, hsv.v);
  const result = rgbToHex(rgb2.r, rgb2.g, rgb2.b);

  return (
    <div className="tool-workspace">
      <ToolHeader title="Hue Shift" desc="Shift the hue angle of any color." />
      <input
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        className="os-input w-full mb-2 font-mono uppercase"
      />
      <input
        type="range"
        min="0"
        max="360"
        value={shift}
        onChange={(e) => setShift(Number(e.target.value))}
        className="w-full accent-cyan-400 mb-2"
      />
      <div className="flex justify-between text-[10px] text-os-text-muted mb-2">
        <span>Shift Angle</span>
        <span className="font-mono text-os-accent">{shift}°</span>
      </div>
      <div
        className="h-10 rounded border border-white/20 flex items-center justify-center font-mono text-xs font-bold"
        style={{
          background: result,
          color: getLuminance(rgb2.r, rgb2.g, rgb2.b) > 0.38 ? '#000' : '#fff',
        }}
      >
        {result.toUpperCase()}
      </div>
    </div>
  );
}

export function DarkenLighten() {
  const [hex, setHex] = useState('#4aa3ff');
  const [percent, setPercent] = useState(20);
  const { r, g, b } = hexToRgb(hex);
  const adjust = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v + (v / 255) * percent * 2.55)));
  const result = rgbToHex(adjust(r), adjust(g), adjust(b));

  return (
    <div className="tool-workspace">
      <ToolHeader title="Darken / Lighten" desc="Adjust lightness and brightness dynamically." />
      <input
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        className="os-input w-full mb-2 font-mono uppercase"
      />
      <input
        type="range"
        min="-100"
        max="100"
        value={percent}
        onChange={(e) => setPercent(Number(e.target.value))}
        className="w-full accent-cyan-400 mb-1"
      />
      <div className="flex justify-between text-[10px] text-os-text-muted mb-2">
        <span>Adjustment</span>
        <span className="font-mono text-os-accent">
          {percent > 0 ? `+${percent}%` : `${percent}%`}
        </span>
      </div>
      <div
        className="h-10 rounded border border-white/20 flex items-center justify-center font-mono text-xs font-bold"
        style={{ background: result }}
      >
        {result.toUpperCase()}
      </div>
    </div>
  );
}

export function RgbToHslTool() {
  const [r, setR] = useState(74);
  const [g, setG] = useState(163);
  const [b, setB] = useState(255);
  const { h, s, l } = rgbToHsl(r, g, b);

  return (
    <div className="tool-workspace">
      <ToolHeader title="RGB → HSL" desc="Convert RGB channel components to HSL color space." />
      <div className="grid grid-cols-3 gap-2 mb-2">
        <input
          type="number"
          min="0"
          max="255"
          value={r}
          onChange={(e) => setR(Number(e.target.value))}
          className="os-input text-center font-mono"
          placeholder="R"
        />
        <input
          type="number"
          min="0"
          max="255"
          value={g}
          onChange={(e) => setG(Number(e.target.value))}
          className="os-input text-center font-mono"
          placeholder="G"
        />
        <input
          type="number"
          min="0"
          max="255"
          value={b}
          onChange={(e) => setB(Number(e.target.value))}
          className="os-input text-center font-mono"
          placeholder="B"
        />
      </div>
      <div className="p-3 bg-black/25 rounded border border-white/10 space-y-1">
        <Out label="Hue" value={`${h}°`} />
        <Out label="Saturation" value={`${s}%`} />
        <Out label="Lightness" value={`${l}%`} />
        <Out
          label="CSS HSL"
          value={`hsl(${h}, ${s}%, ${l}%)`}
          onCopy={() => navigator.clipboard.writeText(`hsl(${h}, ${s}%, ${l}%)`)}
        />
      </div>
    </div>
  );
}

export function HslToRgbTool() {
  const [h, setH] = useState(210);
  const [s, setS] = useState(100);
  const [l, setL] = useState(65);
  const rgb = hslToRgb(h, s, l);
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

  return (
    <div className="tool-workspace">
      <ToolHeader title="HSL → RGB" desc="Convert HSL values to RGB and Hex." />
      <div className="grid grid-cols-3 gap-2 mb-2">
        <input
          type="number"
          min="0"
          max="360"
          value={h}
          onChange={(e) => setH(Number(e.target.value))}
          className="os-input text-center font-mono"
          placeholder="Hue"
        />
        <input
          type="number"
          min="0"
          max="100"
          value={s}
          onChange={(e) => setS(Number(e.target.value))}
          className="os-input text-center font-mono"
          placeholder="Sat %"
        />
        <input
          type="number"
          min="0"
          max="100"
          value={l}
          onChange={(e) => setL(Number(e.target.value))}
          className="os-input text-center font-mono"
          placeholder="Light %"
        />
      </div>
      <div className="p-3 bg-black/25 rounded border border-white/10 space-y-1">
        <Out label="Red (R)" value={rgb.r} />
        <Out label="Green (G)" value={rgb.g} />
        <Out label="Blue (B)" value={rgb.b} />
        <Out
          label="Hex"
          value={hex.toUpperCase()}
          onCopy={() => navigator.clipboard.writeText(hex.toUpperCase())}
        />
      </div>
      <div className="h-8 rounded border border-white/20 mt-2" style={{ background: hex }} />
    </div>
  );
}

export function ColorTemperature() {
  const [temp, setTemp] = useState(6500);
  function tempToRgb(kelvin: number) {
    const k = kelvin / 100;
    let r = 0,
      g = 0,
      b = 0;
    if (k <= 66) {
      r = 255;
      g = Math.max(0, Math.min(255, 99.4708025861 * Math.log(k) - 161.1195681661));
      b =
        k <= 19
          ? 0
          : Math.max(0, Math.min(255, 138.5177312231 * Math.log(k - 10) - 305.0447927307));
    } else {
      r = Math.max(0, Math.min(255, 329.698727446 * Math.pow(k - 60, -0.1332047592)));
      g = Math.max(0, Math.min(255, 288.1221695283 * Math.pow(k - 60, -0.0755148492)));
      b = 255;
    }
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  }
  const color = tempToRgb(temp);
  const hex = rgbToHex(color.r, color.g, color.b);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Color Temperature (Kelvin)"
        desc="Convert physical blackbody radiation temperature (K) to RGB color values."
      />
      <input
        type="range"
        min="1000"
        max="20000"
        step="100"
        value={temp}
        onChange={(e) => setTemp(Number(e.target.value))}
        className="w-full accent-cyan-400 mb-1"
      />
      <div className="flex justify-between text-[10px] text-os-text-muted mb-2">
        <span>Temperature</span>
        <span className="font-mono text-os-accent font-semibold">
          {temp}K (
          {temp <= 3000
            ? 'Warm Incandescent'
            : temp <= 5000
              ? 'Neutral Fluorescent'
              : temp <= 7000
                ? 'Daylight'
                : 'Cool Blue Sky'}
          )
        </span>
      </div>
      <div
        className="h-10 rounded border border-white/20 flex items-center justify-center font-mono text-xs font-bold"
        style={{ background: hex, color: color.r > 160 && color.g > 160 ? '#000' : '#fff' }}
      >
        {hex.toUpperCase()} • rgb({color.r}, {color.g}, {color.b})
      </div>
    </div>
  );
}

export function TintShade() {
  const [hex, setHex] = useState('#4aa3ff');
  const [steps, setSteps] = useState(6);
  const { r, g, b } = hexToRgb(hex);

  const tints = useMemo(
    () =>
      Array.from({ length: steps }, (_, i) => {
        const p = (i + 1) / (steps + 1);
        return rgbToHex(r + (255 - r) * p, g + (255 - g) * p, b + (255 - b) * p);
      }),
    [r, g, b, steps],
  );

  const shades = useMemo(
    () =>
      Array.from({ length: steps }, (_, i) => {
        const p = (i + 1) / (steps + 1);
        return rgbToHex(r * (1 - p), g * (1 - p), b * (1 - p));
      }),
    [r, g, b, steps],
  );

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Tints & Shades"
        desc="Generate systematic tints (mixed with white) and shades (mixed with black)."
      />
      <input
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        className="os-input w-full mb-3 font-mono uppercase"
      />

      <div className="space-y-3">
        <div>
          <div className="text-[10px] text-os-text-muted mb-1 font-mono">TINTS (+ White)</div>
          <div className="flex gap-1 h-8">
            {tints.map((c, i) => (
              <button
                key={i}
                onClick={() => navigator.clipboard.writeText(c.toUpperCase())}
                className="flex-1 rounded border border-white/15"
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] text-os-text-muted mb-1 font-mono">SHADES (+ Black)</div>
          <div className="flex gap-1 h-8">
            {shades.map((c, i) => (
              <button
                key={i}
                onClick={() => navigator.clipboard.writeText(c.toUpperCase())}
                className="flex-1 rounded border border-white/15"
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ColorBlindSimulator() {
  const [hex, setHex] = useState('#4aa3ff');
  const [type, setType] = useState<'protanopia' | 'deuteranopia' | 'tritanopia'>('protanopia');
  const { r, g, b } = hexToRgb(hex);

  function simulate(r: number, g: number, b: number, mode: string) {
    const matrices: Record<string, [number, number, number][]> = {
      protanopia: [
        [0.567, 0.433, 0],
        [0.558, 0.442, 0],
        [0, 0.242, 0.758],
      ],
      deuteranopia: [
        [0.625, 0.375, 0],
        [0.7, 0.3, 0],
        [0, 0.3, 0.7],
      ],
      tritanopia: [
        [0.95, 0.05, 0],
        [0, 0.433, 0.567],
        [0, 0.475, 0.525],
      ],
    };
    const m = matrices[mode] || matrices.protanopia;
    const nr = r * m[0][0] + g * m[0][1] + b * m[0][2];
    const ng = r * m[1][0] + g * m[1][1] + b * m[1][2];
    const nb = r * m[2][0] + g * m[2][1] + b * m[2][2];
    return rgbToHex(nr, ng, nb);
  }

  const simulated = simulate(r, g, b, type);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Color Blindness Simulator"
        desc="Simulate visual perception for Protanopia (red-blind), Deuteranopia (green-blind), and Tritanopia (blue-blind)."
      />
      <div className="flex gap-2 mb-3">
        <input
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          className="os-input flex-1 font-mono uppercase"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as any)}
          className="os-input flex-1"
        >
          <option value="protanopia">Protanopia (Red-Blind)</option>
          <option value="deuteranopia">Deuteranopia (Green-Blind)</option>
          <option value="tritanopia">Tritanopia (Blue-Blind)</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-black/25 rounded border border-white/10 text-center">
          <span className="text-[10px] text-os-text-muted block mb-1">Standard Vision</span>
          <div className="h-12 rounded border border-white/20" style={{ background: hex }} />
          <span className="text-[10px] font-mono mt-1 block">{hex.toUpperCase()}</span>
        </div>

        <div className="p-3 bg-black/25 rounded border border-white/10 text-center">
          <span className="text-[10px] text-os-text-muted block mb-1">Simulated Vision</span>
          <div className="h-12 rounded border border-white/20" style={{ background: simulated }} />
          <span className="text-[10px] font-mono mt-1 block">{simulated.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
}

export function HexToRgbTool() {
  const [input, setInput] = useState('#4AA3FF');
  const { r, g, b } = hexToRgb(input);
  return (
    <div className="tool-workspace">
      <ToolHeader title="Hex → RGB" desc="Convert hexadecimal color codes to RGB components." />
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="#RRGGBB"
        className="os-input w-full mb-2 font-mono uppercase"
      />
      <div className="p-3 bg-black/25 rounded border border-white/10 space-y-1">
        <Out label="Red (R)" value={r} />
        <Out label="Green (G)" value={g} />
        <Out label="Blue (B)" value={b} />
        <Out
          label="CSS RGB"
          value={`rgb(${r}, ${g}, ${b})`}
          onCopy={() => navigator.clipboard.writeText(`rgb(${r}, ${g}, ${b})`)}
        />
      </div>
      <div className="mt-2 h-8 rounded border border-white/20" style={{ background: input }} />
    </div>
  );
}

export function PaletteGenerator() {
  const [base, setBase] = useState('#4aa3ff');
  const [palette, setPalette] = useState<string[]>([]);
  const generate = useCallback(() => {
    const { r, g, b } = hexToRgb(base);
    const hsl = rgbToHsl(r, g, b);
    const out: string[] = [];
    for (let i = 0; i < 5; i++) {
      const h = (hsl.h + i * 36) % 360;
      const s = Math.min(100, Math.max(30, hsl.s + (i - 2) * 10));
      const l = Math.min(90, Math.max(20, hsl.l + (i - 2) * 12));
      out.push(hslToHex(h, s, l));
    }
    setPalette(out);
  }, [base]);

  useEffect(() => {
    generate();
  }, [generate]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Palette Generator"
        desc="Generate cohesive, harmonious 5-color palettes from any base seed color."
      />
      <div className="flex gap-2 mb-3">
        <input
          type="color"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          className="w-10 h-8 rounded border border-white/20 bg-transparent cursor-pointer"
        />
        <input
          value={base}
          onChange={(e) => setBase(e.target.value)}
          className="os-input flex-1 font-mono uppercase"
        />
        <button onClick={generate} className="os-btn os-btn-primary flex items-center gap-1">
          <RefreshCw size={11} /> Roll
        </button>
      </div>
      <div className="grid grid-cols-5 gap-1.5 h-20">
        {palette.map((c, i) => (
          <button
            key={i}
            onClick={() => navigator.clipboard.writeText(c.toUpperCase())}
            className="rounded border border-white/15 flex flex-col justify-end p-1 hover:scale-105 transition-transform"
            style={{ background: c }}
          >
            <span className="text-[8px] font-mono font-bold bg-black/40 px-1 rounded text-white truncate">
              {c.toUpperCase()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function RgbToHexTool() {
  const [r, setR] = useState(74);
  const [g, setG] = useState(163);
  const [b, setB] = useState(255);
  const hex = rgbToHex(r, g, b).toUpperCase();
  return (
    <div className="tool-workspace">
      <ToolHeader title="RGB → Hex" desc="Convert RGB channel integers into hexadecimal format." />
      <div className="grid grid-cols-3 gap-2 mb-2">
        <input
          type="number"
          min="0"
          max="255"
          value={r}
          onChange={(e) => setR(Number(e.target.value))}
          className="os-input text-center font-mono"
          placeholder="R"
        />
        <input
          type="number"
          min="0"
          max="255"
          value={g}
          onChange={(e) => setG(Number(e.target.value))}
          className="os-input text-center font-mono"
          placeholder="G"
        />
        <input
          type="number"
          min="0"
          max="255"
          value={b}
          onChange={(e) => setB(Number(e.target.value))}
          className="os-input text-center font-mono"
          placeholder="B"
        />
      </div>
      <input
        readOnly
        value={hex}
        className="os-input w-full font-mono text-center text-xl cursor-pointer"
        onClick={() => navigator.clipboard.writeText(hex)}
      />
      <div className="mt-2 h-8 rounded border border-white/20" style={{ background: hex }} />
    </div>
  );
}

export const COLOR_TOOLS = {
  ColorPicker,
  PaletteGenerator,
  ColorMixer,
  GradientGenerator,
  ContrastChecker,
  MaterialColors,
  TailwindColors,
  GoldenRatioPalette,
  HueShift,
  DarkenLighten,
  RgbToHslTool,
  HslToRgbTool,
  ColorTemperature,
  TintShade,
  ColorBlindSimulator,
  HexToRgbTool,
  RgbToHexTool,
};
