// 下書き記法。紙の譜面を読み取って手早く書き起こすための、1小節1行のテキスト形式。
// 書き方は drafts/README.md を参照。1パートの曲だけを扱う。

import { eventOffsets } from "./duration";
import { toNumber } from "./fraction";
import type { AuxItem, Barline, Event, Mark, Measure, Note, Score, ShokaItem, Span, StringRef } from "./types";

export interface DraftError {
  line: number;
  message: string;
}

export interface DraftResult {
  score: Score;
  errors: DraftError[];
  /** 各小節が書かれていた行番号（検算結果を元の行に結び付けるため） */
  measureLines: number[];
}

const STRINGS: Record<string, number> = {
  壱: 1, 一: 1, 弐: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 斗: 11, 為: 12, 巾: 13,
};
const SIGNS = new Set(["ワ", "ス"]);
const PART = "koto";

interface Pending {
  marks: Mark[];
  beats?: string;
  free?: boolean;
  barline?: Barline;
  startRepeat?: boolean;
  break?: Measure["break"];
  measuresPerSystem?: number;
}

export function parseDraft(text: string): DraftResult {
  const errors: DraftError[] = [];
  const score: Score = {
    format: "koto-score",
    version: 1,
    meta: { title: "無題" },
    settings: { beatsPerMeasure: "4", measuresPerSystem: 4, systemsPerPage: 7 },
    parts: [{ id: PART, weight: "bold" }],
    tracks: [],
    measures: [],
    spans: [],
  };

  const lines = text.split(/\r?\n/);
  let lineNo = 0;
  let inBody = !lines.some((l) => l.trim() === "---");
  let pending: Pending = { marks: [] };
  const measureLines: number[] = [];
  let openSpan: Span | null = null;

  const fail = (message: string) => errors.push({ line: lineNo, message });

  const parseEvents = (source: string, idPrefix: string): Event[] => {
    const events: Event[] = [];
    for (const token of source.split(/\s+/).filter(Boolean)) {
      const event = parseToken(token, `${idPrefix}${events.length + 1}`, fail);
      if (!event) continue;
      events.push(event.event);
      applyJoin(events, event.join);
      if (event.spanStart !== undefined) {
        if (openSpan) fail("前の波線が閉じられていません");
        openSpan = { id: `s${score.spans.length + 1}`, kind: "wave", part: PART, from: event.event.id, to: event.event.id };
        if (event.spanStart) openSpan.startText = event.spanStart;
      }
      if (event.spanEnd !== undefined) {
        if (!openSpan) fail("始点のない波線の終点があります");
        else {
          const span: Span = openSpan;
          span.to = event.event.id;
          if (event.spanEnd) span.endText = event.spanEnd;
          score.spans.push(span);
          openSpan = null;
        }
      }
    }
    return events;
  };

  for (const raw of lines) {
    lineNo++;
    // 「#」は行頭か空白の後にあるときだけコメント（音名の A#3 などを切らない）
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    if (line === "---") {
      inBody = true;
      continue;
    }
    if (!inBody) {
      parseHeader(line, score, fail);
      continue;
    }

    if (line.startsWith("[")) {
      const close = line.lastIndexOf("]");
      if (close < 0) {
        fail("] がありません");
        continue;
      }
      const body = line.slice(1, close).trim();
      if (body.startsWith("或は")) {
        const prev = score.measures[score.measures.length - 1];
        const m = /^(或は)\s*(?:@(\S+))?\s*:\s*(.+)$/.exec(body);
        if (!prev || !m) fail("代替譜は、小節の行の後に [或は @拍位置: 音符…] と書きます");
        else {
          const index = (prev.ossia?.length ?? 0) + 1;
          (prev.ossia ??= []).push({ part: PART, label: m[1]!, at: m[2] ?? "0", events: parseEvents(m[3]!, `${prev.id}o${index}e`) });
        }
        continue;
      }
      applyDirective(body, pending, fail);
      continue;
    }

    // 補助行： 歌: 字@拍位置 …　／　節: 絃@拍位置 …（直前の小節に付く）
    const aux = /^(歌|節)\s*[:：]\s*(.*)$/.exec(line);
    if (aux) {
      const prev = score.measures[score.measures.length - 1];
      if (!prev) fail("補助行は、小節の行の後に書きます");
      else parseAux(aux[1] as "歌" | "節", aux[2]!, score, prev, fail);
      continue;
    }

    // 小節の行： 音符… ; 口唱歌…
    const [eventPart = "", shokaPart] = line.split(";");
    const id = `m${score.measures.length + 1}`;
    const events = parseEvents(eventPart, `${id}e`);
    const measure: Measure = { id, content: { [PART]: { events } } };
    if (shokaPart !== undefined) {
      const shoka = parseShoka(shokaPart, events, fail);
      if (shoka.length > 0) measure.content[PART] = { events, shoka };
    }
    if (pending.marks.length > 0) measure.marks = pending.marks;
    if (pending.beats) measure.beats = pending.beats;
    if (pending.free) measure.free = true;
    if (pending.barline) measure.barline = pending.barline;
    if (pending.startRepeat) measure.startRepeat = true;
    if (pending.break) measure.break = pending.break;
    if (pending.measuresPerSystem) measure.measuresPerSystem = pending.measuresPerSystem;
    pending = { marks: [] };
    score.measures.push(measure);
    measureLines.push(lineNo);
  }

  if (openSpan) errors.push({ line: lineNo, message: "波線が閉じられていません" });
  if (score.measures.length === 0) errors.push({ line: lineNo, message: "小節がありません" });
  return { score, errors, measureLines };
}

