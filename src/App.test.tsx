// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { loadDefaultStyle, saveDefaultStyle } from "./editor/defaults";

const press = (code: string, key: string, mods: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { code, key, ...mods });

/** 譜面に描かれている絃名（notes-koto グループの文字）を順に返す */
function drawnNotes(): string[] {
  return [...document.querySelectorAll(".page-art #notes-koto text")].map((el) => el.textContent ?? "");
}

beforeEach(() => {
  localStorage.clear();
  // 譜面の絃名を文字として読み取るので、フォントの文字で描く設定を既定にしておく
  saveDefaultStyle({ glyphs: null });
});
afterEach(cleanup);

describe("編集画面", () => {
  it("キーで入力した音符が譜面に出て、取り消せる", () => {
    render(<App />);
    press("Numpad5", "5");
    press("NumpadEnter", "Enter");
    press("Numpad3", "3");
    press("NumpadSubtract", "-");
    expect(drawnNotes()).toEqual(["五", "三", "巾"]);
    expect(document.querySelectorAll(".page-art #notes-koto circle")).toHaveLength(1);
    expect(screen.getByText("警告なし")).toBeTruthy();

    press("KeyZ", "z", { ctrlKey: true });
    expect(drawnNotes()).toEqual(["五", "三"]);
    expect(screen.getByText(/警告 1 件/)).toBeTruthy();
  });

  it("入力した楽譜は自動保存され、開き直すと戻る", () => {
    const first = render(<App />);
    press("Numpad7", "7");
    first.unmount();
    render(<App />);
    expect(drawnNotes()).toEqual(["七"]);
  });

  it("音符をクリックするとその音符が編集対象になる", () => {
    render(<App />);
    press("Numpad1", "1");
    press("Numpad2", "2");
    const hits = document.querySelectorAll(".hit-event");
    fireEvent.mouseDown(hits[0]!);
    expect(document.querySelector(".fields .what")?.textContent).toBe("壱");
    fireEvent.click(screen.getByTitle(/^押し手（なし/));
    expect(document.querySelectorAll(".page-art #techniques path")).toHaveLength(1);
  });

  it("テンキーだけで合せ爪と付点まで打てる", () => {
    render(<App />);
    press("Numpad1", "1");
    press("NumpadAdd", "+");
    expect(screen.getByText(/次に押す絃を重ねます/)).toBeTruthy();
    press("Numpad5", "5");
    press("ArrowDown", "ArrowDown");
    press("Numpad7", "7");
    press("NumpadDecimal", ".");
    // 重ねた字は下から順に描く
    expect(drawnNotes()).toEqual(["五", "壱", "七"]);
    // ↓ は手前の音符（合せ爪）を八分にし、次の七も八分で入る
    expect(document.querySelectorAll(".page-art #durations line")).toHaveLength(2);
    expect(document.querySelectorAll(".page-art #durations circle")).toHaveLength(1);
  });

  it("文字入力欄にいる間はキー割り当てが働かない", () => {
    render(<App />);
    press("Numpad1", "1");
    const input = screen.getByPlaceholderText("例：3 ヒ");
    fireEvent.keyDown(input, { code: "Numpad2", key: "2" });
    expect(drawnNotes()).toEqual(["壱"]);
  });

  it("キー割り当てを変えると、新しいキーで入力できる", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "キー割り当て" }));
    const row = screen.getByText("絃 壱").closest("tr")!;
    fireEvent.click(row.querySelector("button.key")!);
    press("KeyX", "x");
    expect(row.querySelector("button.key")!.textContent).toBe("X");
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

    press("KeyX", "x");
    press("Numpad1", "1");
    expect(drawnNotes()).toEqual(["壱"]);
  });

  it("使用中のキーを割り当てようとすると確認が出る", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "キー割り当て" }));
    const row = screen.getByText("絃 壱").closest("tr")!;
    fireEvent.click(row.querySelector("button.key")!);
    press("KeyP", "p");
    expect(screen.getByText(/割り当て済みです/)).toBeTruthy();
    expect(row.querySelector("button.key")!.textContent).toBe("テンキー1");
    fireEvent.click(screen.getByRole("button", { name: "割り当て直す" }));
    expect(row.querySelector("button.key")!.textContent).toBe("P");
  });

  it("口唱歌：入力欄を出してクリックし、文字を打って Enter で次の音符へ進む", () => {
    render(<App />);
    press("Numpad5", "5");
    press("NumpadEnter", "Enter");
    press("Numpad3", "3");
    expect(document.querySelectorAll(".hit-lane")).toHaveLength(0);

    fireEvent.click(screen.getByLabelText("口唱歌・補助行の入力欄"));
    const lanes = document.querySelectorAll(".hit-lane");
    expect(lanes.length).toBeGreaterThan(0);
    // jsdom には座標がないので、クリック位置は小節の左端（拍位置 0）になる
    fireEvent.mouseDown(lanes[0]!, { clientX: 0 });

    const type = (text: string) => {
      const input = screen.getByLabelText("口唱歌") as HTMLInputElement;
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(screen.getByLabelText("口唱歌"), { key: "Enter" });
    };
    type("テーン");
    type("");
    type("トン");
    const drawn = [...document.querySelectorAll(".page-art #shoka text")].map((el) => el.textContent);
    expect(drawn).toEqual(["テーン", "トン"]);
    // 音符の入力には影響しない
    expect(drawnNotes()).toEqual(["五", "三"]);
  });

  it("スパン：始点に印を付けて、終点で波線を選ぶ", () => {
    render(<App />);
    press("NumpadSubtract", "-");
    press("KeyM", "m");
    press("Numpad6", "6");
    fireEvent.click(screen.getByRole("button", { name: "波線" }));
    expect(screen.getByPlaceholderText("終点の文字")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("終点の文字"), { target: { value: "ラ" } });
    const texts = [...document.querySelectorAll(".page-art #techniques text")].map((el) => el.textContent);
    expect(texts).toEqual(["サ", "ラ"]);
  });

  it("補助行：曲の設定で歌詞の行を足すと、入力欄が出る", () => {
    render(<App />);
    press("Numpad7", "7");
    fireEvent.click(screen.getByRole("button", { name: "曲の設定" }));
    fireEvent.click(screen.getByRole("button", { name: "歌詞を追加" }));
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    fireEvent.click(screen.getByLabelText("口唱歌・補助行の入力欄"));
    // 口唱歌の行と歌詞の行
    expect(document.querySelectorAll(".hit-lane")).toHaveLength(2);
    fireEvent.mouseDown(document.querySelectorAll(".hit-lane")[1]!, { clientX: 0 });
    fireEvent.change(screen.getByLabelText("補助行の文字"), { target: { value: "た" } });
    fireEvent.click(screen.getByLabelText("延ばし線"));
    fireEvent.click(screen.getByRole("button", { name: "確定" }));
    expect(document.querySelector(".page-art g[id^='aux-'] text")?.textContent).toBe("た");
    expect(document.querySelectorAll(".page-art g[id^='aux-'] line")).toHaveLength(1);
  });

  it("操作パネルの幅を、境目のドラッグと矢印キーで変えられ、開き直しても残る", () => {
    const first = render(<App />);
    const width = () => (document.querySelector(".sidebar") as HTMLElement).style.width;
    expect(width()).toBe("300px");

    const splitter = screen.getByRole("separator", { name: "操作パネルの幅" });
    // 右側の枠なので、左へドラッグすると広がる
    fireEvent.mouseDown(splitter, { clientX: 1000 });
    fireEvent.mouseMove(window, { clientX: 900 });
    expect(width()).toBe("400px");
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 500 });
    expect(width()).toBe("400px");

    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(width()).toBe("380px");
    // 下限より狭くはならない
    fireEvent.mouseDown(splitter, { clientX: 0 });
    fireEvent.mouseMove(window, { clientX: 5000 });
    fireEvent.mouseUp(window);
    expect(width()).toBe("200px");

    first.unmount();
    render(<App />);
    expect(width()).toBe("200px");
  });

  it("何も設定していなければ、絃名は元譜から起こした字形で描く", () => {
    saveDefaultStyle(undefined);
    render(<App />);
    press("Numpad5", "5");
    expect(document.querySelectorAll(".page-art #notes-koto text")).toHaveLength(0);
    expect(document.querySelectorAll(".page-art #notes-koto path")).toHaveLength(1);
  });

  it("寸法の設定を既定として保存すると、新規の楽譜にも、開き直したあとにも反映される", () => {
    const noteSize = () => Number(document.querySelector(".page-art #notes-koto text")?.getAttribute("font-size"));
    const first = render(<App />);
    press("Numpad5", "5");
    expect(noteSize()).toBe(6.5);

    fireEvent.click(screen.getByRole("button", { name: "曲の設定" }));
    fireEvent.change(screen.getByLabelText("絃名の大きさ（mm）"), { target: { value: "8" } });
    expect(noteSize()).toBe(8);
    fireEvent.click(screen.getByRole("button", { name: "いまの設定を既定として保存" }));
    expect(screen.getByRole("status").textContent).toContain("既定として保存しました");
    expect(loadDefaultStyle()).toEqual({ glyphs: null, noteSize: 8 });
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

    // 新規の楽譜：保存した大きさで始まる
    const confirm = window.confirm;
    window.confirm = () => true;
    fireEvent.click(screen.getByRole("button", { name: "新規" }));
    window.confirm = confirm;
    press("Numpad3", "3");
    expect(noteSize()).toBe(8);

    // 自動保存が消えた状態で開き直しても、保存した大きさで始まる
    first.unmount();
    localStorage.removeItem("koto-score-editor.autosave");
    render(<App />);
    press("Numpad1", "1");
    expect(noteSize()).toBe(8);
  });

  it("別の設定の楽譜に、保存してある既定の設定を読み込める", () => {
    saveDefaultStyle({ glyphs: null, noteSize: 7.5, systemPitch: 30 });
    localStorage.setItem("koto-score-editor.autosave", JSON.stringify({
      format: "koto-score", version: 1, meta: { title: "別の曲" },
      settings: { beatsPerMeasure: "4", measuresPerSystem: 4, systemsPerPage: 7, style: { glyphs: null, noteSize: 5 } },
      parts: [{ id: "koto", weight: "bold" }], tracks: [], spans: [],
      measures: [{ id: "m1", content: { koto: { events: [{ id: "e1", type: "note", strings: [{ n: 5 }], lines: 0, dots: 0 }] } } }],
    }));
    render(<App />);
    const noteSize = () => Number(document.querySelector(".page-art #notes-koto text")?.getAttribute("font-size"));
    expect(noteSize()).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "曲の設定" }));
    fireEvent.click(screen.getByRole("button", { name: "既定の設定を読み込む" }));
    expect(noteSize()).toBe(7.5);
    expect((screen.getByLabelText(/^段の送り/) as HTMLInputElement).value).toBe("30");
    // 曲ごとの内容（曲名）は変わらない
    expect((screen.getByLabelText("曲名") as HTMLInputElement).value).toBe("別の曲");
  });
});
