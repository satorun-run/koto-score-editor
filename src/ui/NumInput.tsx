import { useEffect, useRef, useState, type KeyboardEvent } from "react";

interface Props {
  value: number | string;
  /** 数として読める値が入ったときだけ呼ぶ。e.target.value に入力された文字列が入る */
  onChange: (e: { target: { value: string } }) => void;
  min?: number;
  max?: number;
  /** 上下の矢印キーで変える幅。既定は 1 */
  step?: number;
  /** 空欄を値として認める（「指定なし」を表す欄用） */
  emptyOk?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  "aria-label"?: string;
}

/** 入力途中の形（空、符号だけ、小数点で終わる）。まだ数として確定していない */
const INCOMPLETE = /^-?$|^-?\d*\.$|^-?\.\d*$/;

/**
 * 数値の入力欄。
 * 入力途中（全部消した状態、「-」だけ、「1.」など）はそのまま表示し、数として読める形になったときだけ値を反映する。
 * 欄を離れたときに、反映されている値の表示に戻す。
 *
 * ブラウザの数値欄（type="number"）は、入力途中の文字を空として返すことがあり、
 * 値をすぐ反映する作りだと、消した文字が元に戻る・1字しか消せないといった動きになる（iPad の Safari で顕著）。
 * そのため、文字の欄として持ち、数の解釈はここで行う
 */
export function NumInput({ value, onChange, min, max, step = 1, emptyOk = false, ...rest }: Props) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  // 外から値が変わったら表示を合わせる。入力中は、打っている文字を優先する
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const accept = (next: string) => {
    if (next.trim() === "") return emptyOk;
    if (INCOMPLETE.test(next.trim())) return false;
    const n = Number(next);
    return Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max);
  };
  const apply = (next: string) => {
    setText(next);
    if (accept(next)) onChange({ target: { value: next.trim() } });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const base = Number.isFinite(Number(text)) && text.trim() !== "" ? Number(text) : Number(value) || 0;
    // 0.1 刻みなどで端数が出ないよう、刻みの桁で丸める
    const digits = (String(step).split(".")[1] ?? "").length;
    let next = Number((base + (e.key === "ArrowUp" ? step : -step)).toFixed(digits));
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    apply(String(next));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(e) => apply(e.target.value)}
      onKeyDown={onKeyDown}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        setText(String(value));
      }}
      {...rest}
    />
  );
}
