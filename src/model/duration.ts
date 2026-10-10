import { add, frac, parseFraction, ZERO, type Frac } from "./fraction";
import type { Event, Measure, Score } from "./types";

/**
 * 音価（拍）。(1 / 2^lines) × (2 − 1 / 2^dots)
 * 例：音価線1本・付点1個 = 3/4拍
 */
export function eventBeats(event: Pick<Event, "lines" | "dots">): Frac {
  const { lines, dots } = event;
  return frac(2 ** (dots + 1) - 1, 2 ** (lines + dots));
}

export function totalBeats(events: readonly Pick<Event, "lines" | "dots">[]): Frac {
  return events.reduce<Frac>((sum, e) => add(sum, eventBeats(e)), ZERO);
}

/** 各音符の開始拍位置 */
export function eventOffsets(events: readonly Pick<Event, "lines" | "dots">[]): Frac[] {
  const offsets: Frac[] = [];
  let pos = ZERO;
  for (const e of events) {
    offsets.push(pos);
    pos = add(pos, eventBeats(e));
  }
  return offsets;
}

/** 小節の拍数。小節に指定がなければ曲の既定値。読めなければ null */
export function measureBeats(score: Score, measure: Measure): Frac | null {
  return parseFraction(measure.beats ?? score.settings.beatsPerMeasure);
}
