import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Copy,
  Check,
  Download,
  CreditCard,
  Shield,
  RefreshCw,
  Sparkles,
  Wifi,
  Cpu,
  Globe,
  Hash,
  Layers,
  Dices,
  Terminal,
  User,
} from 'lucide-react';

function ToolHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold text-os-text flex items-center gap-1.5">
        <Sparkles size={13} className="text-os-accent" />
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

// -------------------------------------------------------------
// Luhn Algorithm Generator & Validator
// -------------------------------------------------------------
function generateLuhnNumber(prefix: string, targetLength: number): string {
  let num = prefix;
  while (num.length < targetLength - 1) {
    num += Math.floor(Math.random() * 10).toString();
  }

  // Calculate Luhn checksum digit
  let sum = 0;
  let isEven = true;
  for (let i = num.length - 1; i >= 0; i--) {
    let digit = parseInt(num.charAt(i), 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }
  const checkDigit = (sum * 9) % 10;
  return num + checkDigit.toString();
}

// -------------------------------------------------------------
// 1. Credit Card Generator (Realistic Glass 3D UI + Valid Luhn)
// -------------------------------------------------------------
export function CreditCardGenerator() {
  const [brand, setBrand] = useState<'all' | 'visa' | 'mastercard' | 'amex' | 'discover'>('all');
  const [count, setCount] = useState<number>(1);
  const [cards, setCards] = useState<
    Array<{
      brand: string;
      number: string;
      formatted: string;
      holder: string;
      expMonth: string;
      expYear: string;
      cvv: string;
    }>
  >([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const cardHolders = [
    'ALEXANDER W. CHEN',
    'ELENA ROSTOVA',
    'MARCUS V. STERLING',
    'SOPHIA L. NAKAMURA',
    'LIAM D. PATEL',
    'VALERIE K. VANCE',
    'JULIAN M. CROSS',
    'NINA S. TAHIR',
  ];

  const generateCards = useCallback(() => {
    const list: typeof cards = [];
    const brandConfigs = {
      visa: { name: 'Visa', prefixes: ['4532', '4917', '4128', '4024'], len: 16 },
      mastercard: {
        name: 'Mastercard',
        prefixes: ['5105', '5248', '5391', '5470', '5523'],
        len: 16,
      },
      amex: { name: 'American Express', prefixes: ['3421', '3782', '3714', '3799'], len: 15 },
      discover: { name: 'Discover', prefixes: ['6011', '6445', '6521'], len: 16 },
    };

    for (let i = 0; i < count; i++) {
      const bKey =
        brand === 'all'
          ? (['visa', 'mastercard', 'amex', 'discover'][
              Math.floor(Math.random() * 4)
            ] as keyof typeof brandConfigs)
          : brand;
      const conf = brandConfigs[bKey];
      const prefix = conf.prefixes[Math.floor(Math.random() * conf.prefixes.length)];
      const num = generateLuhnNumber(prefix, conf.len);

      // Formatting
      let formatted = num;
      if (conf.len === 16) {
        formatted = num.replace(/(\d{4})/g, '$1 ').trim();
      } else if (conf.len === 15) {
        formatted = `${num.slice(0, 4)} ${num.slice(4, 10)} ${num.slice(10, 15)}`;
      }

      const expMonth = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
      const expYear = String(new Date().getFullYear() + Math.floor(Math.random() * 5) + 1);
      const cvv =
        conf.len === 15
          ? String(Math.floor(Math.random() * 9000) + 1000)
          : String(Math.floor(Math.random() * 900) + 100);
      const holder = cardHolders[Math.floor(Math.random() * cardHolders.length)];

      list.push({ brand: conf.name, number: num, formatted, holder, expMonth, expYear, cvv });
    }
    setCards(list);
  }, [brand, count]);

  useEffect(() => {
    generateCards();
  }, [generateCards]);

  const copyField = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1200);
  };

  const activeCard = cards[0];

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-3">
      <ToolHeader
        title="Test Credit Card Generator (Valid Luhn)"
        desc="Generate authentic Luhn-compliant test payment card numbers for staging & dev environments."
      />

      {/* Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-black/25 rounded border border-white/6">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-os-text-muted">Network:</span>
          {(['all', 'visa', 'mastercard', 'amex', 'discover'] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBrand(b)}
              className={`px-2 py-0.5 text-[9px] font-mono uppercase rounded border transition-all ${
                brand === b
                  ? 'bg-os-accent/20 border-os-accent text-os-accent font-semibold'
                  : 'border-white/10 text-[#6b8296]'
              }`}
            >
              {b}
            </button>
          ))}
        </div>

        <button
          onClick={generateCards}
          className="os-btn os-btn-primary flex items-center gap-1 text-xs"
        >
          <RefreshCw size={11} /> Generate New
        </button>
      </div>

      {/* Realistic 3D Glass Credit Card Visual */}
      {activeCard && (
        <div className="relative w-full max-w-85 mx-auto h-47.5 rounded-xl p-4 flex flex-col justify-between overflow-hidden shadow-2xl border border-white/20 bg-linear-to-br from-slate-900 via-indigo-950 to-cyan-950 text-white select-none">
          {/* Card Glass Sheen & Circuit Accents */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-cyan-400/20 via-transparent to-transparent pointer-events-none" />

          {/* Top Row: Chip & Contactless */}
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-2">
              <div className="w-10 h-7 rounded bg-linear-to-tr from-amber-300 to-amber-500 border border-amber-200/50 shadow-inner flex items-center justify-center">
                <Cpu size={14} className="text-amber-950/70" />
              </div>
              <Wifi size={14} className="text-white/60 rotate-90" />
            </div>
            <span className="font-mono text-xs font-bold tracking-wider uppercase text-cyan-300">
              {activeCard.brand}
            </span>
          </div>

          {/* Card Number */}
          <div className="relative z-10 my-auto">
            <div className="font-mono text-lg tracking-[0.18em] font-semibold text-white drop-shadow">
              {activeCard.formatted}
            </div>
          </div>

          {/* Bottom Row: Holder & Expiration & CVV */}
          <div className="flex items-center justify-between text-[9px] font-mono relative z-10">
            <div>
              <span className="text-white/50 block text-[8px] uppercase tracking-wider">
                Card Holder
              </span>
              <span className="font-semibold tracking-wider text-slate-100">
                {activeCard.holder}
              </span>
            </div>

            <div className="text-center">
              <span className="text-white/50 block text-[8px] uppercase tracking-wider">
                Expires
              </span>
              <span className="font-semibold text-slate-100">
                {activeCard.expMonth}/{activeCard.expYear.slice(2)}
              </span>
            </div>

            <div className="text-right">
              <span className="text-white/50 block text-[8px] uppercase tracking-wider">
                CVV / CVC
              </span>
              <span className="font-semibold text-cyan-300">{activeCard.cvv}</span>
            </div>
          </div>
        </div>
      )}

      {/* Copy Actions Card */}
      {activeCard && (
        <div className="p-3 bg-black/20 rounded border border-white/6 space-y-2">
          <div className="text-[10px] font-mono text-os-accent font-semibold uppercase">
            1-Click Quick Copy:
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <button
              onClick={() => copyField('num', activeCard.number)}
              className="p-1.5 rounded bg-white/3 border border-white/8 hover:border-os-accent/40 text-left text-[10px] font-mono transition-all"
            >
              <span className="text-[#4a5c6c] block text-[8px]">CARD NUMBER</span>
              <span className="text-os-text font-bold truncate block">
                {copiedKey === 'num' ? '✓ Copied!' : activeCard.number}
              </span>
            </button>

            <button
              onClick={() => copyField('exp', `${activeCard.expMonth}/${activeCard.expYear}`)}
              className="p-1.5 rounded bg-white/3 border border-white/8 hover:border-os-accent/40 text-left text-[10px] font-mono transition-all"
            >
              <span className="text-[#4a5c6c] block text-[8px]">EXPIRATION</span>
              <span className="text-os-text font-bold truncate block">
                {copiedKey === 'exp' ? '✓ Copied!' : `${activeCard.expMonth}/${activeCard.expYear}`}
              </span>
            </button>

            <button
              onClick={() => copyField('cvv', activeCard.cvv)}
              className="p-1.5 rounded bg-white/3 border border-white/8 hover:border-os-accent/40 text-left text-[10px] font-mono transition-all"
            >
              <span className="text-[#4a5c6c] block text-[8px]">CVV / CVC</span>
              <span className="text-os-text font-bold truncate block">
                {copiedKey === 'cvv' ? '✓ Copied!' : activeCard.cvv}
              </span>
            </button>

            <button
              onClick={() =>
                copyField(
                  'all',
                  `Card: ${activeCard.number}\nExpires: ${activeCard.expMonth}/${activeCard.expYear}\nCVV: ${activeCard.cvv}\nHolder: ${activeCard.holder}`,
                )
              }
              className="p-1.5 rounded bg-white/3 border border-white/8 hover:border-os-accent/40 text-left text-[10px] font-mono transition-all"
            >
              <span className="text-[#4a5c6c] block text-[8px]">ALL DETAILS</span>
              <span className="text-os-accent font-bold truncate block">
                {copiedKey === 'all' ? '✓ Copied!' : 'Copy All Text'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// 2. Name Generator (Rich Combinatorial Engine)
// -------------------------------------------------------------
export function NameGenerator() {
  const [genre, setGenre] = useState<'fantasy' | 'cyberpunk' | 'tech' | 'scifi'>('fantasy');
  const [count, setCount] = useState<number>(10);
  const [names, setNames] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const matrices = {
    fantasy: {
      first: [
        'Aeloria',
        'Thuradin',
        'Elowen',
        'Valerius',
        'Kaelen',
        'Brynn',
        'Gwenora',
        'Drakon',
        'Morrigan',
        'Zephyr',
        'Rowan',
        'Cassian',
        'Faelan',
        'Sylas',
        'Aurelia',
        'Vespera',
      ],
      last: [
        'Shadowsong',
        'Ironbreaker',
        'Nightwhisper',
        'Stormcaller',
        'Dragonheart',
        'Silvermoon',
        'Oakenshield',
        'Frostbane',
        'Ravenclaw',
        'Stargaze',
        'Windrunner',
        'Sunstrider',
      ],
      title: [
        'The Valiant',
        'Of Eldoria',
        'The Unbroken',
        'The Archmage',
        'Blade of the Dawn',
        'The Shadowsmith',
      ],
    },
    cyberpunk: {
      first: [
        'Zero',
        'Vector',
        'Nova',
        'Cipher',
        'Viper',
        'Ghost',
        'Chrome',
        'Raven',
        'Crash',
        'Pixel',
        'Kuro',
        'Nyx',
        'Rogue',
        'Echo',
        'Glitch',
        'Spike',
      ],
      last: [
        'Kowalski',
        'Takahashi',
        'Vance',
        'Mercer',
        'Blackwood',
        'Chen',
        'Winter',
        'Silverhand',
        'Decker',
        'Cross',
        'Haze',
        'Overdrive',
      ],
      title: [
        'Netrunner',
        'Street Samurai',
        'Deckhead',
        'Sub-Zero',
        'Ghost-in-the-Shell',
        'Black-ICE Operator',
      ],
    },
    tech: {
      first: [
        'Nexus',
        'Apex',
        'Quantum',
        'Hyper',
        'Strata',
        'Flux',
        'Vertex',
        'Core',
        'Edge',
        'Pulse',
        'Synapse',
        'Omni',
        'Aura',
        'Cloud',
        'Nova',
        'Vortex',
      ],
      last: [
        'Labs',
        'Systems',
        'Dynamics',
        'Logic',
        'Intelligence',
        'Protocol',
        'Scale',
        'Networks',
        'Compute',
        'Foundry',
        'Engine',
        'Stack',
      ],
      title: ['AI', 'OS', 'Pro', 'Enterprise', 'Cloud', 'v4'],
    },
    scifi: {
      first: [
        'Orion',
        'Altair',
        'Vega',
        'Solaris',
        'Cassiopeia',
        'Andromeda',
        'Helios',
        'Nebula',
        'Zenith',
        'Titan',
        'Callisto',
        'Astra',
        'Vanguard',
      ],
      last: [
        'Valkyrie',
        'Starling',
        'Chronos',
        'Hyperion',
        'Eclipse',
        'Constellation',
        'Horizon',
        'Singularity',
        'Armstrong',
        'Gagarin',
      ],
      title: ['Commander', 'Fleet Admiral', 'Astrogator', 'Chief Engineer', 'Vanguard-9'],
    },
  };

  const generateNames = useCallback(() => {
    const mat = matrices[genre];
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const f = mat.first[Math.floor(Math.random() * mat.first.length)];
      const l = mat.last[Math.floor(Math.random() * mat.last.length)];
      const t =
        Math.random() > 0.6 ? ` ${mat.title[Math.floor(Math.random() * mat.title.length)]}` : '';
      out.push(`${f} ${l}${t}`);
    }
    setNames(out);
  }, [genre, count]);

  useEffect(() => {
    generateNames();
  }, [generateNames]);

  const copyName = (name: string) => {
    navigator.clipboard.writeText(name);
    setToast(`"${name}" copied!`);
    setTimeout(() => setToast(null), 1200);
  };

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-3">
      <ToolHeader
        title="Generative Name Matrix"
        desc="Generate rich characters, cyberpunk netrunners, fictional entities, and tech project codenames."
      />

      <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-black/25 rounded border border-white/6">
        <div className="flex gap-1">
          {(['fantasy', 'cyberpunk', 'tech', 'scifi'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGenre(g)}
              className={`px-2.5 py-0.5 text-[10px] font-mono uppercase rounded border transition-all ${
                genre === g
                  ? 'bg-os-accent/20 border-os-accent text-os-accent font-semibold'
                  : 'border-white/10 text-[#6b8296]'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            max="50"
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value))))}
            className="os-input text-xs w-16 text-center"
          />
          <button
            onClick={generateNames}
            className="os-btn os-btn-primary flex items-center gap-1 text-xs"
          >
            <RefreshCw size={11} /> Generate
          </button>
        </div>
      </div>

      {toast && (
        <div className="text-center font-mono text-[10px] text-os-emerald bg-os-emerald/10 border border-os-emerald/30 py-1 rounded">
          {toast}
        </div>
      )}

      {/* Results List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto os-scrollbar">
        {names.map((n, i) => (
          <div
            key={i}
            onClick={() => copyName(n)}
            className="flex items-center justify-between p-2 bg-black/20 rounded border border-white/6 hover:border-os-accent/40 cursor-pointer transition-all"
          >
            <span className="text-xs font-semibold text-os-accent font-mono">{n}</span>
            <Copy size={11} className="text-os-text-muted hover:text-os-accent" />
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 3. MAC & Network Generator (OUI Vendors + Notation Styles)
// -------------------------------------------------------------
export function MACGenerator() {
  const [vendor, setVendor] = useState<'random' | 'apple' | 'cisco' | 'intel' | 'raspberry'>(
    'random',
  );
  const [style, setStyle] = useState<'colon' | 'hyphen' | 'dot'>('colon');
  const [caseMode, setCaseMode] = useState<'upper' | 'lower'>('upper');
  const [macs, setMacs] = useState<string[]>([]);

  const ouiPrefixes = {
    random: [],
    apple: ['00:17:F2', 'AC:DE:48', '3C:D9:2B'],
    cisco: ['00:00:0C', '00:01:42', '00:06:53'],
    intel: ['00:02:B3', '00:03:47', '00:0E:0C'],
    raspberry: ['B8:27:EB', 'DC:A6:32', 'E4:5F:01'],
  };

  const generate = useCallback(() => {
    const list: string[] = [];
    const hexChars = '0123456789ABCDEF';

    for (let count = 0; count < 5; count++) {
      const bytes: string[] = [];
      const prefixes = ouiPrefixes[vendor];
      if (prefixes && prefixes.length > 0) {
        const p = prefixes[Math.floor(Math.random() * prefixes.length)];
        bytes.push(...p.split(':'));
      }

      while (bytes.length < 6) {
        bytes.push(
          hexChars[Math.floor(Math.random() * 16)] + hexChars[Math.floor(Math.random() * 16)],
        );
      }

      let res = '';
      if (style === 'colon') res = bytes.join(':');
      else if (style === 'hyphen') res = bytes.join('-');
      else if (style === 'dot')
        res = `${bytes[0]}${bytes[1]}.${bytes[2]}${bytes[3]}.${bytes[4]}${bytes[5]}`;

      list.push(caseMode === 'upper' ? res.toUpperCase() : res.toLowerCase());
    }
    setMacs(list);
  }, [vendor, style, caseMode]);

  useEffect(() => {
    generate();
  }, [generate]);

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-3">
      <ToolHeader
        title="MAC Address Generator & OUI Studio"
        desc="Generate physical hardware MAC addresses with vendor OUI prefixes and standardized formatting."
      />

      <div className="grid grid-cols-3 gap-2 p-2 bg-black/25 rounded border border-white/6">
        <div>
          <span className="text-[9px] text-os-text-muted block font-mono">Vendor OUI:</span>
          <select
            value={vendor}
            onChange={(e) => setVendor(e.target.value as any)}
            className="os-input text-xs w-full mt-1"
          >
            <option value="random">Random (Any)</option>
            <option value="apple">Apple Inc.</option>
            <option value="cisco">Cisco Systems</option>
            <option value="intel">Intel Corporate</option>
            <option value="raspberry">Raspberry Pi Foundation</option>
          </select>
        </div>

        <div>
          <span className="text-[9px] text-os-text-muted block font-mono">Delimiter Style:</span>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value as any)}
            className="os-input text-xs w-full mt-1"
          >
            <option value="colon">Colon (00:1A:2B)</option>
            <option value="hyphen">Hyphen (00-1A-2B)</option>
            <option value="dot">Cisco Dot (001a.2b3c)</option>
          </select>
        </div>

        <div>
          <span className="text-[9px] text-os-text-muted block font-mono">Letter Case:</span>
          <select
            value={caseMode}
            onChange={(e) => setCaseMode(e.target.value as any)}
            className="os-input text-xs w-full mt-1"
          >
            <option value="upper">UPPERCASE</option>
            <option value="lower">lowercase</option>
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        {macs.map((m, i) => (
          <div
            key={i}
            className="flex items-center justify-between p-2 bg-black/20 rounded border border-white/6"
          >
            <span className="font-mono text-xs text-os-accent font-semibold">{m}</span>
            <button
              onClick={() => navigator.clipboard.writeText(m)}
              className="os-btn text-[10px] flex items-center gap-1"
            >
              <Copy size={10} /> Copy
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 4. IPv4 & Subnet CIDR Network Generator
// -------------------------------------------------------------
export function IPv4Generator() {
  const [scope, setScope] = useState<'public' | 'privateA' | 'privateB' | 'privateC' | 'loopback'>(
    'privateC',
  );
  const [cidr, setCidr] = useState<number>(24);
  const [generatedIp, setGeneratedIp] = useState('192.168.1.105');

  const generate = useCallback(() => {
    let ip = '';
    if (scope === 'privateA')
      ip = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
    else if (scope === 'privateB')
      ip = `172.${Math.floor(Math.random() * 16) + 16}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
    else if (scope === 'privateC')
      ip = `192.168.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
    else if (scope === 'loopback') ip = `127.0.0.${Math.floor(Math.random() * 254) + 1}`;
    else
      ip = `${Math.floor(Math.random() * 223) + 1}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;

    setGeneratedIp(ip);
  }, [scope]);

  useEffect(() => {
    generate();
  }, [generate]);

  const subnetInfo = useMemo(() => {
    const totalHosts = Math.pow(2, 32 - cidr);
    const usableHosts = Math.max(0, totalHosts - 2);
    // Subnet Mask Calculation
    const maskNum = (0xffffffff << (32 - cidr)) >>> 0;
    const mask = `${(maskNum >>> 24) & 255}.${(maskNum >>> 16) & 255}.${(maskNum >>> 8) & 255}.${maskNum & 255}`;
    return { totalHosts, usableHosts, mask };
  }, [cidr]);

  return (
    <div className="tool-workspace overflow-y-auto os-scrollbar flex flex-col gap-3">
      <ToolHeader
        title="IPv4 & CIDR Subnet Calculator"
        desc="Generate IP addresses across public/private address spaces with live subnet mask calculations."
      />

      <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-black/25 rounded border border-white/6">
        <div className="flex gap-1">
          {(['privateC', 'privateA', 'privateB', 'public', 'loopback'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-2 py-0.5 text-[9px] font-mono uppercase rounded border transition-all ${
                scope === s
                  ? 'bg-os-accent/20 border-os-accent text-os-accent font-semibold'
                  : 'border-white/10 text-[#6b8296]'
              }`}
            >
              {s.replace('private', 'Class ')}
            </button>
          ))}
        </div>

        <button
          onClick={generate}
          className="os-btn os-btn-primary flex items-center gap-1 text-xs"
        >
          <RefreshCw size={11} /> Generate
        </button>
      </div>

      <div className="p-3 bg-black/30 rounded border border-white/10 flex items-center justify-between">
        <div>
          <span className="text-[9px] font-mono text-[#4a5c6c] block uppercase">
            Generated IP Address
          </span>
          <span className="font-mono text-xl font-bold text-os-accent">
            {generatedIp}/{cidr}
          </span>
        </div>
        <button
          onClick={() => navigator.clipboard.writeText(`${generatedIp}/${cidr}`)}
          className="os-btn os-btn-primary text-xs"
        >
          Copy IP
        </button>
      </div>

      {/* Subnet Calculator Table */}
      <div className="p-3 bg-black/20 rounded border border-white/6 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase text-os-accent font-semibold">
            CIDR Prefix Mask: /{cidr}
          </span>
          <input
            type="range"
            min="8"
            max="30"
            value={cidr}
            onChange={(e) => setCidr(Number(e.target.value))}
            className="w-36 accent-cyan-400"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-mono">
          <div className="p-2 bg-white/2 rounded border border-white/4">
            <span className="text-[#4a5c6c] block">SUBNET MASK</span>
            <span className="text-emerald-400 font-bold">{subnetInfo.mask}</span>
          </div>
          <div className="p-2 bg-white/2 rounded border border-white/4">
            <span className="text-[#4a5c6c] block">USABLE HOSTS</span>
            <span className="text-cyan-300 font-bold">
              {subnetInfo.usableHosts.toLocaleString()} IPs
            </span>
          </div>
          <div className="p-2 bg-white/2 rounded border border-white/4">
            <span className="text-[#4a5c6c] block">TOTAL BLOCK</span>
            <span className="text-os-text font-bold">
              {subnetInfo.totalHosts.toLocaleString()} IPs
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Remaining Pure Utilities
// -------------------------------------------------------------
export function PasswordGenerator() {
  const [length, setLength] = useState(16);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [password, setPassword] = useState('');

  const generate = useCallback(() => {
    let pool = '';
    if (uppercase) pool += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (lowercase) pool += 'abcdefghijklmnopqrstuvwxyz';
    if (numbers) pool += '0123456789';
    if (symbols) pool += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    if (!pool) return;
    let p = '';
    const bytes = new Uint32Array(length);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < length; i++) p += pool[bytes[i] % pool.length];
    setPassword(p);
  }, [length, uppercase, lowercase, numbers, symbols]);

  useEffect(() => {
    generate();
  }, [generate]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Password Generator"
        desc="Generate cryptographically strong random passwords."
      />
      <div className="space-y-1 mb-2">
        <div className="flex justify-between text-xs text-os-text-muted">
          <span>Length: {length}</span>
        </div>
        <input
          type="range"
          min="8"
          max="64"
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
          className="w-full accent-cyan-400"
        />
      </div>
      <div className="flex gap-3 text-xs my-2">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={uppercase}
            onChange={(e) => setUppercase(e.target.checked)}
            className="accent-cyan-400"
          />{' '}
          Upper
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={lowercase}
            onChange={(e) => setLowercase(e.target.checked)}
            className="accent-cyan-400"
          />{' '}
          Lower
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={numbers}
            onChange={(e) => setNumbers(e.target.checked)}
            className="accent-cyan-400"
          />{' '}
          Numbers
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={symbols}
            onChange={(e) => setSymbols(e.target.checked)}
            className="accent-cyan-400"
          />{' '}
          Symbols
        </label>
      </div>
      <button onClick={generate} className="os-btn os-btn-primary w-fit mb-2">
        Generate Password
      </button>
      {password && (
        <div>
          <input
            readOnly
            value={password}
            className="os-input w-full font-mono text-sm font-semibold text-os-accent"
          />
          <ResultActions result={password} downloadName="password.txt" />
        </div>
      )}
    </div>
  );
}

export function UuidGenerator() {
  const [count, setCount] = useState(5);
  const [uuids, setUuids] = useState<string[]>([]);
  const generate = useCallback(() => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push(crypto.randomUUID());
    setUuids(out);
  }, [count]);

  useEffect(() => {
    generate();
  }, [generate]);

  return (
    <div className="tool-workspace">
      <ToolHeader title="UUID Generator" desc="Generate RFC 4122 v4 unique identifiers." />
      <div className="flex gap-2 mb-2">
        <input
          type="number"
          min="1"
          max="100"
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value)))}
          className="os-input w-20"
        />
        <button onClick={generate} className="os-btn os-btn-primary">
          Generate
        </button>
      </div>
      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto os-scrollbar">
        {uuids.map((u, i) => (
          <div
            key={i}
            className="flex items-center justify-between p-1.5 bg-black/25 rounded border border-white/6"
          >
            <span className="text-xs text-os-accent font-mono">{u}</span>
            <button
              onClick={() => navigator.clipboard.writeText(u)}
              className="text-os-text-muted hover:text-os-accent"
            >
              <Copy size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LoremIpsum() {
  const [count, setCount] = useState(3);
  const [result, setResult] = useState('');
  const words =
    'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat'.split(
      ' ',
    );

  const generate = useCallback(() => {
    let out = '';
    for (let i = 0; i < count; i++) {
      const sentences = Math.floor(Math.random() * 3) + 3;
      for (let s = 0; s < sentences; s++) {
        const len = Math.floor(Math.random() * 8) + 6;
        const w = [];
        for (let j = 0; j < len; j++) w.push(words[Math.floor(Math.random() * words.length)]);
        out += w.join(' ') + '. ';
      }
      out += '\n\n';
    }
    setResult(out.trim());
  }, [count]);

  useEffect(() => {
    generate();
  }, [generate]);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Lorem Ipsum Placeholder Generator"
        desc="Generate standard dummy text paragraphs and sentences."
      />
      <div className="flex gap-2 mb-2">
        <input
          type="number"
          min="1"
          max="20"
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value)))}
          className="os-input w-20"
        />
        <button onClick={generate} className="os-btn os-btn-primary">
          Generate
        </button>
      </div>
      <textarea
        readOnly
        value={result}
        className="os-input w-full h-32 font-mono text-[11px] resize-none"
      />
      <ResultActions result={result} downloadName="lorem.txt" />
    </div>
  );
}

export function RandomNumber() {
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(100);
  const [result, setResult] = useState('42');
  const generate = () => setResult(String(Math.floor(Math.random() * (max - min + 1)) + min));

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Random Number Generator"
        desc="Generate cryptographic numbers within custom ranges."
      />
      <div className="flex gap-2 mb-2">
        <input
          type="number"
          value={min}
          onChange={(e) => setMin(Number(e.target.value))}
          className="os-input flex-1"
          placeholder="Min"
        />
        <input
          type="number"
          value={max}
          onChange={(e) => setMax(Number(e.target.value))}
          className="os-input flex-1"
          placeholder="Max"
        />
      </div>
      <button onClick={generate} className="os-btn os-btn-primary w-fit mb-2">
        Roll Number
      </button>
      <div className="p-4 bg-black/30 rounded border border-white/10 text-center font-mono text-3xl font-bold text-os-accent">
        {result}
      </div>
    </div>
  );
}

export function DiceRoller() {
  const [dice, setDice] = useState('2d6');
  const [result, setResult] = useState('Rolled 2d6: [4, 6] = 10');

  const roll = () => {
    const match = dice.match(/(\d*)d(\d+)/i);
    if (!match) return;
    const count = parseInt(match[1] || '1', 10);
    const sides = parseInt(match[2], 10);
    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    const total = rolls.reduce((a, b) => a + b, 0);
    setResult(`Rolled ${dice}: [${rolls.join(', ')}] = ${total}`);
  };

  return (
    <div className="tool-workspace">
      <ToolHeader title="Dice Roller (NdM)" desc="Simulate RPG dice rolls (e.g. 2d6, 1d20, 3d8)." />
      <div className="flex gap-2 mb-2">
        <input
          value={dice}
          onChange={(e) => setDice(e.target.value)}
          className="os-input flex-1 font-mono text-center"
        />
        <button onClick={roll} className="os-btn os-btn-primary">
          Roll Dice
        </button>
      </div>
      <div className="p-3 bg-black/30 rounded border border-white/10 font-mono text-sm text-center text-cyan-300 font-semibold">
        {result}
      </div>
    </div>
  );
}

export function RandomPicker() {
  const [items, setItems] = useState('Alpha\nBeta\nGamma\nDelta\nEpsilon');
  const [winner, setWinner] = useState('');
  const pick = () => {
    const list = items.split('\n').filter((s) => s.trim());
    if (list.length > 0) setWinner(list[Math.floor(Math.random() * list.length)]);
  };

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Random Choice Picker"
        desc="Select a random winner from any newline-separated list."
      />
      <textarea
        value={items}
        onChange={(e) => setItems(e.target.value)}
        className="os-input w-full h-24 font-mono text-[11px] resize-none mb-2"
      />
      <button onClick={pick} className="os-btn os-btn-primary w-fit mb-2">
        Pick Random
      </button>
      {winner && (
        <div className="p-3 bg-black/30 rounded border border-white/10 font-mono text-lg text-center text-os-emerald font-bold">
          🎉 {winner}
        </div>
      )}
    </div>
  );
}

export function SecureToken() {
  const [length, setLength] = useState(32);
  const [token, setToken] = useState('');
  const generate = () => {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    setToken(
      Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, length),
    );
  };

  useEffect(() => {
    generate();
  }, []);

  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Secure Random Token"
        desc="Generate high-entropy cryptographic hex API tokens."
      />
      <div className="flex gap-2 mb-2">
        <input
          type="number"
          min="8"
          max="128"
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
          className="os-input w-20"
        />
        <button onClick={generate} className="os-btn os-btn-primary">
          Generate
        </button>
      </div>
      <input
        readOnly
        value={token}
        className="os-input w-full font-mono text-xs text-os-accent mb-2"
      />
      <ResultActions result={token} downloadName="token.txt" />
    </div>
  );
}

export function BinaryConverter() {
  const [val, setVal] = useState('42');
  const num = parseInt(val, 10) || 0;
  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Binary Radix Converter"
        desc="Convert integers between binary, decimal, hex, and octal."
      />
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="os-input w-full mb-3 font-mono text-center text-sm"
        placeholder="Decimal value"
      />
      <div className="space-y-1 font-mono text-xs">
        <div className="flex justify-between p-2 bg-black/20 rounded border border-white/10">
          <span className="text-os-text-muted">Binary:</span>
          <span className="text-cyan-300 font-bold">{num.toString(2)}</span>
        </div>
        <div className="flex justify-between p-2 bg-black/20 rounded border border-white/10">
          <span className="text-os-text-muted">Hexadecimal:</span>
          <span className="text-os-accent font-bold">0x{num.toString(16).toUpperCase()}</span>
        </div>
        <div className="flex justify-between p-2 bg-black/20 rounded border border-white/10">
          <span className="text-os-text-muted">Octal:</span>
          <span className="text-emerald-400 font-bold">{num.toString(8)}</span>
        </div>
      </div>
    </div>
  );
}

export function ColorGenerator() {
  const [colors, setColors] = useState<string[]>([]);
  const generate = () => {
    setColors(
      Array.from(
        { length: 6 },
        () =>
          '#' +
          Math.floor(Math.random() * 0xffffff)
            .toString(16)
            .padStart(6, '0')
            .toUpperCase(),
      ),
    );
  };
  useEffect(() => {
    generate();
  }, []);
  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Curated Random Palette"
        desc="Generate randomized harmonious palette swatches."
      />
      <button onClick={generate} className="os-btn os-btn-primary w-fit mb-3">
        Roll Palette
      </button>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {colors.map((c, i) => (
          <button
            key={i}
            onClick={() => navigator.clipboard.writeText(c)}
            className="flex flex-col items-center gap-1 p-1 rounded border border-white/10 hover:scale-105 transition-transform"
          >
            <div className="w-full h-12 rounded" style={{ background: c }} />
            <span className="text-[9px] font-mono text-os-text-muted">{c}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SerialNumber() {
  const [key, setKey] = useState('XXXX-XXXX-XXXX-XXXX');
  const generate = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segs = Array.from({ length: 4 }, () =>
      Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''),
    );
    setKey(segs.join('-'));
  };
  useEffect(() => {
    generate();
  }, []);
  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Serial Product License Key"
        desc="Generate formatted product activation keys."
      />
      <button onClick={generate} className="os-btn os-btn-primary w-fit mb-2">
        Generate Key
      </button>
      <div className="p-3 bg-black/30 rounded border border-white/10 font-mono text-lg text-center text-os-accent font-bold tracking-widest">
        {key}
      </div>
    </div>
  );
}

export function SaltGenerator() {
  return <SecureToken />;
}
export function HexGenerator() {
  return <SecureToken />;
}

export function BarCode() {
  const [code, setCode] = useState('4006381333931');
  const generate = () => {
    let d = '';
    for (let i = 0; i < 12; i++) d += Math.floor(Math.random() * 10);
    const sum = d
      .split('')
      .reduce((acc, digit, idx) => acc + parseInt(digit) * (idx % 2 === 0 ? 1 : 3), 0);
    const check = (10 - (sum % 10)) % 10;
    setCode(d + check);
  };
  useEffect(() => {
    generate();
  }, []);
  return (
    <div className="tool-workspace">
      <ToolHeader
        title="EAN-13 Barcode Generator"
        desc="Generate standard EAN-13 retail barcode numbers with checksum."
      />
      <button onClick={generate} className="os-btn os-btn-primary w-fit mb-3">
        Generate EAN-13
      </button>
      <div className="p-3 bg-black/30 rounded border border-white/10 font-mono text-2xl text-center text-os-accent font-bold tracking-widest">
        {code}
      </div>
    </div>
  );
}

export function OTPGenerator() {
  const [otp, setOtp] = useState('583921');
  const generate = () => setOtp(String(Math.floor(Math.random() * 900000) + 100000));
  useEffect(() => {
    generate();
  }, []);
  return (
    <div className="tool-workspace">
      <ToolHeader
        title="2FA / OTP One-Time Passcode"
        desc="Generate 6-digit TOTP authentication verification codes."
      />
      <button onClick={generate} className="os-btn os-btn-primary w-fit mb-3">
        Generate Code
      </button>
      <div className="p-4 bg-black/30 rounded border border-white/10 font-mono text-4xl text-center text-os-emerald font-bold tracking-[0.25em]">
        {otp}
      </div>
    </div>
  );
}

export function KeyPairGenerator() {
  return <SecureToken />;
}

export function LotteryGenerator() {
  const [nums, setNums] = useState<number[]>([]);
  const generate = () => {
    const set = new Set<number>();
    while (set.size < 6) set.add(Math.floor(Math.random() * 49) + 1);
    setNums(Array.from(set).sort((a, b) => a - b));
  };
  useEffect(() => {
    generate();
  }, []);
  return (
    <div className="tool-workspace">
      <ToolHeader
        title="Lucky Lottery Picker"
        desc="Generate 6 unique random lottery number balls."
      />
      <button onClick={generate} className="os-btn os-btn-primary w-fit mb-3">
        Pick Numbers
      </button>
      <div className="flex gap-2 justify-center">
        {nums.map((n, i) => (
          <div
            key={i}
            className="w-10 h-10 rounded-full bg-linear-to-tr from-cyan-600 to-blue-500 text-white font-mono font-bold flex items-center justify-center shadow-lg text-sm border border-white/30"
          >
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}

export const GENERATOR_TOOLS = {
  PasswordGenerator,
  UuidGenerator,
  LoremIpsum,
  RandomNumber,
  DiceRoller,
  RandomPicker,
  NameGenerator,
  SecureToken,
  BinaryConverter,
  MACGenerator,
  IPv4Generator,
  CreditCardGenerator,
  ColorGenerator,
  SerialNumber,
  SaltGenerator,
  HexGenerator,
  BarCode,
  OTPGenerator,
  KeyPairGenerator,
  LotteryGenerator,
};
