import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutScore } from "../layout/layout";
import { parseScore } from "../model/load";
import type { Score } from "../model/types";
import { validateScore } from "../model/validate";
import * as cmd from "./commands";
import { initialState, performAction, reducer, type EditorState } from "./store";

function loadSample(name: string): Score {
  const url = new URL(`../../samples/${name}.koto.json`, import.meta.url);
  return parseScore(JSON.parse(readFileSync(url, "utf8")));
}

const run = (state: EditorState, ...ids: string[]) => ids.reduce(performAction, state);
const apply = (state: EditorState, fn: (doc: cmd.Doc) => cmd.Doc | null) => reducer(state, { type: "apply", fn });
const start = () => initialState(cmd.blankScore());
/** 拍数の不足（入力途中の小節）を除いた問題 */
const problems = (score: Score) => validateScore(score).filter((i) => i.code !== "beats-mismatch");
const shoka = (score: Score, mi: number) => cmd.laneItems(score, { kind: "shoka", partId: "koto" }, mi).map((i) => `${i.at}:${i.text}`);

describe("口唱歌・補助行", () => {
  const lane: cmd.LaneRef = { kind: "shoka", partId: "koto" };

  it("項目を置くと拍位置の順に並ぶ。置き換えと削除もできる", () => {
    let s = run(start(), "string.5", "rest", "string.3", "string.1");
    s = apply(s, (d) => cmd.putLaneItem(d, lane, 0, null, { at: "2", text: "トン" }));
    s = apply(s, (d) => cmd.putLaneItem(d, lane, 0, null, { at: "0", text: "テ" }));
    s = apply(s, (d) => cmd.putLaneItem(d, lane, 0, null, { at: "1/2", text: "ー" }));
    expect(shoka(s.doc.score, 0)).toEqual(["0:テ", "1/2:ー", "2:トン"]);
    s = apply(s, (d) => cmd.putLaneItem(d, lane, 0, 1, { at: "1", text: "ン" }));
    expect(shoka(s.doc.score, 0)).toEqual(["0:テ", "1:ン", "2:トン"]);
    s = apply(s, (d) => cmd.putLaneItem(d, lane, 0, 0, null));
    expect(shoka(s.doc.score, 0)).toEqual(["1:ン", "2:トン"]);
    expect(validateScore(s.doc.score)).toEqual([]);
    s = run(s, "undo", "undo", "undo", "undo", "undo");
    expect(shoka(s.doc.score, 0)).toEqual([]);
  });

  it("項目を同じ小節の中でも、別の小節へも動かせる", () => {
    let s = run(start(), "string.1", "fill.rest", "string.2", "fill.rest");
    s = apply(s, (d) => cmd.putLaneItem(d, lane, 0, null, { at: "0", text: "トン" }));
    s = apply(s, (d) => cmd.moveLaneItem(d, lane, 0, 0, 0, "3/8"));
    expect(shoka(s.doc.score, 0)).toEqual(["3/8:トン"]);
    s = apply(s, (d) => cmd.moveLaneItem(d, lane, 0, 0, 1, "1"));
    expect(shoka(s.doc.score, 0)).toEqual([]);
    expect(shoka(s.doc.score, 1)).toEqual(["1:トン"]);
  });

  it("次の音符の位置を返す（Enter で進む先）", () => {
    const score = loadSample("rokudan-excerpt");
    // 第3小節：壱（四分）五.（付点八分）四（十六分）三 壱
    expect(cmd.nextOnset(score, 2, "koto", "0")).toBe("1");
    expect(cmd.nextOnset(score, 2, "koto", "1")).toBe("7/4");
    expect(cmd.nextOnset(score, 2, "koto", "3")).toBeNull();
  });

  it("補助行を足して歌詞を置き、行を消すと中身も消える", () => {
    let s = run(start(), "string.7", "fill.rest");
    s = apply(s, (d) => cmd.addTrack(d, "lyrics", "koto"));
    s = apply(s, (d) => cmd.addTrack(d, "pitch", "koto"));
    const [uta, fushi] = s.doc.score.tracks;
    expect([uta!.name, fushi!.name]).toEqual(["歌詞", "歌の節"]);
    s = apply(s, (d) => cmd.putLaneItem(d, { kind: "aux", trackId: uta!.id }, 0, null, { at: "1", text: "た", extend: true }));
    s = apply(s, (d) => cmd.putLaneItem(d, { kind: "aux", trackId: fushi!.id }, 0, null, { at: "1", notes: [{ n: 6, press: 1 }, { n: 7 }] }));
    expect(validateScore(s.doc.score)).toEqual([]);
    s = apply(s, (d) => cmd.moveTrack(d, fushi!.id, -1));
    expect(s.doc.score.tracks.map((t) => t.kind)).toEqual(["pitch", "lyrics"]);
    s = apply(s, (d) => cmd.removeTrack(d, uta!.id));
    expect(Object.keys(s.doc.score.measures[0]!.aux ?? {})).toEqual([fushi!.id]);
    s = apply(s, (d) => cmd.removeTrack(d, fushi!.id));
    expect(s.doc.score.measures[0]!.aux).toBeUndefined();
  });
});

