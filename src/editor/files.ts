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

export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ファイル名に使えない文字を除く */
export function fileBase(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "").trim() || "score";
}

export async function readScoreFile(file: File): Promise<Score> {
  return parseScore(JSON.parse(await file.text()));
}
