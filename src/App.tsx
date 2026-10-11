import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { blankScore, currentEvent, moveLaneItem, patchScore, putLaneItem } from "./editor/commands";
import { loadDefaultStyle } from "./editor/defaults";
import { describeSave, fileBase, loadAutosave, readScoreFile, saveAutosave, saveTextFile } from "./editor/files";
import { findAction, loadKeymap, saveKeymap, type Keymap } from "./editor/keymap";
import { initialState, reducer } from "./editor/store";
import { layoutScore } from "./layout/layout";
import { resolveStyle, type Style } from "./layout/style";
import { parseScore } from "./model/load";
import { validateScore } from "./model/validate";
import { ExportDialog } from "./ui/ExportDialog";
import { GlyphDialog } from "./ui/GlyphDialog";
import { ImportDialog } from "./ui/ImportDialog";
import { KeymapDialog } from "./ui/KeymapDialog";
import { INITIAL_REF, ReferenceBar, ReferencePane, type RefState } from "./ui/Reference";
import { ScoreDialog } from "./ui/ScoreDialog";
import { ScoreView } from "./ui/ScoreView";
import { Sidebar, type IssueItem } from "./ui/Sidebar";
import { Splitter } from "./ui/Splitter";

const LINE_NAMES = ["四分", "八分", "十六分", "三十二分"];

/** 左右の枠の幅（px）。ドラッグで変えた幅を覚えておく */
interface Panes {
  reference: number;
  sidebar: number;
}
const PANES_KEY = "koto-score-editor.panes";
const DEFAULT_PANES: Panes = { reference: 520, sidebar: 300 };

function loadPanes(): Panes {
  try {
    const saved = JSON.parse(localStorage.getItem(PANES_KEY) ?? "null") as Partial<Panes> | null;
    const pick = (value: unknown, fallback: number) => (typeof value === "number" && value >= 100 && value <= 3000 ? value : fallback);
    return { reference: pick(saved?.reference, DEFAULT_PANES.reference), sidebar: pick(saved?.sidebar, DEFAULT_PANES.sidebar) };
  } catch {
    return DEFAULT_PANES;
  }
}