describe("スパン", () => {
  it("始点に印を付け、終点で種類を選ぶ。順序が逆でもそろえる", () => {
    let s = run(start(), "string.13", "select.mark");
    const first = cmd.currentEvent(s.doc)!.id;
    expect(s.mark).toBe(first);
    s = run(s, "fill.rest", "string.6");
    const second = cmd.currentEvent(s.doc)!.id;
    s = apply(s, (d) => cmd.addSpan(d, "wave", second, first));
    expect(s.doc.score.spans).toMatchObject([{ kind: "wave", part: "koto", from: first, to: second, startText: "サ" }]);
    expect(problems(s.doc.score)).toEqual([]);
    expect(cmd.spansAtMeasure(s.doc.score, 0)).toHaveLength(1);
    expect(cmd.spansAtMeasure(s.doc.score, 1)).toHaveLength(1);

    const id = s.doc.score.spans[0]!.id;
    s = apply(s, (d) => cmd.patchSpan(d, id, (span) => { span.endText = "ラ"; }));
    expect(s.doc.score.spans[0]!.endText).toBe("ラ");
    s = apply(s, (d) => cmd.deleteSpan(d, id));
    expect(s.doc.score.spans).toEqual([]);
  });

  it("別パートの音符どうしには掛けられない", () => {
    const state = initialState(loadSample("ikuyamakawa-excerpt"));
    expect(cmd.addSpan(state.doc, "dash", "m3a1", "m3b1")).toBeNull();
  });

  it("1番括弧・2番括弧は小節に掛け、番号を交互に振る", () => {
    let s = run(start(), "string.1", "fill.rest", "string.2");
    s = apply(s, (d) => cmd.addVolta(d, 0, 0));
    s = apply(s, (d) => cmd.addVolta(d, 1, 1));
    expect(s.doc.score.spans.map((v) => v.startText)).toEqual(["1", "2"]);
    expect(problems(s.doc.score)).toEqual([]);
    // 小節を消すと、そこに掛かっていた括弧も消える
    s = run(s, "measure.delete");
    expect(s.doc.score.spans).toHaveLength(1);
  });
});

describe("代替譜", () => {
  it("カーソル位置に作り、その中に音符を入れる。小節の音符には影響しない", () => {
    let s = run(start(), "string.7", "string.8");
    s = apply(s, cmd.addOssia);
    expect(s.doc.cursor).toMatchObject({ mi: 0, ossia: 0, index: 0 });
    expect(s.doc.score.measures[0]!.ossia![0]).toMatchObject({ part: "koto", label: "或は", at: "1" });
    s = run(s, "lines.more", "string.8", "string.7");
    const ossia = s.doc.score.measures[0]!.ossia![0]!;
    expect(ossia.events.map((e) => (e.type === "note" ? e.strings[0]!.n : 0))).toEqual([8, 7]);
    expect(cmd.eventsAt(s.doc.score, { mi: 0, partId: "koto", index: 0 })).toHaveLength(2);
    // 代替譜はいくつ入れても次の小節へは進まない
    s = run(s, "string.6", "string.5", "string.4", "string.3", "string.2", "string.1", "string.2");
    expect(s.doc.score.measures).toHaveLength(1);
    expect(problems(s.doc.score)).toEqual([]);
  });

  it("代替譜の中から小節の操作をすると、代替譜の外で行われる", () => {
    let s = apply(run(start(), "string.7"), cmd.addOssia);
    s = run(s, "measure.insertAfter");
    expect(s.doc.cursor).toEqual({ mi: 1, partId: "koto", index: 0 });
    expect(run(s, "string.1").doc.score.measures[1]!.content.koto).toMatchObject({ events: [{ type: "note" }] });
  });

  it("削除するとカーソルは小節に戻る", () => {
    let s = apply(run(start(), "string.7"), cmd.addOssia);
    s = apply(s, (d) => cmd.deleteOssia(d, 0));
    expect(s.doc.score.measures[0]!.ossia).toBeUndefined();
    expect(s.doc.cursor.ossia).toBeUndefined();
  });
});

