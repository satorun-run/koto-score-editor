// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layoutScore } from "../layout/layout";
import { resolveStyle, type GlyphSet } from "../layout/style";
import { parseScore } from "../model/load";
import { renderSvg } from "../render/svg";
import { parseGlyphSet, parseSvgGlyph } from "./glyphs";

// jsdom の下では import.meta.url がファイルの場所を指さないので、プロジェクトの場所から読む
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const traced = parseGlyphSet(JSON.parse(read("glyphs/rokudan-traced.glyphs.json")))!;
const sample = (name: string) => parseScore(JSON.parse(read(`samples/${name}.koto.json`)));

describe("元譜から起こした字形", () => {
  it("13本の絃と、記号（ワ・ス・休符・前小節くり返し）がそろっている", () => {
    const keys = Object.keys(traced.glyphs);
    for (let n = 1; n <= 13; n++) expect(keys).toContain(`${n}`);
    for (const symbol of ["ワ", "ス", "○", "⁒"]) expect(keys).toContain(symbol);
    expect(keys).toHaveLength(17);
    for (const [key, glyph] of Object.entries(traced.glyphs)) {
      // 枠の高さは共通。幅は休符だけ字に合わせて狭い
      expect(glyph.box[3]).toBe(1000);
      expect(glyph.box[2] < 1000).toBe(key === "○");
      expect(glyph.d.startsWith("M")).toBe(true);
    }
  });
});

