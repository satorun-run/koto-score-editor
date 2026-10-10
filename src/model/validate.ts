// 検算。SPEC.md 4章に対応する。問題は一覧で返し、処理は止めない。

import { measureBeats, totalBeats } from "./duration";
import { compare, equals, formatFraction, parseFraction, ZERO, type Frac } from "./fraction";
import { parsePitch } from "./pitch";
import {
  isEventsMeasure,
  STRING_COUNT,
  type Event,
  type Measure,
  type Score,
  type StringRef,
} from "./types";

export type IssueCode =
  | "beats-mismatch"
  | "bad-fraction"
  | "position-out-of-range"
  | "unknown-part"
  | "unknown-track"
  | "missing-content"
  | "bad-string"
  | "empty-note"
  | "duplicate-id"
  | "span-missing-end"
  | "span-order"
  | "span-part"
  | "bad-tuning"
  | "bad-layout";

export interface Issue {
  code: IssueCode;
  message: string;
  /** 0始まりの小節番号。曲全体に関する問題では省略 */
  measureIndex?: number;
  measureId?: string;
  partId?: string;
  eventId?: string;
  spanId?: string;
}

interface EventLocation {
  measureIndex: number;
  partId: string;
  eventIndex: number;
}

export function validateScore(score: Score): Issue[] {
  const issues: Issue[] = [];
  const partIds = new Set(score.parts.map((p) => p.id));
  const trackIds = new Set(score.tracks.map((t) => t.id));
  const seenIds = new Set<string>();
  const eventLocations = new Map<string, EventLocation>();
  const measureIndexById = new Map<string, number>();

  const claimId = (id: string, where: Partial<Issue>) => {
    if (seenIds.has(id)) {
      issues.push({ code: "duplicate-id", message: `ID「${id}」が重複しています`, ...where });
    }
    seenIds.add(id);
  };

  for (const track of score.tracks) {
    if (!partIds.has(track.below)) {
      issues.push({
        code: "unknown-part",
        message: `補助行「${track.id}」の配置先パート「${track.below}」がありません`,
      });
    }
  }

  for (const part of score.parts) {
    if (!part.tuning) continue;
    const { pitches } = part.tuning;
    if (pitches.length !== STRING_COUNT || pitches.some((p) => parsePitch(p) === null)) {
      issues.push({
        code: "bad-tuning",
        message: `パート「${part.name ?? part.id}」の調弦は、音名（D4 など）を${STRING_COUNT}個並べてください`,
        partId: part.id,
      });
    }
  }

  if (parseFraction(score.settings.beatsPerMeasure) === null) {
    issues.push({
      code: "bad-fraction",
      message: `既定の拍数「${score.settings.beatsPerMeasure}」を読めません`,
    });
  }

  score.measures.forEach((measure, measureIndex) => {
    const at = { measureIndex, measureId: measure.id };
    claimId(measure.id, at);
    measureIndexById.set(measure.id, measureIndex);

    if (measure.beats !== undefined && parseFraction(measure.beats) === null) {
      issues.push({ code: "bad-fraction", message: `拍数「${measure.beats}」を読めません`, ...at });
    }
    const beats = measureBeats(score, measure);

    const perSystem = measure.measuresPerSystem;
    if (perSystem !== undefined && (!Number.isInteger(perSystem) || perSystem < 1)) {
      issues.push({ code: "bad-layout", message: "1段の小節数は1以上の整数で指定してください", ...at });
    }

    for (const partId of partIds) {
      if (!(partId in measure.content)) {
        issues.push({
          code: "missing-content",
          message: `パート「${partId}」の内容がありません`,
          ...at,
          partId,
        });
      }
    }

    for (const [partId, pm] of Object.entries(measure.content)) {
      const where = { ...at, partId };
      if (!partIds.has(partId)) {
        issues.push({ code: "unknown-part", message: `パート「${partId}」は定義されていません`, ...where });
      }
      if (!isEventsMeasure(pm)) continue;

      pm.events.forEach((event, eventIndex) => {
        claimId(event.id, { ...where, eventId: event.id });
        eventLocations.set(event.id, { measureIndex, partId, eventIndex });
        checkEvent(event, where, issues);
      });

      // まだ何も入れていない小節は、拍数の不一致として数えない
      if (beats !== null && !measure.free && pm.events.length > 0) {
        const total = totalBeats(pm.events);
        if (!equals(total, beats)) {
          issues.push({
            code: "beats-mismatch",
            message: `音価の合計が ${formatFraction(total)} 拍です（小節は ${formatFraction(beats)} 拍）`,
            ...where,
          });
        }
      }

      for (const item of pm.shoka ?? []) {
        checkPosition(item.at, `口唱歌「${item.text}」`, measure, beats, where, issues);
      }
    }

    for (const [trackId, items] of Object.entries(measure.aux ?? {})) {
      if (!trackIds.has(trackId)) {
        issues.push({ code: "unknown-track", message: `補助行「${trackId}」は定義されていません`, ...at });
      }
      for (const item of items) {
        checkPosition(item.at, `補助行「${trackId}」の項目`, measure, beats, at, issues);
        for (const ref of item.notes ?? []) checkString(ref, at, issues);
      }
    }

    for (const ossia of measure.ossia ?? []) {
      const where = { ...at, partId: ossia.part };
      if (!partIds.has(ossia.part)) {
        issues.push({ code: "unknown-part", message: `代替譜のパート「${ossia.part}」は定義されていません`, ...where });
      }
      checkPosition(ossia.at, "代替譜", measure, beats, where, issues);
      for (const event of ossia.events) {
        claimId(event.id, { ...where, eventId: event.id });
        checkEvent(event, where, issues);
      }
    }

    for (const change of measure.retune ?? []) {
      const badString = !Number.isInteger(change.string) || change.string < 1 || change.string > STRING_COUNT;
      if (!partIds.has(change.part) || badString || !Number.isInteger(change.semitones)) {
        issues.push({ code: "bad-tuning", message: "調弦の変更の指定（パート・絃・半音数）が正しくありません", ...at });
      }
    }

    for (const mark of measure.marks ?? []) {
      if (mark.part !== undefined && !partIds.has(mark.part)) {
        issues.push({ code: "unknown-part", message: `標記「${mark.text}」のパート「${mark.part}」は定義されていません`, ...at });
      }
      if (mark.at !== undefined) {
        checkPosition(mark.at, `標記「${mark.text}」`, measure, beats, at, issues);
      }
    }
  });

  for (const span of score.spans) {
    claimId(span.id, { spanId: span.id });
    checkSpan(span, eventLocations, measureIndexById, issues);
  }

  return issues;
}

