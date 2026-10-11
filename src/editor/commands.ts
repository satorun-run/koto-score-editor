// 編集操作。楽譜とカーソルを受け取り、新しい楽譜とカーソルを返す（元は変更しない）。
// 操作できない状況では null を返す。

import { eventOffsets, measureBeats, totalBeats } from "../model/duration";
import { compare, formatFraction, parseFraction, toNumber, ZERO } from "../model/fraction";
import {
  isEventsMeasure,
  type AuxItem,
  type AuxTrack,
  type Event,
  type Measure,
  type Note,
  type Ossia,
  type Part,
  type Score,
  type ShokaItem,
  type Span,
} from "../model/types";

/** カーソルは音符と音符の間にある。index は「手前にある音符の数」 */
export interface Cursor {
  mi: number;
  partId: string;
  index: number;
  /** 代替譜の中にいるとき、小節内での代替譜の番号 */
  ossia?: number;
}

export interface Doc {
  score: Score;
  cursor: Cursor;
}

export type Lines = 0 | 1 | 2 | 3;

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** 何も入っていない楽譜。style には、保存してある既定の設定（寸法・書体・字形）を渡す */
export function blankScore(style?: Score["settings"]["style"]): Score {
  const score: Score = {
    format: "koto-score",
    version: 1,
    meta: { title: "無題" },
    settings: { beatsPerMeasure: "4", measuresPerSystem: 4, systemsPerPage: 7 },
    parts: [{ id: "koto", weight: "bold" }],
    tracks: [],
    measures: [],
    spans: [],
  };
  if (style && Object.keys(style).length > 0) score.settings.style = structuredClone(style);
  score.measures.push(blankMeasure(score));
  return score;
}

export function blankMeasure(score: Score): Measure {
  const content: Measure["content"] = {};
  for (const part of score.parts) content[part.id] = { events: [] };
  return { id: newId("m"), content };
}

export function eventsAt(score: Score, cursor: Cursor): Event[] | null {
  const measure = score.measures[cursor.mi];
  if (cursor.ossia !== undefined) return measure?.ossia?.[cursor.ossia]?.events ?? null;
  const pm = measure?.content[cursor.partId];
  return pm && isEventsMeasure(pm) ? pm.events : null;
}

/** カーソルの手前の音符。属性の変更はこれに掛かる */
export function currentEvent(doc: Doc): Event | null {
  return eventsAt(doc.score, doc.cursor)?.[doc.cursor.index - 1] ?? null;
}

/** カーソルを楽譜の範囲内に収める */
export function clampCursor(score: Score, cursor: Cursor): Cursor {
  const mi = Math.max(0, Math.min(cursor.mi, score.measures.length - 1));
  const partId = score.parts.some((p) => p.id === cursor.partId) ? cursor.partId : (score.parts[0]?.id ?? "");
  const base: Cursor = { mi, partId, index: 0 };
  if (cursor.ossia !== undefined && mi === cursor.mi && score.measures[mi]?.ossia?.[cursor.ossia]) base.ossia = cursor.ossia;
  const length = eventsAt(score, base)?.length ?? 0;
  return { ...base, index: Math.max(0, Math.min(cursor.index, length)) };
}

function edit(doc: Doc, fn: (score: Score, cursor: Cursor) => void | false): Doc | null {
  const score = structuredClone(doc.score);
  const cursor = { ...doc.cursor };
  if (fn(score, cursor) === false) return null;
  return { score, cursor };
}

function isFull(score: Score, measure: Measure, events: Event[]): boolean {
  if (measure.free) return false;
  const beats = measureBeats(score, measure);
  return beats !== null && compare(totalBeats(events), beats) >= 0;
}

/** 入力した音符の音価線を、同じ拍の中にある前の音符とつなぐ */
function autoJoin(events: Event[], index: number): void {
  const event = events[index];
  const prev = events[index - 1];
  if (!event) return;
  delete event.joinPrev;
  // 拍の中に置く付点には音価線を引かないので、つながない
  if (!prev || event.lines === 0 || prev.lines === 0 || event.type === "dot" || prev.type === "dot") return;
  const offsets = eventOffsets(events).map(toNumber);
  const onset = offsets[index]!;
  if (Math.floor(onset + 1e-9) === Math.floor(offsets[index - 1]! + 1e-9) && onset % 1 > 1e-9) {
    event.joinPrev = true;
  }
}

