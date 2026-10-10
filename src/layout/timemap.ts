// 小節内の「拍位置 → 横位置」の対応。
// 譜面の組版では、音符を渡さずに使い、拍を常に均等に割り付ける（layout.ts）。
// 音符ごとの幅（最小幅・希望の幅）を渡すと、入りきらない区間を広げる割り付けもできる。

export interface SpacingEvent {
  onset: number;
  dur: number;
  /** これ以上は詰められない幅 */
  minWidth: number;
  /** 字を指定どおりの大きさで並べたときの幅 */
  prefWidth: number;
}

export interface TimeMap {
  /** 拍位置の横位置 */
  x(t: number): number;
  /** t より後ろで最も近い区切り（音符の開始位置か小節末）の横位置 */
  next(t: number): number;
  /** 最小幅の合計が小節幅を超えた */
  overflow: boolean;
}

const EPS = 1e-9;

export function buildTimeMap(
  parts: readonly (readonly SpacingEvent[])[],
  beats: number,
  left: number,
  right: number,
): TimeMap {
  let end = beats;
  const points = new Set<number>([0]);
  const key = (t: number) => Math.round(t * 1e6) / 1e6;
  for (const events of parts) {
    for (const e of events) {
      points.add(key(e.onset));
      end = Math.max(end, e.onset + e.dur);
    }
  }
  end = key(end);
  const breaks = [...points].filter((t) => t < end - EPS).sort((a, b) => a - b);
  breaks.push(end);

  const count = breaks.length - 1;
  const durs = Array.from({ length: count }, (_, j) => breaks[j + 1]! - breaks[j]!);
  const minFloors = new Array<number>(count).fill(0);
  const prefFloors = new Array<number>(count).fill(0);
  for (const events of parts) {
    for (const e of events) {
      if (e.dur <= EPS) continue;
      for (let j = 0; j < count; j++) {
        const from = breaks[j]!;
        if (from < e.onset - EPS || from >= e.onset + e.dur - EPS) continue;
        // 複数区間にまたがる音符は、幅を区間の長さで按分する
        const share = durs[j]! / e.dur;
        minFloors[j] = Math.max(minFloors[j]!, e.minWidth * share);
        prefFloors[j] = Math.max(prefFloors[j]!, Math.max(e.minWidth, e.prefWidth) * share);
      }
    }
  }

  const width = Math.max(0, right - left);
  const sum = (values: number[]) => values.reduce((x, y) => x + y, 0);
  const minSum = sum(minFloors);
  const prefSum = sum(prefFloors);
  let widths: number[];
  const overflow = minSum > width + EPS;
  if (overflow) {
    widths = minFloors.map((f) => (f * width) / minSum);
  } else if (prefSum > width) {
    const f = (width - minSum) / (prefSum - minSum);
    widths = minFloors.map((m, j) => m + f * (prefFloors[j]! - m));
  } else {
    const floors = prefFloors;
    const total = (k: number) => durs.reduce((sum, d, j) => sum + Math.max(floors[j]!, k * d), 0);
    let lo = 0;
    let hi = end > 0 ? width / end : 0;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (total(mid) > width) hi = mid;
      else lo = mid;
    }
    widths = durs.map((d, j) => Math.max(floors[j]!, lo * d));
  }

  const xs = [left];
  for (const w of widths) xs.push(xs[xs.length - 1]! + w);

  const indexOf = (t: number) => {
    let j = 0;
    while (j < count - 1 && t >= breaks[j + 1]! - EPS) j++;
    return j;
  };

  return {
    overflow,
    x(t) {
      if (count === 0 || t >= end) return xs[xs.length - 1]!;
      if (t <= 0) return left;
      const j = indexOf(t);
      const d = durs[j]!;
      return d <= EPS ? xs[j]! : xs[j]! + ((t - breaks[j]!) / d) * widths[j]!;
    },
    next(t) {
      if (count === 0 || t >= end - EPS) return xs[xs.length - 1]!;
      return xs[indexOf(Math.max(0, t)) + 1]!;
    },
  };
}
