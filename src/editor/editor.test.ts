import { describe, expect, it } from "vitest";
import { validateScore } from "../model/validate";
import { blankScore, currentEvent, eventsAt } from "./commands";
import {
  assignKey, bindingFromEvent, defaultKeymap, findAction, findConflict, formatBinding, normalizeKeymap, type KeyLike,
} from "./keymap";
import { initialState, performAction, type EditorState } from "./store";

const run = (state: EditorState, ...ids: string[]) => ids.reduce(performAction, state);
const start = () => initialState(blankScore());
const strings = (state: EditorState, mi = state.doc.cursor.mi) =>
  (eventsAt(state.doc.score, { ...state.doc.cursor, mi }) ?? []).map((e) =>
    e.type === "note" ? e.strings.map((s) => s.n).join("+") : e.type === "rest" ? "○" : e.type === "dot" ? "●" : e.sign,
  );

function keyEvent(code: string, key: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { code, key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods };
}

describe("音符の入力", () => {
  it("絃と休符を順に入れ、カーソルが進む", () => {
    const s = run(start(), "string.5", "rest", "string.3", "string.1");
    expect(strings(s)).toEqual(["5", "○", "3", "1"]);
    expect(s.doc.cursor).toMatchObject({ mi: 0, index: 4 });
    expect(validateScore(s.doc.score)).toEqual([]);
  });

  it("小節が満ちたら次の小節を作って続ける", () => {
    const s = run(start(), "string.1", "string.2", "string.3", "string.4", "string.5");
    expect(s.doc.score.measures).toHaveLength(2);
    expect(strings(s, 0)).toEqual(["1", "2", "3", "4"]);
    expect(strings(s, 1)).toEqual(["5"]);
    expect(s.doc.cursor).toMatchObject({ mi: 1, index: 1 });
  });

  it("途中に挿入できる", () => {
    const s = run(start(), "string.1", "string.3", "move.left", "string.2");
    expect(strings(s)).toEqual(["1", "2", "3"]);
  });

  it("音価線の本数は次の入力に引き継がれ、同じ拍の中では自動でつながる", () => {
    // 五.四（付点八分＋十六分）と、次の拍の八分
    const s = run(start(), "string.5", "lines.more", "dots", "string.4", "lines.more", "string.3", "lines.less");
    const events = eventsAt(s.doc.score, s.doc.cursor)!;
    expect(events.map((e) => [e.lines, e.dots, !!e.joinPrev])).toEqual([
      [1, 1, false],
      [2, 0, true],
      [1, 0, false],
    ]);
    expect(s.inputLines).toBe(1);
  });

  it("手前に音符がなければ、音価線の操作は次の入力の設定だけを変える", () => {
    const s = run(start(), "lines.more", "lines.more", "string.7");
    expect(currentEvent(s.doc)).toMatchObject({ lines: 2 });
    expect(s.past).toHaveLength(1);
  });
});

describe("属性の変更", () => {
  it("合せ爪：入れた順に上から重なり、左弧が付く。同じ絃でもう一度押すと外れる", () => {
    let s = run(start(), "string.1", "chord.5");
    expect(currentEvent(s.doc)).toMatchObject({ strings: [{ n: 1 }, { n: 5 }], chord: "arc" });
    s = run(s, "chord.style");
    expect(currentEvent(s.doc)).toMatchObject({ chord: "circle" });
    // 上下を入れ替える
    s = run(s, "chord.flip");
    expect(currentEvent(s.doc)).toMatchObject({ strings: [{ n: 5 }, { n: 1 }] });
    s = run(s, "chord.1");
    const event = currentEvent(s.doc)!;
    expect(event).toMatchObject({ strings: [{ n: 5 }] });
    expect("chord" in event).toBe(false);
  });

  it("押し手は なし→一重→二重→三重→なし と回る", () => {
    let s = run(start(), "string.6");
    const press = () => {
      const e = currentEvent(s.doc)!;
      return e.type === "note" ? e.strings[0]!.press : undefined;
    };
    const seen = [];
    for (let i = 0; i < 4; i++) {
      s = run(s, "press");
      seen.push(press());
    }
    expect(seen).toEqual([1, 2, 3, undefined]);
  });

  it("合せ爪では、下の絃の押し手を別に切り替えられる", () => {
    // 巾の下に為を重ね、為に二重押し
    let s = run(start(), "string.13", "chord.next", "string.12", "press.lower", "press.lower");
    expect(currentEvent(s.doc)).toMatchObject({ strings: [{ n: 13 }, { n: 12, press: 2 }] });
    s = run(s, "press");
    expect(currentEvent(s.doc)).toMatchObject({ strings: [{ n: 13, press: 1 }, { n: 12, press: 2 }] });
    // 絃が1つだけの音符では、下の絃の押し手は働かない
    const single = run(start(), "string.9");
    expect(run(single, "press.lower")).toBe(single);
  });

  it("右肩記号・上記号・前記号は押すたびに付け外しする", () => {
    let s = run(start(), "string.1", "sup.3", "sup.ヒ", "above.左", "prefix.kaki");
    expect(currentEvent(s.doc)).toMatchObject({ sup: ["3", "ヒ"], above: ["左"], prefix: "kaki" });
    s = run(s, "sup.3", "above.左", "prefix.kaki");
    const event = currentEvent(s.doc)!;
    expect(event.sup).toEqual(["ヒ"]);
    expect("above" in event).toBe(false);
    expect("prefix" in event).toBe(false);
  });

  it("休符には押し手や前記号を付けない", () => {
    const s = run(start(), "rest");
    expect(run(s, "press", "prefix.kaki")).toBe(s);
  });
});