describe("独自字形での描画", () => {
  const score = sample("rokudan-excerpt");
  /** 絃名の字形だけ（記号は既定のまま） */
  const stringsOnly: GlyphSet = { glyphs: Object.fromEntries(Object.entries(traced.glyphs).filter(([key]) => /^\d+$/.test(key))) };
  const notes = (glyphs: GlyphSet | null | undefined) =>
    layoutScore(score, { glyphs }).pages[0]!.prims.filter((p) => p.layer === "notes-koto" && p.t !== "circle");

  it("登録した絃はパスで、していない絃はフォントの文字で描く", () => {
    const plain = notes(null);
    expect(plain.every((p) => p.t === "text")).toBe(true);
    // 何も指定しなければ、元譜から起こした字形で描く
    expect(notes(undefined).every((p) => p.t === "path")).toBe(true);

    const all = notes(stringsOnly);
    expect(all.every((p) => p.t === "path")).toBe(true);
    expect(all).toHaveLength(plain.length);

    // 五（5）だけ登録：第1小節の 五 三 壱 のうち 五 だけがパスになる
    const onlyFive = notes({ glyphs: { 5: traced.glyphs[5]! } });
    expect(onlyFive.slice(0, 3).map((p) => p.t)).toEqual(["path", "text", "text"]);
  });

  it("記号も登録すれば字形で描く（休符・ワ・前小節くり返し）", () => {
    const count = (layer: string, t: string, glyphs: GlyphSet, name = "rokudan-excerpt") =>
      layoutScore(sample(name), { glyphs, glyphScope: "all" }).pages[0]!.prims.filter((p) => p.layer === layer && p.t === t).length;
    // 六段の抜粋には休符が7つある：既定では丸、登録すればパス
    expect(count("notes-koto", "circle", stringsOnly)).toBe(7);
    expect(count("notes-koto", "circle", traced)).toBe(0);
    expect(count("notes-koto", "path", traced) - count("notes-koto", "path", stringsOnly)).toBe(7);
    // 幾山河の抜粋：第二箏に前小節くり返しが1つ。既定は斜線1本と点2つ、登録すればパス1つ
    expect(count("notes-koto2", "line", stringsOnly, "ikuyamakawa-excerpt")).toBe(1);
    expect(count("notes-koto2", "line", traced, "ikuyamakawa-excerpt")).toBe(0);
  });

  it("字の枠は、フォントの文字と同じ位置・大きさになる", () => {
    const text = notes(null)[0]!;
    const path = notes(traced)[0]!;
    if (text.t !== "text" || path.t !== "path" || !path.place) throw new Error("想定外の描画要素");
    const size = text.size;
    expect(path.place.sy).toBeCloseTo(size / 1000);
    // 横の中心が一致し、枠の上端は文字の上端（下端から size 上）
    expect(path.x + (1000 * path.place.sx) / 2).toBeCloseTo(text.x);
    expect(path.y).toBeCloseTo(text.y + size * 0.12 - size);
  });

  it("長体は横方向の倍率だけに掛かる", () => {
    const narrow = layoutScore(score, { glyphs: traced, areaWidth: 110 }).pages[0]!.prims.filter((p) => p.t === "path" && p.place);
    expect(narrow.some((p) => p.t === "path" && p.place!.sx < p.place!.sy * 0.95)).toBe(true);
  });

  it("太い書体のパートだけに使う設定では、第二箏はフォントのまま", () => {
    const two = sample("ikuyamakawa-excerpt");
    const kinds = (scope: "bold" | "all", layer: string) =>
      new Set(layoutScore(two, { glyphs: traced, glyphScope: scope }).pages[0]!.prims.filter((p) => p.layer === layer && p.t !== "circle" && p.t !== "line").map((p) => p.t));
    expect([...kinds("bold", "notes-koto1")]).toEqual(["path"]);
    expect([...kinds("bold", "notes-koto2")]).toEqual(["text"]);
    expect([...kinds("all", "notes-koto2")]).toEqual(["path"]);
  });

  it("小さく描く字は、縮めた分に応じて輪郭を太らせる。四分音符の字は太らせない", () => {
    const bolds = (shortBold: number, glyphs: GlyphSet | null) =>
      layoutScore(score, { glyphs, shortBold }).pages[0]!.prims.flatMap((p) => {
        if (p.layer !== "notes-koto") return [];
        if (p.t === "path" && p.place) return [{ size: p.place.sy * 1000, bold: p.place.bold ?? 0 }];
        if (p.t === "text") return [{ size: p.size, bold: p.bold ?? 0 }];
        return [];
      });
    for (const glyphs of [stringsOnly, null]) {
      const list = bolds(100, glyphs);
      // 四分音符（6.5mm）は 0、八分（92%）は 0.11×(6.5−5.98)、十六分（76%）はそれより太い
      for (const g of list) {
        expect(g.bold).toBeCloseTo(g.size >= 6.5 - 1e-6 ? 0 : 0.11 * (6.5 - g.size));
      }
      expect(list.some((g) => g.bold > 0.15)).toBe(true);
      // 度合いを半分にすると、足す太さも半分。0 なら足さない
      expect(bolds(50, glyphs).map((g) => g.bold)).toEqual(list.map((g) => g.bold / 2).map((b) => (b > 0.005 ? b : 0)));
      expect(bolds(0, glyphs).every((g) => g.bold === 0)).toBe(true);
    }
  });

  it("横に大きく縮める字は、縦の線（横方向）を多めに太らせる", () => {
    // 十六分：縦 76％、横 50％（縦よりずっと細くする）
    const sizes = { sizeByLines: [1, 0.92, 0.76, 0.66] as [number, number, number, number], widthByLines: [1, 0.92, 0.5, 0.66] as [number, number, number, number] };
    const prims = layoutScore(score, { glyphs: stringsOnly, shortBold: 100, ...sizes }).pages[0]!.prims;
    const places = prims.flatMap((p) => (p.t === "path" && p.place && p.layer === "notes-koto" ? [p.place] : []));
    const sixteenth = places.find((pl) => Math.abs(pl.sy * 1000 - 6.5 * 0.76) < 1e-6)!;
    const eighth = places.find((pl) => Math.abs(pl.sy * 1000 - 6.5 * 0.92) < 1e-6)!;
    // 八分は縦横が同じ比率なので、横方向にだけ足す分はほとんどない
    expect(eighth.boldX ?? 0).toBeLessThan(0.02);
    // 十六分：横の線は 0.11×6.5×(1−0.76)、縦の線は 0.11×6.5×(1−0.5) だけ細くなっている。
    // 輪郭全体に足す分（横方向には 0.5/0.76 倍で効く）と、横方向にだけ足す分を合わせて、縦の線の分になる
    const all = 0.11 * 6.5 * (1 - 0.76);
    const horizontal = 0.11 * 6.5 * (1 - 0.5);
    expect(sixteenth.bold).toBeCloseTo(all);
    expect(sixteenth.bold! * (0.5 / 0.76) + sixteenth.boldX!).toBeCloseTo(horizontal);
    expect(sixteenth.boldX!).toBeGreaterThan(sixteenth.bold!);

    // SVGでは、同じ形を左右にずらした3つをグループにして出す
    const svg = renderSvg(layoutScore(score, { glyphs: stringsOnly, shortBold: 100, ...sizes }).pages[0]!, resolveStyle(score, { glyphs: stringsOnly, ...sizes }));
    expect(svg).toMatch(/<g><path [^>]+\/><path [^>]+\/><path [^>]+\/><\/g>/);
  });

  it("太らせた字は、SVGでは輪郭線つきで出る（線の太さは mm で指定どおり）", () => {
    const page = layoutScore(score, { glyphs: stringsOnly, shortBold: 100 }).pages[0]!;
    const svg = renderSvg(page, resolveStyle(score, { glyphs: stringsOnly, shortBold: 100 }));
    const stroked = [...svg.matchAll(/scale\(([\d.]+) ([\d.]+)\) translate\(0 0\)" d="[^"]+" fill="#000" fill-rule="evenodd" stroke="#000" stroke-width="([\d.]+)"/g)];
    expect(stroked.length).toBeGreaterThan(5);
    for (const m of stroked) {
      const sy = Number(m[2]);
      const mm = Number(m[3]) * sy;
      expect(mm).toBeCloseTo(0.11 * (6.5 - sy * 1000), 2);
    }
    const text = renderSvg(layoutScore(score, { glyphs: null, shortBold: 100 }).pages[0]!, resolveStyle(score, { glyphs: null }));
    expect(text).toMatch(/<text [^>]*stroke="#000" stroke-width="0\.\d+" stroke-linejoin="round">/);
  });

  it("SVGには、塗りだけのパスとして出る", () => {
    const page = layoutScore(score, { glyphs: traced, shortBold: 0 }).pages[0]!;
    const svg = renderSvg(page, resolveStyle(score, { glyphs: traced, shortBold: 0 }));
    const group = /<g id="notes-koto">([\s\S]*?)<\/g>/.exec(svg)![1]!;
    expect(group).toContain('fill-rule="evenodd"');
    expect(group).not.toContain("<text");
    expect(group).toMatch(/transform="translate\([\d. -]+\) scale\([\d. ]+\) translate\(0 0\)"/);
  });
});

describe("SVGファイルからの字形の読み込み", () => {
  it("viewBox を枠にして、パスをまとめて読む", () => {
    const { glyph, messages } = parseSvgGlyph(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 200"><path d="M10 20h50v50z"/><g><path d="M100 100l10 10"/></g></svg>',
    );
    expect(messages).toEqual([]);
    expect(glyph).toEqual({ d: "M10 20h50v50z M100 100l10 10", box: [10, 20, 200, 200] });
  });

  it("viewBox がなければ width・height を使う", () => {
    const { glyph } = parseSvgGlyph('<svg xmlns="http://www.w3.org/2000/svg" width="120px" height="100"><path d="M0 0h1"/></svg>');
    expect(glyph?.box).toEqual([0, 0, 120, 100]);
  });

  it("読めない場合や、反映されない要素がある場合は知らせる", () => {
    expect(parseSvgGlyph("これはSVGではない").glyph).toBeNull();
    expect(parseSvgGlyph('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>五</text></svg>').messages[0]).toContain("アウトライン化");
    expect(parseSvgGlyph('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>').messages[0]).toContain("枠");
    const partial = parseSvgGlyph(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/><path transform="scale(2)" d="M0 0h1"/></svg>',
    );
    expect(partial.glyph).not.toBeNull();
    expect(partial.messages).toHaveLength(2);
  });

  it("字形セットは、知らない絃番号や壊れた字形を捨てて読む", () => {
    const good = { d: "M0 0h1", box: [0, 0, 10, 10] };
    const set = parseGlyphSet({ name: "試作", glyphs: { 5: good, "ワ": good, 14: good, "謎": good, 6: { d: "M0 0" } } });
    expect(set).toEqual({ name: "試作", glyphs: { 5: good, "ワ": good } });
    expect(parseGlyphSet({ glyphs: {} })).toBeNull();
    expect(parseGlyphSet("x")).toBeNull();
  });
});
