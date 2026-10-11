import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDraft } from "../model/draft";
import { parseScore } from "../model/load";
import type { Event, Score } from "../model/types";
import { validateScore } from "../model/validate";
import { blankScore, eventsAt } from "./commands";
import { importMeasures, readSource } from "./importer";
import { initialState, performAction } from "./store";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const loadSample = (name: string): Score => parseScore(JSON.parse(read(`samples/${name}.koto.json`)));
const eventsOf = (score: Score, mi: number): Event[] => eventsAt(score, { mi, partId: score.parts[0]!.id, index: 0 }) ?? [];
const names = (score: Score, mi: number) =>
  eventsOf(score, mi).map((e) => (e.type === "note" ? e.strings.map((s) => s.n).join("+") : e.type === "rest" ? "○" : e.type === "dot" ? "●" : e.sign));

describe("下書き記法", () => {
  const parse = (body: string) => parseDraft(`beats: 4\n---\n${body}`);

  it("音符：絃・休符・音価線・付点・右肩・上記号・前記号・押し手・合せ爪", () => {
    const { score, errors } = parse(`五'ヒ ○ 三 ~壱\n%三_'2 八_. 七__ ▲九 △斗"左 巾+為'オ'ハ ワ..`);
    expect(errors).toEqual([]);
    expect(eventsOf(score, 0)).toMatchObject([
      { type: "note", strings: [{ n: 5 }], lines: 0, dots: 0, sup: ["ヒ"] },
      { type: "rest" },
      { type: "note", strings: [{ n: 3 }] },
      { type: "note", strings: [{ n: 1 }], prefix: "kaki" },
    ]);
    expect(eventsOf(score, 1)).toMatchObject([
      { strings: [{ n: 3 }], lines: 1, prefix: "wari", sup: ["2"] },
      { strings: [{ n: 8 }], lines: 1, dots: 1 },
      { strings: [{ n: 7 }], lines: 2 },
      { strings: [{ n: 9, press: 2 }] },
      { strings: [{ n: 11, press: 1 }], above: ["左"] },
      { strings: [{ n: 13 }, { n: 12 }], sup: ["オ", "ハ"] },
      { type: "sign", sign: "ワ", dots: 2 },
    ]);
  });

  it("拍の中に置く付点 ● は、音価を持つが音価線ではつながない", () => {
    const { score, errors } = parse("五 ●_ ●__ 四__ 三 ○");
    expect(errors).toEqual([]);
    expect(eventsOf(score, 0).map((e) => [e.type, e.lines, !!e.joinPrev])).toEqual([
      ["note", 0, false], ["dot", 1, false], ["dot", 2, false], ["note", 2, false], ["note", 0, false], ["rest", 0, false],
    ]);
    expect(validateScore(score)).toEqual([]);
  });

  it("合せ爪は囲みなしが基本で、( を付けると左弧になる", () => {
    const { score, errors } = parse("巾+為 ○ (壱+五 ○");
    expect(errors).toEqual([]);
    const [plain, , arc] = eventsOf(score, 0);
    expect(plain!.type === "note" && plain!.chord).toBeUndefined();
    expect(arc).toMatchObject({ strings: [{ n: 1 }, { n: 5 }], chord: "arc" });
  });

  it("音価線：同じ拍の中は自動でつなぎ、& と ! で上書きする", () => {
    const { score } = parse("八_ 七_ 八_ 七_ &六_ 七_ 六_ !五_");
    expect(eventsOf(score, 0).map((e) => !!e.joinPrev)).toEqual([false, true, false, true, true, true, false, false]);
  });

  it("口唱歌：音符に順に対応させ、_ で飛ばし、@ で位置を直接指定する", () => {
    const { score, errors } = parse("壱 五_. 四__ 三 ○ ; トン コー ロ リン\n○ 七 ○ ○ ; _ ツン ン@5/2");
    expect(errors).toEqual([]);
    const shoka = (mi: number) => {
      const pm = score.measures[mi]!.content.koto!;
      return "events" in pm ? pm.shoka : undefined;
    };
    expect(shoka(0)).toEqual([
      { at: "0", text: "トン" }, { at: "1", text: "コー" }, { at: "7/4", text: "ロ" }, { at: "2", text: "リン" },
    ]);
    expect(shoka(1)).toEqual([{ at: "1", text: "ツン" }, { at: "5/2", text: "ン" }]);
  });

  it("小節への指定と、代替譜・波線", () => {
    const { score, errors } = parse(
      "[段 四段 少速]\n[拍 2]\n○ ○\n[複]\n[速 徐 @2]\n八 ○ 巾<サ ○\n[或は @1: 八_ 七_]\n[終]\n六\"F>ラ ○ 壱+五 ○",
    );
    expect(errors).toEqual([]);
    expect(score.measures[0]).toMatchObject({ beats: "2", marks: [{ kind: "section", text: "四段", note: "少速" }] });
    expect(score.measures[1]).toMatchObject({ barline: "double", marks: [{ kind: "tempo", text: "徐", at: "2" }] });
    expect(score.measures[1]!.ossia).toMatchObject([{ label: "或は", at: "1", events: [{ lines: 1 }, { lines: 1, joinPrev: true }] }]);
    expect(score.measures[2]!.barline).toBe("final");
    expect(score.spans).toMatchObject([{ kind: "wave", from: "m2e3", to: "m3e1", startText: "サ", endText: "ラ" }]);
    expect(validateScore(score)).toEqual([]);
  });

  it("書き方の誤りは行番号つきで知らせ、読めるところは読む", () => {
    const { score, errors } = parse("五 X 三\n[謎]\n壱____");
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(names(score, 0)).toEqual(["5", "3"]);
  });
});