describe("削除・移動・履歴", () => {
  it("Backspace は手前を、Delete は次を消す", () => {
    let s = run(start(), "string.1", "string.2", "string.3", "delete.back");
    expect(strings(s)).toEqual(["1", "2"]);
    s = run(s, "move.left", "move.left", "delete.forward");
    expect(strings(s)).toEqual(["2"]);
  });

  it("小節の端で左右に動くと隣の小節へ移る", () => {
    let s = run(start(), "string.1", "string.2", "string.3", "string.4", "string.5");
    s = run(s, "move.left", "move.left");
    expect(s.doc.cursor).toMatchObject({ mi: 0, index: 4 });
    s = run(s, "move.right");
    expect(s.doc.cursor).toMatchObject({ mi: 1, index: 0 });
  });

  it("取り消しとやり直し。カーソル移動は履歴に積まない", () => {
    let s = run(start(), "string.1", "string.2", "move.left");
    expect(s.past).toHaveLength(2);
    s = run(s, "undo");
    expect(strings(s)).toEqual(["1"]);
    s = run(s, "undo", "undo");
    expect(strings(s)).toEqual([]);
    s = run(s, "redo", "redo");
    expect(strings(s)).toEqual(["1", "2"]);
  });

  it("消した音符に掛かっていたスパンも消える", () => {
    let s = run(start(), "string.1", "string.2");
    const [a, b] = eventsAt(s.doc.score, s.doc.cursor)!;
    s.doc.score.spans.push({ id: "s1", kind: "wave", from: a!.id, to: b!.id });
    s = run(s, "delete.back");
    expect(s.doc.score.spans).toEqual([]);
  });
});

describe("小節の操作", () => {
  it("挿入・削除・前小節くり返し", () => {
    let s = run(start(), "string.1", "measure.insertAfter", "string.2", "measure.insertBefore");
    expect(s.doc.score.measures.map((_, mi) => strings(s, mi))).toEqual([["1"], [], ["2"]]);
    s = run(s, "measure.repeat");
    expect(s.doc.score.measures[1]!.content.koto).toEqual({ repeat: "measure" });
    expect(run(s, "string.3")).toBe(s);
    s = run(s, "measure.delete", "measure.delete", "measure.delete");
    expect(s.doc.score.measures).toHaveLength(1);
    expect(strings(s)).toEqual([]);
  });
});

