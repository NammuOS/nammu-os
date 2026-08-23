import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Download,
  Copy,
  Check,
  Calculator,
  Binary,
  Calendar,
  DollarSign,
  BarChart2,
  Cpu,
  RefreshCw,
  Delete,
  Percent,
  Sparkles,
  Hash,
  HelpCircle,
  History,
  ArrowRightLeft,
  BookOpen,
  Layers,
  Zap,
  Gauge,
  Clock,
  HardDrive,
  Wifi,
  Monitor,
  Crop,
  Keyboard,
  Activity,
  Heart,
  Search,
  Shield,
  LayoutGrid,
  Fuel,
  Eye,
  Trash2,
} from 'lucide-react';
import {
  evaluateExpression,
  formatNumber,
  isPrime,
  primeFactors,
  gcd,
  lcm,
  factorial,
  type AngleMode,
} from './calculatorEngine';

// ==========================================
// Reusable OS Header & Utility Components
// ==========================================

function ToolHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold text-os-text">{title}</div>
      <div className="text-[10px] text-os-text-muted">{desc}</div>
    </div>
  );
}

function Out({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-os-border/20">
      <span className="text-[10px] text-os-text-muted">{label}</span>
      <span className="text-[10px] font-mono text-os-accent font-medium">{value}</span>
    </div>
  );
}

// ==========================================
// CALCULATOR SUITE MODES DEFINITION
// ==========================================

export type CalculatorMode =
  // Core
  | 'standard'
  | 'scientific'
  | 'programmer'
  | 'converter'
  // Finance
  | 'loan'
  | 'simple-interest'
  | 'compound-interest'
  | 'tip'
  // Math & Algebra
  | 'equation'
  | 'percentage'
  | 'circle'
  | 'triangle'
  | 'resistor'
  | 'utilities'
  // Stats
  | 'statistics'
  | 'probability'
  // Health & Date
  | 'bmi'
  | 'age'
  | 'date-diff'
  // Tech & Computing
  | 'bandwidth'
  | 'data-transfer'
  | 'screen-res'
  | 'aspect-ratio'
  | 'typing-speed'
  | 'fuel-economy';

interface HistoryItem {
  id: string;
  expression: string;
  result: string;
  timestamp: number;
}

interface NavGroup {
  name: string;
  items: { id: CalculatorMode; label: string; icon: any }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    name: 'CORE',
    items: [
      { id: 'standard', label: 'Standard', icon: Calculator },
      { id: 'scientific', label: 'Scientific', icon: Sparkles },
      { id: 'programmer', label: 'Programmer', icon: Binary },
      { id: 'converter', label: 'Unit Converter', icon: ArrowRightLeft },
    ],
  },
  {
    name: 'FINANCE',
    items: [
      { id: 'loan', label: 'Loan & Mortgage', icon: DollarSign },
      { id: 'simple-interest', label: 'Simple Interest', icon: Zap },
      { id: 'compound-interest', label: 'Compound Interest', icon: Zap },
      { id: 'tip', label: 'Tip & Split', icon: DollarSign },
    ],
  },
  {
    name: 'MATH & ALGEBRA',
    items: [
      { id: 'equation', label: 'Equation Solver', icon: Hash },
      { id: 'percentage', label: 'Percentage', icon: Percent },
      { id: 'circle', label: 'Circle Geometry', icon: Layers },
      { id: 'triangle', label: 'Triangle Area', icon: LayoutGrid },
      { id: 'resistor', label: 'Resistor Code', icon: Gauge },
      { id: 'utilities', label: 'Math Tools', icon: Layers },
    ],
  },
  {
    name: 'STATISTICS',
    items: [
      { id: 'statistics', label: 'Statistics', icon: BarChart2 },
      { id: 'probability', label: 'Probability', icon: Layers },
    ],
  },
  {
    name: 'HEALTH & TIME',
    items: [
      { id: 'bmi', label: 'BMI Health', icon: Heart },
      { id: 'age', label: 'Age Calculator', icon: Clock },
      { id: 'date-diff', label: 'Date Difference', icon: Calendar },
    ],
  },
  {
    name: 'TECH & COMPUTING',
    items: [
      { id: 'bandwidth', label: 'Bandwidth', icon: Wifi },
      { id: 'data-transfer', label: 'Data Transfer', icon: HardDrive },
      { id: 'screen-res', label: 'Screen Resolution', icon: Monitor },
      { id: 'aspect-ratio', label: 'Aspect Ratio', icon: Crop },
      { id: 'typing-speed', label: 'Typing Speed', icon: Keyboard },
      { id: 'fuel-economy', label: 'Fuel Economy', icon: Fuel },
    ],
  },
];

