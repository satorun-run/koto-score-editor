// 絃名の独自字形の読み込み。SPEC.md 5.1 に対応する。

import type { GlyphDef, GlyphSet } from "../layout/style";

/** 絃名のほかに字形を登録できる記号 */
export const SYMBOL_KEYS = ["ワ", "ス", "○", "⁒"];

export interface SvgGlyphResult {
  glyph: GlyphDef | null;
  /** 読み込めなかった理由や、無視した要素の知らせ */
  messages: string[];
}

/**
 * SVGファイル1つを、絃名1字分の字形として読む。
 * 文字はアウトライン化（パス化）しておく。枠は viewBox（なければ width・height）から取る。
 */
export function parseSvgGlyph(text: string): SvgGlyphResult {
  const messages: string[] = [];
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) {
    return { glyph: null, messages: ["SVGファイルとして読めませんでした。"] };
  }

  const numbers = (value: string | null) => (value ?? "").trim().split(/[\s,]+/).map(Number);
  let box = numbers(svg.getAttribute("viewBox"));
  if (box.length !== 4 || box.some((v) => !Number.isFinite(v))) {
    const w = parseFloat(svg.getAttribute("width") ?? "");
    const h = parseFloat(svg.getAttribute("height") ?? "");
    box = [0, 0, w, h];
  }
  const [x = 0, y = 0, w = 0, h = 0] = box;
  if (!(w > 0) || !(h > 0)) {
    return { glyph: null, messages: ["字の枠が分かりません。SVGに viewBox か width・height を付けてください。"] };
  }

  const paths = [...doc.querySelectorAll("path")].map((p) => p.getAttribute("d")?.trim() ?? "").filter(Boolean);
  if (paths.length === 0) {
    return { glyph: null, messages: ["パスがありません。文字をアウトライン化してから保存してください。"] };
  }

  const others = doc.querySelectorAll("rect, circle, ellipse, polygon, polyline, line, text, image, use");
  if (others.length > 0) messages.push(`パス以外の要素が ${others.length} 個あり、無視しました（文字や図形はパスに変換してください）。`);
  if (doc.querySelector("[transform]")) messages.push("移動・拡大などの変形（transform）は反映されません。変形を適用してから保存してください。");

  return { glyph: { d: paths.join(" "), box: [x, y, w, h] }, messages };
}

/** 字形セットのファイル（.glyphs.json）を読む。形が違えば null */
export function parseGlyphSet(data: unknown): GlyphSet | null {
  if (typeof data !== "object" || data === null) return null;
  const source = data as Partial<GlyphSet>;
  if (typeof source.glyphs !== "object" || source.glyphs === null) return null;
  const glyphs: GlyphSet["glyphs"] = {};
  for (const [key, value] of Object.entries(source.glyphs)) {
    const n = Number(key);
    const g = value as Partial<GlyphDef> | null;
    const known = (Number.isInteger(n) && n >= 1 && n <= 13) || SYMBOL_KEYS.includes(key);
    if (!known || !g || typeof g.d !== "string") continue;
    if (!Array.isArray(g.box) || g.box.length !== 4 || g.box.some((v) => typeof v !== "number") || !(g.box[2] > 0) || !(g.box[3] > 0)) continue;
    glyphs[key] = { d: g.d, box: [g.box[0], g.box[1], g.box[2], g.box[3]] };
  }
  if (Object.keys(glyphs).length === 0) return null;
  return typeof source.name === "string" ? { name: source.name, glyphs } : { glyphs };
}
