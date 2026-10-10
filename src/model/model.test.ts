import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eventBeats, eventOffsets, totalBeats } from "./duration";
import { add, compare, formatFraction, frac, parseFraction } from "./fraction";
import { parseScore } from "./load";
import { formatPitch, HIRAJOSHI, parsePitch, resolvePitches } from "./pitch";
import type { Event, Score } from "./types";
import { validateScore } from "./validate";

function loadSample(name: string): Score {
  const url = new URL(`../../samples/${name}.koto.json`, import.meta.url);
  return parseScore(JSON.parse(readFileSync(url, "utf8")));
}

const beats = (lines: Event["lines"], dots: Event["dots"]) => formatFraction(eventBeats({ lines, dots }));

describe("分数", () => {
  it("文字列を読み、約分して書き戻す", () => {
    expect(formatFraction(parseFraction("6/4")!)).toBe("3/2");
    expect(formatFraction(parseFraction("2")!)).toBe("2");
    expect(formatFraction(parseFraction(" 0/8 ")!)).toBe("0");
  });

  it("読めない文字列は null", () => {
    for (const text of ["", "1.5", "1/0", "a/2", "1/2/3"]) {
      expect(parseFraction(text)).toBeNull();
    }
  });

  it("加算と比較", () => {
    expect(formatFraction(add(frac(3, 4), frac(1, 4)))).toBe("1");
    expect(compare(frac(1, 2), frac(2, 3))).toBeLessThan(0);
    expect(compare(frac(2, 4), frac(1, 2))).toBe(0);
  });
});

describe("音価", () => {
  it("音価線の本数で半分ずつになる", () => {
    expect([beats(0, 0), beats(1, 0), beats(2, 0), beats(3, 0)]).toEqual(["1", "1/2", "1/4", "1/8"]);
  });

  it("付点は1つで1.5倍、2つで1.75倍", () => {
    expect(beats(1, 1)).toBe("3/4");
    expect(beats(0, 1)).toBe("3/2");
    expect(beats(0, 2)).toBe("7/4");
    expect(beats(2, 2)).toBe("7/16");
  });

  it("合計と開始位置", () => {
    // 五.四三（付点八分・十六分・四分）
    const events = [
      { lines: 1, dots: 1 },
      { lines: 2, dots: 0 },
      { lines: 0, dots: 0 },
    ] as const;
    expect(formatFraction(totalBeats(events))).toBe("2");
    expect(eventOffsets(events).map(formatFraction)).toEqual(["0", "3/4", "1"]);
  });
});

describe("抜粋データ", () => {
  for (const name of ["rokudan-excerpt", "shochikubai-excerpt", "ikuyamakawa-excerpt"]) {
    it(`${name} は検算で問題が出ない`, () => {
      expect(validateScore(loadSample(name))).toEqual([]);
    });
  }
});

describe("検算", () => {
  const codes = (score: Score) => validateScore(score).map((i) => i.code);
  const firstEvents = (score: Score, partId: string) => {
    const pm = score.measures[0]!.content[partId]!;
    if (!("events" in pm)) throw new Error("events がない小節");
    return pm;
  };

  it("拍数が合わない小節を指摘する", () => {
    const score = loadSample("rokudan-excerpt");
    firstEvents(score, "koto").events.pop();
    const issues = validateScore(score);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "beats-mismatch", measureIndex: 0, partId: "koto" });
    expect(issues[0]!.message).toContain("3 拍");
  });

  it("free の小節は拍数を見ない", () => {
    const score = loadSample("rokudan-excerpt");
    firstEvents(score, "koto").events.pop();
    score.measures[0]!.free = true;
    expect(validateScore(score)).toEqual([]);
  });

  it("小節ごとの拍数指定が効く（弱起）", () => {
    const score = loadSample("shochikubai-excerpt");
    delete score.measures[0]!.beats;
    expect(codes(score)).toContain("beats-mismatch");
  });

  it("口唱歌と補助行の拍位置が小節外なら指摘する", () => {
    const rokudan = loadSample("rokudan-excerpt");
    firstEvents(rokudan, "koto").shoka!.push({ at: "4", text: "ン" });
    expect(codes(rokudan)).toEqual(["position-out-of-range"]);

    const shochikubai = loadSample("shochikubai-excerpt");
    shochikubai.measures[0]!.aux!.uta!.push({ at: "2", text: "ち" });
    expect(codes(shochikubai)).toEqual(["position-out-of-range"]);
  });

  it("読めない拍位置を指摘する", () => {
    const score = loadSample("rokudan-excerpt");
    firstEvents(score, "koto").shoka![0]!.at = "0.5";
    expect(codes(score)).toEqual(["bad-fraction"]);
  });

  it("範囲外の絃番号と絃のない音符を指摘する", () => {
    const score = loadSample("rokudan-excerpt");
    const [first, , third] = firstEvents(score, "koto").events;
    if (first?.type !== "note" || third?.type !== "note") throw new Error("想定外のデータ");
    first.strings = [{ n: 14 }];
    third.strings = [];
    expect(codes(score)).toEqual(["bad-string", "empty-note"]);
  });

  it("IDの重複を指摘する", () => {
    const score = loadSample("rokudan-excerpt");
    firstEvents(score, "koto").events[1]!.id = "m1e1";
    expect(codes(score)).toContain("duplicate-id");
  });

  it("スパンの端点の欠落・逆順・パート違いを指摘する", () => {
    const missing = loadSample("rokudan-excerpt");
    missing.spans[0]!.to = "nowhere";
    expect(codes(missing)).toEqual(["span-missing-end"]);

    const reversed = loadSample("rokudan-excerpt");
    const span = reversed.spans[0]!;
    [span.from, span.to] = [span.to, span.from];
    expect(codes(reversed)).toEqual(["span-order"]);

    const crossPart = loadSample("ikuyamakawa-excerpt");
    crossPart.spans[0]!.to = "m5a4";
    expect(codes(crossPart)).toEqual(["span-part"]);
  });

  it("未定義のパート・補助行と、内容の欠落を指摘する", () => {
    const score = loadSample("ikuyamakawa-excerpt");
    const m1 = score.measures[0]!;
    delete m1.content.koto2;
    m1.aux!.nazo = [{ at: "0", text: "?" }];
    expect(codes(score).sort()).toEqual(["missing-content", "unknown-track"]);
  });
});

