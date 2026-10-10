import { useMemo, useState } from "react";
import { downloadText, fileBase } from "../editor/files";
import { layoutScore } from "../layout/layout";
import { resolveStyle } from "../layout/style";
import type { Score } from "../model/types";
import { renderSvg, renderSystemSvg } from "../render/svg";

interface Props {
  score: Score;
  onClose: () => void;
}

type Range = "all" | "pages" | "systems";

/** "1-3,5" のような指定を、0始まりのページ番号の並びにする。書き方が正しくなければ null */
export function parsePageList(text: string, pageCount: number): number[] | null {
  const pages = new Set<number>();
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const from = Number(m[1]);
    const to = Number(m[2] ?? m[1]);
    if (from < 1 || to > pageCount || from > to) return null;
    for (let p = from; p <= to; p++) pages.add(p - 1);
  }
  return pages.size > 0 ? [...pages].sort((a, b) => a - b) : null;
}

/** SVGの書き出し。SPEC.md 7.1 */
export function ExportDialog({ score, onClose }: Props) {
  const [range, setRange] = useState<Range>("all");
  const [pageText, setPageText] = useState("1");
  const [header, setHeader] = useState(() => resolveStyle(score).header);

  // 入力用の空行を含まない、出力用の組版
  const layout = useMemo(() => layoutScore(score, { header }), [score, header]);
  const style = useMemo(() => resolveStyle(score, { header }), [score, header]);
  const pageCount = layout.pages.length;
  const systemCount = layout.pages.reduce((n, p) => n + p.systems.length, 0);
  const pages = range === "pages" ? parsePageList(pageText, pageCount) : layout.pages.map((_, i) => i);

  const files = (): { name: string; svg: string }[] => {
    const base = fileBase(score.meta.title);
    if (range === "systems") {
      let n = 0;
      return layout.pages.flatMap((page) =>
        page.systems.map((_, si) => ({ name: `${base}-s${String(++n).padStart(2, "0")}.svg`, svg: renderSystemSvg(page, si, style) })),
      );
    }
    return (pages ?? []).map((pi) => ({ name: `${base}-p${pi + 1}.svg`, svg: renderSvg(layout.pages[pi]!, style) }));
  };
  const count = range === "systems" ? systemCount : (pages?.length ?? 0);

  const run = () => {
    // 続けて保存するとブラウザが取りこぼすので少し間を空ける
    files().forEach((file, i) => setTimeout(() => downloadText(file.name, file.svg, "image/svg+xml"), i * 300));
    onClose();
  };

  return (
    <div className="dialog-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-label="SVG書き出し">
        <header>
          <h1>SVG書き出し</h1>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className="dialog-body fields wide">
          <p className="hint">
            Illustrator で開けるSVGを書き出します。全 {pageCount} ページ、{systemCount} 段。
            要素は種類ごとのグループ（barlines、notes、durations など）に分かれます。
          </p>
          <h2>範囲</h2>
          <label className="check">
            <input type="radio" name="export-range" checked={range === "all"} onChange={() => setRange("all")} />
            全ページ（ページごとに1ファイル）
          </label>
          <label className="check">
            <input type="radio" name="export-range" checked={range === "pages"} onChange={() => setRange("pages")} />
            ページを指定
            <input
              aria-label="ページの指定"
              className="short"
              value={pageText}
              placeholder="例：1-3,5"
              disabled={range !== "pages"}
              onChange={(e) => setPageText(e.target.value)}
            />
          </label>
          <label className="check">
            <input type="radio" name="export-range" checked={range === "systems"} onChange={() => setRange("systems")} />
            段ごとに分ける（1段1ファイル。DTP側で自由に並べたいとき）
          </label>
          <h2>内容</h2>
          <label className="check">
            <input type="checkbox" checked={header} disabled={range === "systems"} onChange={(e) => setHeader(e.target.checked)} />
            見出し（曲名・調弦表など）を含める
          </label>
          <p className="hint">
            文字はテキストのまま出力します。同じフォントが入っているPCの Illustrator では、開いたあと
            「書式 → アウトラインを作成」で図形にできます。
          </p>
          {count > 1 && <p className="hint">{count} 個のファイルを続けて保存します。ブラウザが「複数のファイルのダウンロード」の許可を求めたら、許可してください。</p>}
          <button type="button" className="start" disabled={count === 0} onClick={run}>
            {count === 0 ? "ページの指定が正しくありません" : `${count} ファイルを書き出す`}
          </button>
        </div>
      </div>
    </div>
  );
}
