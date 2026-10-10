// drafts/ の下書き（*.draft.txt）を楽譜データ（*.koto.json）に変換し、検算結果を表示する。
// 使い方: npm run draft

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseDraft } from "../src/model/draft";
import { validateScore } from "../src/model/validate";

const dir = new URL("../drafts/", import.meta.url);

for (const file of readdirSync(dir)) {
  if (!file.endsWith(".draft.txt")) continue;
  const { score, errors, measureLines } = parseDraft(readFileSync(new URL(file, dir), "utf8"));
  const issues = validateScore(score);
  const out = file.replace(/\.draft\.txt$/, ".koto.json");
  writeFileSync(new URL(out, dir), JSON.stringify(score, null, 2));
  console.log(`${file} → ${out}：${score.measures.length}小節、記法の誤り ${errors.length}件、検算 ${issues.length}件`);
  for (const e of errors) console.log(`  ${e.line}行目：${e.message}`);
  for (const i of issues) {
    const line = i.measureIndex === undefined ? "" : `${measureLines[i.measureIndex]}行目（小節${i.measureIndex + 1}）：`;
    console.log(`  ${line}${i.message}`);
  }
}
