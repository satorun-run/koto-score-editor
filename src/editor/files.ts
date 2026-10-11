// 保存・読み込み・書き出し。SPEC.md 6.4 に対応する。

import { parseScore } from "../model/load";
import type { Score } from "../model/types";

const AUTOSAVE_KEY = "koto-score-editor.autosave";

export function loadAutosave(): Score | null {
  try {
    const saved = globalThis.localStorage?.getItem(AUTOSAVE_KEY);
    return saved ? parseScore(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

export function saveAutosave(score: Score): void {
  try {
    globalThis.localStorage?.setItem(AUTOSAVE_KEY, JSON.stringify(score));
  } catch {
    // 保存できなくても編集は続けられる
  }
}

/** ブラウザの「ダウンロード」として保存する（保存先はブラウザの設定に従う） */
export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 保存先を選ぶダイアログ（File System Access API）。Edge・Chrome にあり、Safari（iPad）にはない
interface WritableFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  name: string;
  createWritable(): Promise<WritableFile>;
}
interface DirectoryHandle {
  name: string;
  getFileHandle(name: string, options: { create: boolean }): Promise<FileHandle>;
}
interface PickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileHandle>;
  showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<DirectoryHandle>;
}

export type SaveResult =
  | { status: "saved"; name: string }
  /** 保存先を選べない環境なので、ブラウザのダウンロードとして保存した */
  | { status: "downloaded"; name: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/**
 * ファイルを1つ保存する。保存先とファイル名を選ぶダイアログを出す。
 * ダイアログを出せない環境では、ブラウザのダウンロードとして保存する
 */
export async function saveTextFile(
  filename: string,
  text: string,
  type: string,
  description: string,
): Promise<SaveResult> {
  const picker = (window as unknown as PickerWindow).showSaveFilePicker;
  if (!picker) {
    downloadText(filename, text, type);
    return { status: "downloaded", name: filename };
  }
  try {
    // 拡張子は、最後の「.」から後ろ（.koto.json なら .json）
    const extension = filename.slice(filename.lastIndexOf("."));
    const handle = await picker.call(window, { suggestedName: filename, types: [{ description, accept: { [type]: [extension] } }] });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return { status: "saved", name: handle.name };
  } catch (error) {
    if (isAbort(error)) return { status: "cancelled" };
    return { status: "failed", message: error instanceof Error ? error.message : "" };
  }
}

/**
 * 複数のファイルをまとめて保存する。保存先のフォルダを選ぶダイアログを出す。
 * ダイアログを出せない環境では、1つずつブラウザのダウンロードとして保存する
 */
export async function saveTextFiles(files: { name: string; text: string }[], type: string): Promise<SaveResult> {
  const picker = (window as unknown as PickerWindow).showDirectoryPicker;
  if (!picker) {
    // 続けて保存するとブラウザが取りこぼすので少し間を空ける
    files.forEach((file, i) => setTimeout(() => downloadText(file.name, file.text, type), i * 300));
    return { status: "downloaded", name: `${files.length} 個のファイル` };
  }
  try {
    const dir = await picker.call(window, { mode: "readwrite" });
    for (const file of files) {
      const handle = await dir.getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.text);
      await writable.close();
    }
    return { status: "saved", name: dir.name };
  } catch (error) {
    if (isAbort(error)) return { status: "cancelled" };
    return { status: "failed", message: error instanceof Error ? error.message : "" };
  }
}

/** ファイル名に使えない文字を除く */
export function fileBase(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "").trim() || "score";
}

export async function readScoreFile(file: File): Promise<Score> {
  return parseScore(JSON.parse(await file.text()));
}

/** 保存の結果を、画面に出す短い文にする。取り消したときは空 */
export function describeSave(result: SaveResult): string {
  switch (result.status) {
    case "saved":
      return `「${result.name}」に保存しました。`;
    case "downloaded":
      return `${result.name} を、ブラウザのダウンロード先に保存しました。`;
    case "cancelled":
      return "";
    case "failed":
      return `保存できませんでした。${result.message}`;
  }
}

/** 設定ファイルなどの小さな書き出し用：保存先を選んで保存し、失敗したときだけ知らせる */
export async function exportTextFile(filename: string, text: string, description: string): Promise<void> {
  const result = await saveTextFile(filename, text, "application/json", description);
  if (result.status === "failed") window.alert(describeSave(result));
}