/** 消えた音符・小節を指すスパンを取り除く */
function cleanupSpans(score: Score): void {
  const ids = new Set<string>();
  for (const m of score.measures) {
    ids.add(m.id);
    for (const pm of Object.values(m.content)) {
      if (isEventsMeasure(pm)) for (const e of pm.events) ids.add(e.id);
    }
  }
  score.spans = score.spans.filter((s) => ids.has(s.from) && ids.has(s.to));
}

type NewEvent =
  | { type: "note"; n: number }
  | { type: "rest" }
  | { type: "dot" }
  | { type: "sign"; sign: string };

/**
 * カーソル位置に音符を入れて、カーソルを進める。
 * 小節の末尾にいて小節が満ちていれば、次の小節（なければ新規）へ進んでから入れる。
 */
export function insertEvent(doc: Doc, spec: NewEvent, lines: Lines): Doc | null {
  return edit(doc, (score, cursor) => {
    let events = eventsAt(score, cursor);
    if (!events) return false;
    if (cursor.ossia === undefined && cursor.index >= events.length && isFull(score, score.measures[cursor.mi]!, events)) {
      if (cursor.mi === score.measures.length - 1) score.measures.push(blankMeasure(score));
      cursor.mi++;
      cursor.index = 0;
      events = eventsAt(score, cursor);
      if (!events) return false;
    }
    const base = { id: newId("e"), lines, dots: 0 as const };
    const event: Event =
      spec.type === "note"
        ? { ...base, type: "note", strings: [{ n: spec.n }] }
        : spec.type === "rest"
          ? { ...base, type: "rest" }
          : spec.type === "dot"
            ? { ...base, type: "dot" }
            : { ...base, type: "sign", sign: spec.sign };
    events.splice(cursor.index, 0, event);
    autoJoin(events, cursor.index);
    cursor.index++;
  });
}

function updateCurrent(doc: Doc, fn: (event: Event, events: Event[], index: number) => void | false): Doc | null {
  return edit(doc, (score, cursor) => {
    const events = eventsAt(score, cursor);
    const event = events?.[cursor.index - 1];
    if (!events || !event) return false;
    return fn(event, events, cursor.index - 1);
  });
}

function updateCurrentNote(doc: Doc, fn: (note: Note) => void | false): Doc | null {
  return updateCurrent(doc, (event) => (event.type === "note" ? fn(event) : false));
}

/** 合せ爪：手前の音符に絃を足す。すでにある絃なら外す */
export function toggleChordString(doc: Doc, n: number): Doc | null {
  return updateCurrentNote(doc, (note) => {
    const at = note.strings.findIndex((s) => s.n === n);
    if (at >= 0) {
      if (note.strings.length === 1) return false;
      note.strings.splice(at, 1);
    } else {
      note.strings.push({ n });
      note.strings.sort((a, b) => a.n - b.n);
    }
    if (note.strings.length > 1) note.chord ??= "arc";
    else delete note.chord;
  });
}

export function setLines(doc: Doc, lines: Lines): Doc | null {
  return updateCurrent(doc, (event, events, index) => {
    if (event.lines === lines) return false;
    event.lines = lines;
    autoJoin(events, index);
  });
}

export function cycleDots(doc: Doc): Doc | null {
  return updateCurrent(doc, (event) => {
    event.dots = ((event.dots + 1) % 3) as Event["dots"];
  });
}

/**
 * 音価線のつながりは「前の音符とつながるか」を音符ごとに持つ（joinPrev）。
 * 「次とつなぐ」は、次の音符の joinPrev を切り替えることと同じ。
 */
function toggleJoinAt(events: Event[], index: number): void | false {
  const event = events[index];
  const prev = events[index - 1];
  if (!event || !prev || event.lines === 0 || prev.lines === 0) return false;
  if (event.joinPrev) delete event.joinPrev;
  else event.joinPrev = true;
}

