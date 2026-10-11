// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeSave, saveTextFile, saveTextFiles } from "./files";

type PickerWindow = Window & { showSaveFilePicker?: unknown; showDirectoryPicker?: unknown };
const win = window as PickerWindow;

function fakeFile(name: string, written: Record<string, string>) {
  return {
    name,
    createWritable: async () => ({
      write: async (data: string) => { written[name] = data; },
      close: async () => {},
    }),
  };
}

afterEach(() => {
  delete win.showSaveFilePicker;
  delete win.showDirectoryPicker;
  vi.restoreAllMocks();
});

describe("保存先を選んで保存する", () => {
  it("保存のダイアログで選んだ場所に書き、選んだファイル名を返す", async () => {
    const written: Record<string, string> = {};
    const picker = vi.fn(async () => fakeFile("六段（校正中）.koto.json", written));
    win.showSaveFilePicker = picker;
    const result = await saveTextFile("六段の調.koto.json", "{}", "application/json", "箏譜エディタの楽譜");
    expect(picker).toHaveBeenCalledWith({
      suggestedName: "六段の調.koto.json",
      types: [{ description: "箏譜エディタの楽譜", accept: { "application/json": [".json"] } }],
    });
    expect(written).toEqual({ "六段（校正中）.koto.json": "{}" });
    expect(describeSave(result)).toBe("「六段（校正中）.koto.json」に保存しました。");
  });

  it("ダイアログで取り消したら、何も保存せず、知らせも出さない", async () => {
    win.showSaveFilePicker = async () => { throw new DOMException("cancel", "AbortError"); };
    const result = await saveTextFile("a.koto.json", "{}", "application/json", "楽譜");
    expect(result).toEqual({ status: "cancelled" });
    expect(describeSave(result)).toBe("");
  });

  it("書き込めなかったら、失敗として知らせる", async () => {
    win.showSaveFilePicker = async () => { throw new Error("書き込みが許可されていません"); };
    const result = await saveTextFile("a.koto.json", "{}", "application/json", "楽譜");
    expect(describeSave(result)).toBe("保存できませんでした。書き込みが許可されていません");
  });

  it("保存先を選べないブラウザでは、ダウンロードとして保存する", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const result = await saveTextFile("a.koto.json", "{}", "application/json", "楽譜");
    expect(click).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "downloaded", name: "a.koto.json" });
  });

  it("複数のファイルは、選んだフォルダにまとめて書く", async () => {
    const written: Record<string, string> = {};
    win.showDirectoryPicker = async () => ({
      name: "入稿用",
      getFileHandle: async (name: string) => fakeFile(name, written),
    });
    const result = await saveTextFiles([{ name: "p1.svg", text: "<svg/>" }, { name: "p2.svg", text: "<svg></svg>" }], "image/svg+xml");
    expect(written).toEqual({ "p1.svg": "<svg/>", "p2.svg": "<svg></svg>" });
    expect(result).toEqual({ status: "saved", name: "入稿用" });
  });
});
