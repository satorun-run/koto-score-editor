import type { Score } from "./types";

/** JSONとして読んだ値が楽譜データの外形を満たすか確かめる。中身の検査は validateScore で行う */
export function parseScore(data: unknown): Score {
  if (typeof data !== "object" || data === null) {
    throw new Error("楽譜データではありません");
  }
  const score = data as Partial<Score>;
  if (score.format !== "koto-score") {
    throw new Error("format が koto-score ではありません");
  }
  if (score.version !== 1) {
    throw new Error(`未対応のバージョンです: ${String(score.version)}`);
  }
  for (const key of ["parts", "tracks", "measures", "spans"] as const) {
    if (!Array.isArray(score[key])) {
      throw new Error(`${key} がありません`);
    }
  }
  if (typeof score.meta !== "object" || score.meta === null) {
    throw new Error("meta がありません");
  }
  if (typeof score.settings !== "object" || score.settings === null) {
    throw new Error("settings がありません");
  }
  return score as Score;
}
