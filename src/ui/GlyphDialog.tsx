import { useRef, useState } from "react";
import { downloadText } from "../editor/files";
import { parseGlyphSet, parseSvgGlyph } from "../editor/glyphs";
import { TRACED_GLYPHS, type GlyphDef, type GlyphSet, type Style } from "../layout/style";

interface Props {
  style: Style;
  /** undefined を渡すと、その項目の指定を外して既定値に戻す */
  onStyle: <K extends keyof Style>(key: K, value: Style[K] | undefined) => void;
  onClose: () => void;
}

/** 字形を登録できるもの。key は字形セットの中での名前、label は画面に出す名前、sample はフォントで描くときの見本 */
const SLOTS = [
  ...[..."壱弐三四五六七八九十斗為巾"].map((name, i) => ({ key: `${i + 1}`, label: name, sample: name })),
  { key: "ワ", label: "ワ（輪連）", sample: "ワ" },
  { key: "ス", label: "ス（すくい爪）", sample: "ス" },
  { key: "○", label: "休符", sample: "○" },
  { key: "⁒", label: "前小節くり返し", sample: "⁒" },
];

function Preview({ glyph }: { glyph: GlyphDef }) {
  return (
    <svg className="glyph-preview" viewBox={glyph.box.join(" ")} aria-hidden="true">
      <path d={glyph.d} fillRule="evenodd" />
    </svg>
  );
}

/** 絃名の独自字形。SPEC.md 5.1 */
export function GlyphDialog({ style, onStyle, onClose }: Props) {
  const svgRef = useRef<HTMLInputElement>(null);
  const setRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState("1");
  const [messages, setMessages] = useState<string[]>([]);
  const set: GlyphSet = style.glyphs ?? { glyphs: {} };
  const count = Object.keys(set.glyphs).length;

  const update = (glyphs: GlyphSet["glyphs"], name = set.name) => {
    if (Object.keys(glyphs).length === 0) onStyle("glyphs", null);
    else onStyle("glyphs", name ? { name, glyphs } : { glyphs });
  };
  const useSet = (next: GlyphSet) => {
    setMessages([]);
    update(next.glyphs, next.name);
  };

  const loadSvg = async (file: File) => {
    const { glyph, messages: notes } = parseSvgGlyph(await file.text());
    setMessages(notes);
    if (glyph) update({ ...set.glyphs, [target]: glyph });
  };
  const loadSet = async (file: File) => {
    try {
      const next = parseGlyphSet(JSON.parse(await file.text()));
      if (next) useSet(next);
      else setMessages(["字形セットのファイルではありません。"]);
    } catch {
      setMessages(["字形セットのファイルを読めませんでした。"]);
    }
  };
  const remove = (key: string) => {
    const { [key]: _gone, ...rest } = set.glyphs;
    update(rest);
  };

  return (
    <div className="dialog-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-label="絃名の字形">
        <header>
          <h1>絃名の字形</h1>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className="dialog-tools">
          {TRACED_GLYPHS && (
            <button type="button" disabled={style.glyphs === TRACED_GLYPHS} onClick={() => { setMessages([]); onStyle("glyphs", undefined); }}>
              元譜から起こした字形に戻す（既定）
            </button>
          )}
          <button type="button" onClick={() => setRef.current?.click()}>字形セットを読み込む</button>
          <button type="button" disabled={count === 0} onClick={() => downloadText("koto.glyphs.json", JSON.stringify(set), "application/json")}>
            字形セットを書き出す
          </button>
          <button type="button" disabled={count === 0} onClick={() => { setMessages([]); onStyle("glyphs", null); }}>すべてフォントの文字にする</button>
          <input ref={setRef} type="file" accept=".json" hidden aria-label="字形セットのファイル" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadSet(f); e.target.value = ""; }} />
          <input ref={svgRef} type="file" accept=".svg,image/svg+xml" hidden aria-label="字形のSVGファイル" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadSvg(f); e.target.value = ""; }} />
        </div>
        {messages.length > 0 && (
          <div className="conflict">{messages.map((m, i) => <p key={i}>{m}</p>)}</div>
        )}
        <div className="dialog-body fields wide">
          <p className="hint">
            絃名と一部の記号（ワ・ス・休符・前小節くり返し）を、登録した形で描きます。登録していないものは、フォントの文字や既定の図形のままです。
            {set.name && <>　いまの字形：{set.name}</>}
          </p>
          <div className="glyph-grid">
            {SLOTS.map(({ key, label, sample }) => {
              const glyph = set.glyphs[key];
              return (
                <div key={key} className="glyph-cell">
                  <div className="glyph-box">
                    {glyph ? <Preview glyph={glyph} /> : <span className="glyph-font" style={{ fontFamily: style.fontMain.family, fontWeight: style.fontMain.weight }}>{sample}</span>}
                  </div>
                  <div className="glyph-name">{label}{glyph ? "" : "（フォント）"}</div>
                  <button type="button" title={`${label} の字形をSVGファイルから読み込む`} onClick={() => { setTarget(key); svgRef.current?.click(); }}>SVG</button>
                  <button type="button" title={`${label} をフォントの文字（既定の図形）にする`} disabled={!glyph} onClick={() => remove(key)}>外す</button>
                </div>
              );
            })}
          </div>
          <label>
            使う範囲
            <select value={style.glyphScope} onChange={(e) => onStyle("glyphScope", e.target.value as Style["glyphScope"])}>
              <option value="bold">太い書体のパートだけ（細い書体のパートはフォントのまま）</option>
              <option value="all">すべてのパート</option>
            </select>
          </label>
          <h2>自分で作った字形を使うには</h2>
          <p className="hint">
            1字ずつSVGファイルにして、各絃の「SVG」から読み込みます。Illustrator では、1字を正方形のアートボードに置き、
            文字はアウトライン化し、移動や拡大などの変形は適用した状態で保存してください。アートボードの高さが絃名の大きさに当たります。
            歌の節などの小さい絃名は、フォントの文字のままです。
          </p>
        </div>
      </div>
    </div>
  );
}