function parseHeader(line: string, score: Score, fail: (message: string) => void): void {
  const at = line.indexOf(":");
  if (at < 0) return fail("見出しは「項目: 値」の形で書きます");
  const key = line.slice(0, at).trim();
  const value = line.slice(at + 1).trim();
  const count = Number(value);
  switch (key) {
    case "title": score.meta.title = value; break;
    case "subtitle": score.meta.subtitle = value; break;
    case "composer": score.meta.composer = value; break;
    case "memo": score.meta.memo = value; break;
    case "tuning": (score.meta.tuning ??= []).push(value.replace(/\|/g, "\t")); break;
    case "note": (score.meta.notes ??= []).push(value); break;
    case "meter": score.settings.meterLabel = value; break;
    case "beats": score.settings.beatsPerMeasure = value; break;
    case "perSystem":
      if (Number.isInteger(count) && count >= 1) score.settings.measuresPerSystem = count;
      else fail("perSystem は1以上の整数で書きます");
      break;
    case "perPage":
      if (Number.isInteger(count) && count >= 1) score.settings.systemsPerPage = count;
      else fail("perPage は1以上の整数で書きます");
      break;
    case "pitches":
      score.parts[0]!.tuning = { ...score.parts[0]!.tuning, pitches: value.split(/\s+/).filter(Boolean) };
      break;
    case "tuningName":
      score.parts[0]!.tuning = { pitches: score.parts[0]!.tuning?.pitches ?? [], name: value };
      break;
    default:
      fail(`知らない見出し「${key}」`);
  }
}

/** [段 初段] [速 徐 @2] [複] などの、次の小節に掛かる指定 */
function applyDirective(body: string, pending: Pending, fail: (message: string) => void): void {
  const words = body.split(/\s+/);
  const [head, ...rest] = words;
  const atWord = rest.find((w) => w.startsWith("@"));
  const args = rest.filter((w) => !w.startsWith("@"));
  const mark = (kind: Mark["kind"]) => {
    if (!args[0]) return fail(`[${head}] には文字が必要です`);
    const m: Mark = { kind, text: args[0] };
    if (args[1]) m.note = args.slice(1).join(" ");
    if (atWord) m.at = atWord.slice(1);
    pending.marks.push(m);
  };
  switch (head) {
    case "段": return mark("section");
    case "速": return mark("tempo");
    case "文": return mark("text");
    case "拍":
      if (!args[0]) return fail("[拍] には拍数が必要です");
      pending.beats = args[0];
      return;
    case "自由": pending.free = true; return;
    case "複": pending.barline = "double"; return;
    case "終": pending.barline = "final"; return;
    case "反復始": pending.startRepeat = true; return;
    case "反復終": pending.barline = "repeatEnd"; return;
    case "改段": pending.break = "system"; return;
    case "改頁": pending.break = "page"; return;
    case "段組": {
      const n = Number(args[0]);
      if (!Number.isInteger(n) || n < 1) return fail("[段組] には1以上の整数が必要です");
      pending.measuresPerSystem = n;
      return;
    }
    default:
      fail(`知らない指定 [${head}]`);
  }
}

