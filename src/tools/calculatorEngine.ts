// Safe Mathematical Calculation Engine for Nammu OS Calculator Suite
// Zero-eval, AST/Shunting-Yard based expression evaluator with scientific support

export type AngleMode = 'DEG' | 'RAD' | 'GRAD';

export interface EvaluationResult {
  success: boolean;
  value?: number;
  formatted?: string;
  error?: string;
}

export function toRadians(val: number, mode: AngleMode): number {
  if (mode === 'DEG') return (val * Math.PI) / 180;
  if (mode === 'GRAD') return (val * Math.PI) / 200;
  return val;
}

export function fromRadians(val: number, mode: AngleMode): number {
  if (mode === 'DEG') return (val * 180) / Math.PI;
  if (mode === 'GRAD') return (val * 200) / Math.PI;
  return val;
}

export function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  if (n > 170) return Infinity; // JS Number overflow limit
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

export function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

export function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(Math.round((a * b) / gcd(a, b)));
}

export function isPrime(n: number): boolean {
  if (n <= 1 || !Number.isInteger(n)) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

export function primeFactors(n: number): number[] {
  n = Math.abs(Math.round(n));
  const factors: number[] = [];
  while (n % 2 === 0) {
    factors.push(2);
    n /= 2;
  }
  for (let d = 3; d * d <= n; d += 2) {
    while (n % d === 0) {
      factors.push(d);
      n /= d;
    }
  }
  if (n > 1) factors.push(n);
  return factors;
}

// Token Types
type TokenType = 'NUMBER' | 'OP' | 'FUNC' | 'CONST' | 'LPAREN' | 'RPAREN' | 'COMMA';

interface Token {
  type: TokenType;
  value: string | number;
}

const FUNCTIONS: Record<string, (args: number[], mode: AngleMode) => number> = {
  sin: ([x], mode) => Math.sin(toRadians(x, mode)),
  cos: ([x], mode) => Math.cos(toRadians(x, mode)),
  tan: ([x], mode) => {
    const rad = toRadians(x, mode);
    if (Math.abs(Math.cos(rad)) < 1e-15) throw new Error('Undefined (tan 90°)');
    return Math.tan(rad);
  },
  asin: ([x], mode) => {
    if (x < -1 || x > 1) throw new Error('Invalid Domain (asin)');
    return fromRadians(Math.asin(x), mode);
  },
  acos: ([x], mode) => {
    if (x < -1 || x > 1) throw new Error('Invalid Domain (acos)');
    return fromRadians(Math.acos(x), mode);
  },
  atan: ([x], mode) => fromRadians(Math.atan(x), mode),
  sinh: ([x]) => Math.sinh(x),
  cosh: ([x]) => Math.cosh(x),
  tanh: ([x]) => Math.tanh(x),
  asinh: ([x]) => Math.asinh(x),
  acosh: ([x]) => (x < 1 ? NaN : Math.acosh(x)),
  atanh: ([x]) => (Math.abs(x) >= 1 ? NaN : Math.atanh(x)),
  sqrt: ([x]) => {
    if (x < 0) throw new Error('Invalid Domain (sqrt)');
    return Math.sqrt(x);
  },
  cbrt: ([x]) => Math.cbrt(x),
  log: ([x]) => {
    if (x <= 0) throw new Error('Invalid Domain (log)');
    return Math.log10(x);
  },
  ln: ([x]) => {
    if (x <= 0) throw new Error('Invalid Domain (ln)');
    return Math.log(x);
  },
  log2: ([x]) => {
    if (x <= 0) throw new Error('Invalid Domain (log2)');
    return Math.log2(x);
  },
  exp: ([x]) => Math.exp(x),
  abs: ([x]) => Math.abs(x),
  floor: ([x]) => Math.floor(x),
  ceil: ([x]) => Math.ceil(x),
  round: ([x]) => Math.round(x),
  fact: ([x]) => {
    const res = factorial(x);
    if (isNaN(res)) throw new Error('Invalid Domain (factorial)');
    return res;
  },
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  phi: 1.618033988749895,
  tau: Math.PI * 2,
};

const OPERATOR_PRECEDENCE: Record<string, { prec: number; assoc: 'L' | 'R' }> = {
  '+': { prec: 1, assoc: 'L' },
  '-': { prec: 1, assoc: 'L' },
  '*': { prec: 2, assoc: 'L' },
  '×': { prec: 2, assoc: 'L' },
  '/': { prec: 2, assoc: 'L' },
  '÷': { prec: 2, assoc: 'L' },
  '%': { prec: 2, assoc: 'L' },
  '^': { prec: 3, assoc: 'R' },
  'u-': { prec: 4, assoc: 'R' }, // Unary minus
  'u+': { prec: 4, assoc: 'R' }, // Unary plus
  '!': { prec: 4, assoc: 'L' }, // Postfix factorial
};

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const clean = input.trim();

  while (i < clean.length) {
    const ch = clean[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Numbers (including scientific notation e.g. 1.5e-3)
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(clean[i + 1] || ''))) {
      let numStr = '';
      while (i < clean.length && /[0-9.]/.test(clean[i])) {
        numStr += clean[i];
        i++;
      }
      // Check for exponent in number (e.g. 1e5)
      if (
        i < clean.length &&
        (clean[i] === 'e' || clean[i] === 'E') &&
        /[0-9+-]/.test(clean[i + 1] || '')
      ) {
        numStr += clean[i];
        i++;
        if (clean[i] === '+' || clean[i] === '-') {
          numStr += clean[i];
          i++;
        }
        while (i < clean.length && /[0-9]/.test(clean[i])) {
          numStr += clean[i];
          i++;
        }
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
      continue;
    }

    // Letters: Functions or Constants
    if (/[a-zA-Zπ]/.test(ch)) {
      let name = '';
      while (i < clean.length && /[a-zA-Z0-9π]/.test(clean[i])) {
        name += clean[i];
        i++;
      }
      const lower = name.toLowerCase();
      if (lower in CONSTANTS) {
        tokens.push({ type: 'CONST', value: CONSTANTS[lower] });
      } else if (lower in FUNCTIONS) {
        tokens.push({ type: 'FUNC', value: lower });
      } else {
        throw new Error(`Unknown identifier "${name}"`);
      }
      continue;
    }

    // Parentheses
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',' });
      i++;
      continue;
    }

    // Operators
    if (['+', '-', '*', '×', '/', '÷', '%', '^', '!'].includes(ch)) {
      const prev = tokens[tokens.length - 1];
      const isUnary =
        (ch === '+' || ch === '-') &&
        (!prev || prev.type === 'OP' || prev.type === 'LPAREN' || prev.type === 'COMMA');

      if (isUnary) {
        tokens.push({ type: 'OP', value: ch === '-' ? 'u-' : 'u+' });
      } else {
        tokens.push({ type: 'OP', value: ch });
      }
      i++;
      continue;
    }

    throw new Error(`Unexpected character "${ch}"`);
  }

  return tokens;
}