describe("パートの追加と削除", () => {
  it("追加すると全小節に空の内容ができ、削除すると補助行・スパンごと消える", () => {
    let s = initialState(loadSample("ikuyamakawa-excerpt"));
    s = apply(s, cmd.addPart);
    const added = s.doc.score.parts[2]!;
    expect(s.doc.score.measures.every((m) => added.id in m.content)).toBe(true);
    expect(validateScore(s.doc.score)).toEqual([]);

    // 第二箏を消す：そこに掛かっていた破線のスパンも消える
    s = apply(s, (d) => cmd.removePart(d, "koto2"));
    expect(s.doc.score.parts.map((p) => p.id)).toEqual(["koto1", added.id]);
    expect(s.doc.score.spans.map((sp) => sp.kind)).toEqual(["volta", "volta"]);
    expect(validateScore(s.doc.score)).toEqual([]);

    // 第一箏を消す：その下の補助行も消える
    s = apply(s, (d) => cmd.removePart(d, "koto1"));
    expect(s.doc.score.tracks).toEqual([]);
    expect(s.doc.score.measures.every((m) => m.aux === undefined)).toBe(true);
    expect(s.doc.cursor.partId).toBe(added.id);
    expect(cmd.removePart(s.doc, added.id)).toBeNull();
  });
});

describe("入力欄のレイアウト", () => {
  it("指定がなければ、中身のある行だけ入力欄になる（出力の組版は変わらない）", () => {
    const score = loadSample("rokudan-excerpt");
    const plain = layoutScore(score);
    const forced = layoutScore(score, {}, { forceLanes: ["shoka:koto"] });
    // 六段の抜粋は全段に口唱歌があるので、強制しても高さは同じ
    expect(forced.pages[0]!.boxes.map((b) => b.y)).toEqual(plain.pages[0]!.boxes.map((b) => b.y));
    const lanes = plain.pages[0]!.lanes.filter((l) => l.lane === "shoka:koto");
    expect(lanes).toHaveLength(7);
    // 4拍の小節には 1/8 拍刻みで32か所の置き場所がある
    expect(lanes[0]!.stops).toHaveLength(32);
    expect(lanes[0]!.stops.slice(0, 3).map((s) => s.at)).toEqual(["0", "1/8", "1/4"]);
    expect(plain.pages[0]!.laneItems.filter((b) => b.measureId === "m1")).toHaveLength(5);
  });

  it("空の行を入力用に出すと、その分だけ下にずれる", () => {
    const score = loadSample("shochikubai-excerpt");
    const plain = layoutScore(score).pages[0]!;
    const forced = layoutScore(score, {}, { forceLanes: ["shoka:koto"] }).pages[0]!;
    expect(plain.lanes.some((l) => l.lane === "shoka:koto")).toBe(false);
    expect(forced.lanes.filter((l) => l.lane === "shoka:koto")).toHaveLength(5);
    expect(forced.boxes[0]!.y).toBeGreaterThan(plain.boxes[0]!.y);
    // 弱起（2拍）の小節は16か所
    expect(forced.lanes.find((l) => l.lane === "shoka:koto" && l.measureId === "m1")!.stops).toHaveLength(16);
  });

  it("代替譜の音符と入力位置が取れる", () => {
    const page = layoutScore(loadSample("rokudan-excerpt")).pages[0]!;
    expect(page.boxes.filter((b) => b.ossia === 0).map((b) => b.eventId)).toEqual(["m5o1", "m5o2"]);
    expect(page.lanes.some((l) => l.lane === "ossia:koto:0" && l.measureId === "m5")).toBe(true);
  });
});
