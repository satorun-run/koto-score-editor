// 描画のスタイル設定。SPEC.md 5章に対応する。寸法はすべて mm。

import type { Score } from "../model/types";

export interface FontSpec {
  family: string;
  weight: number;
}

/** 絃名1字分の独自字形。SVGのパスで持つ */
export interface GlyphDef {
  /** パスデータ（SVG の d 属性） */
  d: string;
  /** 字の枠 [x, y, 幅, 高さ]（パスの座標系で）。高さを絃名の大きさに合わせて描く */
  box: [number, number, number, number];
}

export interface GlyphSet {
  name?: string;
  /**
   * 絃番号（"1"〜"13"）と、記号（"ワ" "ス" "○"＝休符、"⁒"＝前小節くり返し）ごとの字形。
   * 無いものは、フォントの文字やアプリの図形で描く
   */
  glyphs: Record<string, GlyphDef>;
}

export interface Style {
  /** 譜面領域 */
  areaWidth: number;
  areaHeight: number;
  /** 見出し（曲名・調弦表など）を先頭ページに描くか */
  header: boolean;

  /** 主パート用（太）と、第二パート・補助行・口唱歌用（細） */
  fontMain: FontSpec;
  fontSub: FontSpec;
  /** 絃番号 1〜13 の表示文字 */
  stringGlyphs: string[];
  /**
   * 絃名と記号の字形。登録されている絃・記号は、フォントの文字の代わりにこの形で描く。
   * 既定は元譜から起こした字形。null にすると、すべてフォントの文字で描く
   */
  glyphs: GlyphSet | null;
  /** 独自字形を使う範囲。"bold" は太い書体のパートだけ、"all" は全パート */
  glyphScope: "bold" | "all";

  /** 四分音符の絃名の大きさ */
  noteSize: number;
  /** 音価線の本数（0〜3）ごとの大きさの倍率 */
  sizeByLines: [number, number, number, number];
  /**
   * 音価線の本数（0〜3）ごとの、横幅の倍率。sizeByLines が縦（字の高さ）で、こちらが横。
   * 同じ値なら字の形はそのまま、小さい値にすると細長くなる
   */
  widthByLines: [number, number, number, number];

  shokaSize: number;
  supSize: number;
  /** 右肩記号・前記号の位置の、曲全体での調整 [右へ, 下へ]（mm）。音符ごとの調整はこれに足す */
  supShift: [number, number];
  prefixShift: [number, number];
  markSize: number;
  auxTextSize: number;
  auxNoteSize: number;
  ossiaScale: number;

  lineWidth: number;
  beamWidth: number;
  beamGap: number;
  /** 小節線と中身の間隔 */
  measurePad: number;
  /** 段と段の間隔 */
  systemGap: number;
  /**
   * 段の送り（絃名の下端から、次の段の絃名の下端まで）。0 なら中身に応じた自動の間隔。
   * 元譜のように段を等間隔に並べたいときに指定する
   */
  systemPitch: number;
  /** 同じ段の中のパート間隔 */
  partGap: number;
}

/**
 * 元譜から起こした字形。scripts/trace-glyphs.ts で作り、このPCの glyphs/ フォルダに置く。
 * 元の出版物の書き文字をなぞったものなので、公開するリポジトリには含めない。
 * ファイルがない環境（公開版）では null になり、絃名はフォントの文字で描く。
 * 楽譜ファイルに字形を入れて保存すれば、公開版でもその字形で表示できる
 */
const bundledGlyphs = import.meta.glob<GlyphSet>("../../glyphs/rokudan-traced.glyphs.json", { eager: true, import: "default" });
export const TRACED_GLYPHS: GlyphSet | null = Object.values(bundledGlyphs)[0] ?? null;

export const DEFAULT_STYLE: Style = {
  areaWidth: 180,
  areaHeight: 250,
  header: true,

  fontMain: { family: "UD Digi Kyokasho N", weight: 700 },
  fontSub: { family: "UD Digi Kyokasho N", weight: 400 },
  stringGlyphs: ["壱", "弐", "三", "四", "五", "六", "七", "八", "九", "十", "斗", "為", "巾"],
  glyphs: TRACED_GLYPHS,
  glyphScope: "bold",

  noteSize: 6.5,
  sizeByLines: [1, 0.92, 0.76, 0.66],
  widthByLines: [1, 0.88, 0.66, 0.56],

  shokaSize: 2.4,
  supSize: 2.2,
  supShift: [0, 0],
  prefixShift: [0, 0],
  markSize: 3.6,
  auxTextSize: 3,
  auxNoteSize: 2.8,
  ossiaScale: 0.6,

  lineWidth: 0.25,
  beamWidth: 0.3,
  beamGap: 0.75,
  measurePad: 1.2,
  systemGap: 9,
  systemPitch: 0,
  partGap: 5,
};

/** 既定値に、楽譜の設定、その場の上書きの順で重ねる。値が undefined の項目は「指定なし」として飛ばす */
export function resolveStyle(score: Score, overrides: Partial<Style> = {}): Style {
  const style: Record<string, unknown> = { ...DEFAULT_STYLE };
  for (const layer of [score.settings.style, overrides]) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (value !== undefined) style[key] = value;
    }
  }
  return style as unknown as Style;
}

/** 文字列の幅の概算（em単位）。和文は全角、ASCIIは半角として数える */
export function textEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    em += ch.charCodeAt(0) < 0x80 ? 0.55 : 1;
  }
  return em;
}