interface ParsedToken {
  event: Event;
  /** true=必ずつなぐ、false=必ず切る、undefined=同じ拍の中なら自動でつなぐ */
  join: boolean | undefined;
  spanStart?: string;
  spanEnd?: string;
}

/**
 * 音符1つ分の記法：
 *   [&|!] [~|%] [(] 絃(+絃…) [_…] [.…] ['右肩]… ["上記号]… [<波線の始点] [>波線の終点]
 * 絃は 壱〜巾、休符は ○、拍の中に置く付点は ●、記号音符は ワ・ス。絃の前の △ ▲ ▲▲ が押し手。
 */
function parseToken(token: string, id: string, fail: (message: string) => void): ParsedToken | null {
  const chars = [...token];
  let i = 0;
  const peek = () => chars[i];
  let join: boolean | undefined;
  if (peek() === "&") { join = true; i++; } else if (peek() === "!") { join = false; i++; }
  let prefix: Note["prefix"];
  if (peek() === "~") { prefix = "kaki"; i++; } else if (peek() === "%") { prefix = "wari"; i++; }

  // 合せ爪の左弧
  let arc = false;
  if (peek() === "(") { arc = true; i++; }

  const strings: StringRef[] = [];
  let kind: "note" | "rest" | "sign" | "dot" = "note";
  let sign = "";
  if (peek() === "○") { kind = "rest"; i++; }
  else if (peek() === "●") { kind = "dot"; i++; }
  else if (peek() !== undefined && SIGNS.has(peek()!)) { kind = "sign"; sign = peek()!; i++; }
  else {
    for (;;) {
      let press = 0;
      while (peek() === "△" || peek() === "▲") { press += peek() === "△" ? 1 : 2; i++; }
      const n = peek() === undefined ? undefined : STRINGS[peek()!];
      if (n === undefined) {
        fail(`「${token}」の絃名を読めません`);
        return null;
      }
      i++;
      strings.push(press > 0 ? { n, press: Math.min(press, 3) as 1 | 2 | 3 } : { n });
      if (peek() !== "+") break;
      i++;
    }
  }

  let lines = 0;
  while (peek() === "_") { lines++; i++; }
  let dots = 0;
  while (peek() === ".") { dots++; i++; }
  if (lines > 3 || dots > 2) {
    fail(`「${token}」の音価線は3本まで、付点は2つまでです`);
    return null;
  }

  const sup: string[] = [];
  const above: string[] = [];
  const result: Partial<ParsedToken> = {};
  while (i < chars.length) {
    const mark = chars[i++];
    // 波線の文字は省略できる。直後が別の記号なら、文字なしとして扱う
    const takeOptional = () => (i < chars.length && !"'\"<>".includes(chars[i]!) ? chars[i++]! : "");
    if (mark === "<") result.spanStart = takeOptional();
    else if (mark === ">") result.spanEnd = takeOptional();
    else if (mark === "'" || mark === '"') {
      const value = chars[i++];
      if (value === undefined) {
        fail(`「${token}」の ${mark} の後に記号がありません`);
        return null;
      }
      if (mark === "'") sup.push(value);
      else above.push(value === "F" ? "fermata" : value);
    } else {
      fail(`「${token}」の「${mark}」を読めません`);
      return null;
    }
  }

  const base = { id, lines: lines as Event["lines"], dots: dots as Event["dots"] };
  let event: Event;
  if (kind === "rest") event = { ...base, type: "rest" };
  else if (kind === "dot") event = { ...base, type: "dot" };
  else if (kind === "sign") event = { ...base, type: "sign", sign };
  else {
    event = { ...base, type: "note", strings };
    if (strings.length > 1 && arc) event.chord = "arc";
    if (prefix) event.prefix = prefix;
  }
  if (prefix && kind !== "note") fail(`「${token}」：かき爪・わり爪は絃にだけ付けられます`);
  if (sup.length > 0) event.sup = sup;
  if (above.length > 0) event.above = above;
  return { event, join, ...result };
}

/** 末尾の音符の音価線を、前の音符とつなぐかどうか決める */
function applyJoin(events: Event[], join: boolean | undefined): void {
  const index = events.length - 1;
  const event = events[index]!;
  const prev = events[index - 1];
  if (!prev || event.lines === 0 || prev.lines === 0 || join === false || event.type === "dot" || prev.type === "dot") return;
  if (join === true) {
    event.joinPrev = true;
    return;
  }
  const offsets = eventOffsets(events).map(toNumber);
  const onset = offsets[index]!;
  if (Math.floor(onset + 1e-9) === Math.floor(offsets[index - 1]! + 1e-9) && onset % 1 > 1e-9) event.joinPrev = true;
}