describe("読み込み", () => {
  it("形式が違うデータは拒否する", () => {
    expect(() => parseScore(null)).toThrow();
    expect(() => parseScore({ format: "other" })).toThrow();
    expect(() => parseScore({ format: "koto-score", version: 2 })).toThrow();
  });
});

describe("音高（五線譜への変換の土台）", () => {
  it("音名とMIDIノート番号を相互に変換する", () => {
    expect(parsePitch("C4")).toBe(60);
    expect(parsePitch("A#3")).toBe(58);
    expect(parsePitch("Bb3")).toBe(58);
    expect(parsePitch("D5")).toBe(74);
    expect(parsePitch("H4")).toBeNull();
    expect(HIRAJOSHI.map((p) => formatPitch(parsePitch(p)!))).toEqual(HIRAJOSHI);
  });

  const pitchNames = (score: Score, ...ids: string[]) => {
    const pitches = resolvePitches(score);
    return ids.map((id) => pitches.get(id)?.map(formatPitch).join("+"));
  };

  it("調弦から各音符の音高が決まる（六段の冒頭：五 三 壱）", () => {
    const score = loadSample("rokudan-excerpt");
    expect(resolvePitches(score).size).toBe(0);
    score.parts[0]!.tuning = { name: "平調子", pitches: [...HIRAJOSHI] };
    expect(pitchNames(score, "m1e1", "m1e3", "m1e4")).toEqual(["D4", "A3", "D4"]);
    // 休符は音高を持たない。合せ爪は絃ごとに持つ
    expect(pitchNames(score, "m1e2", "m7e3")).toEqual([undefined, "D4+D4"]);
    expect(validateScore(score)).toEqual([]);
  });

  it("押し手は半音ずつ上がり、甲音の点は1オクターブ上がる", () => {
    const score = loadSample("shochikubai-excerpt");
    score.parts[0]!.tuning = { pitches: [...HIRAJOSHI] };
    // 六（D#4）を一重押し → E4
    expect(pitchNames(score, "m2e3")).toEqual(["E4"]);
    const events = score.measures[1]!.content.koto!;
    if (!("events" in events)) throw new Error("想定外のデータ");
    events.events[0]!.above = ["甲"];
    expect(pitchNames(score, "m2e1")).toEqual(["G5"]);
  });

  it("途中の調弦の変更は、その小節から先に効く", () => {
    const score = loadSample("ikuyamakawa-excerpt");
    for (const part of score.parts) part.tuning = { pitches: [...HIRAJOSHI] };
    // 第3小節から第一箏の九を半音上げる（A#4 → B4）
    score.measures[2]!.retune = [{ part: "koto1", string: 9, semitones: 1 }];
    expect(pitchNames(score, "m3a1", "m4a1")).toEqual(["B4", "B4"]);
    // 第二箏には効かない
    expect(pitchNames(score, "m7b3")).toEqual(["A#4"]);
    expect(validateScore(score)).toEqual([]);
  });

  it("調弦の書き方が正しくなければ指摘する", () => {
    const score = loadSample("rokudan-excerpt");
    score.parts[0]!.tuning = { pitches: ["D4", "G3"] };
    score.measures[0]!.retune = [{ part: "koto", string: 14, semitones: 1 }];
    expect(validateScore(score).map((i) => i.code)).toEqual(["bad-tuning", "bad-tuning"]);
  });
});
