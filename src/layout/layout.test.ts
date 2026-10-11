import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScore } from "../model/load";
import type { Score } from "../model/types";
import { renderSvg } from "../render/svg";
import { layoutScore as layoutWithDefaults } from "./layout";
import type { EventBox } from "./prims";
import { resolveStyle } from "./style";
import { buildTimeMap } from "./timemap";

// 字の位置や大きさを文字の要素で確かめるので、既定の字形（パス）ではなくフォントの文字で組む
const layoutScore: typeof layoutWithDefaults = (score, overrides = {}, options = {}) =>
  layoutWithDefaults(score, { glyphs: null, ...overrides }, options);

function loadSample(name: string): Score {
  const url = new URL(`../../samples/${name}.koto.json`, import.meta.url);
  return parseScore(JSON.parse(readFileSync(url, "utf8")));
}

function boxOf(boxes: EventBox[], eventId: string): EventBox {
  const box = boxes.find((b) => b.eventId === eventId);
  if (!box) throw new Error(`${eventId} の位置がありません`);
  return box;
}

describe("拍位置と横位置の対応", () => {
  const ev = (onset: number, dur: number, minWidth = 1, prefWidth = minWidth) => ({ onset, dur, minWidth, prefWidth });

  it("拍を均等に割り付ける", () => {
    const tm = buildTimeMap([[ev(0, 1), ev(1, 1), ev(2, 1), ev(3, 1)]], 4, 10, 50);
    [10, 20, 30, 50].forEach((x, i) => expect(tm.x([0, 1, 2, 4][i]!)).toBeCloseTo(x));
    expect(tm.x(0.5)).toBeCloseTo(15);
    expect(tm.next(1.5)).toBeCloseTo(30);
    expect(tm.overflow).toBe(false);
  });

  it("音符の数が違っても、最小幅に収まるかぎり拍の幅は変わらない", () => {
    // 1拍目は四分1つ、2拍目は十六分4つ
    const tm = buildTimeMap([[ev(0, 1, 3), ev(1, 0.25, 2), ev(1.25, 0.25, 2), ev(1.5, 0.25, 2), ev(1.75, 0.25, 2)]], 2, 0, 20);
    expect(tm.x(1)).toBeCloseTo(10);
    expect(tm.x(1.5)).toBeCloseTo(15);
  });

  it("最小幅を割る音符の区間だけ広げ、残りを他が拍に比例して分け合う", () => {
    // 複付点四分（7/4拍）と三十二分×2。三十二分は最小幅 2 を確保する
    const tm = buildTimeMap([[ev(0, 1.75, 3), ev(1.75, 0.125, 2), ev(1.875, 0.125, 2)]], 2, 0, 20);
    expect(tm.x(1.875) - tm.x(1.75)).toBeCloseTo(2);
    expect(tm.x(2) - tm.x(1.875)).toBeCloseTo(2);
    expect(tm.x(1.75)).toBeCloseTo(16);
  });

  it("指定どおりの幅で入りきらない拍は、小節に余裕があれば広げる", () => {
    // 1拍目は余裕があり、2拍目は指定の幅だと 14 必要（均等なら 10）
    const tm = buildTimeMap([[ev(0, 1, 3, 5), ev(1, 1, 8, 14)]], 2, 0, 20);
    expect(tm.x(2) - tm.x(1)).toBeCloseTo(14);
    expect(tm.x(1)).toBeCloseTo(6);
    expect(tm.overflow).toBe(false);
  });

  it("小節全体で入りきらなければ、最小幅に向けて全体を均等に詰める", () => {
    const tm = buildTimeMap([[ev(0, 1, 4, 12), ev(1, 1, 4, 12)]], 2, 0, 16);
    expect(tm.x(1)).toBeCloseTo(8);
    expect(tm.overflow).toBe(false);
  });

  it("最小幅でも入らなければ知らせる", () => {
    const over = buildTimeMap([[ev(0, 1, 6), ev(1, 1, 6)]], 2, 0, 8);
    expect(over.overflow).toBe(true);
    expect(over.x(2)).toBeCloseTo(8);
  });

  it("別パートの音符の開始位置も区切りになる", () => {
    const tm = buildTimeMap([[ev(0, 2)], [ev(0, 0.5), ev(0.5, 0.5), ev(1, 1)]], 2, 0, 40);
    expect(tm.next(0)).toBeCloseTo(10);
    expect(tm.next(0.5)).toBeCloseTo(20);
  });
});