/**
 * 口唱歌：空白区切りの字を、音符に順に対応させる。「_」はその音符を飛ばす。
 * 「字@拍位置」と書くと、音符と関係なくその位置に置く（順番の対応は進めない）。
 */
function parseShoka(source: string, events: Event[], fail: (message: string) => void): ShokaItem[] {
  const offsets = eventOffsets(events);
  const items: ShokaItem[] = [];
  let index = 0;
  for (const token of source.split(/\s+/).filter(Boolean)) {
    const at = token.indexOf("@");
    if (at > 0) {
      items.push({ at: token.slice(at + 1), text: token.slice(0, at) });
      continue;
    }
    const offset = offsets[index++];
    if (token === "_") continue;
    if (!offset) {
      fail(`口唱歌「${token}」に対応する音符がありません`);
      continue;
    }
    items.push({ at: offset.d === 1 ? `${offset.n}` : `${offset.n}/${offset.d}`, text: token });
  }
  return items.sort((a, b) => fractionValue(a.at) - fractionValue(b.at));
}

const AUX_TRACKS = {
  歌: { id: "lyrics", kind: "lyrics", name: "歌詞" },
  節: { id: "melody", kind: "pitch", name: "歌の節" },
} as const;

/**
 * 補助行。空白区切りの「中身@拍位置」を並べる。末尾に「-」を付けると、次の項目まで延ばし線を引く。
 *   歌: た@1 ち@1.5
 *   節: ▲六@1 七@1.25- |@3     （「|」は延ばし線の終わり。絃は「+」で横に並べられる）
 * 拍位置は分数（3/2）でも小数（1.5、1/8拍きざみ）でもよい
 */
function parseAux(head: "歌" | "節", source: string, score: Score, measure: Measure, fail: (message: string) => void): void {
  const def = AUX_TRACKS[head];
  if (!score.tracks.some((t) => t.id === def.id)) {
    score.tracks.push({ id: def.id, kind: def.kind, name: def.name, below: PART });
    // 元譜と同じく、歌詞を上、歌の節を下に並べる
    score.tracks.sort((a, b) => (a.id === "lyrics" ? 0 : 1) - (b.id === "lyrics" ? 0 : 1));
  }
  const items: AuxItem[] = (measure.aux ??= {})[def.id] ??= [];
  for (const token of source.split(/\s+/).filter(Boolean)) {
    const m = /^(.*)@([\d./]+)(-?)$/.exec(token);
    const at = m ? draftPosition(m[2]!) : null;
    if (!m || at === null) {
      fail(`補助行の「${token}」は「中身@拍位置」の形で書きます`);
      continue;
    }
    const body = m[1]!;
    const item: AuxItem = { at };
    if (head === "歌" || body === "|" || body === "") item.text = body === "|" ? "" : body;
    else {
      const notes: StringRef[] = [];
      let press = 0;
      let bad = false;
      for (const ch of body) {
        if (ch === "+") continue;
        if (ch === "△" || ch === "▲") { press += ch === "△" ? 1 : 2; continue; }
        const n = STRINGS[ch];
        if (n === undefined) { bad = true; break; }
        notes.push(press > 0 ? { n, press: Math.min(press, 3) as 1 | 2 | 3 } : { n });
        press = 0;
      }
      if (bad || notes.length === 0) {
        fail(`補助行の「${token}」の絃名を読めません`);
        continue;
      }
      item.notes = notes;
    }
    if (m[3]) item.extend = true;
    items.push(item);
  }
  items.sort((a, b) => fractionValue(a.at) - fractionValue(b.at));
}

/** 拍位置を分数の文字列にそろえる。小数は 1/8 拍きざみで受け付ける */
function draftPosition(text: string): string | null {
  if (/^\d+(\/[1-9]\d*)?$/.test(text)) return text;
  if (!/^\d*\.\d+$/.test(text)) return null;
  const eighths = Number(text) * 8;
  if (!Number.isInteger(eighths)) return null;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(eighths, 8) || 1;
  return 8 / g === 1 ? `${eighths / g}` : `${eighths / g}/${8 / g}`;
}

function fractionValue(text: string): number {
  const [n, d] = text.split("/").map(Number);
  return (n ?? 0) / (d ?? 1);
}