export function toggleJoinPrev(doc: Doc): Doc | null {
  return updateCurrent(doc, (_event, events, index) => toggleJoinAt(events, index));
}

export function toggleJoinNext(doc: Doc): Doc | null {
  return updateCurrent(doc, (_event, events, index) => toggleJoinAt(events, index + 1));
}

/** 手前の2音を「付点八分＋十六分」にする（コーロリンの頭など、頻出の形） */
export function makeDottedPair(doc: Doc): Doc | null {
  return edit(doc, (score, cursor) => {
    const events = eventsAt(score, cursor);
    const long = events?.[cursor.index - 2];
    const short = events?.[cursor.index - 1];
    if (!events || !long || !short) return false;
    long.lines = 1;
    long.dots = 1;
    short.lines = 2;
    short.dots = 0;
    autoJoin(events, cursor.index - 2);
    short.joinPrev = true;
  });
}

export function cyclePress(doc: Doc): Doc | null {
  return updateCurrentNote(doc, (note) => {
    const first = note.strings[0];
    if (!first) return false;
    if (first.press === undefined) first.press = 1;
    else if (first.press < 3) first.press = (first.press + 1) as 2 | 3;
    else delete first.press;
  });
}

function toggleInList(list: string[] | undefined, value: string): string[] | undefined {
  const next = list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value];
  return next.length > 0 ? next : undefined;
}

function assignOptional<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

export function toggleSup(doc: Doc, text: string): Doc | null {
  return updateCurrent(doc, (event) => assignOptional(event, "sup", toggleInList(event.sup, text)));
}

export function toggleAbove(doc: Doc, text: string): Doc | null {
  return updateCurrent(doc, (event) => assignOptional(event, "above", toggleInList(event.above, text)));
}

export function togglePrefix(doc: Doc, prefix: NonNullable<Note["prefix"]>): Doc | null {
  return updateCurrentNote(doc, (note) => assignOptional(note, "prefix", note.prefix === prefix ? undefined : prefix));
}

export function cycleChordStyle(doc: Doc): Doc | null {
  return updateCurrentNote(doc, (note) => {
    if (note.strings.length < 2) return false;
    const order = ["arc", "circle", "stack"] as const;
    note.chord = order[(order.indexOf(note.chord ?? "arc") + 1) % order.length]!;
  });
}

/** 属性パネルからの自由な変更 */
export function patchCurrent(doc: Doc, fn: (event: Event) => void): Doc | null {
  return updateCurrent(doc, (event) => fn(event));
}

/** カーソルのある小節・パートの中の、指定した番号の音符を変更する */
export function patchEventAt(doc: Doc, index: number, fn: (event: Event) => void): Doc | null {
  return edit(doc, (score, cursor) => {
    const event = eventsAt(score, cursor)?.[index];
    if (!event) return false;
    fn(event);
  });
}

/**
 * カーソルの手前の音符が入っている拍の、音符の範囲 [最初の番号, 最後の番号]。
 * その拍に音符が1つしかなければ null
 */
export function beatGroupOfCurrent(doc: Doc): [number, number] | null {
  const events = eventsAt(doc.score, doc.cursor);
  const at = doc.cursor.index - 1;
  if (!events || at < 0 || doc.cursor.ossia !== undefined) return null;
  const beats = eventOffsets(events).map((o) => Math.floor(toNumber(o) + 1e-9));
  let first = at;
  let last = at;
  while (first > 0 && beats[first - 1] === beats[at]) first--;
  while (last + 1 < events.length && beats[last + 1] === beats[at]) last++;
  return last > first ? [first, last] : null;
}

export function deleteBack(doc: Doc): Doc | null {
  if (doc.cursor.index === 0) return moveCursor(doc, -1);
  return edit(doc, (score, cursor) => {
    const events = eventsAt(score, cursor);
    if (!events) return false;
    events.splice(cursor.index - 1, 1);
    cursor.index--;
    cleanupSpans(score);
  });
}

