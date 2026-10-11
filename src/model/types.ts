// 楽譜データの型。SPEC.md 3章に対応する。

import type { Style } from "../layout/style";

/** 拍を単位とする分数文字列。"2"、"3/2" など（四分音符=1） */
export type Fraction = string;

export interface Score {
  format: "koto-score";
  version: 1;
  meta: Meta;
  settings: Settings;
  /** 上から順 */
  parts: Part[];
  tracks: AuxTrack[];
  measures: Measure[];
  spans: Span[];
}

export interface Meta {
  title: string;
  subtitle?: string;
  composer?: string;
  /** 調弦表。1行1要素。タブで左右を分ける */
  tuning?: string[];
  /** 譜面に載せる注記 */
  notes?: string[];
  /** データについての覚え書き。譜面には出さない */
  memo?: string;
}

export interface Settings {
  /** 既定の拍数 */
  beatsPerMeasure: Fraction;
  /** 拍子表示。空なら表示しない */
  meterLabel?: string;
  measuresPerSystem: number;
  systemsPerPage: number;
  /** 既定値と違う項目だけ指定する */
  style?: Partial<Style>;
}

export interface Part {
  id: string;
  name?: string;
  weight: "bold" | "regular";
  /** 調弦。音高を求めるのに使う（五線譜への変換の土台） */
  tuning?: Tuning;
}

export interface Tuning {
  /** 調子の名前。"平調子" など */
  name?: string;
  /** 絃 壱〜巾 の開放の音高。"D4" "A#3" のような音名を13個 */
  pitches: string[];
}

/** 曲の途中での調弦の変更（「三半音上る」など）。この小節の頭から効く */
export interface Retune {
  part: string;
  /** 絃番号 1〜13 */
  string: number;
  /** 上げ下げする半音数。下げるときは負 */
  semitones: number;
}

export interface AuxTrack {
  id: string;
  name?: string;
  kind: "lyrics" | "pitch" | "rhythm" | "text";
  /** この partId の下に置く */
  below: string;
  label?: string;
}

export type Barline = "single" | "double" | "final" | "repeatEnd" | "none";

export interface Measure {
  id: string;
  /** 既定と違うときだけ指定 */
  beats?: Fraction;
  /** true なら拍数の検算をしない */
  free?: boolean;
  /** 右側の小節線。省略時は単線 */
  barline?: Barline;
  startRepeat?: boolean;
  /** この小節の後で改段・改ページ */
  break?: "system" | "page";
  /** この小節から先の、1段の小節数。この小節は新しい段の先頭になる */
  measuresPerSystem?: number;
  marks?: Mark[];
  retune?: Retune[];
  content: Record<string, PartMeasure>;
  aux?: Record<string, AuxItem[]>;
  ossia?: Ossia[];
}

export type PartMeasure = EventsMeasure | RepeatMeasure;

export interface EventsMeasure {
  events: Event[];
  shoka?: ShokaItem[];
}

/** 前小節くり返し */
export interface RepeatMeasure {
  repeat: "measure";
}

/** 口唱歌。元譜で読み取った位置に置く */
export interface ShokaItem {
  at: Fraction;
  text: string;
}

export interface Mark {
  kind: "section" | "rehearsal" | "tempo" | "text";
  text: string;
  enclosure?: "none" | "box" | "circle" | "paren";
  /** 添え書き */
  note?: string;
  /** 特定パートの上に置くとき */
  part?: string;
  /** 小節内の拍位置。省略時は小節頭 */
  at?: Fraction;
}

export type Event = Note | Rest | Sign | Dot;

export interface EventBase {
  id: string;
  /** 音価線の本数 */
  lines: 0 | 1 | 2 | 3;
  dots: 0 | 1 | 2;
  /** 音価線を前の音符とつなぐ */
  joinPrev?: boolean;
  /** 右肩記号 */
  sup?: string[];
  /** 上記号 */
  above?: string[];
  /** 右肩記号の位置の調整 [右へ, 下へ]（mm）。曲全体の調整（スタイルの supShift）に足す */
  supShift?: [number, number];
  /**
   * この音符から始まる拍（1拍に複数の音符があるとき）の調整。拍の最初の音符に持たせる。
   * spread はかたまりが使ってよい幅（拍の幅に対する％）、gap は字と字の間隔（mm）。
   * 指定しなければ、曲全体の設定（スタイルの groupSpread・groupGap）に従う
   */
  beat?: { spread?: number; gap?: number };
}

export interface Note extends EventBase {
  type: "note";
  /** 2つ以上で合せ爪（上から順） */
  strings: StringRef[];
  chord?: "stack" | "arc" | "circle";
  prefix?: "kaki" | "wari";
  /** 前記号の位置の調整 [右へ, 下へ]（mm）。曲全体の調整（スタイルの prefixShift）に足す */
  prefixShift?: [number, number];
}

export interface StringRef {
  /** 1〜13 */
  n: number;
  /** 押し手（一重・二重・三重） */
  press?: 1 | 2 | 3;
}

export interface Rest extends EventBase {
  type: "rest";
}

export interface Sign extends EventBase {
  type: "sign";
  sign: string;
}

/**
 * 拍の中に置く付点。前の音符を、この音符自身の長さ（音価線の本数で決まる）だけ延ばす。
 * 「五 ●（八分）●（十六分）四（十六分）」のように、付点が次の拍に入る書き方に使う。
 * 音符のすぐ後ろに付く付点（同じ拍の中で完結するもの）は、音符の dots で表す
 */
export interface Dot extends EventBase {
  type: "dot";
}

export interface Span {
  id: string;
  kind: "wave" | "dash" | "pressBracket" | "volta";
  part?: string;
  /** 開始の eventId（volta は measureId） */
  from: string;
  /** 終了の eventId（volta は measureId） */
  to: string;
  startText?: string;
  endText?: string;
}

export interface AuxItem {
  at: Fraction;
  text?: string;
  notes?: StringRef[];
  lines?: 0 | 1 | 2 | 3;
  joinPrev?: boolean;
  /** 次の項目まで横線を引く */
  extend?: boolean;
  enclosure?: "paren" | "bracket";
}

export interface Ossia {
  part: string;
  label: string;
  at: Fraction;
  events: Event[];
}

export const STRING_COUNT = 13;

export function isEventsMeasure(pm: PartMeasure): pm is EventsMeasure {
  return "events" in pm;
}
