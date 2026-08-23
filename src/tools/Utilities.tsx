import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Download,
  Copy,
  Upload,
  AlertCircle,
  Link,
  Type,
  Wifi,
  User,
  Mail,
  MessageSquare,
  Coins,
  FileCode,
  Printer,
  Scan,
  Globe,
  RotateCcw,
} from 'lucide-react';
import QRCode from 'qrcode';

type QrType = 'url' | 'text' | 'wifi' | 'vcard' | 'email' | 'sms' | 'crypto';
type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';
type CenterIcon =
  'none' | 'spark' | 'link' | 'wifi' | 'user' | 'lock' | 'star' | 'heart' | 'crypto';

interface ColorPreset {
  name: string;
  fg: string;
  bg: string;
}

const COLOR_PRESETS: ColorPreset[] = [
  { name: 'Monochrome', fg: '#000000', bg: '#ffffff' },
  { name: 'OLED Inverted', fg: '#ffffff', bg: '#000000' },
  { name: 'Electric Blue', fg: '#4aa3ff', bg: '#05080d' },
  { name: 'Emerald', fg: '#2ee6a6', bg: '#04100c' },
  { name: 'Amber Glow', fg: '#f59e0b', bg: '#120902' },
  { name: 'Rose', fg: '#f43f5e', bg: '#130408' },
  { name: 'Ultra Violet', fg: '#a855f7', bg: '#0d0417' },
  { name: 'Oceanic', fg: '#38bdf8', bg: '#081726' },
];