function checkEvent(event: Event, where: Partial<Issue>, issues: Issue[]): void {
  if (event.type !== "note") return;
  const at = { ...where, eventId: event.id };
  if (event.strings.length === 0) {
    issues.push({ code: "empty-note", message: "絃が指定されていない音符があります", ...at });
  }
  for (const ref of event.strings) checkString(ref, at, issues);
}

function checkString(ref: StringRef, where: Partial<Issue>, issues: Issue[]): void {
  if (!Number.isInteger(ref.n) || ref.n < 1 || ref.n > STRING_COUNT) {
    issues.push({ code: "bad-string", message: `絃番号 ${ref.n} は範囲外です（1〜${STRING_COUNT}）`, ...where });
  }
}

/** 拍位置が小節内（0以上、拍数未満）にあるか。検算を除外した小節では上限を見ない */
function checkPosition(
  text: string,
  label: string,
  measure: Measure,
  beats: Frac | null,
  where: Partial<Issue>,
  issues: Issue[],
): void {
  const pos = parseFraction(text);
  if (pos === null) {
    issues.push({ code: "bad-fraction", message: `${label}の拍位置「${text}」を読めません`, ...where });
    return;
  }
  const beyondEnd = beats !== null && !measure.free && compare(pos, beats) >= 0;
  if (compare(pos, ZERO) < 0 || beyondEnd) {
    issues.push({
      code: "position-out-of-range",
      message: `${label}の拍位置 ${formatFraction(pos)} が小節の範囲外です`,
      ...where,
    });
  }
}

function checkSpan(
  span: Score["spans"][number],
  eventLocations: Map<string, EventLocation>,
  measureIndexById: Map<string, number>,
  issues: Issue[],
): void {
  const where = { spanId: span.id };

  if (span.kind === "volta") {
    const from = measureIndexById.get(span.from);
    const to = measureIndexById.get(span.to);
    if (from === undefined || to === undefined) {
      issues.push({ code: "span-missing-end", message: "括弧の始点または終点の小節がありません", ...where });
    } else if (from > to) {
      issues.push({ code: "span-order", message: "括弧の始点が終点より後ろにあります", ...where });
    }
    return;
  }

  const from = eventLocations.get(span.from);
  const to = eventLocations.get(span.to);
  if (from === undefined || to === undefined) {
    issues.push({ code: "span-missing-end", message: "スパンの始点または終点の音符がありません", ...where });
    return;
  }
  if (from.partId !== to.partId || (span.part !== undefined && span.part !== from.partId)) {
    issues.push({ code: "span-part", message: "スパンの始点と終点が同じパートにありません", ...where });
    return;
  }
  const backwards =
    from.measureIndex > to.measureIndex ||
    (from.measureIndex === to.measureIndex && from.eventIndex > to.eventIndex);
  if (backwards) {
    issues.push({
      code: "span-order",
      message: "スパンの始点が終点より後ろにあります",
      ...where,
      measureIndex: from.measureIndex,
    });
  }
}