describe("六段の調の下書き", () => {
  const { score, errors } = parseDraft(read("drafts/rokudan.draft.txt"));

  it("記法の誤りがなく、全157小節が検算を通る", () => {
    expect(errors).toEqual([]);
    expect(score.measures).toHaveLength(157);
    expect(validateScore(score)).toEqual([]);
  });

  it("段名が6つ、代替譜が5つ、波線が2つ入っている", () => {
    const sections = score.measures.flatMap((m) => (m.marks ?? []).filter((k) => k.kind === "section").map((k) => k.text));
    expect(sections).toEqual(["初段", "二段", "三段", "四段", "五段", "六段"]);
    expect(score.measures.reduce((n, m) => n + (m.ossia?.length ?? 0), 0)).toBe(5);
    expect(score.spans.map((s) => s.kind)).toEqual(["wave", "wave"]);
  });
});

describe("下書きの取り込み", () => {
  const draft = readSource(read("drafts/rokudan.draft.txt")).score;

  it("まだ何も入れていない楽譜には、設定ごと置き換えて入る", () => {
    const state = initialState(blankScore());
    const next = importMeasures(state.doc, draft, { from: 0, to: 23, mode: "append", withMeta: true })!;
    expect(next.score.meta.title).toBe("六段の調");
    expect(next.score.measures).toHaveLength(24);
    expect(next.cursor).toMatchObject({ mi: 0, index: 0 });
    expect(validateScore(next.score)).toEqual([]);
  });

  it("設定ごと取り込んでも、いまの楽譜の寸法・書体・字形は保たれる", () => {
    const state = initialState(blankScore({ noteSize: 8, systemPitch: 36.5 }));
    const next = importMeasures(state.doc, draft, { from: 0, to: 3, mode: "append", withMeta: true })!;
    // 曲ごとの設定は下書きのもの、寸法は元の楽譜のもの
    expect(next.score.settings).toMatchObject({ meterLabel: "4/4", measuresPerSystem: 4, style: { noteSize: 8, systemPitch: 36.5 } });
  });

  it("末尾への追加・挿入・置換ができ、IDは重ならない", () => {
    let state = initialState(loadSample("rokudan-excerpt"));
    const opts = { from: 0, to: 1, withMeta: false } as const;

    const appended = importMeasures(state.doc, draft, { ...opts, mode: "append" })!;
    expect(appended.score.measures).toHaveLength(9);
    expect(names(appended.score, 7)).toEqual(["5", "○", "3", "1"]);
    expect(appended.cursor.mi).toBe(7);
    expect(validateScore(appended.score)).toEqual([]);
    // 同じ下書きを2回取り込んでも問題ない
    expect(validateScore(importMeasures(appended, draft, { ...opts, mode: "append" })!.score)).toEqual([]);

    state = performAction(state, "measure.next");
    const inserted = importMeasures(state.doc, draft, { ...opts, mode: "insertAfter" })!;
    expect(inserted.score.measures).toHaveLength(9);
    expect(inserted.cursor.mi).toBe(2);
    expect(names(inserted.score, 2)).toEqual(["5", "○", "3", "1"]);

    const replaced = importMeasures(state.doc, draft, { ...opts, mode: "replace" })!;
    expect(replaced.score.measures).toHaveLength(7);
    expect(names(replaced.score, 1)).toEqual(["5", "○", "3", "1"]);
    expect(replaced.score.meta.title).toBe("六段の調");
    expect(validateScore(replaced.score)).toEqual([]);
  });

  it("範囲の中で完結しているスパンだけ付いてくる", () => {
    const blank = initialState(blankScore()).doc;
    // 小節54（三段の頭）は波線が小節内で完結する
    const whole = importMeasures(blank, draft, { from: 53, to: 53, mode: "append", withMeta: false })!;
    expect(whole.score.spans).toHaveLength(1);
    // 終結の波線は小節156から157にまたがるので、片方だけでは付いてこない
    const half = importMeasures(blank, draft, { from: 155, to: 155, mode: "append", withMeta: false })!;
    expect(half.score.spans).toHaveLength(0);
    expect(validateScore(half.score).filter((i) => i.code !== "beats-mismatch")).toEqual([]);
  });

  it("置き換えで消えた小節に掛かっていたスパンは消える", () => {
    let state = initialState(loadSample("rokudan-excerpt"));
    // 抜粋の第6小節から第7小節に波線が掛かっている
    for (let i = 0; i < 5; i++) state = performAction(state, "measure.next");
    const replaced = importMeasures(state.doc, draft, { from: 0, to: 0, mode: "replace", withMeta: false })!;
    expect(replaced.score.spans).toEqual([]);
    expect(validateScore(replaced.score)).toEqual([]);
  });

  it("2パートの楽譜を1パートの楽譜へ取り込むと、パートと補助行が足される", () => {
    const state = initialState(loadSample("rokudan-excerpt"));
    const next = importMeasures(state.doc, loadSample("ikuyamakawa-excerpt"), { from: 4, to: 5, mode: "append", withMeta: false })!;
    expect(next.score.parts).toHaveLength(2);
    expect(next.score.tracks.map((t) => t.kind)).toEqual(["rhythm", "lyrics", "lyrics", "pitch"]);
    expect(Object.keys(next.score.measures[7]!.aux ?? {})).toHaveLength(3);
    // 取り込み元は2拍子、取り込み先は4拍子なので、小節に拍数が明記される
    expect(next.score.measures[7]!.beats).toBe("2");
    expect(validateScore(next.score)).toEqual([]);
  });
});