export function QrGen() {
  const [activeNav, setActiveNav] = useState<QrType | 'scan'>('url');

  // Input states with rich demo data
  const [urlInput, setUrlInput] = useState('https://nammu.os');
  const [textInput, setTextInput] = useState('Nammu OS - Next Gen Web Operating System');

  // WiFi Demo
  const [wifiSsid, setWifiSsid] = useState('Nammu-Network');
  const [wifiPassword, setWifiPassword] = useState('nammu@2026');
  const [wifiType, setWifiType] = useState<'WPA' | 'WEP' | 'nopass'>('WPA');
  const [wifiHidden, setWifiHidden] = useState(false);

  // vCard Demo
  const [vcardFirst, setVcardFirst] = useState('Nammu');
  const [vcardLast, setVcardLast] = useState('OS');
  const [vcardOrg, setVcardOrg] = useState('Nammu Systems');
  const [vcardPhone, setVcardPhone] = useState('+1 555 019 2831');
  const [vcardEmail, setVcardEmail] = useState('contact@nammu.os');
  const [vcardUrl, setVcardUrl] = useState('https://nammu.os');

  // Email Demo
  const [emailTo, setEmailTo] = useState('support@nammu.os');
  const [emailSubject, setEmailSubject] = useState('Hello from Nammu OS');
  const [emailBody, setEmailBody] = useState('I am enjoying the new Nammu OS experience.');

  // SMS Demo
  const [smsPhone, setSmsPhone] = useState('+1 555 019 2831');
  const [smsMessage, setSmsMessage] = useState('Hello from Nammu OS!');

  // Crypto Demo
  const [cryptoCoin, setCryptoCoin] = useState<'bitcoin' | 'ethereum' | 'solana'>('bitcoin');
  const [cryptoAddress, setCryptoAddress] = useState('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  const [cryptoAmount, setCryptoAmount] = useState('0.05');

  // Default colors
  const [fg, setFg] = useState('#000000');
  const [bg, setBg] = useState('#ffffff');

  // Custom Resolution Width & Height
  const [customWidth, setCustomWidth] = useState(512);
  const [customHeight, setCustomHeight] = useState(512);
  const [lockAspect, setLockAspect] = useState(true);

  const [margin, setMargin] = useState(2);
  const [ecLevel, setEcLevel] = useState<ErrorCorrectionLevel>('H');
  const [centerIcon, setCenterIcon] = useState<CenterIcon>('none');

  // Feedback states
  const [error, setError] = useState('');
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [svgString, setSvgString] = useState<string>('');
  const [scanResult, setScanResult] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Compute raw payload
  const getPayload = useCallback((): string => {
    if (activeNav === 'scan') return '';
    switch (activeNav) {
      case 'url': {
        const trimmed = urlInput.trim();
        if (!trimmed) return '';
        if (!/^https?:\/\//i.test(trimmed) && !trimmed.includes('://')) {
          return `https://${trimmed}`;
        }
        return trimmed;
      }
      case 'text':
        return textInput;
      case 'wifi': {
        if (!wifiSsid.trim()) return '';
        const t = wifiType === 'nopass' ? 'nopass' : wifiType;
        const p = wifiType === 'nopass' ? '' : wifiPassword;
        const h = wifiHidden ? 'H:true;' : '';
        return `WIFI:S:${wifiSsid.trim()};T:${t};P:${p};${h};`;
      }
      case 'vcard': {
        if (!vcardFirst && !vcardLast && !vcardPhone && !vcardEmail) return '';
        return [
          'BEGIN:VCARD',
          'VERSION:3.0',
          `N:${vcardLast};${vcardFirst};;;`,
          `FN:${vcardFirst} ${vcardLast}`.trim(),
          vcardOrg ? `ORG:${vcardOrg}` : '',
          vcardPhone ? `TEL;TYPE=CELL:${vcardPhone}` : '',
          vcardEmail ? `EMAIL:${vcardEmail}` : '',
          vcardUrl ? `URL:${vcardUrl}` : '',
          'END:VCARD',
        ]
          .filter(Boolean)
          .join('\n');
      }
      case 'email': {
        if (!emailTo.trim()) return '';
        const params = new URLSearchParams();
        if (emailSubject) params.set('subject', emailSubject);
        if (emailBody) params.set('body', emailBody);
        const q = params.toString();
        return `mailto:${emailTo.trim()}${q ? `?${q}` : ''}`;
      }
      case 'sms': {
        if (!smsPhone.trim()) return '';
        return `sms:${smsPhone.trim()}${smsMessage ? `?body=${encodeURIComponent(smsMessage)}` : ''}`;
      }
      case 'crypto': {
        if (!cryptoAddress.trim()) return '';
        const scheme =
          cryptoCoin === 'bitcoin' ? 'bitcoin' : cryptoCoin === 'ethereum' ? 'ethereum' : 'solana';
        let payload = `${scheme}:${cryptoAddress.trim()}`;
        if (cryptoAmount.trim()) {
          payload += `?amount=${encodeURIComponent(cryptoAmount.trim())}`;
        }
        return payload;
      }
      default:
        return '';
    }
  }, [
    activeNav,
    urlInput,
    textInput,
    wifiSsid,
    wifiPassword,
    wifiType,
    wifiHidden,
    vcardFirst,
    vcardLast,
    vcardOrg,
    vcardPhone,
    vcardEmail,
    vcardUrl,
    emailTo,
    emailSubject,
    emailBody,
    smsPhone,
    smsMessage,
    cryptoCoin,
    cryptoAddress,
    cryptoAmount,
  ]);

  const payload = getPayload();
  const byteCount = new Blob([payload]).size;
  const densityPercent = Math.min(100, Math.round((byteCount / 500) * 100));

  // Reset form to defaults with demo data
  const resetForm = () => {
    setUrlInput('https://nammu.os');
    setTextInput('Nammu OS - Next Gen Web Operating System');
    setWifiSsid('Nammu-Network');
    setWifiPassword('nammu@2026');
    setWifiType('WPA');
    setWifiHidden(false);
    setVcardFirst('Nammu');
    setVcardLast('OS');
    setVcardOrg('Nammu Systems');
    setVcardPhone('+1 555 019 2831');
    setVcardEmail('contact@nammu.os');
    setVcardUrl('https://nammu.os');
    setEmailTo('support@nammu.os');
    setEmailSubject('Hello from Nammu OS');
    setEmailBody('I am enjoying the new Nammu OS experience.');
    setSmsPhone('+1 555 019 2831');
    setSmsMessage('Hello from Nammu OS!');
    setCryptoCoin('bitcoin');
    setCryptoAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    setCryptoAmount('0.05');
    setFg('#000000');
    setBg('#ffffff');
    setCenterIcon('none');
    setCustomWidth(512);
    setCustomHeight(512);
  };

  // Draw Center Icon on Canvas
  const drawCenterBadge = useCallback(
    (ctx: CanvasRenderingContext2D, canvasWidth: number, iconType: CenterIcon) => {
      if (iconType === 'none') return;

      const badgeSize = Math.round(canvasWidth * 0.22);
      const center = canvasWidth / 2;
      const half = badgeSize / 2;

      ctx.save();
      ctx.fillStyle = bg;
      ctx.fillRect(center - half, center - half, badgeSize, badgeSize);

      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(1.5, canvasWidth * 0.006);
      ctx.strokeRect(center - half, center - half, badgeSize, badgeSize);

      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontSize = Math.round(badgeSize * 0.52);
      ctx.font = `bold ${fontSize}px "Outfit", "Segoe UI Symbol", sans-serif`;

      let glyph = '✦';
      if (iconType === 'spark') glyph = '✦';
      else if (iconType === 'link') glyph = '🔗';
      else if (iconType === 'wifi') glyph = '📶';
      else if (iconType === 'user') glyph = '👤';
      else if (iconType === 'lock') glyph = '🔒';
      else if (iconType === 'star') glyph = '★';
      else if (iconType === 'heart') glyph = '♥';
      else if (iconType === 'crypto') glyph = '₿';

      ctx.fillText(glyph, center, center + Math.round(fontSize * 0.05));
      ctx.restore();
    },
    [bg, fg],
  );

  // Generate QR Code on Canvas & SVG
  const generateQRCode = useCallback(async () => {
    if (!payload || activeNav === 'scan') {
      setError('');
      setSvgString('');
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    try {
      setError('');
      const canvas = canvasRef.current;
      if (canvas) {
        await QRCode.toCanvas(canvas, payload, {
          width: 440,
          margin: margin,
          errorCorrectionLevel: ecLevel,
          color: { dark: fg, light: bg },
        });

        const ctx = canvas.getContext('2d');
        if (ctx && centerIcon !== 'none') {
          drawCenterBadge(ctx, 440, centerIcon);
        }
      }

      // Generate pristine vector SVG
      const rawSvg = await QRCode.toString(payload, {
        type: 'svg',
        margin: margin,
        errorCorrectionLevel: ecLevel,
        color: { dark: fg, light: bg },
      });

      setSvgString(rawSvg);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate QR code');
    }
  }, [payload, activeNav, margin, ecLevel, fg, bg, centerIcon, drawCenterBadge]);

  useEffect(() => {
    generateQRCode();
  }, [generateQRCode]);

  // Download SVG
  const handleDownloadSvg = useCallback(() => {
    if (!svgString) return;
    let finalSvg = svgString;

    if (centerIcon !== 'none') {
      const glyphMap: Record<CenterIcon, string> = {
        none: '',
        spark: '✦',
        link: '🔗',
        wifi: '📶',
        user: '👤',
        lock: '🔒',
        star: '★',
        heart: '♥',
        crypto: '₿',
      };
      const glyph = glyphMap[centerIcon] || '✦';

      const centerInjection = `
        <rect x="39%" y="39%" width="22%" height="22%" fill="${bg}" stroke="${fg}" stroke-width="0.8" />
        <text x="50%" y="52%" font-family="sans-serif" font-size="3.5" font-weight="bold" fill="${fg}" text-anchor="middle" dominant-baseline="middle">${glyph}</text>
      `;
      finalSvg = finalSvg.replace('</svg>', `${centerInjection}</svg>`);
    }

    const blob = new Blob([finalSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qrcode_${activeNav}_${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    setCopiedType('download_svg');
    setTimeout(() => setCopiedType(null), 2000);
  }, [svgString, centerIcon, bg, fg, activeNav]);

  // Download PNG with Custom Width & Height
  const handleDownloadPng = useCallback(async () => {
    if (!payload) return;
    try {
      const offscreen = document.createElement('canvas');
      const renderDim = Math.max(customWidth, customHeight);
      await QRCode.toCanvas(offscreen, payload, {
        width: renderDim,
        margin: margin,
        errorCorrectionLevel: ecLevel,
        color: { dark: fg, light: bg },
      });

      const ctx = offscreen.getContext('2d');
      if (ctx && centerIcon !== 'none') {
        drawCenterBadge(ctx, renderDim, centerIcon);
      }

      let finalCanvas = offscreen;
      if (customWidth !== customHeight) {
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = customWidth;
        scaledCanvas.height = customHeight;
        const sCtx = scaledCanvas.getContext('2d');
        if (sCtx) {
          sCtx.drawImage(offscreen, 0, 0, customWidth, customHeight);
          finalCanvas = scaledCanvas;
        }
      }

      const url = finalCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `qrcode_${activeNav}_${customWidth}x${customHeight}_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setCopiedType('download_png');
      setTimeout(() => setCopiedType(null), 2000);
    } catch (err: any) {
      setError(err?.message || 'Failed to download PNG');
    }
  }, [
    payload,
    customWidth,
    customHeight,
    margin,
    ecLevel,
    fg,
    bg,
    centerIcon,
    drawCenterBadge,
    activeNav,
  ]);

  // Copy SVG Code
  const handleCopySvgCode = useCallback(() => {
    if (!svgString) return;
    navigator.clipboard.writeText(svgString).then(() => {
      setCopiedType('svg_code');
      setTimeout(() => setCopiedType(null), 2000);
    });
  }, [svgString]);

  // Print QR Layout
  const handlePrint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Nammu OS - QR Print Badge</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 90vh; margin: 0; background: #fff; }
            .card { border: 2px dashed #94a3b8; padding: 28px; text-align: center; }
            img { width: 280px; height: 280px; }
            .title { font-size: 14px; font-weight: 600; margin-top: 14px; color: #0f172a; }
            .meta { margin-top: 6px; font-size: 11px; color: #64748b; font-family: monospace; max-width: 320px; word-break: break-all; }
          </style>
        </head>
        <body>
          <div class="card">
            <img src="${dataUrl}" />
            <div class="title">Nammu OS · QR Badge</div>
            <div class="meta">${payload}</div>
          </div>
          <script>window.onload = () => { window.print(); window.close(); }</script>
        </body>
      </html>
    `);
    win.document.close();
  }, [payload]);

  // File upload for scanner
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanResult(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        setScanResult(
          `Image loaded: ${img.width}x${img.height}px (${file.name}). Matrix inspection ready.`,
        );
      };
      img.src = evt.target?.result as string;
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = '';
  };

  const navItems = [
    { id: 'url', label: 'URL / Web', icon: Link },
    { id: 'text', label: 'Plain Text', icon: Type },
    { id: 'wifi', label: 'Wi-Fi Network', icon: Wifi },
    { id: 'vcard', label: 'Contact vCard', icon: User },
    { id: 'email', label: 'Email / Mailto', icon: Mail },
    { id: 'sms', label: 'SMS Message', icon: MessageSquare },
    { id: 'crypto', label: 'Crypto Pay', icon: Coins },
    { id: 'scan', label: 'Image Scan', icon: Scan },
  ];

  return (
    <div className="flex h-full w-full min-h-0 bg-[#05080d] text-[11px] text-[#c9d7e2] select-none font-sans overflow-hidden">
      {/* 1. Left Sidebar: Clean navigation with density gauge at bottom */}
      <aside className="w-36 shrink-0 border-r border-white/[0.06] bg-white/[0.012] p-2 flex flex-col justify-between">
        <nav className="space-y-0.5" aria-label="QR Studio Types">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id as any)}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] transition-colors ${
                  isActive
                    ? 'bg-[#4aa3ff]/10 text-[#cfe6ff] font-medium'
                    : 'text-[#71889d] hover:bg-white/[0.035] hover:text-[#bcd0df]'
                }`}
              >
                <Icon size={12} className={isActive ? 'text-[#4aa3ff]' : 'text-[#61788c]'} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Density Gauge Widget */}
        <div className="mt-4 border-t border-white/[0.05] pt-3">
          <div className="mb-1 flex justify-between px-2 font-mono text-[8px] text-[#476077]">
            <span>DENSITY</span>
            <span className="text-[#89a6be]">{densityPercent}%</span>
          </div>
          <div className="mx-2 h-px bg-white/[0.06]">
            <span
              className="block h-full bg-[#4aa3ff] transition-all duration-300"
              style={{ width: `${densityPercent}%` }}
            />
          </div>
          <div className="mt-1 px-2 font-mono text-[7.5px] text-[#455c6e]">
            {byteCount} bytes · EC: {ecLevel}
          </div>
        </div>
      </aside>

      {/* 2. Main Workspace Layout */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Center Main Section & Right Sidebar Split */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {activeNav !== 'scan' ? (
            <>
              {/* Unified Main Section: 2 Columns side-by-side (Controls on Left, Big QR on Right) */}
              <div className="flex min-w-0 flex-1 overflow-hidden p-3.5 gap-4">
                {/* Left Side: All Controls (Inputs, Palette, Shield Emblem, Error Correction, Margin) */}
                <div className="w-[360px] lg:w-[390px] shrink-0 overflow-auto os-scrollbar space-y-4 pr-1">
                  {/* Active Dynamic Input Fields */}
                  <div className="space-y-2">
                    {activeNav === 'url' && (
                      <div className="space-y-1">
                        <div className="flex items-center border border-white/[0.08] bg-black/40 px-2.5 py-1.5 focus-within:border-[#4aa3ff]/50 transition-colors">
                          <Globe size={11} className="mr-2 text-[#4aa3ff] shrink-0" />
                          <input
                            type="text"
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            placeholder="Target URL..."
                            className="min-w-0 flex-1 bg-transparent text-[11px] text-[#e0ecf7] outline-none placeholder:text-[#3d5568]"
                          />
                        </div>
                      </div>
                    )}

                    {activeNav === 'text' && (
                      <div className="space-y-1">
                        <textarea
                          rows={4}
                          value={textInput}
                          onChange={(e) => setTextInput(e.target.value)}
                          placeholder="Enter text, notes, code, or payload data..."
                          className="w-full border border-white/[0.08] bg-black/40 p-2 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50 placeholder:text-[#3d5568] os-scrollbar resize-none"
                        />
                      </div>
                    )}

                    {activeNav === 'wifi' && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={wifiSsid}
                            onChange={(e) => setWifiSsid(e.target.value)}
                            placeholder="Network SSID *"
                            className="w-full border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                          />
                          {wifiType !== 'nopass' && (
                            <input
                              type="text"
                              value={wifiPassword}
                              onChange={(e) => setWifiPassword(e.target.value)}
                              placeholder="Password *"
                              className="w-full border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                            />
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <div className="flex gap-1">
                            {(['WPA', 'WEP', 'nopass'] as const).map((t) => (
                              <button
                                key={t}
                                onClick={() => setWifiType(t)}
                                className={`border px-2 py-0.5 font-mono text-[8px] uppercase transition-colors ${
                                  wifiType === t
                                    ? 'border-[#4aa3ff]/50 bg-[#4aa3ff]/15 text-[#97ccfc]'
                                    : 'border-white/[0.06] text-[#5d778d] hover:bg-white/[0.03]'
                                }`}
                              >
                                {t === 'nopass' ? 'Open' : t}
                              </button>
                            ))}
                          </div>
                          <label className="flex items-center gap-1.5 font-mono text-[8px] text-[#69849b] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={wifiHidden}
                              onChange={(e) => setWifiHidden(e.target.checked)}
                              className="accent-[#4aa3ff]"
                            />
                            <span>Hidden Network</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {activeNav === 'vcard' && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={vcardFirst}
                            onChange={(e) => setVcardFirst(e.target.value)}
                            placeholder="First Name *"
                            className="border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                          />
                          <input
                            type="text"
                            value={vcardLast}
                            onChange={(e) => setVcardLast(e.target.value)}
                            placeholder="Last Name"
                            className="border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="tel"
                            value={vcardPhone}
                            onChange={(e) => setVcardPhone(e.target.value)}
                            placeholder="Phone Number"
                            className="border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                          />
                          <input
                            type="email"
                            value={vcardEmail}
                            onChange={(e) => setVcardEmail(e.target.value)}
                            placeholder="Email Address"
                            className="border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                          />
                        </div>
                        <input
                          type="text"
                          value={vcardOrg}
                          onChange={(e) => setVcardOrg(e.target.value)}
                          placeholder="Company / Organization"
                          className="w-full border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                        />
                      </div>
                    )}

                    {activeNav === 'email' && (
                      <div className="space-y-2">
                        <input
                          type="email"
                          value={emailTo}
                          onChange={(e) => setEmailTo(e.target.value)}
                          placeholder="Recipient Email *"
                          className="w-full border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                        />
                        <input
                          type="text"
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                          placeholder="Subject Line"
                          className="w-full border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                        />
                        <textarea
                          rows={2}
                          value={emailBody}
                          onChange={(e) => setEmailBody(e.target.value)}
                          placeholder="Pre-filled email body..."
                          className="w-full border border-white/[0.08] bg-black/40 p-2 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50 os-scrollbar resize-none"
                        />
                      </div>
                    )}

                    {activeNav === 'sms' && (
                      <div className="space-y-2">
                        <input
                          type="tel"
                          value={smsPhone}
                          onChange={(e) => setSmsPhone(e.target.value)}
                          placeholder="Phone Number *"
                          className="w-full border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                        />
                        <textarea
                          rows={2}
                          value={smsMessage}
                          onChange={(e) => setSmsMessage(e.target.value)}
                          placeholder="Pre-filled SMS text..."
                          className="w-full border border-white/[0.08] bg-black/40 p-2 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50 os-scrollbar resize-none"
                        />
                      </div>
                    )}

                    {activeNav === 'crypto' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[8px] text-[#557087]">
                            COIN / NETWORK
                          </span>
                          <div className="flex gap-1">
                            {(['bitcoin', 'ethereum', 'solana'] as const).map((coin) => (
                              <button
                                key={coin}
                                onClick={() => setCryptoCoin(coin)}
                                className={`border px-1.5 py-0.5 font-mono text-[8px] uppercase transition-colors ${
                                  cryptoCoin === coin
                                    ? 'border-[#4aa3ff]/50 bg-[#4aa3ff]/15 text-[#97ccfc]'
                                    : 'border-white/[0.06] text-[#5d778d]'
                                }`}
                              >
                                {coin.slice(0, 3)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <input
                          type="text"
                          value={cryptoAddress}
                          onChange={(e) => setCryptoAddress(e.target.value)}
                          placeholder={`${cryptoCoin.toUpperCase()} Address *`}
                          className="w-full border border-white/[0.08] bg-black/40 px-2 py-1.5 font-mono text-[10px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                        />
                        <input
                          type="text"
                          value={cryptoAmount}
                          onChange={(e) => setCryptoAmount(e.target.value)}
                          placeholder="Requested Amount"
                          className="w-full border border-white/[0.08] bg-black/40 px-2 py-1.5 font-mono text-[10px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                        />
                      </div>
                    )}
                  </div>

                  <div className="h-px bg-white/[0.04]" />

                  {/* Color Palette Presets */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.16em] text-[#557087]">
                      <span>Color Palette</span>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                      {COLOR_PRESETS.map((p) => {
                        const isSelected = fg === p.fg && bg === p.bg;
                        return (
                          <button
                            key={p.name}
                            onClick={() => {
                              setFg(p.fg);
                              setBg(p.bg);
                            }}
                            className={`flex items-center gap-1.5 border p-1.5 text-left transition-all ${
                              isSelected
                                ? 'border-[#4aa3ff] bg-[#4aa3ff]/10'
                                : 'border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.035]'
                            }`}
                          >
                            <div
                              className="h-3 w-3 border border-white/20 shrink-0"
                              style={{ backgroundColor: p.fg }}
                            />
                            <span className="truncate font-mono text-[8px] text-[#90a8bd]">
                              {p.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Manual Color Pickers */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="flex items-center justify-between border border-white/[0.06] bg-black/30 px-2 py-1">
                        <span className="font-mono text-[8px] text-[#6e889d]">FG: {fg}</span>
                        <input
                          type="color"
                          value={fg}
                          onChange={(e) => setFg(e.target.value)}
                          className="h-4 w-4 cursor-pointer border border-white/20 bg-transparent"
                        />
                      </div>
                      <div className="flex items-center justify-between border border-white/[0.06] bg-black/30 px-2 py-1">
                        <span className="font-mono text-[8px] text-[#6e889d]">BG: {bg}</span>
                        <input
                          type="color"
                          value={bg}
                          onChange={(e) => setBg(e.target.value)}
                          className="h-4 w-4 cursor-pointer border border-white/20 bg-transparent"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="h-px bg-white/[0.04]" />

                  {/* Shield Emblem & Error Correction & Margin */}
                  <div className="space-y-3">
                    {/* Center Shield Emblem */}
                    <div>
                      <div className="flex items-center justify-between mb-1 font-mono text-[8px] uppercase tracking-wider text-[#557087]">
                        <span>Center Shield Emblem</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {[
                          { id: 'none', label: 'None' },
                          { id: 'spark', label: '✦' },
                          { id: 'link', label: '🔗' },
                          { id: 'wifi', label: '📶' },
                          { id: 'user', label: '👤' },
                          { id: 'lock', label: '🔒' },
                          { id: 'star', label: '★' },
                          { id: 'heart', label: '♥' },
                          { id: 'crypto', label: '₿' },
                        ].map((ic) => (
                          <button
                            key={ic.id}
                            onClick={() => {
                              setCenterIcon(ic.id as CenterIcon);
                              if (ic.id !== 'none' && ecLevel !== 'H') setEcLevel('H');
                            }}
                            className={`border py-1 text-[9px] transition-colors ${
                              centerIcon === ic.id
                                ? 'border-[#4aa3ff]/60 bg-[#4aa3ff]/20 text-[#a0d2ff] font-bold'
                                : 'border-white/[0.06] text-[#698295] hover:bg-white/[0.03]'
                            }`}
                          >
                            {ic.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Error Correction Level */}
                    <div>
                      <div className="flex items-center justify-between mb-1 font-mono text-[8px] uppercase tracking-wider text-[#557087]">
                        <span>Error Correction Level</span>
                        <span className="text-[#4aa3ff]">{ecLevel}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {(['L', 'M', 'Q', 'H'] as const).map((lvl) => (
                          <button
                            key={lvl}
                            onClick={() => setEcLevel(lvl)}
                            className={`border py-1 font-mono text-[8.5px] uppercase transition-colors ${
                              ecLevel === lvl
                                ? 'border-[#4aa3ff]/60 bg-[#4aa3ff]/20 text-[#a0d2ff] font-bold'
                                : 'border-white/[0.06] text-[#5e788d] hover:bg-white/[0.03]'
                            }`}
                          >
                            {lvl} (
                            {lvl === 'L' ? '7%' : lvl === 'M' ? '15%' : lvl === 'Q' ? '25%' : '30%'}
                            )
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Quiet Zone Margin */}
                    <div className="space-y-1">
                      <div className="flex justify-between font-mono text-[8px] text-[#557087]">
                        <span>QUIET ZONE MARGIN</span>
                        <span>{margin} modules</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="6"
                        step="1"
                        value={margin}
                        onChange={(e) => setMargin(Number(e.target.value))}
                        className="w-full accent-[#4aa3ff]"
                      />
                    </div>
                    <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#476077]">
                      Resolution
                    </div>

                    {/* Custom Width & Height Resolution Controls */}
                    <div className="space-y-1.5">
                      <div className="flex items-center border border-white/[0.08] bg-black/40 px-2 py-1">
                        <span className="font-mono text-[8px] text-[#4d667b] mr-1.5">WIDTH:</span>
                        <input
                          type="number"
                          min="64"
                          max="4096"
                          step="32"
                          value={customWidth}
                          onChange={(e) => {
                            const val = Math.max(32, Math.min(4096, Number(e.target.value) || 256));
                            setCustomWidth(val);
                            if (lockAspect) setCustomHeight(val);
                          }}
                          className="w-full bg-transparent font-mono text-[9px] text-[#e0ecf7] outline-none"
                        />
                        <span className="font-mono text-[8px] text-[#4d667b]">px</span>
                      </div>

                      <div className="flex items-center border border-white/[0.08] bg-black/40 px-2 py-1">
                        <span className="font-mono text-[8px] text-[#4d667b] mr-1.5">HEIGHT:</span>
                        <input
                          type="number"
                          min="64"
                          max="4096"
                          step="32"
                          value={customHeight}
                          onChange={(e) => {
                            const val = Math.max(32, Math.min(4096, Number(e.target.value) || 256));
                            setCustomHeight(val);
                            if (lockAspect) setCustomWidth(val);
                          }}
                          className="w-full bg-transparent font-mono text-[9px] text-[#e0ecf7] outline-none"
                        />
                        <span className="font-mono text-[8px] text-[#4d667b]">px</span>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <label className="flex items-center gap-1.5 font-mono text-[8px] text-[#69849b] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={lockAspect}
                            onChange={(e) => setLockAspect(e.target.checked)}
                            className="accent-[#4aa3ff]"
                          />
                          <span>1:1 Square Ratio</span>
                        </label>
                      </div>
                    </div>

                    {/* Preset resolution buttons */}
                    <div className="grid grid-cols-3 gap-1 pt-1">
                      {[256, 512, 1024].map((r) => (
                        <button
                          key={r}
                          onClick={() => {
                            setCustomWidth(r);
                            setCustomHeight(r);
                          }}
                          className={`border py-1 font-mono text-[8px] transition-colors ${
                            customWidth === r && customHeight === r
                              ? 'border-[#4aa3ff]/50 bg-[#4aa3ff]/15 text-[#a0d2ff]'
                              : 'border-white/[0.05] text-[#5e798e] hover:bg-white/[0.03]'
                          }`}
                        >
                          {r}px
                        </button>
                      ))}
                    </div>

                    <div className="space-y-1.5 pt-3 border-t border-white/[0.05]">
                      <button
                        onClick={resetForm}
                        className="flex w-full items-center justify-center gap-1.5 border border-white/[0.08] bg-white/[0.03] py-2 font-mono text-[9px] uppercase tracking-wider text-[#cfe6ff] hover:bg-white/[0.06] hover:text-white transition-colors disabled:opacity-40"
                      >
                        <RotateCcw size={10} />
                        <span>Reset</span>
                      </button>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={handleDownloadSvg}
                          disabled={!payload}
                          className="flex w-full items-center justify-center gap-1.5 border border-white/[0.08] bg-white/[0.03] py-2 font-mono text-[9px] uppercase tracking-wider text-[#cfe6ff] hover:bg-white/[0.06] hover:text-white transition-colors disabled:opacity-40"
                        >
                          <FileCode size={11} className="text-[#4aa3ff]" />
                          <span>Download SVG</span>
                        </button>

                        <button
                          onClick={handleDownloadPng}
                          disabled={!payload}
                          className="flex w-full items-center justify-center gap-1.5 border border-white/[0.08] bg-white/[0.03] py-2 font-mono text-[9px] uppercase tracking-wider text-[#cfe6ff] hover:bg-white/[0.06] hover:text-white transition-colors disabled:opacity-40"
                        >
                          <Download size={11} className="text-[#2ee6a6]" />
                          <span>Download PNG</span>
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={handleCopySvgCode}
                          disabled={!svgString}
                          className="flex w-full items-center justify-center gap-1.5 border border-white/[0.08] bg-white/[0.03] py-2 font-mono text-[9px] uppercase tracking-wider text-[#cfe6ff] hover:bg-white/[0.06] hover:text-white transition-colors disabled:opacity-40"
                        >
                          <Copy size={10} />
                          <span>{copiedType === 'svg_code' ? 'Copied SVG!' : 'Copy SVG'}</span>
                        </button>

                        <button
                          onClick={handlePrint}
                          disabled={!payload}
                          className="flex w-full items-center justify-center gap-1.5 border border-white/[0.08] bg-white/[0.03] py-2 font-mono text-[9px] uppercase tracking-wider text-[#cfe6ff] hover:bg-white/[0.06] hover:text-white transition-colors disabled:opacity-40"
                        >
                          <Printer size={10} />
                          <span>Print Badge</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Side: Big Centered QR Canvas Preview directly beside all controls */}
                <div className="min-w-0 flex-1 flex flex-col items-center justify-center p-4 border border-white/[0.08]">
                  <canvas
                    ref={canvasRef}
                    width={500}
                    height={500}
                    className="object-contain max-w-[90%] max-h-[90%]"
                  />

                  {error && (
                    <div className="mt-3 flex items-center gap-1.5 border border-red-500/30 bg-red-500/10 p-2 text-[9.5px] text-red-300">
                      <AlertCircle size={12} className="shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                  <div className="mt-3 font-mono text-xl text-[#4e687e] text-center">
                    {byteCount} bytes encoded
                    <br />
                    {densityPercent}% density
                    <br />
                    {ecLevel} Level Error Correction
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* Image Scan Mode */
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
              <div className="w-full max-w-sm border border-white/[0.08] bg-white/[0.015] p-5 text-center shadow-2xl">
                <div className="mx-auto mb-2.5 grid h-10 w-10 place-items-center border border-[#4aa3ff]/30 bg-[#4aa3ff]/10 text-[#4aa3ff]">
                  <Scan size={18} />
                </div>
                <div className="font-semibold text-[13px] text-white">QR Image Inspector</div>
                <p className="mt-1 text-[10.5px] text-[#718b9f] leading-relaxed">
                  Select a QR code image to inspect its geometry, pixel density, and payload.
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 border border-[#4aa3ff]/40 bg-[#4aa3ff]/15 py-2 font-mono text-[9px] uppercase tracking-wider text-[#cfe6ff] hover:bg-[#4aa3ff]/25 transition-all"
                >
                  <Upload size={11} />
                  <span>Choose Image File</span>
                </button>
                {scanResult && (
                  <div className="mt-3 border border-white/[0.08] bg-black/40 p-2 text-left font-mono text-[8.5px] text-[#8ea7bc] space-y-1">
                    <div className="text-[#2ee6a6]">✓ Loaded</div>
                    <div>{scanResult}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
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

function UtilToolHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold text-os-text">{title}</div>
      <div className="text-[10px] text-os-text-muted">{desc}</div>
    </div>
  );
}

// 1. Timezone Converter
export function TimeZoneConverter() {
  const [utc, setUtc] = useState('12:00');
  const [tz, setTz] = useState('+5.5');
  const convert = () => {
    const [h, m] = utc.split(':').map(Number);
    const totalMin = (h || 0) * 60 + (m || 0) + (parseFloat(tz) || 0) * 60;
    const nh = ((Math.floor(totalMin / 60) % 24) + 24) % 24;
    const nm = ((Math.round(totalMin) % 60) + 60) % 60;
    return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
  };
  return (
    <div className="tool-workspace">
      <UtilToolHeader
        title="Timezone Converter"
        desc="Convert UTC time to local timezone with custom offset."
      />
      <div className="flex gap-2 mb-2">
        <input
          value={utc}
          onChange={(e) => setUtc(e.target.value)}
          className="os-input flex-1 font-mono"
          placeholder="HH:MM (UTC)"
        />
        <input
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="os-input w-24 font-mono"
          placeholder="Offset (+5.5)"
        />
      </div>
      <div className="mt-2 space-y-1">
        <Out label="Local Time" value={convert()} />
        <Out label="UTC Base" value={utc} />
        <Out label="Offset" value={`${tz} hrs`} />
      </div>
    </div>
  );
}

// 2. File Size Converter
export function FileSizeConverter() {
  const [bytes, setBytes] = useState(1048576);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const result = () => {
    let b = bytes;
    let i = 0;
    while (b >= 1024 && i < units.length - 1) {
      b /= 1024;
      i++;
    }
    return `${b.toFixed(2)} ${units[i]}`;
  };
  return (
    <div className="tool-workspace">
      <UtilToolHeader
        title="File Size Converter"
        desc="Convert byte counts to human-readable size formats."
      />
      <input
        type="number"
        value={bytes}
        onChange={(e) => setBytes(Number(e.target.value))}
        className="os-input w-full mb-2"
        placeholder="Bytes"
      />
      <div className="mt-2 space-y-1">
        <Out label="Human Readable" value={result()} />
        <Out label="Bits" value={(bytes * 8).toLocaleString()} />
        <Out label="Kilobytes (KB)" value={(bytes / 1024).toFixed(3)} />
        <Out label="Megabytes (MB)" value={(bytes / (1024 * 1024)).toFixed(4)} />
        <Out label="Gigabytes (GB)" value={(bytes / (1024 * 1024 * 1024)).toFixed(6)} />
      </div>
    </div>
  );
}

// 3. Bandwidth Calculator
export function BandwidthCalc() {
  const [fileSize, setFileSize] = useState(100);
  const [bandwidth, setBandwidth] = useState(10);
  const time = bandwidth > 0 ? (fileSize * 8) / bandwidth : 0;
  return (
    <div className="tool-workspace">
      <UtilToolHeader
        title="Bandwidth Calculator"
        desc="Calculate download and upload transfer times based on connection speed."
      />
      <div className="space-y-2">
        <input
          type="number"
          value={fileSize}
          onChange={(e) => setFileSize(Number(e.target.value))}
          className="os-input w-full"
          placeholder="File Size (MB)"
        />
        <input
          type="number"
          value={bandwidth}
          onChange={(e) => setBandwidth(Number(e.target.value))}
          className="os-input w-full"
          placeholder="Connection Speed (Mbps)"
        />
      </div>
      <div className="mt-2 space-y-1">
        <Out label="Estimated Time (seconds)" value={time.toFixed(2)} />
        <Out label="Estimated Time (minutes)" value={(time / 60).toFixed(2)} />
        <Out label="Estimated Time (hours)" value={(time / 3600).toFixed(3)} />
      </div>
    </div>
  );
}

// 4. Data Transfer Calculator
export function DataTransferCalc() {
  const [size, setSize] = useState(500);
  const [speed, setSpeed] = useState(100);
  const time = speed > 0 ? size / speed : 0;
  return (
    <div className="tool-workspace">
      <UtilToolHeader
        title="Data Transfer Calculator"
        desc="Calculate file transfer speed and duration."
      />
      <div className="space-y-2">
        <input
          type="number"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="os-input w-full"
          placeholder="Data Volume (MB)"
        />
        <input
          type="number"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="os-input w-full"
          placeholder="Transfer Speed (MB/s)"
        />
      </div>
      <div className="mt-2 space-y-1">
        <Out label="Total Time" value={`${time.toFixed(2)} seconds`} />
        <Out label="Minutes" value={(time / 60).toFixed(2)} />
        <Out label="Hours" value={(time / 3600).toFixed(4)} />
      </div>
    </div>
  );
}

// 5. Screen Resolution Calculator
export function ScreenResCalc() {
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const [diagonal, setDiagonal] = useState(24);
  const pixels = w * h;
  const ppi = diagonal > 0 ? Math.sqrt(w * w + h * h) / diagonal : 0;
  return (
    <div className="tool-workspace">
      <UtilToolHeader
        title="Screen Resolution"
        desc="Calculate pixel density (PPI), aspect ratio, and total screen pixels."
      />
      <div className="space-y-2">
        <input
          type="number"
          value={w}
          onChange={(e) => setW(Number(e.target.value))}
          className="os-input w-full"
          placeholder="Width (pixels)"
        />
        <input
          type="number"
          value={h}
          onChange={(e) => setH(Number(e.target.value))}
          className="os-input w-full"
          placeholder="Height (pixels)"
        />
        <input
          type="number"
          value={diagonal}
          onChange={(e) => setDiagonal(Number(e.target.value))}
          className="os-input w-full"
          placeholder="Diagonal Screen Size (inches)"
        />
      </div>
      <div className="mt-2 space-y-1">
        <Out label="Total Pixels" value={pixels.toLocaleString()} />
        <Out label="Pixel Density (PPI)" value={ppi.toFixed(1)} />
        <Out label="Aspect Ratio" value={h > 0 ? `${(w / h).toFixed(3)}:1` : '—'} />
      </div>
    </div>
  );
}

// 6. Aspect Ratio Calculator
export function AspectRatioCalc() {
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const ratio = h > 0 ? w / h : 0;
  return (
    <div className="tool-workspace">
      <UtilToolHeader
        title="Aspect Ratio"
        desc="Calculate aspect ratio and find closest common video standards."
      />
      <div className="flex gap-2 mb-2">
        <input
          type="number"
          value={w}
          onChange={(e) => setW(Number(e.target.value))}
          className="os-input flex-1"
          placeholder="Width"
        />
        <input
          type="number"
          value={h}
          onChange={(e) => setH(Number(e.target.value))}
          className="os-input flex-1"
          placeholder="Height"
        />
      </div>
      <div className="mt-2 space-y-1">
        <Out label="Calculated Ratio" value={ratio.toFixed(4)} />
        <Out label="16:9 Proportion" value={`${Math.round((w * 9) / (h || 1))}:9`} />
        <Out label="4:3 Proportion" value={`${Math.round((w * 3) / (h || 1))}:3`} />
      </div>
    </div>
  );
}

// 7. Typing Speed
export function TypingSpeed() {
  const [text, setText] = useState('The quick brown fox jumps over the lazy dog.');
  const [time, setTime] = useState(60);
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const safeTime = Math.max(1, time);
  const wpm = (words / safeTime) * 60;
  const cpm = (chars / safeTime) * 60;
  return (
    <div className="tool-workspace">
      <UtilToolHeader
        title="Typing Speed"
        desc="Calculate typing speed (WPM & CPM) from sample text."
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter or paste typed text..."
        className="os-input w-full h-20 font-mono text-[11px] resize-none mb-2"
      />
      <div className="flex gap-2 mb-2">
        <input
          type="number"
          min="1"
          value={time}
          onChange={(e) => setTime(Math.max(1, Number(e.target.value)))}
          className="os-input flex-1"
          placeholder="Time spent in seconds"
        />
      </div>
      <div className="mt-2 space-y-1">
        <Out label="Word Count" value={words} />
        <Out label="Character Count" value={chars} />
        <Out label="Words Per Minute (WPM)" value={wpm.toFixed(1)} />
        <Out label="Characters Per Minute (CPM)" value={cpm.toFixed(1)} />
      </div>
    </div>
  );
}

// 8. Clothing Size Converter
export function ClothingSize() {
  const [size, setSize] = useState('M');
  const sizes: Record<string, Record<string, string>> = {
    US: { XS: 'XS', S: 'S', M: 'M', L: 'L', XL: 'XL', XXL: 'XXL' },
    EU: { XS: '32-34', S: '36-38', M: '40-42', L: '44-46', XL: '48-50', XXL: '52-54' },
    UK: { XS: '4-6', S: '8-10', M: '12-14', L: '16-18', XL: '20-22', XXL: '24-26' },
  };
  const norm = size.toUpperCase().trim();
  return (
    <div className="tool-workspace">
      <UtilToolHeader
        title="Clothing Size Converter"
        desc="Convert clothing sizes across US, EU, and UK international sizing charts."
      />
      <input
        value={size}
        onChange={(e) => setSize(e.target.value)}
        className="os-input w-full mb-2 font-mono text-center text-xl"
        placeholder="e.g. S, M, L, XL"
      />
      <div className="mt-2 space-y-1">
        <Out label="US Size" value={sizes.US[norm] || norm} />
        <Out label="EU Sizing" value={sizes.EU[norm] || '—'} />
        <Out label="UK Sizing" value={sizes.UK[norm] || '—'} />
      </div>
    </div>
  );
}

export const UTILITY_TOOLS = {
  QrGen,
  TimeZoneConverter,
  FileSizeConverter,
  BandwidthCalc,
  DataTransferCalc,
  ScreenResCalc,
  AspectRatioCalc,
  TypingSpeed,
  ClothingSize,
};

export const UTILITIES_2 = UTILITY_TOOLS;