export function deleteForward(doc: Doc): Doc | null {
  return edit(doc, (score, cursor) => {
    const events = eventsAt(score, cursor);
    if (!events || cursor.index >= events.length) return false;
    events.splice(cursor.index, 1);
    cleanupSpans(score);
  });
}

// ---------------------------------------------------------------- カーソル移動（楽譜は変えない）

function withCursor(doc: Doc, cursor: Cursor): Doc | null {
  const next = clampCursor(doc.score, cursor);
  const same =
    next.mi === doc.cursor.mi && next.partId === doc.cursor.partId && next.index === doc.cursor.index && next.ossia === doc.cursor.ossia;
  return same ? null : { score: doc.score, cursor: next };
}

/** 音符1つ分動く。小節の端では隣の小節へ移る */
export function moveCursor(doc: Doc, delta: -1 | 1): Doc | null {
  const { score, cursor } = doc;
  const length = eventsAt(score, cursor)?.length ?? 0;
  const index = cursor.index + delta;
  if (index >= 0 && index <= length) return withCursor(doc, { ...cursor, index });
  if (cursor.ossia !== undefined) return null;
  const mi = cursor.mi + delta;
  if (mi < 0 || mi >= score.measures.length) return null;
  const target = { ...cursor, mi, index: 0 };
  return withCursor(doc, delta > 0 ? target : { ...target, index: eventsAt(score, target)?.length ?? 0 });
}

export function moveMeasure(doc: Doc, delta: -1 | 1): Doc | null {
  return withCursor(doc, { mi: doc.cursor.mi + delta, partId: doc.cursor.partId, index: 0 });
}

export function movePart(doc: Doc, delta: -1 | 1): Doc | null {
  const parts = doc.score.parts;
  const at = parts.findIndex((p) => p.id === doc.cursor.partId) + delta;
  const part = parts[at];
  return part ? withCursor(doc, { mi: doc.cursor.mi, partId: part.id, index: 0 }) : null;
}

// ---------------------------------------------------------------- 小節

export function insertMeasureAfter(doc: Doc): Doc | null {
  return edit(doc, (score, cursor) => {
    score.measures.splice(cursor.mi + 1, 0, blankMeasure(score));
    cursor.mi++;
    cursor.index = 0;
  });
}

export function insertMeasureBefore(doc: Doc): Doc | null {
  return edit(doc, (score, cursor) => {
    score.measures.splice(cursor.mi, 0, blankMeasure(score));
    cursor.index = 0;
  });
}

export function deleteMeasure(doc: Doc): Doc | null {
  return edit(doc, (score, cursor) => {
    score.measures.splice(cursor.mi, 1);
    if (score.measures.length === 0) score.measures.push(blankMeasure(score));
    cursor.mi = Math.min(cursor.mi, score.measures.length - 1);
    cursor.index = 0;
    cleanupSpans(score);
  });
}

/** 小節の残りを休符で埋め、次の小節（なければ新規）の頭へ進む */
export function fillRests(doc: Doc): Doc | null {
  return edit(doc, (score, cursor) => {
    const measure = score.measures[cursor.mi];
    const events = eventsAt(score, cursor);
    if (!measure || !events) return false;
    const beats = measureBeats(score, measure);
    let remaining = beats && !measure.free ? toNumber(beats) - toNumber(totalBeats(events)) : 0;
    for (const lines of [0, 1, 2, 3] as const) {
      const value = 1 / 2 ** lines;
      while (remaining >= value - 1e-9) {
        events.push({ id: newId("e"), type: "rest", lines, dots: 0 });
        autoJoin(events, events.length - 1);
        remaining -= value;
      }
    }
    if (cursor.mi === score.measures.length - 1) score.measures.push(blankMeasure(score));
    cursor.mi++;
    cursor.index = 0;
  });
}

/** 小節の中身（音符・口唱歌・補助行）を、IDを振り直して写す。標記や小節線は写さない */
function copyContent(from: Measure, to: Measure): void {
  const content = structuredClone(from.content);
  for (const pm of Object.values(content)) {
    if (isEventsMeasure(pm)) for (const e of pm.events) e.id = newId("e");
  }
  to.content = content;
  if (from.aux) to.aux = structuredClone(from.aux);
  else delete to.aux;
}

