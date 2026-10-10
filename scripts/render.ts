// samples/ と drafts/ の楽譜データを out/ にSVGで書き出す。
// 使い方: npm run render [-- --font "Yu Mincho"] [-- --glyphs --suffix -glyphs]

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { layoutScore } from "../src/layout/layout";
import { resolveStyle, type Style } from "../src/layout/style";
import { parseScore } from "../src/model/load";
import { validateScore } from "../src/model/validate";
import { renderSvg } from "../src/render/svg";

const root = new URL("../", import.meta.url);
const samples = new URL("samples/", root);
const out = new URL("out/", root);
mkdirSync(out, { recursive: true });

const overrides: Partial<Style> = {};
const fontArg = process.argv.indexOf("--font");
if (fontArg >= 0 && process.argv[fontArg + 1]) {
  const family = process.argv[fontArg + 1]!;
  overrides.fontMain = { family, weight: 700 };
  overrides.fontSub = { family, weight: 400 };
}
// --glyphs を付けると、元譜から起こした字形で描く
if (process.argv.includes("--glyphs")) {
  overrides.glyphs = JSON.parse(readFileSync(new URL("glyphs/rokudan-traced.glyphs.json", root), "utf8"));
}
const suffixArg = process.argv.indexOf("--suffix");
const suffix = suffixArg >= 0 ? (process.argv[suffixArg + 1] ?? "") : "";

const inputs = [samples, new URL("drafts/", root)].flatMap((dir) =>
  readdirSync(dir).filter((f) => f.endsWith(".koto.json")).map((f) => new URL(f, dir)),
);
for (const input of inputs) {
  const name = decodeURIComponent(input.pathname.split("/").pop()!).replace(/\.koto\.json$/, "");
  const score = parseScore(JSON.parse(readFileSync(input, "utf8")));
  const issues = validateScore(score);
  const layout = layoutScore(score, overrides);
  const st = resolveStyle(score, overrides);
  layout.pages.forEach((page, i) => {
    writeFileSync(new URL(`${name}${suffix}-p${i + 1}.svg`, out), renderSvg(page, st, { background: true }));
  });
  console.log(`${name}: ${layout.pages.length}ページ、検算 ${issues.length}件、配置 ${layout.issues.length}件`);
  for (const issue of [...issues, ...layout.issues]) console.log(`  - ${issue.message}`);
}

// 書き出したSVGをまとめて見るためのページ
const svgs = readdirSync(out).filter((f) => f.endsWith(".svg")).sort();
const body = svgs.map((f) => `<h2>${f}</h2>\n<img src="${f}">`).join("\n");
writeFileSync(
  new URL("index.html", out),
  `<!doctype html>\n<meta charset="utf-8">\n<title>描画確認</title>\n<style>body{font-family:sans-serif;background:#ddd;margin:16px}h2{font-size:14px;margin:24px 0 4px}img{background:#fff;border:1px solid #999;width:180mm}</style>\n${body}\n`,
);
