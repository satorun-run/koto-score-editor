// レイアウト結果を表す描画要素。座標は mm、原点はページ左上。

export type FontRole = "main" | "sub";

interface PrimBase {
  /** 出力時のグループ名（SPEC.md 7.1） */
  layer: string;
}

export interface TextPrim extends PrimBase {
  t: "text";
  x: number;
  /** ベースライン */
  y: number;
  text: string;
  size: number;
  font: FontRole;
  anchor: "start" | "middle" | "end";
  /** 長体（横方向の縮小率）。省略時は 1 */
  scaleX?: number;
}

export interface LinePrim extends PrimBase {
  t: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  dash?: number[];
}

export interface CirclePrim extends PrimBase {
  t: "circle";
  cx: number;
  cy: number;
  r: number;
  fill: boolean;
  /** fill が false のときの線幅 */
  width?: number;
}

/** d は (x, y) を原点とする相対座標で書く */
export interface PathPrim extends PrimBase {
  t: "path";
  x: number;
  y: number;
  d: string;
  fill: boolean;
  width?: number;
  dash?: number[];
  /**
   * 独自字形など、別の座標系で書かれたパスを置くときの変換。
   * d の点 (ox, oy) を (x, y) に合わせ、横 sx 倍・縦 sy 倍にする。指定したパスは塗りだけで描く
   */
  place?: { sx: number; sy: number; ox: number; oy: number };
}

export type Prim = TextPrim | LinePrim | CirclePrim | PathPrim;

/** 編集画面での選択に使う、音符の占める範囲 */
export interface EventBox {
  eventId: string;
  measureId: string;
  partId: string;
  /** 代替譜の中の音符なら、小節内での代替譜の番号 */
  ossia?: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 編集画面でのカーソル表示と選択に使う、小節（パートごと）の範囲 */
export interface MeasureBox {
  measureId: string;
  partId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 口唱歌・補助行・代替譜の、小節ごとの入力欄。
 * lane は "shoka:<partId>"、"aux:<trackId>"、"ossia:<partId>:<番号>" のいずれか。
 */
export interface LaneBox {
  lane: string;
  measureId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 項目を置ける拍位置（1/8拍刻み）と、その横位置 */
  stops: { at: string; x: number }[];
}

/** 口唱歌・補助行に置かれている項目の範囲 */
export interface LaneItemBox {
  lane: string;
  measureId: string;
  /** その小節の項目の中での番号 */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Page {
  index: number;
  width: number;
  height: number;
  prims: Prim[];
  boxes: EventBox[];
  measureBoxes: MeasureBox[];
  lanes: LaneBox[];
  laneItems: LaneItemBox[];
  systems: SystemInfo[];
}

/** ページ内の1段。段ごとの書き出しに使う */
export interface SystemInfo {
  y: number;
  height: number;
  /** prims のうち、この段の要素が入っている範囲（primEnd は含まない） */
  primStart: number;
  primEnd: number;
  /** 段に含まれる小節（通し番号、両端を含む） */
  firstMeasure: number;
  lastMeasure: number;
}

export interface LayoutOptions {
  /** 中身がなくても行を確保する入力欄（編集画面で、空の行に入力するため） */
  forceLanes?: Iterable<string>;
}

export interface LayoutIssue {
  code: "overflow" | "page-overflow";
  message: string;
  measureIndex?: number;
  measureId?: string;
}

export interface LayoutResult {
  pages: Page[];
  issues: LayoutIssue[];
}

export function shiftPrim(p: Prim, dy: number): void {
  switch (p.t) {
    case "text":
    case "path":
      p.y += dy;
      break;
    case "line":
      p.y1 += dy;
      p.y2 += dy;
      break;
    case "circle":
      p.cy += dy;
      break;
  }
}
