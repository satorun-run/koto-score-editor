// 下書きの取り込み。SPEC.md 6.4・8章に対応する。
// 別の楽譜データから小節の範囲を取り出し、IDを振り直して今の楽譜に入れる。

import { parseDraft, type DraftError } from "../model/draft";
import { parseScore } from "../model/load";
import { isEventsMeasure, type Measure, type Score } from "../model/types";
import { newId, type Doc } from "./commands";

export type ImportMode = "append" | "insertAfter" | "replace";

export interface ImportOptions {
  /** 取り込む範囲（0始まり、両端を含む） */
  from: number;
  to: number;
  mode: ImportMode;
  /** 曲名・調弦表・拍数などの設定も取り込む */
  withMeta: boolean;
}

export interface LoadedSource {
  score: Score;
  /** 下書き記法の誤り（.koto.json なら空） */
  errors: DraftError[];
}

/** ファイルの中身を楽譜データとして読む。JSON でなければ下書き記法として読む */
export function readSource(text: string): LoadedSource {
  if (text.trimStart().startsWith("{")) return { score: parseScore(JSON.parse(text)), errors: [] };
  const { score, errors } = parseDraft(text);
  return { score, errors };
}

function isBlank(score: Score): boolean {
  return score.measures.every(
    (m) => !m.aux && !m.ossia && !m.marks && Object.values(m.content).every((pm) => isEventsMeasure(pm) && pm.events.length === 0),
  );
}

export function importMeasures(doc: Doc, source: Score, options: ImportOptions): Doc | null {
  const from = Math.max(0, Math.min(options.from, options.to));
  const to = Math.min(source.measures.length - 1, Math.max(options.from, options.to));
  if (to < from) return null;

  const score = structuredClone(doc.score);
  const blank = isBlank(score);

  if (options.withMeta) {
    score.meta = structuredClone(source.meta);
    // 寸法・書体・字形は、いまの楽譜の設定を土台にして、取り込み元が指定している項目だけ上書きする
    const style = { ...score.settings.style, ...structuredClone(source.settings.style) };
    score.settings = structuredClone(source.settings);
    if (Object.keys(style).length > 0) score.settings.style = style;
  }

  // パートは並び順で対応させ、足りなければ足す
  const partMap = new Map<string, string>();
  source.parts.forEach((part, i) => {
    let target = score.parts[i];
    if (!target) {
      target = { ...structuredClone(part), id: newId("p") };
      score.parts.push(target);
      for (const m of score.measures) m.content[target.id] = { events: [] };
    } else if (options.withMeta) {
      const { id } = target;
      Object.assign(target, structuredClone(part), { id });
    }
    partMap.set(part.id, target.id);
  });

  // 補助行は同じIDがあればそこへ、なければ足す
  const trackMap = new Map<string, string>();
  for (const track of source.tracks) {
    const below = partMap.get(track.below) ?? score.parts[0]!.id;
    const existing = score.tracks.find((t) => t.id === track.id && t.kind === track.kind);
    if (existing) trackMap.set(track.id, existing.id);
    else {
      const id = score.tracks.some((t) => t.id === track.id) ? newId("t") : track.id;
      score.tracks.push({ ...structuredClone(track), id, below });
      trackMap.set(track.id, id);
    }
  }

  const idMap = new Map<string, string>();
  const measures = source.measures.slice(from, to + 1).map((m): Measure => {
    const copy = structuredClone(m);
    const id = newId("m");
    idMap.set(m.id, id);
    copy.id = id;
    // 既定の拍数が違う楽譜から持ってくるときは、小節に拍数を明記して意味を保つ
    if (copy.beats === undefined && source.settings.beatsPerMeasure !== score.settings.beatsPerMeasure) {
      copy.beats = source.settings.beatsPerMeasure;
    }

    const content: Measure["content"] = {};
    for (const [partId, pm] of Object.entries(copy.content)) {
      const target = partMap.get(partId);
      if (!target) continue;
      if (isEventsMeasure(pm)) {
        for (const e of pm.events) {
          const eid = newId("e");
          idMap.set(e.id, eid);
          e.id = eid;
        }
      }
      content[target] = pm;
    }
    for (const part of score.parts) content[part.id] ??= { events: [] };
    copy.content = content;

    if (copy.aux) {
      const aux: NonNullable<Measure["aux"]> = {};
      for (const [trackId, items] of Object.entries(copy.aux)) {
        const target = trackMap.get(trackId);
        if (target) aux[target] = items;
      }
      copy.aux = aux;
    }
    for (const ossia of copy.ossia ?? []) {
      ossia.part = partMap.get(ossia.part) ?? score.parts[0]!.id;
      for (const e of ossia.events) e.id = newId("e");
    }
    for (const mark of copy.marks ?? []) {
      if (mark.part) mark.part = partMap.get(mark.part) ?? mark.part;
    }
    for (const change of copy.retune ?? []) change.part = partMap.get(change.part) ?? change.part;
    return copy;
  });

  // 範囲の中で完結しているスパンだけ持ってくる
  const spans = source.spans.flatMap((span) => {
    const a = idMap.get(span.from);
    const b = idMap.get(span.to);
    if (!a || !b) return [];
    const copy = { ...span, id: newId("s"), from: a, to: b };
    if (copy.part) copy.part = partMap.get(copy.part) ?? copy.part;
    return [copy];
  });

  let at: number;
  if (blank) {
    // まだ何も入れていない楽譜なら、空の小節を残さず置き換える
    score.measures = measures;
    at = 0;
  } else if (options.mode === "append") {
    at = score.measures.length;
    score.measures.push(...measures);
  } else if (options.mode === "insertAfter") {
    at = doc.cursor.mi + 1;
    score.measures.splice(at, 0, ...measures);
  } else {
    at = doc.cursor.mi;
    const removed = score.measures.splice(at, measures.length, ...measures);
    const gone = new Set(removed.flatMap((m) => [m.id, ...Object.values(m.content).flatMap((pm) => (isEventsMeasure(pm) ? pm.events.map((e) => e.id) : []))]));
    score.spans = score.spans.filter((s) => !gone.has(s.from) && !gone.has(s.to));
  }
  score.spans.push(...spans);

  return { score, cursor: { mi: at, partId: score.parts[0]!.id, index: 0 } };
}