describe("速く入力するための操作", () => {
  it("合せ爪：「重ねる」のあとに押した絃が手前の音符に重なる。待ち状態は1回で解ける", () => {
    // 上の絃を先に打ち、「重ねる」のあとに下の絃を打つ
    let s = run(start(), "string.1", "chord.next");
    expect(s.chordArmed).toBe(true);
    s = run(s, "string.5");
    expect(s.chordArmed).toBe(false);
    expect(strings(s)).toEqual(["1+5"]);
    s = run(s, "string.3");
    expect(strings(s)).toEqual(["1+5", "3"]);
    // 待ち状態で別の操作をしたら解ける
    s = run(s, "chord.next", "dots", "string.4");
    expect(strings(s)).toEqual(["1+5", "3", "4"]);
  });

  it("残りを休符で埋めて次の小節へ進む（七○○○）", () => {
    const s = run(start(), "string.7", "fill.rest");
    expect(strings(s, 0)).toEqual(["7", "○", "○", "○"]);
    expect(s.doc.cursor).toMatchObject({ mi: 1, index: 0 });
    expect(validateScore(s.doc.score)).toEqual([]);
  });

  it("半端な残りは短い休符で埋める", () => {
    const s = run(start(), "lines.more", "string.7", "fill.rest");
    const events = eventsAt(s.doc.score, { ...s.doc.cursor, mi: 0 })!;
    expect(events.map((e) => [e.type, e.lines])).toEqual([["note", 1], ["rest", 0], ["rest", 0], ["rest", 0], ["rest", 1]]);
    expect(validateScore(s.doc.score)).toEqual([]);
  });

  it("手前の2音を付点八分＋十六分にする", () => {
    const s = run(start(), "string.5", "string.4", "pattern.dotted", "string.3");
    const events = eventsAt(s.doc.score, s.doc.cursor)!;
    expect(events.map((e) => [e.lines, e.dots, !!e.joinPrev])).toEqual([
      [1, 1, false],
      [2, 0, true],
      [0, 0, false],
    ]);
  });

  it("前の小節を写す。写した音符は別のIDを持つ", () => {
    let s = run(start(), "string.1", "string.2", "string.3", "string.4", "measure.insertAfter", "measure.copyPrev");
    expect(strings(s, 1)).toEqual(["1", "2", "3", "4"]);
    expect(s.doc.cursor).toMatchObject({ mi: 1, index: 4 });
    expect(validateScore(s.doc.score)).toEqual([]);
    s = run(s, "undo");
    expect(strings(s, 1)).toEqual([]);
  });

  it("小節をコピーして別の小節に貼り付ける", () => {
    let s = run(start(), "string.9", "measure.copy", "measure.insertAfter", "measure.insertAfter", "measure.paste");
    expect(s.doc.score.measures.map((_, mi) => strings(s, mi))).toEqual([["9"], [], ["9"]]);
    s = run(s, "measure.prev", "measure.paste");
    expect(strings(s, 1)).toEqual(["9"]);
  });
});

describe("拍の中に置く付点", () => {
  it("五 ●（八分）●（十六分）四（十六分）で2拍になり、付点には音価線がつながらない", () => {
    // 四分の五、八分の付点、十六分の付点、十六分の四、あとは休符
    // 音価線の操作は手前の音符に掛かるので、付点を入れてから長さを決める
    const s = run(start(), "string.5", "dot.event", "lines.more", "dot.event", "lines.more", "string.4", "fill.rest");
    expect(strings(s, 0)).toEqual(["5", "●", "●", "4", "○", "○"]);
    const events = eventsAt(s.doc.score, { ...s.doc.cursor, mi: 0 })!;
    expect(events.map((e) => [e.lines, !!e.joinPrev])).toEqual([[0, false], [1, false], [2, false], [2, false], [0, false], [0, false]]);
    expect(validateScore(s.doc.score)).toEqual([]);
  });
});

describe("音価線のつながり", () => {
  // 八分を3つ並べ、真ん中の音符にカーソルを置く
  const three = () => run(start(), "lines.more", "string.1", "string.2", "string.3", "move.left");
  const joins = (s: EditorState) => eventsAt(s.doc.score, s.doc.cursor)!.map((e) => !!e.joinPrev);

  it("入力時は拍の中だけ自動でつながる", () => {
    expect(joins(three())).toEqual([false, true, false]);
  });

  it("前とつなぐ／次とつなぐを、音符ごとに別々に切り替えられる", () => {
    let s = run(three(), "join.prev");
    expect(joins(s)).toEqual([false, false, false]);
    s = run(s, "join.next");
    expect(joins(s)).toEqual([false, false, true]);
    s = run(s, "join.prev");
    expect(joins(s)).toEqual([false, true, true]);
  });

  it("線のない音符とはつなげない", () => {
    // 壱は四分、弐だけ八分
    const s = run(start(), "string.1", "string.2", "lines.more");
    expect(run(s, "join.prev")).toBe(s);
    expect(run(s, "join.next")).toBe(s);
  });
});