export function CalculatorTool() {
  const [mode, setMode] = useState<CalculatorMode>('standard');
  const [searchQuery, setSearchQuery] = useState('');
  const [expression, setExpression] = useState('');
  const [display, setDisplay] = useState('0');
  const [prevExpression, setPrevExpression] = useState('');
  const [memory, setMemory] = useState<number>(0);
  const [hasMemory, setHasMemory] = useState(false);
  const [angleMode, setAngleMode] = useState<AngleMode>('DEG');
  const [is2nd, setIs2nd] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('nammu-calc-history') || '[]');
    } catch {
      return [];
    }
  });
  const [copiedResult, setCopiedResult] = useState(false);

  // Save history
  useEffect(() => {
    localStorage.setItem('nammu-calc-history', JSON.stringify(history.slice(0, 50)));
  }, [history]);

  // Evaluate & append to history
  const handleCalculate = useCallback(() => {
    const exprToEval = expression || display;
    if (!exprToEval || exprToEval === '0') return;

    const res = evaluateExpression(exprToEval, angleMode);
    if (res.success && res.formatted !== undefined && res.value !== undefined) {
      setDisplay(res.formatted);
      setPrevExpression(exprToEval + ' =');
      setExpression('');

      const newItem: HistoryItem = {
        id: Date.now().toString(),
        expression: exprToEval,
        result: res.formatted,
        timestamp: Date.now(),
      };
      setHistory((prev) => [newItem, ...prev.slice(0, 49)]);
    } else {
      setDisplay(res.error || 'Error');
    }
  }, [expression, display, angleMode]);

  // Keypad button input
  const inputChar = useCallback(
    (char: string) => {
      if (
        display === 'Error' ||
        display === 'Cannot divide by zero' ||
        display === 'Invalid expression'
      ) {
        setDisplay('0');
        setExpression('');
      }

      if (char === 'C') {
        setExpression('');
        setDisplay('0');
        setPrevExpression('');
        return;
      }

      if (char === 'CE') {
        setDisplay('0');
        return;
      }

      if (char === '⌫') {
        if (expression.length > 0) {
          const next = expression.slice(0, -1);
          setExpression(next);
          setDisplay(next || '0');
        } else if (display.length > 1 && display !== '0') {
          const next = display.slice(0, -1);
          setDisplay(next);
        } else {
          setDisplay('0');
        }
        return;
      }

      if (char === '=') {
        handleCalculate();
        return;
      }

      if (char === '±') {
        try {
          const currentNum = parseFloat(display.replace(/,/g, ''));
          if (!isNaN(currentNum)) {
            const toggled = -currentNum;
            setDisplay(toggled.toString());
            if (expression) setExpression(toggled.toString());
          }
        } catch {}
        return;
      }

      // Append to expression
      setExpression((prev) => {
        let next = prev;
        if (next === '' && display !== '0' && ['+', '-', '*', '/', '%', '^'].includes(char)) {
          next = display.replace(/,/g, '');
        }
        return next + char;
      });

      setDisplay((prev) => {
        if (prev === '0' && !['+', '-', '*', '/', '%', '^', '.'].includes(char)) {
          return char;
        }
        return prev + char;
      });
    },
    [display, expression, handleCalculate],
  );

  // Memory functions
  const handleMemory = useCallback(
    (action: 'MC' | 'MR' | 'M+' | 'M-' | 'MS') => {
      const currentVal = parseFloat(display.replace(/,/g, '')) || 0;
      switch (action) {
        case 'MC':
          setMemory(0);
          setHasMemory(false);
          break;
        case 'MR':
          if (hasMemory) {
            setDisplay(memory.toString());
            setExpression((prev) => prev + memory.toString());
          }
          break;
        case 'M+':
          setMemory((prev) => prev + currentVal);
          setHasMemory(true);
          break;
        case 'M-':
          setMemory((prev) => prev - currentVal);
          setHasMemory(true);
          break;
        case 'MS':
          setMemory(currentVal);
          setHasMemory(currentVal !== 0);
          break;
      }
    },
    [display, hasMemory, memory],
  );

  // Keyboard navigation for standard & scientific
  useEffect(() => {
    if (mode !== 'standard' && mode !== 'scientific') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

      if (e.key >= '0' && e.key <= '9') inputChar(e.key);
      else if (e.key === '.') inputChar('.');
      else if (e.key === '+') inputChar('+');
      else if (e.key === '-') inputChar('-');
      else if (e.key === '*') inputChar('*');
      else if (e.key === '/') inputChar('/');
      else if (e.key === '%') inputChar('%');
      else if (e.key === '^') inputChar('^');
      else if (e.key === '(') inputChar('(');
      else if (e.key === ')') inputChar(')');
      else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        inputChar('=');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        inputChar('⌫');
      } else if (e.key === 'Escape') {
        inputChar('C');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inputChar, mode]);

  // Copy result
  const copyDisplay = () => {
    navigator.clipboard.writeText(display.replace(/,/g, '')).then(() => {
      setCopiedResult(true);
      setTimeout(() => setCopiedResult(false), 1500);
    });
  };

  // Filtered Nav Groups by search
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return NAV_GROUPS;
    const q = searchQuery.toLowerCase().trim();
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((it) => it.label.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0);
  }, [searchQuery]);

  return (
    <div className="flex h-full min-h-0 bg-[#05080d] text-[11px] select-none">
      {/* Cloud-Inspired Left Sidebar */}
      <aside className="w-44 shrink-0 border-r border-white/[0.06] bg-white/[0.012] p-2 flex flex-col justify-between select-none">
        <div className="flex-1 overflow-y-auto os-scrollbar pr-1">
          {/* Quick Search */}
          <div className="mb-2.5 flex items-center gap-1.5 border border-white/[0.06] bg-black/20 px-2 py-1 rounded-[3px]">
            <Search size={10} className="text-[#4aa3ff]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Find calculator..."
              className="min-w-0 flex-1 bg-transparent text-[9px] text-[#c9d8e4] outline-none"
            />
          </div>

          <nav className="space-y-3" aria-label="Calculator Categories">
            {filteredGroups.map((group) => (
              <div key={group.name}>
                <div className="mb-1 px-2 font-mono text-[8px] uppercase tracking-[0.2em] text-[#476077]">
                  {group.name}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = mode === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setMode(item.id)}
                        className={`flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-[10.5px] transition-colors ${
                          isActive
                            ? 'bg-[#4aa3ff]/10 text-[#cfe6ff] font-medium border-l-2 border-[#4aa3ff]'
                            : 'text-[#71889d] hover:bg-white/[0.035] hover:text-[#bcd0df]'
                        }`}
                      >
                        <Icon
                          size={12}
                          className={isActive ? 'text-[#4aa3ff]' : 'text-[#61788c]'}
                        />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom Status Gauge */}
        <div className="mt-3 border-t border-white/[0.05] pt-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[8px] text-[#476077] uppercase tracking-wider">
              {mode.toUpperCase()}
            </span>
            <span className="font-mono text-[8px] text-os-text-dim">{history.length} runs</span>
          </div>
          {hasMemory && (
            <div className="mt-1 px-1 flex items-center justify-between font-mono text-[8px] text-os-accent">
              <span>MEM: {formatNumber(memory)}</span>
              <button
                onClick={() => handleMemory('MC')}
                className="hover:underline text-[7.5px] text-os-text-muted"
              >
                CLEAR
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Pane */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-y-auto os-scrollbar p-4">
            {mode === 'standard' && (
              <div className="flex flex-col max-w-sm mx-auto w-full h-full justify-between">
                {/* Display */}
                <div className="bg-[#05070b] border border-os-border/30 rounded-sm p-3 mb-2 flex flex-col justify-end min-h-[90px] shadow-inner relative group">
                  <div className="flex items-center justify-between text-[10px] font-mono text-os-text-dim mb-1">
                    <span className="flex items-center gap-1.5">
                      {hasMemory && (
                        <span className="px-1 py-0.2 rounded bg-os-accent/10 border border-os-accent/20 text-os-accent text-[8px] font-semibold">
                          M
                        </span>
                      )}
                    </span>
                    <span className="truncate max-w-[200px]">{prevExpression || expression}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-2xl font-mono text-os-text font-semibold tracking-wide truncate">
                      {display}
                    </span>
                    <button
                      onClick={copyDisplay}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-os-text-muted hover:text-os-accent"
                      title="Copy result"
                    >
                      {copiedResult ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>

                {/* Memory Strip */}
                <div className="grid grid-cols-5 gap-1 mb-2">
                  {(['MC', 'MR', 'M+', 'M-', 'MS'] as const).map((mem) => (
                    <button
                      key={mem}
                      onClick={() => handleMemory(mem)}
                      disabled={mem === 'MC' || mem === 'MR' ? !hasMemory : false}
                      className={`py-1 text-[10px] font-mono rounded-sm border transition-colors ${
                        hasMemory && (mem === 'MC' || mem === 'MR')
                          ? 'border-os-accent/30 text-os-accent hover:bg-os-accent/10'
                          : 'border-os-border/20 text-os-text-muted hover:text-os-text hover:bg-white/[0.04] disabled:opacity-40 disabled:hover:bg-transparent'
                      }`}
                    >
                      {mem}
                    </button>
                  ))}
                </div>

                {/* Standard Keypad */}
                <div className="grid grid-cols-4 gap-1.5 flex-1">
                  {[
                    { label: '%', val: '%' },
                    { label: 'CE', val: 'CE' },
                    { label: 'C', val: 'C' },
                    { label: '⌫', val: '⌫' },
                    { label: '1/x', val: '1/' },
                    { label: 'x²', val: '^2' },
                    { label: '√x', val: 'sqrt(' },
                    { label: '÷', val: '/' },
                    { label: '7', val: '7' },
                    { label: '8', val: '8' },
                    { label: '9', val: '9' },
                    { label: '×', val: '*' },
                    { label: '4', val: '4' },
                    { label: '5', val: '5' },
                    { label: '6', val: '6' },
                    { label: '-', val: '-' },
                    { label: '1', val: '1' },
                    { label: '2', val: '2' },
                    { label: '3', val: '3' },
                    { label: '+', val: '+' },
                    { label: '±', val: '±' },
                    { label: '0', val: '0' },
                    { label: '.', val: '.' },
                    { label: '=', val: '=' },
                  ].map((b) => {
                    const isEquals = b.val === '=';
                    const isOp = ['/', '*', '-', '+', '=', '%'].includes(b.val);
                    return (
                      <button
                        key={b.label}
                        onClick={() => inputChar(b.val)}
                        className={`flex items-center justify-center font-mono rounded-sm transition-all text-xs select-none active:scale-[0.97] ${
                          isEquals
                            ? 'bg-os-accent/25 border border-os-accent/60 text-os-accent font-semibold shadow-sm hover:bg-os-accent/35'
                            : isOp
                              ? 'bg-os-surface/40 border border-os-border/30 text-[#8ec4ff] hover:bg-os-surface/70 hover:border-os-accent/40'
                              : 'bg-[#090e18]/80 border border-os-border/20 text-os-text hover:bg-os-surface/40 hover:border-os-border/40'
                        }`}
                        style={{ minHeight: '38px' }}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {mode === 'scientific' && (
              <div className="flex flex-col max-w-xl mx-auto w-full h-full justify-between">
                {/* Display */}
                <div className="bg-[#05070b] border border-os-border/30 rounded-sm p-3 mb-2 flex flex-col justify-end min-h-[90px] shadow-inner relative group">
                  <div className="flex items-center justify-between text-[10px] font-mono text-os-text-dim mb-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setAngleMode((m) => (m === 'DEG' ? 'RAD' : m === 'RAD' ? 'GRAD' : 'DEG'))
                        }
                        className="px-1.5 py-0.5 rounded bg-os-surface border border-os-border/40 text-os-accent text-[9px] font-semibold"
                      >
                        {angleMode}
                      </button>
                      {hasMemory && (
                        <span className="px-1 py-0.2 rounded bg-os-accent/10 border border-os-accent/20 text-os-accent text-[8px] font-semibold">
                          M
                        </span>
                      )}
                    </div>
                    <span className="truncate max-w-[300px]">{prevExpression || expression}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-2xl font-mono text-os-text font-semibold tracking-wide truncate">
                      {display}
                    </span>
                    <button
                      onClick={copyDisplay}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-os-text-muted hover:text-os-accent"
                      title="Copy result"
                    >
                      {copiedResult ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>

                {/* Scientific Keypad */}
                <div className="grid grid-cols-5 gap-1 flex-1 text-[11px]">
                  {[
                    { label: is2nd ? 'asin' : 'sin', val: is2nd ? 'asin(' : 'sin(' },
                    { label: is2nd ? 'acos' : 'cos', val: is2nd ? 'acos(' : 'cos(' },
                    { label: is2nd ? 'atan' : 'tan', val: is2nd ? 'atan(' : 'tan(' },
                    { label: 'π', val: 'π' },
                    { label: 'e', val: 'e' },

                    { label: is2nd ? 'asinh' : 'sinh', val: is2nd ? 'asinh(' : 'sinh(' },
                    { label: is2nd ? 'acosh' : 'cosh', val: is2nd ? 'acosh(' : 'cosh(' },
                    { label: is2nd ? 'atanh' : 'tanh', val: is2nd ? 'atanh(' : 'tanh(' },
                    { label: 'ln', val: 'ln(' },
                    { label: 'log', val: 'log(' },

                    { label: '2nd', action: () => setIs2nd(!is2nd), active: is2nd },
                    { label: 'xʸ', val: '^' },
                    { label: '√', val: 'sqrt(' },
                    { label: 'x!', val: '!' },
                    { label: '1/x', val: '1/' },

                    { label: '(', val: '(' },
                    { label: ')', val: ')' },
                    { label: 'CE', val: 'CE' },
                    { label: 'C', val: 'C' },
                    { label: '⌫', val: '⌫' },

                    { label: '7', val: '7' },
                    { label: '8', val: '8' },
                    { label: '9', val: '9' },
                    { label: '÷', val: '/' },
                    { label: '%', val: '%' },

                    { label: '4', val: '4' },
                    { label: '5', val: '5' },
                    { label: '6', val: '6' },
                    { label: '×', val: '*' },
                    { label: '±', val: '±' },

                    { label: '1', val: '1' },
                    { label: '2', val: '2' },
                    { label: '3', val: '3' },
                    { label: '-', val: '-' },
                    { label: 'exp', val: 'exp(' },

                    { label: '0', val: '0' },
                    { label: '.', val: '.' },
                    { label: '=', val: '=' },
                    { label: '+', val: '+' },
                    { label: 'abs', val: 'abs(' },
                  ].map((b, idx) => {
                    const isEquals = b.val === '=';
                    const isNumber = b.val && /^[0-9.]$/.test(b.val);
                    return (
                      <button
                        key={idx}
                        onClick={() => (b.action ? b.action() : inputChar(b.val!))}
                        className={`flex items-center justify-center font-mono rounded-sm transition-all py-2 select-none active:scale-[0.97] ${
                          b.active
                            ? 'bg-os-accent text-black font-bold shadow-sm'
                            : isEquals
                              ? 'bg-os-accent/25 border border-os-accent/60 text-os-accent font-semibold shadow-sm hover:bg-os-accent/35'
                              : isNumber
                                ? 'bg-[#090e18]/80 border border-os-border/20 text-os-text hover:bg-os-surface/40'
                                : 'bg-os-surface/30 border border-os-border/25 text-[#9ac5e8] hover:bg-os-surface/60 hover:text-white'
                        }`}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {mode === 'programmer' && <ProgrammerMode />}
            {mode === 'converter' && <ConverterMode />}
            {mode === 'loan' && <LoanMode />}
            {mode === 'simple-interest' && <SimpleInterestMode />}
            {mode === 'compound-interest' && <CompoundInterestMode />}
            {mode === 'tip' && <TipMode />}
            {mode === 'equation' && <EquationMode />}
            {mode === 'percentage' && <PercentageMode />}
            {mode === 'circle' && <CircleMode />}
            {mode === 'triangle' && <TriangleMode />}
            {mode === 'resistor' && <ResistorMode />}
            {mode === 'utilities' && <UtilitiesMode />}
            {mode === 'statistics' && <StatisticsMode />}
            {mode === 'probability' && <ProbabilityMode />}
            {mode === 'bmi' && <BMIMode />}
            {mode === 'age' && <AgeMode />}
            {mode === 'date-diff' && <DateDiffMode />}
            {mode === 'bandwidth' && <BandwidthMode />}
            {mode === 'data-transfer' && <DataTransferMode />}
            {mode === 'screen-res' && <ScreenResMode />}
            {mode === 'aspect-ratio' && <AspectRatioMode />}
            {mode === 'typing-speed' && <TypingSpeedMode />}
            {mode === 'fuel-economy' && <FuelEconomyMode />}
          </div>

          {/* History Sidebar - Always Open on the Right Side */}
          <aside className="w-56 shrink-0 border-l border-white/[0.06] bg-[#060a12]/95 p-3 flex flex-col justify-between select-none">
            <div className="flex items-center justify-between pb-2 border-b border-os-border/20 text-xs font-semibold text-os-text">
              <span className="flex items-center gap-1.5 text-os-text">
                <History size={12} className="text-os-accent" /> History
              </span>
              {history.length > 0 && (
                <button
                  onClick={() => setHistory([])}
                  className="text-[10px] text-os-text-muted hover:text-os-red transition-colors flex items-center gap-1"
                  title="Clear history"
                >
                  <Trash2 size={10} /> Clear
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto os-scrollbar space-y-2 py-2">
              {history.length === 0 ? (
                <div className="text-[11px] text-os-text-dim text-center py-12 leading-relaxed">
                  No calculations yet.
                  <br />
                  <span className="text-[9px] text-[#476077]">
                    Results will appear here automatically.
                  </span>
                </div>
              ) : (
                history.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      setDisplay(item.result);
                      setExpression(item.result);
                    }}
                    className="p-2 rounded bg-os-surface/30 border border-os-border/20 text-right cursor-pointer hover:border-os-accent/30 transition-all group"
                    title="Click to load into calculator"
                  >
                    <div className="text-[10px] font-mono text-os-text-muted truncate">
                      {item.expression} =
                    </div>
                    <div className="text-xs font-mono text-os-accent font-semibold truncate mt-0.5">
                      {item.result}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

// ==========================================
// 1. PROGRAMMER CALCULATOR MODE
// ==========================================
function ProgrammerMode() {
  const [val, setVal] = useState<bigint>(0n);
  const [wordSize, setWordSize] = useState<'64' | '32' | '16' | '8'>('64');

  const mask = useMemo(() => {
    if (wordSize === '8') return 0xffn;
    if (wordSize === '16') return 0xffffn;
    if (wordSize === '32') return 0xffffffffn;
    return 0xffffffffffffffffn;
  }, [wordSize]);

  const currentVal = val & mask;

  const hex = currentVal.toString(16).toUpperCase();
  const dec = currentVal.toString(10);
  const oct = currentVal.toString(8);
  const bin = currentVal.toString(2).padStart(Number(wordSize), '0');

  const toggleBit = (bitIndex: number) => {
    const bitMask = 1n << BigInt(bitIndex);
    setVal((prev) => (prev ^ bitMask) & mask);
  };

  return (
    <div className="max-w-xl mx-auto w-full space-y-3">
      <ToolHeader
        title="Programmer Calculator"
        desc="Hexadecimal, Decimal, Octal, Binary, bitwise operations and bitboards."
      />
      {/* Bases Display */}
      <div className="bg-[#05070b] border border-os-border/30 rounded-sm p-3 space-y-1.5 font-mono text-xs shadow-inner">
        <div className="flex justify-between items-center text-os-text">
          <span className="text-[10px] text-os-text-dim uppercase w-10">HEX</span>
          <span className="text-os-accent font-semibold">{hex || '0'}</span>
        </div>
        <div className="flex justify-between items-center text-os-text">
          <span className="text-[10px] text-os-text-dim uppercase w-10">DEC</span>
          <span className="text-[#e2e8f0] font-semibold">{dec}</span>
        </div>
        <div className="flex justify-between items-center text-os-text">
          <span className="text-[10px] text-os-text-dim uppercase w-10">OCT</span>
          <span className="text-[#9ac5e8]">{oct}</span>
        </div>
        <div className="flex justify-between items-center text-os-text">
          <span className="text-[10px] text-os-text-dim uppercase w-10">BIN</span>
          <span className="text-[11px] text-os-emerald tracking-widest break-all text-right">
            {bin}
          </span>
        </div>
      </div>

      {/* Word Size Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['64', '32', '16', '8'] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWordSize(w)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded border ${
                wordSize === w
                  ? 'border-os-accent bg-os-accent/15 text-os-accent font-semibold'
                  : 'border-os-border/20 text-os-text-muted hover:text-os-text'
              }`}
            >
              {w === '64' ? 'QWORD' : w === '32' ? 'DWORD' : w === '16' ? 'WORD' : 'BYTE'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setVal(0n)}
          className="px-2 py-0.5 text-[10px] font-mono rounded border border-os-border/20 text-os-text-muted hover:text-os-accent"
        >
          CLEAR
        </button>
      </div>

      {/* Interactive Bitboard */}
      <div className="bg-[#080d16] border border-os-border/30 rounded-sm p-3">
        <div className="text-[10px] text-os-text-dim mb-2 uppercase tracking-wider font-semibold">
          Interactive Bitboard (Click to toggle bit)
        </div>
        <div className="grid grid-cols-8 sm:grid-cols-16 gap-1 font-mono text-[10px]">
          {Array.from({ length: Number(wordSize) }, (_, idx) => {
            const bitPos = Number(wordSize) - 1 - idx;
            const isSet = (currentVal & (1n << BigInt(bitPos))) !== 0n;
            return (
              <button
                key={bitPos}
                onClick={() => toggleBit(bitPos)}
                className={`py-1 rounded border text-center transition-all ${
                  isSet
                    ? 'border-os-emerald bg-os-emerald/20 text-os-emerald font-bold shadow-sm'
                    : 'border-os-border/20 bg-black/40 text-os-text-dim hover:text-os-text-muted'
                }`}
                title={`Bit ${bitPos} = ${isSet ? 1 : 0}`}
              >
                {isSet ? 1 : 0}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bitwise operations */}
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { label: 'AND (&)', act: () => setVal((v) => v & 0xffn & mask) },
          { label: 'OR (|)', act: () => setVal((v) => (v | 0xffn) & mask) },
          { label: 'XOR (^)', act: () => setVal((v) => (v ^ 0xffn) & mask) },
          { label: 'NOT (~)', act: () => setVal((v) => ~v & mask) },
          { label: 'LSH (<< 1)', act: () => setVal((v) => (v << 1n) & mask) },
          { label: 'RSH (>> 1)', act: () => setVal((v) => (v >> 1n) & mask) },
          { label: '+ 1', act: () => setVal((v) => (v + 1n) & mask) },
          { label: '- 1', act: () => setVal((v) => (v - 1n) & mask) },
        ].map((b) => (
          <button
            key={b.label}
            onClick={b.act}
            className="os-btn py-1.5 text-center font-mono text-[11px]"
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ==========================================
// 2. UNIT CONVERTER MODE
// ==========================================
const CONVERSION_CATEGORIES: Record<string, { units: string[]; toBase: Record<string, number> }> = {
  Length: {
    units: ['Millimeter', 'Centimeter', 'Meter', 'Kilometer', 'Inch', 'Foot', 'Yard', 'Mile'],
    toBase: {
      Millimeter: 0.001,
      Centimeter: 0.01,
      Meter: 1,
      Kilometer: 1000,
      Inch: 0.0254,
      Foot: 0.3048,
      Yard: 0.9144,
      Mile: 1609.344,
    },
  },
  Mass: {
    units: ['Milligram', 'Gram', 'Kilogram', 'Metric Ton', 'Ounce', 'Pound', 'Stone'],
    toBase: {
      Milligram: 0.000001,
      Gram: 0.001,
      Kilogram: 1,
      'Metric Ton': 1000,
      Ounce: 0.0283495,
      Pound: 0.453592,
      Stone: 6.35029,
    },
  },
  Area: {
    units: ['Square Meter', 'Square Kilometer', 'Square Foot', 'Square Mile', 'Acre', 'Hectare'],
    toBase: {
      'Square Meter': 1,
      'Square Kilometer': 1000000,
      'Square Foot': 0.092903,
      'Square Mile': 2589988.11,
      Acre: 4046.86,
      Hectare: 10000,
    },
  },
  Volume: {
    units: [
      'Milliliter',
      'Liter',
      'Cubic Meter',
      'Gallon (US)',
      'Quart (US)',
      'Pint (US)',
      'Cup (US)',
    ],
    toBase: {
      Milliliter: 0.001,
      Liter: 1,
      'Cubic Meter': 1000,
      'Gallon (US)': 3.78541,
      'Quart (US)': 0.946353,
      'Pint (US)': 0.473176,
      'Cup (US)': 0.236588,
    },
  },
  Speed: {
    units: ['Meter/sec', 'Km/hour', 'Miles/hour', 'Knot', 'Mach'],
    toBase: {
      'Meter/sec': 1,
      'Km/hour': 0.277778,
      'Miles/hour': 0.44704,
      Knot: 0.514444,
      Mach: 340.29,
    },
  },
  'Digital Storage': {
    units: ['Bit', 'Byte', 'KB', 'MB', 'GB', 'TB', 'PB', 'KiB', 'MiB', 'GiB', 'TiB'],
    toBase: {
      Bit: 0.125,
      Byte: 1,
      KB: 1e3,
      MB: 1e6,
      GB: 1e9,
      TB: 1e12,
      PB: 1e15,
      KiB: 1024,
      MiB: 1024 ** 2,
      GiB: 1024 ** 3,
      TiB: 1024 ** 4,
    },
  },
  Time: {
    units: ['Millisecond', 'Second', 'Minute', 'Hour', 'Day', 'Week', 'Year (365d)'],
    toBase: {
      Millisecond: 0.001,
      Second: 1,
      Minute: 60,
      Hour: 3600,
      Day: 86400,
      Week: 604800,
      'Year (365d)': 31536000,
    },
  },
};

function ConverterMode() {
  const [cat, setCat] = useState<string>('Length');
  const [val, setVal] = useState<number>(100);
  const [fromUnit, setFromUnit] = useState<string>('Meter');
  const [toUnit, setToUnit] = useState<string>('Foot');

  const activeCat = CONVERSION_CATEGORIES[cat] || CONVERSION_CATEGORIES['Length'];

  const converted = useMemo(() => {
    if (cat === 'Temperature') {
      let c = val;
      if (fromUnit === 'Fahrenheit') c = ((val - 32) * 5) / 9;
      else if (fromUnit === 'Kelvin') c = val - 273.15;

      if (toUnit === 'Fahrenheit') return (c * 9) / 5 + 32;
      if (toUnit === 'Kelvin') return c + 273.15;
      return c;
    }
    const fromFactor = activeCat.toBase[fromUnit] || 1;
    const toFactor = activeCat.toBase[toUnit] || 1;
    return (val * fromFactor) / toFactor;
  }, [cat, val, fromUnit, toUnit, activeCat]);

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Unit Converter"
        desc="Fast bidirectional scientific, metric, and imperial conversions."
      />

      {/* Category Pills */}
      <div className="flex flex-wrap gap-1">
        {Object.keys(CONVERSION_CATEGORIES)
          .concat(['Temperature'])
          .map((c) => (
            <button
              key={c}
              onClick={() => {
                setCat(c);
                if (c === 'Temperature') {
                  setFromUnit('Celsius');
                  setToUnit('Fahrenheit');
                } else {
                  setFromUnit(CONVERSION_CATEGORIES[c].units[0]);
                  setToUnit(CONVERSION_CATEGORIES[c].units[1] || CONVERSION_CATEGORIES[c].units[0]);
                }
              }}
              className={`px-2 py-0.5 text-[10px] rounded border transition-all ${
                cat === c
                  ? 'border-os-accent bg-os-accent/15 text-os-accent font-medium'
                  : 'border-os-border/20 text-os-text-muted hover:text-os-text'
              }`}
            >
              {c}
            </button>
          ))}
      </div>

      {/* Inputs */}
      <div className="space-y-2">
        <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-1">
          <div className="text-[10px] text-os-text-muted">From</div>
          <div className="flex gap-2">
            <input
              type="number"
              value={val}
              onChange={(e) => setVal(parseFloat(e.target.value) || 0)}
              className="os-input font-mono text-sm flex-1"
            />
            <select
              value={fromUnit}
              onChange={(e) => setFromUnit(e.target.value)}
              className="os-input font-mono text-xs bg-[#090e18]"
            >
              {(cat === 'Temperature' ? ['Celsius', 'Fahrenheit', 'Kelvin'] : activeCat.units).map(
                (u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ),
              )}
            </select>
          </div>
        </div>

        <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-1">
          <div className="text-[10px] text-os-text-muted">To</div>
          <div className="flex gap-2 items-center">
            <div className="font-mono text-lg text-os-accent font-semibold flex-1 truncate px-2 py-1 bg-black/40 rounded">
              {formatNumber(converted)}
            </div>
            <select
              value={toUnit}
              onChange={(e) => setToUnit(e.target.value)}
              className="os-input font-mono text-xs bg-[#090e18]"
            >
              {(cat === 'Temperature' ? ['Celsius', 'Fahrenheit', 'Kelvin'] : activeCat.units).map(
                (u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ),
              )}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 3. LOAN & MORTGAGE CALCULATOR
// ==========================================
function LoanMode() {
  const [principal, setPrincipal] = useState(250000);
  const [rate, setRate] = useState(6.5);
  const [years, setYears] = useState(30);

  const { monthlyPayment, totalPayment, totalInterest } = useMemo(() => {
    const p = principal;
    const r = rate / 100 / 12;
    const n = years * 12;
    if (r === 0 || n === 0) return { monthlyPayment: 0, totalPayment: 0, totalInterest: 0 };
    const emi = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const tot = emi * n;
    return {
      monthlyPayment: emi,
      totalPayment: tot,
      totalInterest: tot - p,
    };
  }, [principal, rate, years]);

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Loan & Mortgage EMI Calculator"
        desc="Calculate monthly installments, interest breakdown, and payoff schedule."
      />
      <div className="space-y-2">
        <div>
          <label className="text-[10px] text-os-text-muted block mb-0.5">Loan Principal ($)</label>
          <input
            type="number"
            value={principal}
            onChange={(e) => setPrincipal(parseFloat(e.target.value) || 0)}
            className="os-input w-full font-mono text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-os-text-muted block mb-0.5">
              Annual Interest Rate (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
              className="os-input w-full font-mono text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] text-os-text-muted block mb-0.5">Term (Years)</label>
            <input
              type="number"
              value={years}
              onChange={(e) => setYears(parseFloat(e.target.value) || 0)}
              className="os-input w-full font-mono text-xs"
            />
          </div>
        </div>
      </div>

      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Monthly Payment (EMI)" value={`$${formatNumber(monthlyPayment)}`} />
        <Out label="Total Interest" value={`$${formatNumber(totalInterest)}`} />
        <Out label="Total Payable" value={`$${formatNumber(totalPayment)}`} />
      </div>
    </div>
  );
}

// ==========================================
// 4. SIMPLE INTEREST
// ==========================================
function SimpleInterestMode() {
  const [p, setP] = useState(10000);
  const [r, setR] = useState(5);
  const [t, setT] = useState(3);

  const interest = (p * r * t) / 100;
  const total = p + interest;

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Simple Interest Calculator"
        desc="Calculate standard investment or deposit returns (I = P × R × T)."
      />
      <div className="space-y-2">
        <input
          type="number"
          value={p}
          onChange={(e) => setP(parseFloat(e.target.value) || 0)}
          className="os-input w-full font-mono text-xs"
          placeholder="Principal Amount ($)"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            step="0.1"
            value={r}
            onChange={(e) => setR(parseFloat(e.target.value) || 0)}
            className="os-input w-full font-mono text-xs"
            placeholder="Interest Rate (% / yr)"
          />
          <input
            type="number"
            value={t}
            onChange={(e) => setT(parseFloat(e.target.value) || 0)}
            className="os-input w-full font-mono text-xs"
            placeholder="Time Period (Years)"
          />
        </div>
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Total Interest" value={`$${formatNumber(interest)}`} />
        <Out label="Final Balance" value={`$${formatNumber(total)}`} />
      </div>
    </div>
  );
}

// ==========================================
// 5. COMPOUND INTEREST
// ==========================================
function CompoundInterestMode() {
  const [p, setP] = useState(10000);
  const [r, setR] = useState(7);
  const [t, setT] = useState(10);
  const [n, setN] = useState(12);

  const total = p * Math.pow(1 + r / 100 / n, n * t);
  const interest = total - p;

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Compound Interest Calculator"
        desc="Calculate wealth growth with periodic compound interest (A = P(1 + r/n)^(nt))."
      />
      <div className="space-y-2">
        <input
          type="number"
          value={p}
          onChange={(e) => setP(parseFloat(e.target.value) || 0)}
          className="os-input w-full font-mono text-xs"
          placeholder="Initial Investment ($)"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            step="0.1"
            value={r}
            onChange={(e) => setR(parseFloat(e.target.value) || 0)}
            className="os-input w-full font-mono text-xs"
            placeholder="Annual Rate (%)"
          />
          <input
            type="number"
            value={t}
            onChange={(e) => setT(parseFloat(e.target.value) || 0)}
            className="os-input w-full font-mono text-xs"
            placeholder="Years"
          />
        </div>
        <select
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          className="os-input w-full font-mono text-xs bg-[#090e18]"
        >
          <option value={1}>Compounded Annually (1/yr)</option>
          <option value={2}>Compounded Semi-Annually (2/yr)</option>
          <option value={4}>Compounded Quarterly (4/yr)</option>
          <option value={12}>Compounded Monthly (12/yr)</option>
          <option value={365}>Compounded Daily (365/yr)</option>
        </select>
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Compound Interest Earned" value={`$${formatNumber(interest)}`} />
        <Out label="Future Value" value={`$${formatNumber(total)}`} />
      </div>
    </div>
  );
}

// ==========================================
// 6. TIP & BILL SPLIT CALCULATOR
// ==========================================
function TipMode() {
  const [bill, setBill] = useState(75);
  const [tipPct, setTipPct] = useState(18);
  const [people, setPeople] = useState(2);

  const tip = (bill * tipPct) / 100;
  const total = bill + tip;
  const perPerson = total / Math.max(1, people);

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Tip & Split Calculator"
        desc="Calculate gratuity and evenly distribute restaurant bills."
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          type="number"
          value={bill}
          onChange={(e) => setBill(parseFloat(e.target.value) || 0)}
          className="os-input w-full font-mono text-xs"
          placeholder="Bill ($)"
        />
        <input
          type="number"
          value={tipPct}
          onChange={(e) => setTipPct(parseFloat(e.target.value) || 0)}
          className="os-input w-full font-mono text-xs"
          placeholder="Tip %"
        />
        <input
          type="number"
          min="1"
          value={people}
          onChange={(e) => setPeople(parseInt(e.target.value) || 1)}
          className="os-input w-full font-mono text-xs"
          placeholder="People"
        />
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Tip Amount" value={`$${formatNumber(tip)}`} />
        <Out label="Total Bill" value={`$${formatNumber(total)}`} />
        <Out label="Amount Per Person" value={`$${formatNumber(perPerson)}`} />
      </div>
    </div>
  );
}

// ==========================================
// 7. EQUATION SOLVER MODE
// ==========================================
function EquationMode() {
  const [a, setA] = useState(1);
  const [b, setB] = useState(-5);
  const [c, setC] = useState(6);

  const roots = useMemo(() => {
    if (a === 0) {
      if (b === 0) return 'No solution';
      return `Linear solution: x = ${-c / b}`;
    }
    const d = b * b - 4 * a * c;
    if (d > 0) {
      const x1 = (-b + Math.sqrt(d)) / (2 * a);
      const x2 = (-b - Math.sqrt(d)) / (2 * a);
      return `Two real roots: x₁ = ${formatNumber(x1)}, x₂ = ${formatNumber(x2)}`;
    } else if (d === 0) {
      const x = -b / (2 * a);
      return `One real root: x = ${formatNumber(x)}`;
    } else {
      const real = (-b / (2 * a)).toFixed(3);
      const img = (Math.sqrt(-d) / (2 * a)).toFixed(3);
      return `Complex roots: x = ${real} ± ${img}i`;
    }
  }, [a, b, c]);

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Quadratic & Linear Equation Solver"
        desc="Solves ax² + bx + c = 0 with real and complex roots."
      />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-os-text-muted block mb-0.5">a (x²)</label>
          <input
            type="number"
            value={a}
            onChange={(e) => setA(parseFloat(e.target.value) || 0)}
            className="os-input w-full font-mono text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] text-os-text-muted block mb-0.5">b (x)</label>
          <input
            type="number"
            value={b}
            onChange={(e) => setB(parseFloat(e.target.value) || 0)}
            className="os-input w-full font-mono text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] text-os-text-muted block mb-0.5">c (constant)</label>
          <input
            type="number"
            value={c}
            onChange={(e) => setC(parseFloat(e.target.value) || 0)}
            className="os-input w-full font-mono text-xs"
          />
        </div>
      </div>

      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Discriminant (Δ)" value={b * b - 4 * a * c} />
        <Out label="Roots" value={roots} />
      </div>
    </div>
  );
}

// ==========================================
// 8. PERCENTAGE CALCULATOR MODE
// ==========================================
function PercentageMode() {
  const [p1, setP1] = useState(25);
  const [t1, setT1] = useState(200);

  const [v1, setV1] = useState(50);
  const [v2, setV2] = useState(250);

  return (
    <div className="max-w-md mx-auto w-full space-y-4">
      <ToolHeader
        title="Percentage Calculator"
        desc="Instant calculation for percentage proportions and comparisons."
      />

      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2">
        <div className="text-[11px] text-os-text font-medium">What is X% of Y?</div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={p1}
            onChange={(e) => setP1(parseFloat(e.target.value) || 0)}
            className="os-input w-20 font-mono text-xs"
          />
          <span className="text-os-text-muted text-xs">% of</span>
          <input
            type="number"
            value={t1}
            onChange={(e) => setT1(parseFloat(e.target.value) || 0)}
            className="os-input w-24 font-mono text-xs"
          />
          <span className="text-os-text-muted text-xs">=</span>
          <span className="font-mono text-os-accent font-semibold text-sm">
            {formatNumber((p1 / 100) * t1)}
          </span>
        </div>
      </div>

      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2">
        <div className="text-[11px] text-os-text font-medium">X is what % of Y?</div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={v1}
            onChange={(e) => setV1(parseFloat(e.target.value) || 0)}
            className="os-input w-20 font-mono text-xs"
          />
          <span className="text-os-text-muted text-xs">is what % of</span>
          <input
            type="number"
            value={v2}
            onChange={(e) => setV2(parseFloat(e.target.value) || 0)}
            className="os-input w-24 font-mono text-xs"
          />
          <span className="text-os-text-muted text-xs">=</span>
          <span className="font-mono text-os-accent font-semibold text-sm">
            {v2 !== 0 ? `${formatNumber((v1 / v2) * 100)}%` : '0%'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 9. CIRCLE CALCULATOR
// ==========================================
function CircleMode() {
  const [r, setR] = useState(5);
  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Circle Geometry Calculator"
        desc="Calculate diameter, circumference, and area from circle radius."
      />
      <input
        type="number"
        value={r}
        onChange={(e) => setR(parseFloat(e.target.value) || 0)}
        className="os-input w-full font-mono text-xs"
        placeholder="Radius (r)"
      />
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Diameter (2r)" value={formatNumber(r * 2)} />
        <Out label="Circumference (2πr)" value={formatNumber(2 * Math.PI * r)} />
        <Out label="Surface Area (πr²)" value={formatNumber(Math.PI * r * r)} />
      </div>
    </div>
  );
}

// ==========================================
// 10. TRIANGLE AREA (HERON'S FORMULA)
// ==========================================
function TriangleMode() {
  const [a, setA] = useState(3);
  const [b, setB] = useState(4);
  const [c, setC] = useState(5);

  const s = (a + b + c) / 2;
  const areaVal = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Triangle Area Calculator"
        desc="Compute exact triangle surface area using Heron's Formula."
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          type="number"
          value={a}
          onChange={(e) => setA(parseFloat(e.target.value) || 0)}
          className="os-input w-full font-mono text-xs"
          placeholder="Side a"
        />
        <input
          type="number"
          value={b}
          onChange={(e) => setB(parseFloat(e.target.value) || 0)}
          className="os-input w-full font-mono text-xs"
          placeholder="Side b"
        />
        <input
          type="number"
          value={c}
          onChange={(e) => setC(parseFloat(e.target.value) || 0)}
          className="os-input w-full font-mono text-xs"
          placeholder="Side c"
        />
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Semi-Perimeter (s)" value={formatNumber(s)} />
        <Out label="Calculated Area" value={formatNumber(areaVal)} />
      </div>
    </div>
  );
}

// ==========================================
// 11. RESISTOR COLOR CODE
// ==========================================
function ResistorMode() {
  const [b1, setB1] = useState(1);
  const [b2, setB2] = useState(0);
  const [mul, setMul] = useState(2);
  const [tol, setTol] = useState(5);

  const val = (b1 * 10 + b2) * Math.pow(10, mul);

  const formatRes = (ohms: number) => {
    if (ohms >= 1e6) return `${(ohms / 1e6).toFixed(2)} MΩ`;
    if (ohms >= 1e3) return `${(ohms / 1e3).toFixed(2)} kΩ`;
    return `${ohms} Ω`;
  };

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="4-Band Resistor Color Code"
        desc="Decode electronic resistance value and tolerance from color bands."
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-os-text-muted block mb-1">Band 1 (1st Digit)</label>
          <select
            value={b1}
            onChange={(e) => setB1(Number(e.target.value))}
            className="os-input w-full font-mono text-xs bg-[#090e18]"
          >
            {[
              'Black (0)',
              'Brown (1)',
              'Red (2)',
              'Orange (3)',
              'Yellow (4)',
              'Green (5)',
              'Blue (6)',
              'Violet (7)',
              'Gray (8)',
              'White (9)',
            ].map((c, i) => (
              <option key={i} value={i}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-os-text-muted block mb-1">Band 2 (2nd Digit)</label>
          <select
            value={b2}
            onChange={(e) => setB2(Number(e.target.value))}
            className="os-input w-full font-mono text-xs bg-[#090e18]"
          >
            {[
              'Black (0)',
              'Brown (1)',
              'Red (2)',
              'Orange (3)',
              'Yellow (4)',
              'Green (5)',
              'Blue (6)',
              'Violet (7)',
              'Gray (8)',
              'White (9)',
            ].map((c, i) => (
              <option key={i} value={i}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-os-text-muted block mb-1">Multiplier Band</label>
          <select
            value={mul}
            onChange={(e) => setMul(Number(e.target.value))}
            className="os-input w-full font-mono text-xs bg-[#090e18]"
          >
            {[
              '1 Ω (Black)',
              '10 Ω (Brown)',
              '100 Ω (Red)',
              '1 kΩ (Orange)',
              '10 kΩ (Yellow)',
              '100 kΩ (Green)',
              '1 MΩ (Blue)',
              '10 MΩ (Violet)',
            ].map((m, i) => (
              <option key={i} value={i}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-os-text-muted block mb-1">Tolerance Band</label>
          <select
            value={tol}
            onChange={(e) => setTol(Number(e.target.value))}
            className="os-input w-full font-mono text-xs bg-[#090e18]"
          >
            <option value={1}>± 1% (Brown)</option>
            <option value={2}>± 2% (Red)</option>
            <option value={5}>± 5% (Gold)</option>
            <option value={10}>± 10% (Silver)</option>
          </select>
        </div>
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Resistance" value={formatRes(val)} />
        <Out label="Tolerance" value={`± ${tol}%`} />
        <Out
          label="Resistance Range"
          value={`${formatRes(val * (1 - tol / 100))} - ${formatRes(val * (1 + tol / 100))}`}
        />
      </div>
    </div>
  );
}

// ==========================================
// 12. MATH UTILITIES (GCD/LCM/PRIMES)
// ==========================================
function UtilitiesMode() {
  const [numA, setNumA] = useState(48);
  const [numB, setNumB] = useState(72);
  const [primeCheckNum, setPrimeCheckNum] = useState(97);

  return (
    <div className="max-w-md mx-auto w-full space-y-4">
      <ToolHeader title="Math Utilities" desc="GCD, LCM, Prime checks, and prime factorization." />
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2">
        <div className="text-[11px] text-os-text font-medium">GCD & LCM</div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            value={numA}
            onChange={(e) => setNumA(parseInt(e.target.value) || 1)}
            className="os-input font-mono text-xs"
            placeholder="Number A"
          />
          <input
            type="number"
            value={numB}
            onChange={(e) => setNumB(parseInt(e.target.value) || 1)}
            className="os-input font-mono text-xs"
            placeholder="Number B"
          />
        </div>
        <Out label="Greatest Common Divisor (GCD)" value={gcd(numA, numB)} />
        <Out label="Least Common Multiple (LCM)" value={lcm(numA, numB)} />
      </div>

      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2">
        <div className="text-[11px] text-os-text font-medium">Prime Checker & Factors</div>
        <input
          type="number"
          value={primeCheckNum}
          onChange={(e) => setPrimeCheckNum(parseInt(e.target.value) || 1)}
          className="os-input w-full font-mono text-xs"
        />
        <Out label="Is Prime?" value={isPrime(primeCheckNum) ? 'Yes (Prime)' : 'No (Composite)'} />
        <Out label="Prime Factors" value={primeFactors(primeCheckNum).join(' × ') || 'None'} />
      </div>
    </div>
  );
}

// ==========================================
// 13. STATISTICS MODE
// ==========================================
function StatisticsMode() {
  const [dataInput, setDataInput] = useState('12, 15, 18, 20, 22, 25, 28, 30');

  const stats = useMemo(() => {
    const nums = dataInput
      .split(/[\s,]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);

    if (nums.length === 0) return null;

    const count = nums.length;
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / count;
    const min = nums[0];
    const max = nums[nums.length - 1];
    const range = max - min;
    const median =
      count % 2 === 0 ? (nums[count / 2 - 1] + nums[count / 2]) / 2 : nums[Math.floor(count / 2)];

    const variance = nums.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / count;
    const sampleVariance =
      count > 1 ? nums.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (count - 1) : 0;

    return {
      count,
      sum,
      mean,
      median,
      min,
      max,
      range,
      popStdDev: Math.sqrt(variance),
      sampleStdDev: Math.sqrt(sampleVariance),
    };
  }, [dataInput]);

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Statistics Calculator"
        desc="Compute descriptive statistics for a numerical dataset."
      />
      <textarea
        value={dataInput}
        onChange={(e) => setDataInput(e.target.value)}
        placeholder="Enter numbers separated by comma or space"
        className="os-input w-full font-mono text-xs h-20 resize-none"
      />
      {stats && (
        <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-1.5">
          <Out label="Count (N)" value={stats.count} />
          <Out label="Sum" value={formatNumber(stats.sum)} />
          <Out label="Mean (Average)" value={formatNumber(stats.mean)} />
          <Out label="Median" value={formatNumber(stats.median)} />
          <Out label="Min / Max" value={`${stats.min} / ${stats.max}`} />
          <Out label="Range" value={formatNumber(stats.range)} />
          <Out label="Sample Std Dev (s)" value={formatNumber(stats.sampleStdDev)} />
          <Out label="Population Std Dev (σ)" value={formatNumber(stats.popStdDev)} />
        </div>
      )}
    </div>
  );
}

// ==========================================
// 14. PROBABILITY & COMBINATORICS
// ==========================================
function ProbabilityMode() {
  const [n, setN] = useState(5);
  const [r, setR] = useState(2);
  const perm = factorial(n) / factorial(n - r);
  const comb = factorial(n) / (factorial(r) * factorial(n - r));

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Probability & Combinatorics"
        desc="Calculate permutations P(n, r) and combinations C(n, r)."
      />
      <div className="flex gap-2">
        <input
          type="number"
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          className="os-input flex-1 font-mono text-xs"
          placeholder="Total Items (n)"
        />
        <input
          type="number"
          value={r}
          onChange={(e) => setR(Number(e.target.value))}
          className="os-input flex-1 font-mono text-xs"
          placeholder="Sample Subset (r)"
        />
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Permutations P(n,r)" value={formatNumber(perm)} />
        <Out label="Combinations C(n,r)" value={formatNumber(comb)} />
      </div>
    </div>
  );
}

// ==========================================
// 15. BMI CALCULATOR
// ==========================================
function BMIMode() {
  const [weight, setWeight] = useState(70);
  const [height, setHeight] = useState(175);

  const bmi = weight / (height / 100) ** 2;
  let cat = '';
  if (bmi < 18.5) cat = 'Underweight';
  else if (bmi < 25) cat = 'Normal weight';
  else if (bmi < 30) cat = 'Overweight';
  else cat = 'Obese';

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Body Mass Index (BMI)"
        desc="Calculate Body Mass Index and clinical weight categorization."
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="Weight (kg)"
        />
        <input
          type="number"
          value={height}
          onChange={(e) => setHeight(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="Height (cm)"
        />
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="BMI Score" value={bmi.toFixed(1)} />
        <Out label="Category" value={cat} />
      </div>
    </div>
  );
}

// ==========================================
// 16. AGE CALCULATOR
// ==========================================
function AgeMode() {
  const [birth, setBirth] = useState('2000-01-01');

  const ageData = useMemo(() => {
    if (!birth) return null;
    const b = new Date(birth);
    const now = new Date();
    let years = now.getFullYear() - b.getFullYear();
    let months = now.getMonth() - b.getMonth();
    let days = now.getDate() - b.getDate();
    if (days < 0) {
      months -= 1;
      days += 30;
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    const totalDays = Math.floor((now.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
    return { years, months, days, totalDays };
  }, [birth]);

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Age Calculator"
        desc="Calculate exact lifetime age in years, months, and total elapsed days."
      />
      <input
        type="date"
        value={birth}
        onChange={(e) => setBirth(e.target.value)}
        className="os-input w-full font-mono text-xs"
      />
      {ageData && (
        <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
          <Out
            label="Age"
            value={`${ageData.years} yrs, ${ageData.months} mos, ${ageData.days} days`}
          />
          <Out label="Total Elapsed Days" value={`${formatNumber(ageData.totalDays)} days`} />
        </div>
      )}
    </div>
  );
}

// ==========================================
// 17. DATE DIFFERENCE
// ==========================================
function DateDiffMode() {
  const [d1, setD1] = useState(new Date().toISOString().split('T')[0]);
  const [d2, setD2] = useState(new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]);

  const diffDays = useMemo(() => {
    const t1 = new Date(d1).getTime();
    const t2 = new Date(d2).getTime();
    return Math.round(Math.abs(t2 - t1) / (1000 * 60 * 60 * 24));
  }, [d1, d2]);

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Date Difference"
        desc="Calculate exact time interval between two calendar dates."
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={d1}
          onChange={(e) => setD1(e.target.value)}
          className="os-input w-full font-mono text-xs"
        />
        <input
          type="date"
          value={d2}
          onChange={(e) => setD2(e.target.value)}
          className="os-input w-full font-mono text-xs"
        />
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Difference in Days" value={`${diffDays} days`} />
        <Out label="Weeks & Days" value={`${Math.floor(diffDays / 7)} wks, ${diffDays % 7} days`} />
        <Out label="Approx. Months" value={`${(diffDays / 30.4375).toFixed(1)} months`} />
      </div>
    </div>
  );
}

// ==========================================
// 18. BANDWIDTH CALCULATOR
// ==========================================
function BandwidthMode() {
  const [fileSize, setFileSize] = useState(100);
  const [bandwidth, setBandwidth] = useState(50);
  const time = bandwidth > 0 ? (fileSize * 8) / bandwidth : 0;

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Bandwidth Transfer Calculator"
        desc="Calculate upload and download completion times across network speeds."
      />
      <div className="space-y-2">
        <input
          type="number"
          value={fileSize}
          onChange={(e) => setFileSize(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="File Size (MB)"
        />
        <input
          type="number"
          value={bandwidth}
          onChange={(e) => setBandwidth(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="Network Speed (Mbps)"
        />
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Estimated Time (seconds)" value={`${time.toFixed(2)} s`} />
        <Out label="Estimated Time (minutes)" value={`${(time / 60).toFixed(2)} min`} />
        <Out label="Estimated Time (hours)" value={`${(time / 3600).toFixed(3)} hr`} />
      </div>
    </div>
  );
}

// ==========================================
// 19. DATA TRANSFER CALCULATOR
// ==========================================
function DataTransferMode() {
  const [size, setSize] = useState(500);
  const [speed, setSpeed] = useState(100);
  const time = speed > 0 ? size / speed : 0;

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Data Transfer Calculator"
        desc="Calculate storage copy and disk transfer duration."
      />
      <div className="space-y-2">
        <input
          type="number"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="Data Volume (MB)"
        />
        <input
          type="number"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="Transfer Speed (MB/s)"
        />
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Total Time" value={`${time.toFixed(2)} seconds`} />
        <Out label="Minutes" value={`${(time / 60).toFixed(2)} min`} />
      </div>
    </div>
  );
}

// ==========================================
// 20. SCREEN RESOLUTION & PPI
// ==========================================
function ScreenResMode() {
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const [diagonal, setDiagonal] = useState(24);

  const pixels = w * h;
  const ppi = diagonal > 0 ? Math.sqrt(w * w + h * h) / diagonal : 0;

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Screen Resolution & Pixel Density"
        desc="Calculate PPI, aspect ratio, and total display pixels."
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          value={w}
          onChange={(e) => setW(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="Width (px)"
        />
        <input
          type="number"
          value={h}
          onChange={(e) => setH(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="Height (px)"
        />
      </div>
      <input
        type="number"
        value={diagonal}
        onChange={(e) => setDiagonal(Number(e.target.value))}
        className="os-input w-full font-mono text-xs"
        placeholder="Diagonal Size (inches)"
      />
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Total Screen Pixels" value={pixels.toLocaleString()} />
        <Out label="Pixel Density (PPI)" value={`${ppi.toFixed(1)} PPI`} />
        <Out label="Aspect Ratio" value={h > 0 ? `${(w / h).toFixed(3)}:1` : '—'} />
      </div>
    </div>
  );
}

// ==========================================
// 21. ASPECT RATIO CALCULATOR
// ==========================================
function AspectRatioMode() {
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const ratio = h > 0 ? w / h : 0;

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Aspect Ratio Calculator"
        desc="Compute proportion scaling and match against common video aspect ratios."
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          value={w}
          onChange={(e) => setW(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="Width"
        />
        <input
          type="number"
          value={h}
          onChange={(e) => setH(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="Height"
        />
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="16:9 Scaled Ratio" value={`${Math.round((w * 9) / (h || 1))}:9`} />
        <Out label="4:3 Scaled Ratio" value={`${Math.round((w * 3) / (h || 1))}:3`} />
      </div>
    </div>
  );
}

// ==========================================
// 22. TYPING SPEED (WPM/CPM)
// ==========================================
function TypingSpeedMode() {
  const [text, setText] = useState('The quick brown fox jumps over the lazy dog.');
  const [time, setTime] = useState(60);
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const safeTime = Math.max(1, time);
  const wpm = (words / safeTime) * 60;
  const cpm = (chars / safeTime) * 60;

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Typing Speed & Word Metrics"
        desc="Calculate typing velocity (WPM & CPM) from typed sample text."
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type or paste sample text..."
        className="os-input w-full h-20 font-mono text-xs resize-none"
      />
      <input
        type="number"
        min="1"
        value={time}
        onChange={(e) => setTime(Math.max(1, Number(e.target.value)))}
        className="os-input w-full font-mono text-xs"
        placeholder="Elapsed time (seconds)"
      />
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Word Count" value={words} />
        <Out label="Character Count" value={chars} />
        <Out label="Words Per Minute (WPM)" value={wpm.toFixed(1)} />
        <Out label="Characters Per Minute (CPM)" value={cpm.toFixed(1)} />
      </div>
    </div>
  );
}

// ==========================================
// 23. FUEL ECONOMY
// ==========================================
function FuelEconomyMode() {
  const [distance, setDistance] = useState(500); // km
  const [fuel, setFuel] = useState(35); // Liters

  const lPer100 = distance > 0 ? (fuel / distance) * 100 : 0;
  const mpgUS = lPer100 > 0 ? 235.215 / lPer100 : 0;

  return (
    <div className="max-w-md mx-auto w-full space-y-3">
      <ToolHeader
        title="Fuel Economy Calculator"
        desc="Convert fuel consumption between L/100km, km/L, and Miles Per Gallon (MPG)."
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          value={distance}
          onChange={(e) => setDistance(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="Distance (km)"
        />
        <input
          type="number"
          value={fuel}
          onChange={(e) => setFuel(Number(e.target.value))}
          className="os-input w-full font-mono text-xs"
          placeholder="Fuel (Liters)"
        />
      </div>
      <div className="bg-[#05070b] border border-os-border/30 p-3 rounded space-y-2 mt-3">
        <Out label="Consumption (L/100 km)" value={`${lPer100.toFixed(2)} L/100km`} />
        <Out label="Miles Per Gallon (MPG US)" value={`${mpgUS.toFixed(2)} MPG`} />
        <Out
          label="Efficiency (km / Liter)"
          value={`${(distance / Math.max(0.1, fuel)).toFixed(2)} km/L`}
        />
      </div>
    </div>
  );
}

// ==========================================
// Standalone Tools Compatibility Exports
// ==========================================
export function ScientificCalculator() {
  return <CalculatorTool />;
}
export function BMICalculator() {
  return <CalculatorTool />;
}
export function AgeCalculator() {
  return <CalculatorTool />;
}
export function CurrencyConverter() {
  return <ConverterMode />;
}
export function UnitConverter() {
  return <ConverterMode />;
}
export function TipCalculator() {
  return <TipMode />;
}
export function LoanCalculator() {
  return <LoanMode />;
}
export function PercentageCalculator() {
  return <PercentageMode />;
}
export function DateDifference() {
  return <DateDiffMode />;
}
export function CircleCalc() {
  return <CircleMode />;
}
export function StatisticsCalc() {
  return <StatisticsMode />;
}
export function ProbabilityCalc() {
  return <ProbabilityMode />;
}

export const CALCULATOR_TOOLS = {
  CalculatorTool,
  ScientificCalculator,
  BMICalculator,
  AgeCalculator,
  CurrencyConverter,
  UnitConverter,
  TipCalculator,
  LoanCalculator,
  PercentageCalculator,
  DateDifference,
  CircleCalc,
  StatisticsCalc,
  ProbabilityCalc,
};
