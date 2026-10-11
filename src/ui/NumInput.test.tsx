// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NumInput } from "./NumInput";

afterEach(cleanup);

/** 値をそのまま保持する親。反映された値の履歴も残す */
function Field(props: { initial: number; min?: number; step?: number; emptyOk?: boolean; log: string[] }) {
  const [value, setValue] = useState<number | string>(props.initial);
  return (
    <NumInput
      aria-label="欄"
      value={value}
      min={props.min}
      step={props.step}
      emptyOk={props.emptyOk}
      onChange={(e) => {
        props.log.push(e.target.value);
        setValue(e.target.value === "" ? "" : Number(e.target.value));
      }}
    />
  );
}

const field = () => screen.getByLabelText("欄") as HTMLInputElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

describe("数値の入力欄", () => {
  it("1字ずつ消して全部消し、打ち直せる。入力途中の空欄は値に反映しない", () => {
    const log: string[] = [];
    render(<Field initial={-12} log={log} />);
    fireEvent.focus(field());
    // -12 → -1 → - → （空） → 5 → 5.  → 5.5
    for (const text of ["-1", "-", "", "5", "5.", "5.5"]) {
      type(text);
      expect(field().value).toBe(text);
    }
    expect(log).toEqual(["-1", "5", "5.5"]);
  });

  it("欄を離れると、反映されている値の表示に戻る", () => {
    const log: string[] = [];
    render(<Field initial={36} log={log} />);
    fireEvent.focus(field());
    type("");
    expect(field().value).toBe("");
    fireEvent.blur(field());
    expect(field().value).toBe("36");
    expect(log).toEqual([]);
  });

  it("下限より小さい値は、打っている間は表示するが反映しない", () => {
    const log: string[] = [];
    render(<Field initial={180} min={50} log={log} />);
    fireEvent.focus(field());
    // 180 を 200 に打ち直す途中の「2」「20」は下限未満
    for (const text of ["", "2", "20", "200"]) type(text);
    expect(field().value).toBe("200");
    expect(log).toEqual(["200"]);
  });

  it("空欄を認める欄では、空欄も反映する", () => {
    const log: string[] = [];
    render(<Field initial={110} emptyOk log={log} />);
    fireEvent.focus(field());
    type("");
    expect(log).toEqual([""]);
  });

  it("上下の矢印キーで、刻みの分だけ変わる（端数が出ない）", () => {
    const log: string[] = [];
    render(<Field initial={0.2} step={0.1} log={log} />);
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(log).toEqual(["0.3", "0.4", "0.3"]);
    expect(field().value).toBe("0.3");
  });
});