/** 渡された小節の中身で、カーソルのある小節を置き換える */
export function pasteMeasure(doc: Doc, source: Measure | null | undefined): Doc | null {
  if (!source) return null;
  return edit(doc, (score, cursor) => {
    const measure = score.measures[cursor.mi];
    if (!measure) return false;
    copyContent(source, measure);
    for (const part of score.parts) measure.content[part.id] ??= { events: [] };
    cursor.index = eventsAt(score, cursor)?.length ?? 0;
    cleanupSpans(score);
  });
}

/** カーソルのあるパートの小節を「前小節くり返し」と通常の小節の間で切り替える */
export function toggleMeasureRepeat(doc: Doc): Doc | null {
  return edit(doc, (score, cursor) => {
    const measure = score.measures[cursor.mi];
    if (!measure) return false;
    const pm = measure.content[cursor.partId];
    measure.content[cursor.partId] = pm && !isEventsMeasure(pm) ? { events: [] } : { repeat: "measure" };
    cursor.index = 0;
    cleanupSpans(score);
  });
}

export function patchMeasure(doc: Doc, fn: (measure: Measure) => void): Doc | null {
  return edit(doc, (score, cursor) => {
    const measure = score.measures[cursor.mi];
    if (!measure) return false;
    fn(measure);
  });
}

export function patchScore(doc: Doc, fn: (score: Score) => void): Doc | null {
  return edit(doc, (score) => fn(score));
}

// ---------------------------------------------------------------- 口唱歌・補助行

/** 入力欄の指定。"shoka:<partId>" または "aux:<trackId>" */
export type LaneRef = { kind: "shoka"; partId: string } | { kind: "aux"; trackId: string };
export type LaneItem = ShokaItem | AuxItem;

export function parseLane(lane: string): LaneRef | null {
  const at = lane.indexOf(":");
  const kind = lane.slice(0, at);
  const id = lane.slice(at + 1);
  if (kind === "shoka") return { kind, partId: id };
  if (kind === "aux") return { kind, trackId: id };
  return null;
}

export function laneItems(score: Score, lane: LaneRef, mi: number): LaneItem[] {
  const measure = score.measures[mi];
  if (!measure) return [];
  if (lane.kind === "aux") return measure.aux?.[lane.trackId] ?? [];
  const pm = measure.content[lane.partId];
  return pm && isEventsMeasure(pm) ? (pm.shoka ?? []) : [];
}

const atOf = (item: LaneItem) => parseFraction(item.at) ?? ZERO;

/**
 * 入力欄の項目を置く・置き換える・消す。
 * index が null なら新規、item が null なら削除。項目は拍位置の順に並べ直す。
 */
export function putLaneItem(doc: Doc, lane: LaneRef, mi: number, index: number | null, item: LaneItem | null): Doc | null {
  return edit(doc, (score) => {
    const measure = score.measures[mi];
    if (!measure) return false;
    const list = [...laneItems(score, lane, mi)];
    if (index !== null) {
      if (!list[index]) return false;
      list.splice(index, 1);
    }
    if (item) list.push(item);
    if (index === null && !item) return false;
    list.sort((a, b) => compare(atOf(a), atOf(b)));

    if (lane.kind === "aux") {
      if (list.length > 0) (measure.aux ??= {})[lane.trackId] = list as AuxItem[];
      else if (measure.aux) {
        delete measure.aux[lane.trackId];
        if (Object.keys(measure.aux).length === 0) delete measure.aux;
      }
    } else {
      const pm = measure.content[lane.partId];
      if (!pm || !isEventsMeasure(pm)) return false;
      if (list.length > 0) pm.shoka = list as ShokaItem[];
      else delete pm.shoka;
    }
  });
}

