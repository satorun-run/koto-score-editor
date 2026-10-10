// 描画要素をSVG文字列にする。SPEC.md 7.1 に対応する。

import { shiftPrim, type Page, type Prim } from "../layout/prims";
import type { Style } from "../layout/style";

/** グループの並び順。notes-* と aux-* はこの位置に、現れた順で入る */
const LAYER_ORDER = ["barlines", "notes-", "durations", "techniques", "shoka", "aux-", "ossia", "marks", "header"];

export interface SvgOptions {
  /** 確認用に白い背景を敷く。DTP向けの出力では付けない */
  background?: boolean;
}

export function renderSvg(page: Page, st: Style, options: SvgOptions = {}): string {
  const groups = new Map<string, Prim[]>();
  for (const p of page.prims) {
    const list = groups.get(p.layer);
    if (list) list.push(p);
    else groups.set(p.layer, [p]);
  }
  const rank = (layer: string) => {
    const i = LAYER_ORDER.findIndex((name) => (name.endsWith("-") ? layer.startsWith(name) : layer === name));
    return i < 0 ? LAYER_ORDER.length : i;
  };
  const layers = [...groups.keys()].sort((a, b) => rank(a) - rank(b));

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.width)}mm" height="${n(page.height)}mm" viewBox="0 0 ${n(page.width)} ${n(page.height)}">`,
  );
  if (options.background) {
    out.push(`<rect width="${n(page.width)}" height="${n(page.height)}" fill="#fff"/>`);
  }
  for (const layer of layers) {
    out.push(`<g id="${esc(layer)}">`);
    for (const p of groups.get(layer)!) out.push(primSvg(p, st));
    out.push("</g>");
  }
  out.push("</svg>");
  return out.join("\n");
}

/** 1段だけを、上下に少し余白を付けたSVGにする */
export function renderSystemSvg(page: Page, systemIndex: number, st: Style, options: SvgOptions = {}): string {
  const system = page.systems[systemIndex];
  if (!system) throw new Error(`段 ${systemIndex} がありません`);
  const margin = 2;
  const prims = structuredClone(page.prims.slice(system.primStart, system.primEnd));
  for (const p of prims) shiftPrim(p, margin - system.y);
  return renderSvg({ ...page, height: system.height + margin * 2, prims }, st, options);
}

function primSvg(p: Prim, st: Style): string {
  switch (p.t) {
    case "text": {
      const font = p.font === "main" ? st.fontMain : st.fontSub;
      const attrs = `font-family="${esc(font.family)}" font-weight="${font.weight}" font-size="${n(p.size)}" text-anchor="${p.anchor}" fill="#000"`;
      if (p.scaleX !== undefined) {
        return `<text transform="translate(${n(p.x)} ${n(p.y)}) scale(${n(p.scaleX)} 1)" ${attrs}>${esc(p.text)}</text>`;
      }
      return `<text x="${n(p.x)}" y="${n(p.y)}" ${attrs}>${esc(p.text)}</text>`;
    }
    case "line":
      return `<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}" ${stroke(p.width, p.dash)}/>`;
    case "circle":
      return p.fill
        ? `<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.r)}" fill="#000"/>`
        : `<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.r)}" fill="none" ${stroke(p.width ?? 0.25)}/>`;
    case "path":
      if (p.place) {
        const { sx, sy, ox, oy } = p.place;
        const transform = `translate(${n(p.x)} ${n(p.y)}) scale(${f(sx)} ${f(sy)}) translate(${n(-ox)} ${n(-oy)})`;
        return `<path transform="${transform}" d="${esc(p.d)}" fill="#000" fill-rule="evenodd"/>`;
      }
      return `<path transform="translate(${n(p.x)} ${n(p.y)})" d="${p.d}" fill="${p.fill ? "#000" : "none"}" ${stroke(p.width ?? 0.25, p.dash)} stroke-linejoin="round" stroke-linecap="round"/>`;
  }
}

function stroke(width: number, dash?: number[]): string {
  const base = `stroke="#000" stroke-width="${n(width)}"`;
  return dash ? `${base} stroke-dasharray="${dash.map(n).join(" ")}"` : base;
}

function n(value: number): string {
  return `${Math.round(value * 1000) / 1000}`;
}

/** 倍率用。小さい値でも桁が残るようにする */
function f(value: number): string {
  return `${Math.round(value * 1e6) / 1e6}`;
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