/** 文字入力中の欄では、キー割り当てを働かせない */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(loadAutosave() ?? blankScore(loadDefaultStyle())));
  const [keymap, setKeymap] = useState<Keymap>(() => loadKeymap());
  const [zoom, setZoom] = useState(5);
  const [dialog, setDialog] = useState<"keymap" | "score" | "import" | "export" | "glyphs" | null>(null);
  const [ref, setRef] = useState<RefState>(INITIAL_REF);
  /** 保存の結果など、下の帯に出す知らせ */
  const [notice, setNotice] = useState("");
  /** 口唱歌・補助行の、まだ何も入っていない行も入力用に表示する */
  const [panes, setPanes] = useState(loadPanes);
  useEffect(() => {
    try {
      localStorage.setItem(PANES_KEY, JSON.stringify(panes));
    } catch {
      // 保存できなくても編集は続けられる
    }
  }, [panes]);
  const [showLanes, setShowLanes] = useState(() => import.meta.env.DEV && new URLSearchParams(location.search).has("lanes"));
  const fileRef = useRef<HTMLInputElement>(null);
  const { score, cursor } = state.doc;

  const style = useMemo(() => resolveStyle(score), [score]);
  const layout = useMemo(() => {
    const forceLanes = showLanes
      ? [...score.parts.map((p) => `shoka:${p.id}`), ...score.tracks.map((t) => `aux:${t.id}`)]
      : [];
    return layoutScore(score, {}, { forceLanes });
  }, [score, showLanes]);
  const issues = useMemo<IssueItem[]>(() => [...validateScore(score), ...layout.issues], [score, layout]);

  useEffect(() => saveAutosave(score), [score]);

  // 開発時のみ：?sample=rokudan-excerpt で samples/ の楽譜を、?sample=drafts/rokudan で drafts/ の楽譜を開く。
  // ?ref=side または ?ref=overlay で scans/rokudan の元画像も読み込む
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const params = new URLSearchParams(location.search);
    const mode = params.get("ref");
    if (mode === "side" || mode === "overlay") {
      const images = [1, 2, 3, 4, 5, 6].map((n) => ({ name: `p${n}.jpg`, url: `/scans/rokudan/p${n}.jpg` }));
      setRef((r) => ({ ...r, images, mode }));
    }
    const name = params.get("sample");
    if (!name) return;
    fetch(name.includes("/") ? `/${name}.koto.json` : `/samples/${name}.koto.json`)
      .then((res) => res.json())
      .then((data) => dispatch({ type: "load", score: parseScore(data) }))
      .catch(() => window.alert(`サンプル「${name}」を開けませんでした。`));
  }, []);
  useEffect(() => saveKeymap(keymap), [keymap]);

  useEffect(() => {
    if (dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.isComposing) return;
      const id = findAction(keymap, e);
      if (!id) return;
      e.preventDefault();
      dispatch({ type: "perform", id });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keymap, dialog]);

  const setStyleValue = <K extends keyof Style>(key: K, value: Style[K] | undefined) =>
    dispatch({ type: "apply", fn: (doc) => patchScore(doc, (s) => { s.settings.style = { ...s.settings.style, [key]: value }; }) });

  const newScore = () => {
    if (window.confirm("新しい楽譜を始めます。今の楽譜は、保存していなければ失われます。")) {
      dispatch({ type: "load", score: blankScore(loadDefaultStyle()) });
    }
  };
  const openFile = async (file: File) => {
    try {
      dispatch({ type: "load", score: await readScoreFile(file) });
    } catch (error) {
      window.alert(`楽譜ファイルを読めませんでした。\n${error instanceof Error ? error.message : ""}`);
    }
  };
  const save = () => {
    // いま表示に使っている字形を楽譜ファイルに入れておく。字形を同梱していない環境（公開版・iPad）で開いても同じ形で表示できる
    const file = structuredClone(score);
    if (style.glyphs && file.settings.style?.glyphs === undefined) {
      file.settings.style = { ...file.settings.style, glyphs: style.glyphs };
    }
    void saveTextFile(`${fileBase(score.meta.title)}.koto.json`, JSON.stringify(file, null, 2), "application/json", "箏譜エディタの楽譜").then(
      (result) => setNotice(describeSave(result)),
    );
  };
  return (
    <div className="app">
      <header className="toolbar">
        <strong className="title">{score.meta.title}</strong>
        <button type="button" onClick={newScore}>新規</button>
        <button type="button" onClick={() => fileRef.current?.click()}>開く</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ""; }} />
        <button type="button" onClick={save} title="保存先とファイル名を選んで、楽譜をファイルに保存します">保存</button>
        <button type="button" onClick={() => setDialog("import")} title="別の楽譜ファイルや下書きから小節を取り込みます">下書きの取り込み</button>
        <button type="button" onClick={() => setDialog("export")} title="Illustrator で開けるSVGを書き出します">SVG書き出し</button>
        <button type="button" onClick={() => window.print()} title="ブラウザの印刷機能で、紙やPDFに出します（確認用）">印刷・PDF</button>
        <span className="gap" />
        <button type="button" disabled={state.past.length === 0} onClick={() => dispatch({ type: "perform", id: "undo" })}>取り消し</button>
        <button type="button" disabled={state.future.length === 0} onClick={() => dispatch({ type: "perform", id: "redo" })}>やり直し</button>
        <span className="gap" />
        <button type="button" onClick={() => setZoom((z) => Math.max(2, z - 1))} title="縮小">－</button>
        <span className="zoom">{Math.round((zoom / 5) * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(12, z + 1))} title="拡大">＋</button>
        <span className="gap" />
        <label className="toggle" title="口唱歌・歌詞などの、まだ何も入っていない行も表示して、クリックで入力できるようにします（出力には影響しません）">
          <input type="checkbox" checked={showLanes} onChange={(e) => setShowLanes(e.target.checked)} />
          口唱歌・補助行の入力欄
        </label>
        <span className="spacer" />
        <button type="button" onClick={() => setDialog("glyphs")} title="絃名を、フォントの文字の代わりに独自の字形で描きます">絃名の字形</button>
        <button type="button" onClick={() => setDialog("score")}>曲の設定</button>
        <button type="button" onClick={() => setDialog("keymap")}>キー割り当て</button>
      </header>

      <ReferenceBar
        state={ref}
        onChange={setRef}
        style={style}
        onStyle={setStyleValue}
      />

      <main className="workspace">
        <ReferencePane state={ref} width={panes.reference} />
        {ref.mode === "side" && ref.images.length > 0 && (
          <Splitter label="元画像の幅" value={panes.reference} min={160} max={1600} direction={1} onChange={(reference) => setPanes((p) => ({ ...p, reference }))} />
        )}
        <div className={showLanes ? "canvas lanes" : "canvas"}>
          <ScoreView
            score={score}
            layout={layout}
            style={style}
            cursor={cursor}
            mark={state.mark}
            overlay={ref.mode === "overlay" ? ref : null}
            keymap={keymap}
            zoom={zoom}
            onCursor={(c, extend) => {
              // Shift+クリック：いまの音符をスパンの始点にして、クリックした音符へ移る
              const from = extend ? currentEvent(state.doc) : null;
              if (from) dispatch({ type: "setMark", eventId: from.id });
              dispatch({ type: "setCursor", cursor: c });
            }}
            onPutItem={(lane, mi, index, item) => dispatch({ type: "apply", fn: (doc) => putLaneItem(doc, lane, mi, index, item) })}
            onMoveItem={(lane, fromMi, index, toMi, at) => dispatch({ type: "apply", fn: (doc) => moveLaneItem(doc, lane, fromMi, index, toMi, at) })}
          />
        </div>
        <Splitter label="操作パネルの幅" value={panes.sidebar} min={200} max={900} direction={-1} onChange={(sidebar) => setPanes((p) => ({ ...p, sidebar }))} />
        <Sidebar doc={state.doc} inputLines={state.inputLines} mark={state.mark} keymap={keymap} issues={issues} dispatch={dispatch} width={panes.sidebar} />
      </main>

      <footer className="status">
        <span>小節 {cursor.mi + 1} / {score.measures.length}</span>
        {score.parts.length > 1 && <span>パート：{score.parts.find((p) => p.id === cursor.partId)?.name ?? cursor.partId}</span>}
        <span>次に入れる音価：{LINE_NAMES[state.inputLines]}</span>
        {notice && <span className="notice" role="status">{notice}</span>}
        {state.chordArmed && <span className="armed">合せ爪：次に押す絃を重ねます</span>}
        {cursor.ossia !== undefined && <span className="armed">代替譜を編集中（譜面の音符をクリックで戻る）</span>}
        <span>{layout.pages.length} ページ</span>
        <span className="spacer" />
        <span>{issues.length === 0 ? "警告なし" : `警告 ${issues.length} 件`}</span>
      </footer>

      {dialog === "glyphs" && <GlyphDialog style={style} onStyle={setStyleValue} onClose={() => setDialog(null)} />}
      {dialog === "export" && <ExportDialog score={score} onDone={setNotice} onClose={() => setDialog(null)} />}
      {dialog === "import" && <ImportDialog doc={state.doc} apply={(fn) => dispatch({ type: "apply", fn })} onClose={() => setDialog(null)} />}
      {dialog === "keymap" && <KeymapDialog keymap={keymap} onChange={setKeymap} onClose={() => setDialog(null)} />}
      {dialog === "score" && (
        <ScoreDialog doc={state.doc} apply={(fn) => dispatch({ type: "apply", fn })} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
