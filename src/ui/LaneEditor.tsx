import { useState, type KeyboardEvent } from "react";
import type { LaneItem } from "../editor/commands";
import { findAction, type Keymap } from "../editor/keymap";
import type { AuxItem, AuxTrack, StringRef } from "../model/types";

export type LaneKind = "shoka" | AuxTrack["kind"];

interface Props {
  kind: LaneKind;
  at: string;
  /** すでに置かれている項目。新規なら undefined */
  item: LaneItem | undefined;
  keymap: Keymap;
  /** item が null なら削除（新規で空なら何もしない）。advance なら次の位置へ進む */
  onCommit: (item: LaneItem | null, advance: boolean) => void;
  onCancel: () => void;
}

const STRING_NAMES = "壱弐三四五六七八九十斗為巾";
const PRESS_MARKS = ["", "△", "▲", "▲▲"];

/** 口唱歌・補助行の項目を1つ入力する小さな欄。Enter で確定して次の音符の位置へ進む */
export function LaneEditor({ kind, at, item, keymap, onCommit, onCancel }: Props) {
  const aux = item as AuxItem | undefined;
  const [text, setText] = useState(item?.text ?? "");
  const [notes, setNotes] = useState<StringRef[]>(aux?.notes ?? []);
  const [extend, setExtend] = useState(!!aux?.extend);
  const [enclosure, setEnclosure] = useState<AuxItem["enclosure"] | "">(aux?.enclosure ?? "");
  const [lines, setLines] = useState<number>(aux?.lines ?? 1);
  const [joinPrev, setJoinPrev] = useState(!!aux?.joinPrev);
  const isPitch = kind === "pitch";

  const build = (): LaneItem | null => {
    if (kind === "shoka") return text.trim() ? { at, text: text.trim() } : null;
    const next: AuxItem = { at };
    if (isPitch) {
      if (notes.length === 0) return null;
      next.notes = notes;
    } else {
      if (!text.trim()) return null;
      next.text = text.trim();
    }
    if (extend) next.extend = true;
    if (enclosure && (kind === "lyrics" || kind === "text")) next.enclosure = enclosure;
    if (kind === "rhythm") {
      next.lines = lines as AuxItem["lines"];
      if (joinPrev) next.joinPrev = true;
    }
    return next;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      onCommit(build(), true);
    } else if (isPitch) {
      // 歌の節は、絃の入力と同じキーで絃名を並べる
      e.preventDefault();
      const action = findAction(keymap, e.nativeEvent);
      if (action?.startsWith("string.")) setNotes([...notes, { n: Number(action.slice(7)) }]);
      else if (action === "press" && notes.length > 0) {
        const last = notes[notes.length - 1]!;
        const press = ((last.press ?? 0) + 1) % 4;
        setNotes([...notes.slice(0, -1), press === 0 ? { n: last.n } : { n: last.n, press: press as 1 | 2 | 3 }]);
      } else if (e.key === "Backspace") setNotes(notes.slice(0, -1));
    }
  };

  return (
    <div className="lane-form" onMouseDown={(e) => e.stopPropagation()}>
      {isPitch ? (
        <input
          autoFocus
          readOnly
          className="main"
          aria-label="歌の節"
          placeholder="絃のキーで入力"
          value={notes.map((n) => `${PRESS_MARKS[n.press ?? 0]}${STRING_NAMES[n.n - 1] ?? "？"}`).join(" ")}
          onKeyDown={onKeyDown}
        />
      ) : (
        <input
          autoFocus
          className="main"
          aria-label={kind === "shoka" ? "口唱歌" : "補助行の文字"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
      {kind !== "shoka" && (
        <label className="check">
          <input type="checkbox" checked={extend} onChange={(e) => setExtend(e.target.checked)} />
          延ばし線
        </label>
      )}
      {(kind === "lyrics" || kind === "text") && (
        <select aria-label="囲み" value={enclosure} onChange={(e) => setEnclosure(e.target.value as AuxItem["enclosure"] | "")}>
          <option value="">囲みなし</option>
          <option value="paren">( )</option>
          <option value="bracket">〔 〕</option>
        </select>
      )}
      {kind === "rhythm" && (
        <>
          <select aria-label="音価線" value={lines} onChange={(e) => setLines(Number(e.target.value))}>
            <option value={0}>線なし</option>
            <option value={1}>1本</option>
            <option value={2}>2本</option>
            <option value={3}>3本</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={joinPrev} onChange={(e) => setJoinPrev(e.target.checked)} />
            前とつなぐ
          </label>
        </>
      )}
      <button type="button" onClick={() => onCommit(build(), false)}>確定</button>
      {item && <button type="button" onClick={() => onCommit(null, false)}>削除</button>}
      <button type="button" title="変更を捨てて閉じる（Esc）" onClick={onCancel}>×</button>
    </div>
  );
}