/** 項目を別の拍位置（別の小節でもよい）へ動かす */
export function moveLaneItem(doc: Doc, lane: LaneRef, fromMi: number, index: number, toMi: number, at: string): Doc | null {
  const item = laneItems(doc.score, lane, fromMi)[index];
  if (!item) return null;
  const moved = { ...item, at };
  if (fromMi === toMi) return putLaneItem(doc, lane, fromMi, index, moved);
  const removed = putLaneItem(doc, lane, fromMi, index, null);
  return removed && putLaneItem(removed, lane, toMi, null, moved);
}

/** 拍位置 at より後ろで最初の、音符の開始位置。小節内になければ null */
export function nextOnset(score: Score, mi: number, partId: string, at: string): string | null {
  const pm = score.measures[mi]?.content[partId];
  if (!pm || !isEventsMeasure(pm)) return null;
  const from = parseFraction(at) ?? ZERO;
  for (const onset of eventOffsets(pm.events)) {
    if (compare(onset, from) > 0) return formatFraction(onset);
  }
  return null;
}

// ---------------------------------------------------------------- スパン

function locateEvent(score: Score, eventId: string): { mi: number; partId: string; index: number } | null {
  for (let mi = 0; mi < score.measures.length; mi++) {
    for (const [partId, pm] of Object.entries(score.measures[mi]!.content)) {
      if (!isEventsMeasure(pm)) continue;
      const index = pm.events.findIndex((e) => e.id === eventId);
      if (index >= 0) return { mi, partId, index };
    }
  }
  return null;
}

/** 2つの音符の間にスパンを掛ける。順序は自動でそろえる。別パートどうしには掛けられない */
export function addSpan(doc: Doc, kind: Exclude<Span["kind"], "volta">, aId: string, bId: string): Doc | null {
  return edit(doc, (score) => {
    const a = locateEvent(score, aId);
    const b = locateEvent(score, bId);
    if (!a || !b || a.partId !== b.partId) return false;
    const forward = a.mi < b.mi || (a.mi === b.mi && a.index <= b.index);
    const span: Span = { id: newId("s"), kind, part: a.partId, from: forward ? aId : bId, to: forward ? bId : aId };
    if (kind === "wave") span.startText = "サ";
    score.spans.push(span);
  });
}

/** 1番括弧・2番括弧。小節の範囲に掛ける */
export function addVolta(doc: Doc, fromMi: number, toMi: number): Doc | null {
  return edit(doc, (score) => {
    const from = score.measures[Math.min(fromMi, toMi)];
    const to = score.measures[Math.max(fromMi, toMi)];
    if (!from || !to) return false;
    const count = score.spans.filter((s) => s.kind === "volta").length;
    score.spans.push({ id: newId("s"), kind: "volta", from: from.id, to: to.id, startText: `${(count % 2) + 1}` });
  });
}

export function patchSpan(doc: Doc, id: string, fn: (span: Span) => void): Doc | null {
  return edit(doc, (score) => {
    const span = score.spans.find((s) => s.id === id);
    if (!span) return false;
    fn(span);
  });
}

export function deleteSpan(doc: Doc, id: string): Doc | null {
  return edit(doc, (score) => {
    const at = score.spans.findIndex((s) => s.id === id);
    if (at < 0) return false;
    score.spans.splice(at, 1);
  });
}

/** カーソルのある小節に掛かっているスパン */
export function spansAtMeasure(score: Score, mi: number): Span[] {
  const measureIndex = new Map(score.measures.map((m, i) => [m.id, i]));
  return score.spans.filter((span) => {
    const from = span.kind === "volta" ? measureIndex.get(span.from) : locateEvent(score, span.from)?.mi;
    const to = span.kind === "volta" ? measureIndex.get(span.to) : locateEvent(score, span.to)?.mi;
    return from !== undefined && to !== undefined && from <= mi && mi <= to;
  });
}

// ---------------------------------------------------------------- 代替譜