describe("キー割り当て", () => {
  it("初期値：絃はテンキー（1〜9、0＝十、/＝斗、*＝為、-＝巾）", () => {
    const map = defaultKeymap("jis");
    expect(findAction(map, keyEvent("Numpad1", "1"))).toBe("string.1");
    expect(findAction(map, keyEvent("Numpad9", "9"))).toBe("string.9");
    expect(findAction(map, keyEvent("Numpad0", "0"))).toBe("string.10");
    expect(findAction(map, keyEvent("NumpadDivide", "/"))).toBe("string.11");
    expect(findAction(map, keyEvent("NumpadMultiply", "*"))).toBe("string.12");
    expect(findAction(map, keyEvent("NumpadSubtract", "-"))).toBe("string.13");
    // NumLock が切れていても物理キーで判定する
    expect(findAction(map, keyEvent("Numpad1", "End"))).toBe("string.1");
  });

  it("初期値：テンキーの残りで休符・付点・合せ爪、上下で音価", () => {
    const map = defaultKeymap("jis");
    expect(findAction(map, keyEvent("NumpadEnter", "Enter"))).toBe("rest");
    expect(findAction(map, keyEvent("NumpadDecimal", "."))).toBe("dots");
    expect(findAction(map, keyEvent("NumpadAdd", "+"))).toBe("chord.next");
    expect(findAction(map, keyEvent("ArrowDown", "ArrowDown"))).toBe("lines.more");
    expect(findAction(map, keyEvent("ArrowUp", "ArrowUp"))).toBe("lines.less");
    expect(findAction(map, keyEvent("Enter", "Enter"))).toBe("fill.rest");
    expect(findAction(map, keyEvent("KeyH", "h"))).toBe("sup.ヒ");
    expect(findAction(map, keyEvent("KeyO", "O", { shiftKey: true }))).toBe("sup.ヲ");
    expect(findAction(map, keyEvent("KeyZ", "z", { ctrlKey: true }))).toBe("undo");
    expect(findAction(map, keyEvent("KeyX", "x"))).toBeNull();
  });

  it("[ ] のキーは、JISとUSで物理位置が違っても同じ操作になる", () => {
    expect(findAction(defaultKeymap("jis"), keyEvent("BracketRight", "["))).toBe("join.prev");
    expect(findAction(defaultKeymap("jis"), keyEvent("Backslash", "]"))).toBe("join.next");
    expect(findAction(defaultKeymap("us"), keyEvent("BracketLeft", "["))).toBe("join.prev");
    expect(findAction(defaultKeymap("us"), keyEvent("BracketRight", "]"))).toBe("join.next");
  });

  it("初期値に重複がない", () => {
    for (const preset of ["jis", "us"] as const) {
      const map = defaultKeymap(preset);
      for (const [action, binding] of Object.entries(map)) {
        if (binding) expect(findConflict(map, binding, action)).toBeNull();
      }
    }
  });

  it("重複を見つけ、割り当て直すと元の操作からは外れる", () => {
    const map = defaultKeymap("jis");
    const binding = bindingFromEvent(keyEvent("KeyP", "p"))!;
    expect(findConflict(map, binding, "sup.ヒ")).toBe("press");
    const next = assignKey(map, "sup.ヒ", binding);
    expect(next.press).toBeNull();
    expect(findAction(next, keyEvent("KeyP", "p"))).toBe("sup.ヒ");
    expect(formatBinding(next["sup.ヒ"])).toBe("P");
  });

  it("修飾キーだけでは割り当てにならない。テンキーは名前で区別して表示する", () => {
    expect(bindingFromEvent(keyEvent("ShiftLeft", "Shift", { shiftKey: true }))).toBeNull();
    expect(formatBinding(bindingFromEvent(keyEvent("KeyK", "K", { shiftKey: true, ctrlKey: true })))).toBe("Ctrl+Shift+K");
    expect(formatBinding(bindingFromEvent(keyEvent("NumpadMultiply", "*")))).toBe("テンキー*");
    expect(formatBinding(bindingFromEvent(keyEvent("Numpad7", "Home")))).toBe("テンキー7");
  });

  it("読み込んだ設定は、知らない操作を捨て、欠けた操作を初期値で補う", () => {
    const base = defaultKeymap("jis");
    const loaded = normalizeKeymap({ press: null, dots: { code: "KeyO", label: "O" }, unknown: { code: "KeyX", label: "X" } }, base);
    expect(loaded.press).toBeNull();
    expect(loaded.dots).toEqual({ code: "KeyO", label: "O" });
    expect("unknown" in loaded).toBe(false);
    expect(loaded.rest).toEqual(base.rest);
  });
});
