// 絃名から音高を求める。五線譜への変換の土台（SPEC.md 12章）。
// 音高は "D4" "A#3" "Bb3" のような音名で書き、内部ではMIDIノート番号（C4=60）で扱う。

import { isEventsMeasure, STRING_COUNT, type Event, type Score } from "./types";

const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** 音名をMIDIノート番号にする。読めなければ null */
export function parsePitch(name: string): number | null {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) return null;
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + STEPS[m[1]!]! + accidental;
}

export function formatPitch(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** 平調子（壱＝D4）。他の調子はこれを書き換えて作る */
export const HIRAJOSHI = ["D4", "G3", "A3", "A#3", "D4", "D#4", "G4", "A4", "A#4", "D5", "D#5", "G5", "A5"];

/** 押し手で上がる半音数（一重＝半音、二重＝一音、三重＝一音半） */
const PRESS_SEMITONES = { 1: 1, 2: 2, 3: 3 } as const;

/**
 * 各音符の鳴り始めの音高（MIDIノート番号）を求める。
 * 調弦が設定されていないパートの音符は結果に含めない。
 * あと押し（ヲ・オ）のように鳴ってから変わる音高は、ここでは扱わない。
 */
export function resolvePitches(score: Score): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const part of score.parts) {
    const open = part.tuning?.pitches.map(parsePitch);
    if (!open || open.length !== STRING_COUNT || open.some((p) => p === null)) continue;
    const strings = open as number[];

    for (const measure of score.measures) {
      for (const change of measure.retune ?? []) {
        if (change.part === part.id && strings[change.string - 1] !== undefined) {
          strings[change.string - 1]! += change.semitones;
        }
      }
      const pm = measure.content[part.id];
      if (!pm || !isEventsMeasure(pm)) continue;
      for (const event of pm.events) {
        const pitches = notePitches(event, strings);
        if (pitches) result.set(event.id, pitches);
      }
    }
  }
  return result;
}

function notePitches(event: Event, strings: readonly number[]): number[] | null {
  if (event.type !== "note") return null;
  const octave = event.above?.includes("甲") ? 12 : 0;
  const pitches: number[] = [];
  for (const ref of event.strings) {
    const open = strings[ref.n - 1];
    if (open === undefined) return null;
    pitches.push(open + (ref.press ? PRESS_SEMITONES[ref.press] : 0) + octave);
  }
  return pitches;
}
