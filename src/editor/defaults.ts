// 寸法・書体・字形の設定を、既定として保存する。SPEC.md 6.4 に対応する。
// 保存した設定は、新しく作る楽譜と、下書きを取り込む楽譜の初期値になる。

import type { Style } from "../layout/style";

const STORAGE_KEY = "koto-score-editor.default-style";

/** 設定ファイル（.koto-settings.json）の形 */
export interface SettingsFile {
  format: "koto-settings";
  version: 1;
  style: Partial<Style>;
}

export function loadDefaultStyle(): Partial<Style> | undefined {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    return saved ? parseSettings(JSON.parse(saved)) ?? undefined : undefined;
  } catch {
    return undefined;
  }
}

/** 既定として保存する。undefined を渡すと、保存した既定を消す */
export function saveDefaultStyle(style: Partial<Style> | undefined): boolean {
  try {
    if (style === undefined) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(toSettingsFile(style)));
    return true;
  } catch {
    return false;
  }
}

export function toSettingsFile(style: Partial<Style>): SettingsFile {
  return { format: "koto-settings", version: 1, style };
}

/** 設定ファイルとして読んだ値から、設定を取り出す。形が違えば null */
export function parseSettings(data: unknown): Partial<Style> | null {
  if (typeof data !== "object" || data === null) return null;
  const file = data as Partial<SettingsFile>;
  if (file.format !== "koto-settings" || typeof file.style !== "object" || file.style === null) return null;
  return file.style;
}