describe("レイアウト", () => {
  it("抜粋3曲が警告なしで1ページに収まる", () => {
    for (const name of ["rokudan-excerpt", "shochikubai-excerpt", "ikuyamakawa-excerpt"]) {
      const result = layoutScore(loadSample(name));
      expect(result.issues).toEqual([]);
      expect(result.pages).toHaveLength(1);
    }
  });

  it("改段の指定で次の段へ送る", () => {
    const { boxes } = layoutScore(loadSample("rokudan-excerpt")).pages[0]!;
    const m4 = boxOf(boxes, "m4e1");
    const m5 = boxOf(boxes, "m5e1");
    expect(m5.y).toBeGreaterThan(m4.y);
    expect(m5.x).toBeLessThan(m4.x);
  });

  it("小節幅は拍数に比例する（弱起は狭い）", () => {
    const { boxes } = layoutScore(loadSample("shochikubai-excerpt")).pages[0]!;
    const pickup = boxOf(boxes, "m2e1").x - boxOf(boxes, "m1e1").x;
    const full = boxOf(boxes, "m3e1").x - boxOf(boxes, "m2e1").x;
    expect(full / pickup).toBeCloseTo(2, 5);
  });

  it("同じ拍位置の音符はパート間で縦にそろう", () => {
    const { boxes } = layoutScore(loadSample("ikuyamakawa-excerpt")).pages[0]!;
    // 第4小節：第一箏は四分2つ、第二箏は八分4つ（1拍に2つずつ）。
    // 1拍を分ける音符は字を寄せて拍の中央に置くので、八分の2つは四分の両脇に並ぶ
    const prims = layoutScore(loadSample("ikuyamakawa-excerpt")).pages[0]!.prims;
    const xs = (layer: string) => prims.flatMap((p) => (p.t === "text" && p.layer === layer ? [p.x] : []));
    const quarter = boxOf(boxes, "m4a2");
    const center = quarter.x + quarter.w / 2;
    const pair = [boxOf(boxes, "m4b3"), boxOf(boxes, "m4b4")];
    expect(xs("notes-koto1")).toContain(center);
    expect(pair[0]!.x).toBeGreaterThanOrEqual(quarter.x - 1e-6);
    expect(pair[0]!.x).toBeLessThan(center);
    expect(Math.abs(pair[1]!.x - center)).toBeLessThan(2);
    expect(pair[1]!.x + pair[1]!.w).toBeLessThanOrEqual(quarter.x + quarter.w + 1e-6);
    expect(boxOf(boxes, "m4b1").y).toBeGreaterThan(boxOf(boxes, "m4a1").y);
  });

  it("曲の途中から1段の小節数を変えられる", () => {
    const score = loadSample("ikuyamakawa-excerpt");
    // 既定は1段8小節。第3小節から1段2小節にし、第7小節から3小節にする
    score.measures[2]!.measuresPerSystem = 2;
    score.measures[6]!.measuresPerSystem = 3;
    const { boxes, measureBoxes } = layoutScore(score).pages[0]!;
    const measureX = (id: string) => measureBoxes.find((b) => b.measureId === id && b.partId === "koto1")!.x;
    const rowOf = (eventId: string) => boxOf(boxes, eventId).y;
    const rows = ["m1a1", "m2a1", "m3a1", "m4a1", "m5a1", "m6a1", "m7a1", "m8a1"].map(rowOf);
    const systems = [...new Set(rows)].map((y) => rows.filter((r) => r === y).length);
    expect(systems).toEqual([2, 2, 2, 2]);
    // 2小節の段は、譜面の幅いっぱいに組まれる
    expect(measureX("m4") - measureX("m3")).toBeCloseTo((180 - 2.5) / 2);
    // 最後の段は3小節分の幅で組み、足りない分は空ける
    expect(measureX("m8") - measureX("m7")).toBeCloseTo((180 - 2.5) / 3);
  });

  it("拍は均等で、音符は拍の中央に置かれる", () => {
    const score = loadSample("rokudan-excerpt");
    const page = layoutScore(score).pages[0]!;
    // 第1小節（五 ○ 三 壱）：4つの枠が同じ幅
    const widths = ["m1e1", "m1e2", "m1e3", "m1e4"].map((id) => boxOf(page.boxes, id).w);
    widths.forEach((w) => expect(w).toBeCloseTo(widths[0]!));
    // 絃名の文字は、枠の中央にある
    const glyphs = page.prims.filter((p) => p.t === "text" && p.layer === "notes-koto");
    const first = glyphs[0]!;
    const box = boxOf(page.boxes, "m1e1");
    expect(first.t === "text" && first.x).toBeCloseTo(box.x + box.w / 2);
    // 口唱歌「テ」は音符の真上、「ー」（半拍後）は次の枠との中間
    const shoka = page.prims.filter((p) => p.layer === "shoka");
    expect(shoka[0]!.t === "text" && shoka[0]!.x).toBeCloseTo(box.x + box.w / 2);
    expect(shoka[1]!.t === "text" && shoka[1]!.x).toBeCloseTo(box.x + box.w);
  });

  it("段の送りを固定すると、絃名の下端が等間隔に並ぶ", () => {
    const score = parseScore(JSON.parse(readFileSync(new URL("../../drafts/rokudan.koto.json", import.meta.url), "utf8")));
    const auto = layoutScore(score).pages[1]!;
    const fixed = layoutScore(score, { systemPitch: 34 }).pages[1]!;
    const bottoms = (page: typeof auto) => page.systems.map((s) => {
      const box = page.measureBoxes.find((b) => b.y >= s.y && b.y < s.y + s.height)!;
      return box.y;
    });
    const gaps = (ys: number[]) => ys.slice(1).map((y, i) => y - ys[i]!);
    gaps(bottoms(fixed)).forEach((g) => expect(g).toBeCloseTo(34));
    // 自動のときは、段の中身（段名や代替譜の有無）で間隔が変わる
    const autoGaps = gaps(bottoms(auto));
    expect(Math.max(...autoGaps) - Math.min(...autoGaps)).toBeGreaterThan(1);
  });

  it("1拍を分ける音符は、字を寄せて拍の中央に置く", () => {
    const score = loadSample("rokudan-excerpt");
    const page = layoutScore(score).pages[0]!;
    // 第3小節：壱（四分）五.四（付点八分＋十六分）三 壱
    const beat = boxOf(page.boxes, "m3e1").w;
    const five = boxOf(page.boxes, "m3e2");
    const four = boxOf(page.boxes, "m3e3");
    const three = boxOf(page.boxes, "m3e4");
    // 五と四は隣り合い、次の拍の三の手前に収まる
    expect(four.x).toBeCloseTo(five.x + five.w);
    expect(five.x).toBeGreaterThan(boxOf(page.boxes, "m3e1").x);
    expect(four.x).toBeLessThan(three.x);
    expect(beat).toBeGreaterThan(0);
    // 時間に比例させた場合（付点八分は拍の 3/4）より、四は五に寄っている
    expect(five.w).toBeLessThan((three.x - five.x) * 0.75);
  });

  it("余裕のある拍では、寄せた音符の両側に同じだけ余白ができる", () => {
    // 幅を広く取り、八分2つが1拍に余裕で入るようにする
    const score = loadSample("rokudan-excerpt");
    const page = layoutScore(score, { areaWidth: 320 }).pages[0]!;
    // 第4小節の2拍目：八 七（八分2つ）
    const prev = boxOf(page.boxes, "m4e1");
    const a = boxOf(page.boxes, "m4e2");
    const b = boxOf(page.boxes, "m4e3");
    const glyphs = page.prims.flatMap((p) => (p.t === "text" && p.layer === "notes-koto" ? [p] : []));
    // 前の四分の枠は次の字の手前まで。字を寄せた分、拍の左端より右から始まる
    expect(a.x).toBeCloseTo(prev.x + prev.w);
    expect(a.x - prev.x).toBeGreaterThan(prev.w * 0.99);
    expect(b.x).toBeCloseTo(a.x + a.w);
    // 2つの字の間隔は、字の大きさ＋わずかな隙間
    const width = glyphs[0]!.size * 0.88;
    expect(a.w).toBeCloseTo(width + 0.5, 1);
  });

  it("横の倍率を大きくすると字はその幅になり、拍の幅は変わらない（字どうしが寄る）", () => {
    const score = loadSample("rokudan-excerpt");
    // 第4小節：九（四分）八 七（八分）八. 七（付点八分＋十六分）六 七（八分）
    const measure = (widthByLines: [number, number, number, number]) => {
      const { pages, issues } = layoutScore(score, { widthByLines });
      const page = pages[0]!;
      const a = boxOf(page.boxes, "m4e2");
      const b = boxOf(page.boxes, "m4e3");
      // 絃名の文字は入力順に並ぶ。第1〜3小節に 3+6+5 個、第4小節の九の次が八（八分）
      const texts = page.prims.flatMap((p) => (p.t === "text" && p.layer === "notes-koto" ? [p] : []));
      const glyph = texts[3 + 6 + 5 + 1]!;
      expect(glyph.text).toBe("八");
      return { glyph: glyph.size * (glyph.scaleX ?? 1), beat: boxOf(page.boxes, "m4e1").w, advance: b.x - a.x, issues };
    };
    const narrow = measure([1, 0.8, 0.7, 0.6]);
    const wide = measure([1, 1.2, 0.7, 0.6]);
    expect(narrow.glyph).toBeCloseTo(6.5 * 0.8);
    expect(wide.glyph).toBeCloseTo(6.5 * 1.2);
    // 拍の割り付けは変わらない：四分音符の九は、どちらでも1拍目の中にある
    expect(wide.beat).toBeGreaterThan(0);
    expect(narrow.beat).toBeGreaterThan(0);
    // 広い字は拍に入りきらないので、字の幅より狭い間隔で並ぶ（重なる）
    expect(wide.advance).toBeLessThan(6.5 * 1.2);
    // 狭い字は重ならずに並ぶ
    expect(narrow.advance).toBeCloseTo(6.5 * 0.8 + 0.5);
  });

  it("どの拍も同じ幅で、音符の多い拍も広がらない", () => {
    const score = loadSample("rokudan-excerpt");
    const page = layoutScore(score).pages[0]!;
    // 第4小節の拍の頭：九、八、八.、六
    const heads = ["m4e1", "m4e2", "m4e4", "m4e6"].map((id) => boxOf(page.boxes, id));
    const measure = page.measureBoxes.find((b) => b.measureId === "m4")!;
    const beat = (measure.w - 2 * 1.2) / 4;
    // 各拍の先頭の字は、その拍の近くにある（入りきらないかたまりは、隣のすき間へ少しはみ出す）
    heads.forEach((box, i) => {
      const beatLeft = measure.x + 1.2 + beat * i;
      expect(box.x).toBeGreaterThanOrEqual(beatLeft - beat * 0.4);
      expect(box.x).toBeLessThan(beatLeft + beat);
    });
    // 四分音符の九は、1拍目からはみ出さない
    expect(heads[0]!.x).toBeGreaterThanOrEqual(measure.x + 1.2 - 1e-6);
    expect(heads[1]!.x).toBeGreaterThanOrEqual(heads[0]!.x + 6.5);
  });

  it("拍の中に置く付点は、前の音符の続きとして拍の左から並び、音価線を持たない", () => {
    const score = loadSample("rokudan-excerpt");
    // 第1小節を「五 ●（八分）●（十六分）四（十六分）三 壱」に差し替える
    const base = { dots: 0 as const };
    score.measures[0]!.content.koto = { events: [
      { id: "a", type: "note", strings: [{ n: 5 }], lines: 0, ...base },
      { id: "b", type: "dot", lines: 1, ...base },
      { id: "c", type: "dot", lines: 2, ...base },
      { id: "d", type: "note", strings: [{ n: 4 }], lines: 2, ...base },
      { id: "e", type: "note", strings: [{ n: 3 }], lines: 0, ...base },
      { id: "f", type: "note", strings: [{ n: 1 }], lines: 0, ...base },
    ] };
    const page = layoutScore(score, { header: false }).pages[0]!;
    const [five, dot1, dot2, four, three] = ["a", "b", "c", "d", "e"].map((id) => boxOf(page.boxes, id));
    // 2拍目は、拍の左端から 付点・付点・四 と並ぶ
    expect(dot1!.x).toBeCloseTo(five!.x + five!.w);
    expect(dot2!.x).toBeCloseTo(dot1!.x + dot1!.w);
    expect(four!.x).toBeCloseTo(dot2!.x + dot2!.w);
    expect(four!.x).toBeLessThan(three!.x);
    // 点は2つ（長いほうが大きい）。音価線は四の2本だけ
    const inMeasure = (x: number, y: number) => x >= five!.x && x < three!.x && y >= five!.y && y < five!.y + five!.h + 1;
    const dots = page.prims.filter((p) => p.t === "circle" && p.layer === "durations" && inMeasure(p.cx, p.cy));
    expect(dots).toHaveLength(2);
    expect(dots[0]!.t === "circle" && dots[1]!.t === "circle" && dots[0]!.r > dots[1]!.r).toBe(true);
    const beams = page.prims.filter((p) => p.t === "line" && p.layer === "durations" && inMeasure(p.x1, p.y1));
    expect(beams).toHaveLength(2);
  });

  it("短い音符の字は、縦と横の倍率を別々に決められる", () => {
    const score = loadSample("rokudan-excerpt");
    const eighth = (overrides: Parameters<typeof layoutScore>[1]) => {
      // 第4小節の2つ目（八分の八）。幅は十分に取り、枠に収めるための長体が掛からないようにする
      const page = layoutScore(score, { areaWidth: 320, ...overrides }).pages[0]!;
      const texts = page.prims.flatMap((p) => (p.t === "text" && p.layer === "notes-koto" ? [p] : []));
      const box = boxOf(page.boxes, "m4e2");
      return texts.find((p) => p.x > box.x && p.x < box.x + box.w)!;
    };
    const base = eighth({ sizeByLines: [1, 0.9, 0.7, 0.6], widthByLines: [1, 0.9, 0.7, 0.6] });
    expect(base.size).toBeCloseTo(6.5 * 0.9);
    expect(base.scaleX).toBeUndefined();
    // 横だけ 60% にすると、字の高さは変わらず、横に 0.6/0.9 倍の長体が掛かる
    const narrow = eighth({ sizeByLines: [1, 0.9, 0.7, 0.6], widthByLines: [1, 0.6, 0.7, 0.6] });
    expect(narrow.size).toBeCloseTo(6.5 * 0.9);
    expect(narrow.scaleX).toBeCloseTo(0.6 / 0.9);
  });

  it("右肩記号と前記号の位置は、曲全体でも音符ごとでも調整できる", () => {
    const score = loadSample("rokudan-excerpt");
    // 第2小節の2つ目：わり爪の三に指番号 2
    const find = (overrides: Parameters<typeof layoutScore>[1]) => {
      const page = layoutScore(score, overrides).pages[0]!;
      const sup = page.prims.find((p) => p.t === "text" && p.layer === "techniques" && p.text === "2")!;
      // 波線を持つ前記号のうち2つ目（1つ目は第1小節の壱のかき爪）
      const prefix = page.prims.filter((p) => p.t === "path" && p.layer === "techniques" && p.d.includes(" q "))[1]!;
      if (sup.t !== "text" || prefix.t !== "path") throw new Error("想定外の描画要素");
      return { sup, prefix };
    };
    const base = find({});
    // 曲全体：右肩記号を左へ 0.5、上へ 0.3。前記号を右へ 0.4
    const whole = find({ supShift: [-0.5, -0.3], prefixShift: [0.4, 0] });
    expect(whole.sup.x).toBeCloseTo(base.sup.x - 0.5);
    expect(whole.sup.y).toBeCloseTo(base.sup.y - 0.3);
    expect(whole.prefix.x).toBeCloseTo(base.prefix.x + 0.4);

    // 音符ごと：曲全体の調整に足される
    const pm = score.measures[1]!.content.koto!;
    if (!("events" in pm)) throw new Error("想定外のデータ");
    const note = pm.events[1]!;
    if (note.type !== "note") throw new Error("想定外のデータ");
    note.supShift = [0.2, 0];
    note.prefixShift = [0, 0.6];
    const both = find({ supShift: [-0.5, -0.3] });
    expect(both.sup.x).toBeCloseTo(base.sup.x - 0.3);
    expect(both.prefix.y).toBeCloseTo(base.prefix.y + 0.6);
  });

  it("わり爪が続くとき、1音目の指番号は2音目の前記号に掛からない", () => {
    const score = loadSample("rokudan-excerpt");
    const page = layoutScore(score, { areaWidth: 260 }).pages[0]!;
    const first = boxOf(page.boxes, "m2e2");
    const second = boxOf(page.boxes, "m2e3");
    const sup = page.prims.find((p) => p.t === "text" && p.layer === "techniques" && p.text === "2")!;
    if (sup.t !== "text") throw new Error("想定外の描画要素");
    // 指番号の右端（半角1字分）が、2音目の枠の左端（前記号の始まり）より左にある
    expect(sup.x).toBeGreaterThan(first.x);
    expect(sup.x + sup.size * 0.55).toBeLessThanOrEqual(second.x + 0.1);
  });

  it("拍に入りきらないかたまりは、隣の字までのすき間へ広がる（隣の拍の字は動かない）", () => {
    const score = loadSample("rokudan-excerpt");
    // 第6小節：○ 壱（かき爪） 五 壱壱（わり爪の八分2つ）。最後の拍は、前の拍の五との間にすき間がある
    score.measures = [score.measures[0]!, {
      id: "x", content: { koto: { events: [
        { id: "x1", type: "rest", lines: 0, dots: 0 },
        { id: "x2", type: "note", strings: [{ n: 1 }], lines: 0, dots: 0, prefix: "kaki" },
        { id: "x3", type: "note", strings: [{ n: 5 }], lines: 0, dots: 0 },
        { id: "x4", type: "note", strings: [{ n: 1 }], lines: 1, dots: 0, prefix: "wari", sup: ["2"] },
        { id: "x5", type: "note", strings: [{ n: 1 }], lines: 1, dots: 0, prefix: "wari", sup: ["3"], joinPrev: true },
      ] } },
    }];
    score.spans = [];
    const page = layoutScore(score, { header: false }).pages[0]!;
    const measure = page.measureBoxes.find((b) => b.measureId === "x")!;
    const beat = (measure.w - 2.4) / 4;
    const beat4 = measure.x + 1.2 + beat * 3;
    const five = boxOf(page.boxes, "x3");
    const first = boxOf(page.boxes, "x4");
    const second = boxOf(page.boxes, "x5");
    // 2つで拍より広い（7.37mm×2 > 約10.5mm）ので、1つ目は拍の左端より左へ出る
    expect(first.x).toBeLessThan(beat4 - 0.5);
    // 五は左へ寄るが、自分の拍からは出ない。わり爪の1つ目とも重ならない
    expect(five.x).toBeGreaterThanOrEqual(measure.x + 1.2 + beat * 2 - 1e-6);
    expect(five.x + 7).toBeLessThanOrEqual(first.x + 1e-6);
    // わり爪の2つは、字と前記号が重ならない（詰まるのは字の間の空きの分まで）
    expect(second.x - first.x).toBeGreaterThan(7.37 - 0.5);
    expect(second.x + 7.37).toBeLessThanOrEqual(measure.x + measure.w - 1.2 + 1e-6);
    expect(layoutScore(score, { header: false }).issues).toEqual([]);
  });

  it("広げても入りきらないときは、記号のない所から先に重ねる", () => {
    const score = loadSample("rokudan-excerpt");
    // 1拍に八分・十六分・十六分。3つ目にだけわり爪を付け、字を大きくして必ず重なるようにする
    score.measures = [{
      id: "y", content: { koto: { events: [
        { id: "y0", type: "note", strings: [{ n: 5 }], lines: 0, dots: 0 },
        { id: "y1", type: "note", strings: [{ n: 9 }], lines: 1, dots: 0 },
        { id: "y2", type: "note", strings: [{ n: 8 }], lines: 2, dots: 0, joinPrev: true },
        { id: "y3", type: "note", strings: [{ n: 9 }], lines: 2, dots: 0, joinPrev: true, prefix: "wari" },
        { id: "y4", type: "note", strings: [{ n: 5 }], lines: 0, dots: 0 },
        { id: "y5", type: "note", strings: [{ n: 5 }], lines: 0, dots: 0 },
      ] } },
    }];
    score.spans = [];
    const page = layoutScore(score, { header: false, noteSize: 9 }).pages[0]!;
    const [a, b, c] = ["y1", "y2", "y3"].map((id) => boxOf(page.boxes, id));
    const unit = (lines: number, prefix = 0) => 9 * [1, 0.88, 0.66, 0.56][lines]! + prefix + 0.5;
    // 重なりは、まず1つ目と2つ目の間（記号なし）で引き受ける。3つ目の前記号の手前は後回し
    const overlapAB = unit(1) - (b!.x - a!.x);
    const overlapBC = unit(2) - (c!.x - b!.x);
    expect(overlapAB).toBeGreaterThan(0.5);
    expect(overlapAB).toBeGreaterThan(overlapBC + 0.5);
  });

  describe("1拍に複数の音符があるときの調整", () => {
    // 第8小節と同じ形：三三 八七 三三 八九（どの拍にも八分が2つ。三三はわり爪）
    const crowdedScore = () => {
      const score = loadSample("rokudan-excerpt");
      const note = (id: string, n: number, extra: object = {}) => ({ id, type: "note" as const, strings: [{ n }], lines: 1 as const, dots: 0 as const, ...extra });
      score.measures = [{
        id: "z", content: { koto: { events: [
          note("z1", 3, { prefix: "wari", sup: ["2"] }), note("z2", 3, { prefix: "wari", sup: ["3"], joinPrev: true }),
          note("z3", 8), note("z4", 7, { joinPrev: true }),
          note("z5", 3, { prefix: "wari", sup: ["2"] }), note("z6", 3, { prefix: "wari", sup: ["3"], joinPrev: true }),
          note("z7", 8), note("z8", 9, { joinPrev: true }),
        ] } },
      }];
      score.spans = [];
      return score;
    };
    const xs = (score: Score, overrides: Parameters<typeof layoutScore>[1] = {}) => {
      const page = layoutScore(score, { header: false, ...overrides }).pages[0]!;
      return Object.fromEntries(page.boxes.map((b) => [b.eventId, b.x]));
    };

    it("表示範囲を110％にすると、かたまりが左右に5％ずつ隣の拍へ広がる", () => {
      const base = xs(crowdedScore());
      const wide = xs(crowdedScore(), { groupSpread: 110 });
      const beat = (45 - 2.4) / 4;
      // 3拍目の三三：左へ拍の5％ぶん出て、2つの字の間が広がる
      expect(wide.z5).toBeCloseTo(base.z5! - beat * 0.05);
      expect(wide.z6! - wide.z5!).toBeGreaterThan(base.z6! - base.z5! + 0.5);
      // 小節の端にある1拍目は、小節の外へは出ない
      expect(wide.z1).toBeCloseTo(base.z1!);
    });

    it("かたまりが広がって隣と重なっても、つながっていない音価線の間にはすき間が残る", () => {
      for (const groupSpread of [100, 110, 130]) {
        const page = layoutScore(crowdedScore(), { header: false, groupSpread }).pages[0]!;
        const lines = page.prims.flatMap((p) => (p.t === "line" && p.layer === "durations" ? [p] : [])).sort((a, b) => a.x1 - b.x1);
        // 拍ごとに1本（2つの八分がつながった線）で、4本。隣の線との間は 0.7mm 以上空く
        expect(lines).toHaveLength(8);
        const groups = [0, 2, 4, 6].map((i) => ({ x1: lines[i]!.x1, x2: lines[i + 1]!.x2 }));
        groups.slice(1).forEach((g, i) => expect(g.x1 - groups[i]!.x2).toBeGreaterThanOrEqual(0.7 - 1e-6));
        // 同じ拍の中の2つはつながったまま
        [0, 2, 4, 6].forEach((i) => expect(lines[i + 1]!.x1).toBeCloseTo(lines[i]!.x2));
      }
    });

    it("拍ごとの指定は、その拍だけに効く", () => {
      const score = crowdedScore();
      const base = xs(score);
      const events = score.measures[0]!.content.koto!;
      if (!("events" in events)) throw new Error("想定外のデータ");
      events.events[4]!.beat = { spread: 120 };
      const tuned = xs(score);
      expect(tuned.z5).toBeLessThan(base.z5! - 0.5);
      expect(tuned.z3).toBeCloseTo(base.z3!);
      expect(tuned.z7).toBeCloseTo(base.z7!);
    });

    it("字間を変えると、余裕のある拍では字と字の距離がその分だけ変わる", () => {
      const score = loadSample("rokudan-excerpt");
      // 幅を広く取り、第4小節の八分2つ（八 七）が余裕で入るようにする
      const gapOf = (groupGap: number) => {
        const page = layoutScore(score, { areaWidth: 320, groupGap }).pages[0]!;
        return boxOf(page.boxes, "m4e3").x - boxOf(page.boxes, "m4e2").x;
      };
      expect(gapOf(1.5) - gapOf(0.5)).toBeCloseTo(1);
      // マイナスなら字が重なる（字の幅より狭い間隔で並ぶ）
      expect(gapOf(-1)).toBeCloseTo(6.5 * 0.88 - 1);
    });
  });

  it("押し手の括弧は、口唱歌の下で、両端の押し手の三角の頂点どうしをつなぐ", () => {
    const score = loadSample("rokudan-excerpt");
    // 七 為 巾（一重押し） 為（一重押し）。巾と為に括弧
    score.measures = [{
      id: "b", content: { koto: {
        events: [
          { id: "b1", type: "note", strings: [{ n: 7 }], lines: 0, dots: 0 },
          { id: "b2", type: "note", strings: [{ n: 12 }], lines: 0, dots: 0 },
          { id: "b3", type: "note", strings: [{ n: 13, press: 1 }], lines: 0, dots: 0 },
          { id: "b4", type: "note", strings: [{ n: 12, press: 1 }], lines: 0, dots: 0 },
        ],
        shoka: [{ at: "2", text: "チン" }, { at: "3", text: "ツン" }],
      } },
    }];
    score.spans = [{ id: "s", kind: "pressBracket", part: "koto", from: "b3", to: "b4" }];
    const page = layoutScore(score, { header: false }).pages[0]!;
    const bracket = page.prims.find((p) => p.t === "path" && p.layer === "techniques" && p.d.includes(" H "))!;
    const shoka = page.prims.find((p) => p.t === "text" && p.layer === "shoka")!;
    const triangles = page.prims.filter((p) => p.t === "path" && p.layer === "techniques" && p.d.endsWith("Z"));
    const note = boxOf(page.boxes, "b3");
    if (bracket.t !== "path" || shoka.t !== "text") throw new Error("想定外の描画要素");
    expect(triangles).toHaveLength(2);
    // 括弧の横線は、口唱歌より下、絃名より上
    expect(bracket.y).toBeGreaterThan(shoka.y);
    expect(bracket.y).toBeLessThan(note.y);
    // 横の位置は、2つの音符の中央どうし
    const center = (id: string) => boxOf(page.boxes, id).x + boxOf(page.boxes, id).w / 2;
    expect(bracket.x).toBeCloseTo(center("b3"));
    expect(bracket.d).toContain(` H ${Math.round((center("b4") - center("b3")) * 1000) / 1000}`);
  });

  it("補助行に添える文字（（三絃）など）は、項目の下の中央に、小節ごとに置く", () => {
    const score = loadSample("rokudan-excerpt");
    score.tracks = [{ id: "san", kind: "text", below: "koto", label: "（三絃）" }];
    score.measures = [score.measures[0]!, score.measures[1]!];
    score.spans = [];
    score.measures[0]!.aux = { san: [{ at: "2", text: "トツ" }, { at: "3", text: "テン" }] };
    const page = layoutScore(score, { header: false }).pages[0]!;
    const texts = page.prims.flatMap((p) => (p.t === "text" && p.layer === "aux-san" ? [p] : []));
    expect(texts.map((t) => t.text)).toEqual(["トツ", "テン", "（三絃）"]);
    const [a, b, label] = texts;
    // 2つの項目の間の中央、1行下に、少し小さく
    expect(label!.x).toBeCloseTo((a!.x + b!.x) / 2, 0);
    expect(label!.y).toBeGreaterThan(a!.y + 1);
    expect(label!.size).toBeLessThan(a!.size);
  });

  it("フェルマータは、口唱歌のある行では口唱歌の上に置く", () => {
    const score = loadSample("rokudan-excerpt");
    // 抜粋の最後の小節：六（フェルマータ、口唱歌リーン）
    const page = layoutScore(score).pages[0]!;
    const arc = page.prims.find((p) => p.t === "path" && p.layer === "techniques" && p.d.includes(" A "))!;
    const box = boxOf(page.boxes, "m7e1");
    // 「リ」は前の小節の口唱歌にもあるので、最後のもの（この小節の「リーン」の頭）を取る
    const shoka = page.prims.flatMap((p) => (p.t === "text" && p.layer === "shoka" && p.text === "リ" ? [p] : [])).at(-1)!;
    if (arc.t !== "path") throw new Error("想定外の描画要素");
    expect(arc.x).toBeCloseTo(box.x + box.w / 2);
    expect(arc.y).toBeLessThan(shoka.y - 1.5);
    expect(arc.y).toBeGreaterThan(shoka.y - 6);

    // 口唱歌のない行では、絃名のすぐ上
    const plain = loadSample("rokudan-excerpt");
    for (const m of plain.measures) {
      const pm = m.content.koto!;
      if ("events" in pm) delete pm.shoka;
    }
    const page2 = layoutScore(plain).pages[0]!;
    const arc2 = page2.prims.find((p) => p.t === "path" && p.layer === "techniques" && p.d.includes(" A "))!;
    const box2 = boxOf(page2.boxes, "m7e1");
    if (arc2.t !== "path") throw new Error("想定外の描画要素");
    expect(box2.y - arc2.y).toBeLessThan(2);
  });

  it("1ページの段数を超えたら改ページする", () => {
    const score = loadSample("rokudan-excerpt");
    score.settings.systemsPerPage = 1;
    expect(layoutScore(score).pages).toHaveLength(2);
  });

  it("収まらない小節を知らせる", () => {
    const score = loadSample("rokudan-excerpt");
    const result = layoutScore(score, { areaWidth: 60 });
    expect(result.issues.some((i) => i.code === "overflow")).toBe(true);
  });
});

describe("SVG出力", () => {
  it("mm指定で、種類ごとのグループを決まった順に出す", () => {
    const score = loadSample("ikuyamakawa-excerpt");
    const page = layoutScore(score).pages[0]!;
    const svg = renderSvg(page, resolveStyle(score));
    expect(svg).toContain('width="180mm" height="250mm" viewBox="0 0 180 250"');
    const ids = [...svg.matchAll(/<g id="([^"]+)">/g)].map((m) => m[1]);
    expect(ids).toEqual([
      "barlines", "notes-koto1", "notes-koto2", "durations", "techniques",
      "aux-taiko", "aux-uta1", "aux-uta2", "aux-fushi", "marks", "header",
    ]);
  });

  it("見出しを切れば header グループは出ない", () => {
    const score = loadSample("rokudan-excerpt");
    const page = layoutScore(score, { header: false }).pages[0]!;
    expect(renderSvg(page, resolveStyle(score))).not.toContain('id="header"');
  });
});
