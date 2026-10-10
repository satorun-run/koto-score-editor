// 編集状態と、操作ID（キー割り当ての単位）の実行。

import * as cmd from "./commands";
import type { Doc, Lines } from "./commands";
import type { Measure, Score } from "../model/types";

export interface EditorState {
  doc: Doc;
  /** 次に入力する音符の音価線の本数 */
  inputLines: Lines;
  past: Doc[];
  future: Doc[];
  /** 次に押す絃を、手前の音符に重ねる（合せ爪の入力待ち） */
  chordArmed: boolean;
  /** コピーした小節 */
  clip: Measure | null;
  /** スパンの始点として印を付けた音符 */
  mark: string | null;
}

const HISTORY_LIMIT = 300;

export function initialState(score: Score): EditorState {
  const cursor = cmd.clampCursor(score, { mi: 0, partId: score.parts[0]?.id ?? "", index: 0 });
  return { doc: { score, cursor }, inputLines: 0, past: [], future: [], chordArmed: false, clip: null, mark: null };
}

/** 操作の結果を反映する。楽譜が変わったときだけ履歴に積む */
export function applyDoc(state: EditorState, next: Doc | null): EditorState {
  if (!next) return state;
  if (next.score === state.doc.score) return { ...state, doc: next };
  return { ...state, doc: next, past: [...state.past, state.doc].slice(-HISTORY_LIMIT), future: [] };
}

export function undo(state: EditorState): EditorState {
  const prev = state.past[state.past.length - 1];
  if (!prev) return state;
  return { ...state, doc: prev, past: state.past.slice(0, -1), future: [state.doc, ...state.future] };
}

export function redo(state: EditorState): EditorState {
  const next = state.future[0];
  if (!next) return state;
  return { ...state, doc: next, past: [...state.past, state.doc], future: state.future.slice(1) };
}

function changeLines(state: EditorState, delta: -1 | 1): EditorState {
  const current = cmd.currentEvent(state.doc);
  const from = current ? current.lines : state.inputLines;
  const lines = Math.max(0, Math.min(3, from + delta)) as Lines;
  const next = current ? applyDoc(state, cmd.setLines(state.doc, lines)) : state;
  return { ...next, inputLines: lines };
}

/** 操作IDを実行する。該当する操作がなければ状態をそのまま返す */
export function performAction(input: EditorState, id: string): EditorState {
  const [head, arg = ""] = splitId(id);
  if (id === "chord.next") return { ...input, chordArmed: !input.chordArmed };
  // 合せ爪の入力待ちは、次の操作1回で解ける
  let state = input.chordArmed ? { ...input, chordArmed: false } : input;
  if (state.doc.cursor.ossia !== undefined && /^(measure|fill|part)\./.test(id)) {
    const { mi, partId } = state.doc.cursor;
    state = { ...state, doc: { score: state.doc.score, cursor: { mi, partId, index: 0 } } };
  }
  const { doc } = state;
  const run = (next: Doc | null) => applyDoc(state, next);
  if (input.chordArmed && head === "string") return run(cmd.toggleChordString(doc, Number(arg)));

  switch (head) {
    case "string":
      return run(cmd.insertEvent(doc, { type: "note", n: Number(arg) }, state.inputLines));
    case "chord":
      return arg === "style" ? run(cmd.cycleChordStyle(doc)) : run(cmd.toggleChordString(doc, Number(arg)));
    case "sign":
      return run(cmd.insertEvent(doc, { type: "sign", sign: arg }, state.inputLines));
    case "sup":
      return run(cmd.toggleSup(doc, arg));
    case "above":
      return run(cmd.toggleAbove(doc, arg));
    case "prefix":
      return run(cmd.togglePrefix(doc, arg === "wari" ? "wari" : "kaki"));
  }

  switch (id) {
    case "select.mark": {
      const current = cmd.currentEvent(doc);
      if (!current || doc.cursor.ossia !== undefined) return { ...state, mark: null };
      return { ...state, mark: state.mark === current.id ? null : current.id };
    }
    case "rest":
      return run(cmd.insertEvent(doc, { type: "rest" }, state.inputLines));
    case "dot.event":
      return run(cmd.insertEvent(doc, { type: "dot" }, state.inputLines));
    case "lines.more":
      return changeLines(state, 1);
    case "lines.less":
      return changeLines(state, -1);
    case "dots":
      return run(cmd.cycleDots(doc));
    case "join.prev":
      return run(cmd.toggleJoinPrev(doc));
    case "join.next":
      return run(cmd.toggleJoinNext(doc));
    case "pattern.dotted":
      return run(cmd.makeDottedPair(doc));
    case "fill.rest":
      return run(cmd.fillRests(doc));
    case "measure.copy":
      return { ...state, clip: doc.score.measures[doc.cursor.mi] ?? null };
    case "measure.paste":
      return run(cmd.pasteMeasure(doc, state.clip));
    case "measure.copyPrev":
      return run(cmd.pasteMeasure(doc, doc.score.measures[doc.cursor.mi - 1]));
    case "press":
      return run(cmd.cyclePress(doc));
    case "move.left":
      return run(cmd.moveCursor(doc, -1));
    case "move.right":
      return run(cmd.moveCursor(doc, 1));
    case "measure.next":
      return run(cmd.moveMeasure(doc, 1));
    case "measure.prev":
      return run(cmd.moveMeasure(doc, -1));
    case "part.up":
      return run(cmd.movePart(doc, -1));
    case "part.down":
      return run(cmd.movePart(doc, 1));
    case "delete.back":
      return run(cmd.deleteBack(doc));
    case "delete.forward":
      return run(cmd.deleteForward(doc));
    case "undo":
      return undo(state);
    case "redo":
      return redo(state);
    case "measure.insertAfter":
      return run(cmd.insertMeasureAfter(doc));
    case "measure.insertBefore":
      return run(cmd.insertMeasureBefore(doc));
    case "measure.delete":
      return run(cmd.deleteMeasure(doc));
    case "measure.repeat":
      return run(cmd.toggleMeasureRepeat(doc));
    default:
      return state;
  }
}

function splitId(id: string): [string, string | undefined] {
  const at = id.indexOf(".");
  return at < 0 ? [id, undefined] : [id.slice(0, at), id.slice(at + 1)];
}

export type EditorAction =
  | { type: "perform"; id: string }
  | { type: "apply"; fn: (doc: Doc) => Doc | null }
  | { type: "setCursor"; cursor: cmd.Cursor }
  | { type: "setInputLines"; lines: Lines }
  | { type: "setMark"; eventId: string | null }
  | { type: "load"; score: Score };

export function reducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "perform":
      return performAction(state, action.id);
    case "apply":
      return applyDoc(state, action.fn(state.doc));
    case "setCursor":
      return { ...state, doc: { score: state.doc.score, cursor: cmd.clampCursor(state.doc.score, action.cursor) } };
    case "setInputLines":
      return { ...state, inputLines: action.lines };
    case "setMark":
      return { ...state, mark: action.eventId };
    case "load":
      return { ...initialState(action.score), clip: state.clip };
  }
}
