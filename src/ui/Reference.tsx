import { useRef, type CSSProperties } from "react";
import { NumInput } from "./NumInput";
import type { Style } from "../layout/style";

/** 元画像（スキャン）の表示設定。SPEC.md 6.1 */
export interface RefState {
  images: { name: string; url: string }[];
  mode: "off" | "side" | "overlay";
  /** 横に並べるときの拡大率（%） */
  sideZoom: number;
  /** 重ねるとき：譜面の1ページ目に当てる画像 */
  index: number;
  /** 重ねるとき：濃さ（0〜1）と色 */
  opacity: number;
  color: RefColor;
  /** 重ねるとき：譜面領域の幅を100とした画像の幅と、縦方向の伸縮（%） */
  width: number;
  height: number;
  /** 重ねるとき：位置のずれ（mm） */
  dx: number;
  dy: number;
}

export type RefColor = "red" | "blue" | "green" | "black";
const COLORS: Record<RefColor, { label: string; css: string }> = {
  red: { label: "赤", css: "#e0261a" },
  blue: { label: "青", css: "#1d5fd6" },
  green: { label: "緑", css: "#0f8a3c" },
  black: { label: "黒（元のまま）", css: "#000" },
};

export const INITIAL_REF: RefState = {
  images: [], mode: "off", sideZoom: 60, index: 0, opacity: 0.6, color: "red", width: 115, height: 100, dx: -12, dy: -18,
};

interface BarProps {
  state: RefState;
  onChange: (next: RefState) => void;
  /** 重ねて合わせるときに一緒に調整する、譜面側の設定 */
  style: Style;
  onStyle: <K extends keyof Style>(key: K, value: Style[K]) => void;
}

/** 元画像の読み込みと、表示方法の切り替え */
export function ReferenceBar({ state, onChange, style, onStyle }: BarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<RefState>) => onChange({ ...state, ...patch });
  const count = state.images.length;

  const load = (files: FileList) => {
    for (const image of state.images) URL.revokeObjectURL(image.url);
    const images = [...files]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
    onChange({ ...state, images, index: 0, mode: state.mode === "off" ? "side" : state.mode });
  };

  const num = (label: string, value: number, apply: (n: number) => void, step = 0.5, title?: string) => (
    <label title={title}>
      {label}
      <NumInput
        step={step}
        value={value}
        onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n)) apply(n); }}
      />
    </label>
  );

  return (
    <div className="refbar">
      <button type="button" onClick={() => fileRef.current?.click()} title="スキャン画像を選びます（複数可）。この画面を閉じると選び直しが必要です">
        元画像を選ぶ
      </button>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-label="元画像" onChange={(e) => { if (e.target.files?.length) load(e.target.files); e.target.value = ""; }} />
      {count > 0 && (
        <>
          <select aria-label="元画像の表示" value={state.mode} onChange={(e) => set({ mode: e.target.value as RefState["mode"] })}>
            <option value="off">表示しない</option>
            <option value="side">横に並べる</option>
            <option value="overlay">譜面に重ねる</option>
          </select>
          {state.mode === "side" && (
            <>
              <span className="ref-note">{count} 枚。譜面と同じく、上下にスクロールして送ります。</span>
              <label>大きさ<input type="range" min={20} max={200} value={state.sideZoom} onChange={(e) => set({ sideZoom: Number(e.target.value) })} /></label>
            </>
          )}
          {state.mode === "overlay" && (
            <>
              <span className="ref-group">
                <b>元画像</b>
                <label title="譜面の1ページ目に当てる画像。2ページ目以降には続きの画像が当たります">
                  1ページ目に
                  <select aria-label="1ページ目に当てる画像" value={state.index} onChange={(e) => set({ index: Number(e.target.value) })}>
                    {state.images.map((image, i) => <option key={i} value={i}>{i + 1}枚目（{image.name}）</option>)}
                  </select>
                </label>
                <label>
                  色
                  <select aria-label="元画像の色" value={state.color} onChange={(e) => set({ color: e.target.value as RefColor })}>
                    {Object.entries(COLORS).map(([value, c]) => <option key={value} value={value}>{c.label}</option>)}
                  </select>
                </label>
                <label>濃さ<input type="range" min={5} max={100} value={state.opacity * 100} onChange={(e) => set({ opacity: Number(e.target.value) / 100 })} /></label>
                {num("幅%", state.width, (n) => set({ width: Math.max(10, n) }), 0.5, "譜面領域の幅を100としたときの、画像の幅")}
                {num("高さ%", state.height, (n) => set({ height: Math.max(10, n) }), 0.5, "縦方向だけの伸び縮み。100で元の縦横比")}
                {num("左右mm", state.dx, (n) => set({ dx: n }))}
                {num("上下mm", state.dy, (n) => set({ dy: n }))}
              </span>
              <span className="ref-group" title="ここは譜面そのものの設定で、出力にも反映されます">
                <b>譜面</b>
                {num("段の送りmm", style.systemPitch, (n) => onStyle("systemPitch", Math.max(0, n)), 0.5, "段から次の段までの距離を固定します。0 にすると中身に応じた自動の間隔に戻ります")}
                {num("幅mm", style.areaWidth, (n) => onStyle("areaWidth", Math.max(50, n)), 1, "譜面領域の幅")}
                {num("絃名mm", style.noteSize, (n) => onStyle("noteSize", Math.max(2, n)), 0.1, "絃名の大きさ")}
              </span>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** 横に並べる表示。全部の画像を縦に並べ、譜面と同じようにスクロールで送る */
export function ReferencePane({ state, width }: { state: RefState; width: number }) {
  if (state.mode !== "side" || state.images.length === 0) return null;
  return (
    <div className="refpane" style={{ width }}>
      {state.images.map((image, i) => (
        <figure key={image.url}>
          <figcaption>{i + 1} / {state.images.length}　{image.name}</figcaption>
          <img src={image.url} alt={`元画像 ${image.name}`} style={{ width: `${state.sideZoom}%` }} />
        </figure>
      ))}
    </div>
  );
}

/** 譜面に重ねる画像。黒い線を指定の色に置き換えて、譜面と見分けやすくする */
export function ReferenceOverlay({ state, pageIndex, pageWidth, zoom }: { state: RefState; pageIndex: number; pageWidth: number; zoom: number }) {
  const image = state.images[state.index + pageIndex];
  if (!image) return null;
  const box: CSSProperties = {
    opacity: state.opacity,
    width: (pageWidth * zoom * state.width) / 100,
    left: state.dx * zoom,
    top: state.dy * zoom,
    transform: `scaleY(${state.height / 100})`,
  };
  return (
    <div className="page-ref" style={box}>
      <img alt="" src={image.url} />
      {state.color !== "black" && <div className="page-ref-tint" style={{ background: COLORS[state.color].css }} />}
    </div>
  );
}