/** カーソル位置（手前の音符の拍位置）に代替譜を作り、その中へカーソルを移す */
export function addOssia(doc: Doc): Doc | null {
  if (doc.cursor.ossia !== undefined) return null;
  return edit(doc, (score, cursor) => {
    const measure = score.measures[cursor.mi];
    const events = eventsAt(score, cursor);
    if (!measure || !events) return false;
    const onset = eventOffsets(events)[Math.max(0, cursor.index - 1)];
    const ossia: Ossia = { part: cursor.partId, label: "或は", at: onset ? formatFraction(onset) : "0", events: [] };
    (measure.ossia ??= []).push(ossia);
    cursor.ossia = measure.ossia.length - 1;
    cursor.index = 0;
  });
}

export function patchOssia(doc: Doc, index: number, fn: (ossia: Ossia) => void): Doc | null {
  return edit(doc, (score, cursor) => {
    const ossia = score.measures[cursor.mi]?.ossia?.[index];
    if (!ossia) return false;
    fn(ossia);
  });
}

export function deleteOssia(doc: Doc, index: number): Doc | null {
  return edit(doc, (score, cursor) => {
    const measure = score.measures[cursor.mi];
    if (!measure?.ossia?.[index]) return false;
    measure.ossia.splice(index, 1);
    if (measure.ossia.length === 0) delete measure.ossia;
    delete cursor.ossia;
    cursor.index = 0;
  });
}

// ---------------------------------------------------------------- パートと補助行

export function addPart(doc: Doc): Doc | null {
  return edit(doc, (score) => {
    const part: Part = { id: newId("p"), name: `パート${score.parts.length + 1}`, weight: "regular" };
    score.parts.push(part);
    for (const measure of score.measures) measure.content[part.id] = { events: [] };
  });
}

/** パートを、その下の補助行・代替譜・スパンごと取り除く。最後の1つは消せない */
export function removePart(doc: Doc, partId: string): Doc | null {
  if (doc.score.parts.length <= 1) return null;
  return edit(doc, (score, cursor) => {
    const tracks = score.tracks.filter((t) => t.below === partId).map((t) => t.id);
    score.parts = score.parts.filter((p) => p.id !== partId);
    score.tracks = score.tracks.filter((t) => t.below !== partId);
    for (const measure of score.measures) {
      delete measure.content[partId];
      for (const id of tracks) delete measure.aux?.[id];
      if (measure.aux && Object.keys(measure.aux).length === 0) delete measure.aux;
      if (measure.ossia) {
        measure.ossia = measure.ossia.filter((o) => o.part !== partId);
        if (measure.ossia.length === 0) delete measure.ossia;
      }
      if (measure.retune) {
        measure.retune = measure.retune.filter((r) => r.part !== partId);
        if (measure.retune.length === 0) delete measure.retune;
      }
      for (const mark of measure.marks ?? []) if (mark.part === partId) delete mark.part;
    }
    cleanupSpans(score);
    Object.assign(cursor, clampCursor(score, { mi: cursor.mi, partId: cursor.partId, index: 0 }));
    delete cursor.ossia;
  });
}

export function addTrack(doc: Doc, kind: AuxTrack["kind"], below: string): Doc | null {
  return edit(doc, (score) => {
    const names = { lyrics: "歌詞", pitch: "歌の節", rhythm: "唱歌", text: "他楽器" } as const;
    const count = score.tracks.filter((t) => t.kind === kind).length;
    score.tracks.push({ id: newId("t"), name: `${names[kind]}${count > 0 ? count + 1 : ""}`, kind, below });
  });
}

export function removeTrack(doc: Doc, trackId: string): Doc | null {
  return edit(doc, (score) => {
    score.tracks = score.tracks.filter((t) => t.id !== trackId);
    for (const measure of score.measures) {
      delete measure.aux?.[trackId];
      if (measure.aux && Object.keys(measure.aux).length === 0) delete measure.aux;
    }
  });
}

/** 補助行の並び順を1つ上下に動かす */
export function moveTrack(doc: Doc, trackId: string, delta: -1 | 1): Doc | null {
  return edit(doc, (score) => {
    const at = score.tracks.findIndex((t) => t.id === trackId);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= score.tracks.length) return false;
    const [track] = score.tracks.splice(at, 1);
    score.tracks.splice(to, 0, track!);
  });
}