export function evaluateExpression(input: string, angleMode: AngleMode = 'DEG'): EvaluationResult {
  if (!input || !input.trim()) {
    return { success: true, value: 0, formatted: '0' };
  }

  try {
    const tokens = tokenize(input);
    if (tokens.length === 0) return { success: true, value: 0, formatted: '0' };

    // Shunting-yard algorithm (Infix to RPN)
    const outputQueue: Token[] = [];
    const opStack: Token[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token.type === 'NUMBER' || token.type === 'CONST') {
        outputQueue.push(token);
      } else if (token.type === 'FUNC') {
        opStack.push(token);
      } else if (token.type === 'COMMA') {
        while (opStack.length > 0 && opStack[opStack.length - 1].type !== 'LPAREN') {
          outputQueue.push(opStack.pop()!);
        }
        if (opStack.length === 0) throw new Error('Misplaced comma');
      } else if (token.type === 'OP') {
        const op1 = token.value as string;
        const op1Info = OPERATOR_PRECEDENCE[op1];

        while (opStack.length > 0) {
          const top = opStack[opStack.length - 1];
          if (top.type === 'OP') {
            const op2 = top.value as string;
            const op2Info = OPERATOR_PRECEDENCE[op2];
            if (
              (op1Info.assoc === 'L' && op1Info.prec <= op2Info.prec) ||
              (op1Info.assoc === 'R' && op1Info.prec < op2Info.prec)
            ) {
              outputQueue.push(opStack.pop()!);
              continue;
            }
          }
          break;
        }
        opStack.push(token);
      } else if (token.type === 'LPAREN') {
        opStack.push(token);
      } else if (token.type === 'RPAREN') {
        let foundLParen = false;
        while (opStack.length > 0) {
          const top = opStack.pop()!;
          if (top.type === 'LPAREN') {
            foundLParen = true;
            break;
          }
          outputQueue.push(top);
        }
        if (!foundLParen) throw new Error('Mismatched parentheses');
        if (opStack.length > 0 && opStack[opStack.length - 1].type === 'FUNC') {
          outputQueue.push(opStack.pop()!);
        }
      }
    }

    while (opStack.length > 0) {
      const top = opStack.pop()!;
      if (top.type === 'LPAREN' || top.type === 'RPAREN') {
        throw new Error('Mismatched parentheses');
      }
      outputQueue.push(top);
    }

    // Evaluate RPN
    const evalStack: number[] = [];

    for (const token of outputQueue) {
      if (token.type === 'NUMBER' || token.type === 'CONST') {
        evalStack.push(Number(token.value));
      } else if (token.type === 'OP') {
        const op = token.value as string;
        if (op === 'u-') {
          if (evalStack.length < 1) throw new Error('Invalid syntax');
          evalStack.push(-evalStack.pop()!);
        } else if (op === 'u+') {
          if (evalStack.length < 1) throw new Error('Invalid syntax');
          // No-op
        } else if (op === '!') {
          if (evalStack.length < 1) throw new Error('Invalid syntax');
          const val = evalStack.pop()!;
          const res = factorial(val);
          if (isNaN(res)) throw new Error('Invalid Factorial');
          evalStack.push(res);
        } else {
          if (evalStack.length < 2) throw new Error('Invalid syntax');
          const b = evalStack.pop()!;
          const a = evalStack.pop()!;

          switch (op) {
            case '+':
              evalStack.push(a + b);
              break;
            case '-':
              evalStack.push(a - b);
              break;
            case '*':
            case '×':
              evalStack.push(a * b);
              break;
            case '/':
            case '÷':
              if (b === 0) throw new Error('Cannot divide by zero');
              evalStack.push(a / b);
              break;
            case '%':
              if (b === 0) throw new Error('Cannot divide by zero');
              evalStack.push(a % b);
              break;
            case '^':
              evalStack.push(Math.pow(a, b));
              break;
            default:
              throw new Error(`Unknown operator "${op}"`);
          }
        }
      } else if (token.type === 'FUNC') {
        const fnName = token.value as string;
        const fn = FUNCTIONS[fnName];
        if (!fn) throw new Error(`Unknown function "${fnName}"`);
        if (evalStack.length < 1) throw new Error(`Missing argument for "${fnName}"`);
        const arg = evalStack.pop()!;
        const res = fn([arg], angleMode);
        if (isNaN(res)) throw new Error(`Invalid calculation in "${fnName}"`);
        evalStack.push(res);
      }
    }

    if (evalStack.length !== 1) {
      throw new Error('Invalid expression');
    }

    const finalVal = evalStack[0];
    const formatted = formatNumber(finalVal);

    return {
      success: true,
      value: finalVal,
      formatted,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Invalid expression',
    };
  }
}

export function formatNumber(n: number, maxDecimals: number = 10): string {
  if (!Number.isFinite(n)) {
    if (n === Infinity) return 'Infinity';
    if (n === -Infinity) return '-Infinity';
    return 'NaN';
  }

  // Handle tiny floating point rounding issues e.g. 0.1 + 0.2 = 0.30000000000000004
  const rounded = parseFloat(n.toPrecision(14));
  if (Math.abs(rounded) < 1e-12 && rounded !== 0) {
    return rounded.toExponential(4);
  }
  if (Math.abs(rounded) >= 1e15 || (Math.abs(rounded) < 1e-6 && rounded !== 0)) {
    return rounded.toExponential(6);
  }

  const parts = rounded.toString().split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}
