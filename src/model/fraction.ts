// 拍位置・拍数を誤差なく扱うための有理数。

export interface Frac {
  n: number;
  d: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function frac(n: number, d = 1): Frac {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) {
    throw new Error(`不正な分数: ${n}/${d}`);
  }
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

export const ZERO: Frac = { n: 0, d: 1 };

const FRACTION_PATTERN = /^(-?\d+)(?:\/(\d+))?$/;

/** "3/2" や "2" を読む。読めなければ null */
export function parseFraction(text: string): Frac | null {
  if (typeof text !== "string") return null;
  const m = FRACTION_PATTERN.exec(text.trim());
  if (!m) return null;
  const d = m[2] === undefined ? 1 : Number(m[2]);
  if (d === 0) return null;
  return frac(Number(m[1]), d);
}

export function formatFraction(f: Frac): string {
  return f.d === 1 ? `${f.n}` : `${f.n}/${f.d}`;
}

export function add(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function sub(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d);
}

/** a<b なら負、a=b なら 0、a>b なら正 */
export function compare(a: Frac, b: Frac): number {
  return a.n * b.d - b.n * a.d;
}

export function equals(a: Frac, b: Frac): boolean {
  return compare(a, b) === 0;
}

export function toNumber(f: Frac): number {
  return f.n / f.d;
}
