import { useRef, useState } from "react";
import { NumInput } from "./NumInput";
import type { Doc } from "../editor/commands";
import { importMeasures, readSource, type ImportMode, type LoadedSource } from "../editor/importer";
import { validateScore } from "../model/validate";

interface Props {
  doc: Doc;
  apply: (fn: (doc: Doc) => Doc | null) => void;
  onClose: () => void;
}

const MODES: [ImportMode, string][] = [
  ["append", "楽譜の末尾に追加する"],
  ["insertAfter", "カーソルのある小節の後ろに挿入する"],
  ["replace", "カーソルのある小節から、同じ数の小節を置き換える"],
];

/** 下書き（.koto.json または下書き記法の .txt）から、小節の範囲を取り込む */
export function ImportDialog({ doc, apply, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [source, setSource] = useState<LoadedSource | null>(null);
  const [failure, setFailure] = useState("");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [mode, setMode] = useState<ImportMode>("append");
  const [withMeta, setWithMeta] = useState(false);

  const isBlank = doc.score.measures.every((m) => Object.values(m.content).every((pm) => "events" in pm && pm.events.length === 0));

  const load = async (file: File) => {
    setFileName(file.name);
    try {
      const loaded = readSource(await file.text());
      setSource(loaded);
      setFailure("");
      setFrom(1);
      setTo(loaded.score.measures.length);
      setWithMeta(isBlank);
    } catch (error) {
      setSource(null);
      setFailure(`読めませんでした。${error instanceof Error ? error.message : ""}`);
    }
  };

  const count = source?.score.measures.length ?? 0;
  const issues = source ? validateScore(source.score) : [];
  const valid = !!source && count > 0 && from >= 1 && to <= count && from <= to;
  const run = () => {
    if (!source || !valid) return;
    apply((d) => importMeasures(d, source.score, { from: from - 1, to: to - 1, mode, withMeta }));
    onClose();
  };

  return (
    <div className="dialog-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-label="下書きの取り込み">
        <header>
          <h1>下書きの取り込み</h1>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className="dialog-body fields wide">
          <p className="hint">
            別の楽譜ファイル（.koto.json）や、下書き記法のテキスト（.draft.txt）から、小節を取り込みます。
            取り込みは「取り消し」で戻せます。
          </p>
          <div className="inline">
            <button type="button" onClick={() => fileRef.current?.click()}>ファイルを選ぶ</button>
            <span>{fileName || "未選択"}</span>
            <input ref={fileRef} type="file" accept=".json,.txt" hidden aria-label="取り込むファイル" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
          </div>
          {failure && <p className="conflict">{failure}</p>}

          {source && (
            <>
              <p>
                「{source.score.meta.title}」 {count} 小節、{source.score.parts.length} パート。
                {issues.length === 0 ? "検算の警告はありません。" : `検算の警告が ${issues.length} 件あります（取り込み後に警告一覧で確認できます）。`}
              </p>
              {source.errors.length > 0 && (
                <div className="conflict">
                  <p>下書きの書き方に誤りが {source.errors.length} 件あります。該当の音符は取り込まれません。</p>
                  <ul>
                    {source.errors.slice(0, 20).map((e, i) => <li key={i}>{e.line}行目：{e.message}</li>)}
                  </ul>
                </div>
              )}
              <h2>取り込む範囲</h2>
              <div className="inline">
                <label>
                  最初の小節
                  <NumInput min={1} max={count} value={from} onChange={(e) => setFrom(Math.floor(Number(e.target.value)))} />
                </label>
                <label>
                  最後の小節
                  <NumInput min={1} max={count} value={to} onChange={(e) => setTo(Math.floor(Number(e.target.value)))} />
                </label>
              </div>
              <h2>入れる場所</h2>
              {isBlank ? (
                <p className="hint">今の楽譜にはまだ何も入っていないので、取り込んだ小節で置き換えます。</p>
              ) : (
                MODES.map(([value, label]) => (
                  <label key={value} className="check">
                    <input type="radio" name="import-mode" checked={mode === value} onChange={() => setMode(value)} />
                    {label}
                  </label>
                ))
              )}
              <label className="check">
                <input type="checkbox" checked={withMeta} onChange={(e) => setWithMeta(e.target.checked)} />
                曲名・調弦表・拍数・段組などの設定も取り込む（今の設定を上書きします）
              </label>
              <button type="button" className="start" disabled={!valid} onClick={run}>
                {valid ? `${to - from + 1} 小節を取り込む` : "範囲が正しくありません"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
