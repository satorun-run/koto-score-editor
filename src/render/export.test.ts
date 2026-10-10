import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutScore } from "../layout/layout";
import { resolveStyle } from "../layout/style";
import { parseDraft } from "../model/draft";
import { parsePageList } from "../ui/ExportDialog";
import { renderSvg, renderSystemSvg } from "./svg";

const { score } = parseDraft(readFileSync(new URL("../../drafts/rokudan.draft.txt", import.meta.url), "utf8"));
const style = resolveStyle(score);

describe("段ごとの書き出し", () => {
  const layout = layoutScore(score);

  it("六段の調は6ページ、40段に組まれ、全小節がどこかの段に入る", () => {
    expect(layout.issues).toEqual([]);
    expect(layout.pages).toHaveLength(6);
    const systems = layout.pages.flatMap((p) => p.systems);
    expect(systems).toHaveLength(40);
    expect(systems[0]).toMatchObject({ firstMeasure: 0, lastMeasure: 3 });
    expect(systems[39]).toMatchObject({ firstMeasure: 156, lastMeasure: 156 });
    systems.slice(1).forEach((s, i) => expect(s.firstMeasure).toBe(systems[i]!.lastMeasure + 1));
  });

  it("1段分のSVGは、その段の高さだけを持ち、他の段や見出しの要素を含まない", () => {
    const page = layout.pages[0]!;
    const whole = renderSvg(page, style);
    const first = renderSystemSvg(page, 0, style);
    const system = page.systems[0]!;
    expect(first).toContain(`width="180mm" height="${Math.round((system.height + 4) * 1000) / 1000}mm"`);
    expect(first).not.toContain('id="header"');
    expect(whole).toContain('id="header"');
    // 1段目には「初段」があり、「二段」（7段目）はない
    expect(first).toContain(">初段<");
    expect(first).not.toContain(">二段<");
    // 段の要素の数を合わせると、見出しを除いたページ全体の数になる
    const count = (svg: string) => (svg.match(/<(text|line|circle|path) /g) ?? []).length;
    const headerCount = page.prims.filter((p) => p.layer === "header").length;
    const sum = page.systems.reduce((n, _, i) => n + count(renderSystemSvg(page, i, style)), 0);
    expect(sum).toBe(count(whole) - headerCount);
  });

  it("書き出した段は、元の組版を動かさない", () => {
    const page = layout.pages[0]!;
    const before = JSON.stringify(page.prims);
    renderSystemSvg(page, 3, style);
    expect(JSON.stringify(page.prims)).toBe(before);
  });
});

describe("ページの指定", () => {
  it("範囲とカンマ区切りを読む", () => {
    expect(parsePageList("1-3,5", 6)).toEqual([0, 1, 2, 4]);
    expect(parsePageList(" 6 , 2 ", 6)).toEqual([1, 5]);
    expect(parsePageList("2-2", 6)).toEqual([1]);
  });

  it("範囲外や書き間違いは受け付けない", () => {
    for (const text of ["", "0", "7", "3-1", "a", "1-", "1;2"]) {
      expect(parsePageList(text, 6)).toBeNull();
    }
  });
});
