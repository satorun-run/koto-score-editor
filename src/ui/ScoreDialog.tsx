import { useRef, useState } from "react";
import { loadDefaultStyle, parseSettings, saveDefaultStyle, toSettingsFile } from "../editor/defaults";
import { downloadText } from "../editor/files";
import { resolveStyle, type Style } from "../layout/style";
import { HIRAJOSHI } from "../model/pitch";
import { addPart, addTrack, moveTrack, patchScore, removePart, removeTrack, type Doc } from "../editor/commands";
import type { AuxTrack, Part, Score } from "../model/types";

interface Props {
  doc: Doc;
  apply: (fn: (doc: Doc) => Doc | null) => void;
  onClose: () => void;
}

const TRACK_KINDS: [AuxTrack["kind"], string][] = [
  ["lyrics", "歌詞"], ["pitch", "歌の節（小さい絃名）"], ["rhythm", "唱歌（音価線つき）"], ["text", "他楽器の手・文字"],
];

/** 調弦表は「箏|弐」のように | で左右を分けて入力する（データ上はタブ） */
const toLines = (list: string[] | undefined) => (list ?? []).join("\n").replace(/\t/g, "|");
const fromLines = (text: string) => text.split("\n").map((line) => line.replace(/\|/g, "\t"));

/** 曲の情報と、譜面全体の設定 */
export function ScoreDialog({ doc, apply, onClose }: Props) {
  const { score } = doc;
  const onChange = (fn: (score: Score) => void) => apply((d) => patchScore(d, fn));
  const { meta, settings } = score;
  const setTrack = (id: string, fn: (track: AuxTrack) => void) =>
    onChange((s) => {
      const track = s.tracks.find((t) => t.id === id);
      if (track) fn(track);
    });
  const style = resolveStyle(score);
  const settingsRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");
  const applyStyle = (next: Partial<Style>) => onChange((s) => { s.settings.style = structuredClone(next); });
  const loadSettingsFile = async (file: File) => {
    try {
      const next = parseSettings(JSON.parse(await file.text()));
      if (!next) return setNotice("設定ファイルではありません。");
      applyStyle(next);
      setNotice(`「${file.name}」の設定を、この楽譜に読み込みました。`);
    } catch {
      setNotice("設定ファイルを読めませんでした。");
    }
  };

  const setText = (key: "subtitle" | "composer", value: string) =>
    onChange((s) => {
      if (value) s.meta[key] = value;
      else delete s.meta[key];
    });
  const setList = (key: "tuning" | "notes", text: string) =>
    onChange((s) => {
      const list = fromLines(text);
      if (text.trim()) s.meta[key] = list;
      else delete s.meta[key];
    });
  const setStyle = <K extends keyof Style>(key: K, value: Style[K]) =>
    onChange((s) => {
      s.settings.style = { ...s.settings.style, [key]: value };
    });
  const setPart = (id: string, fn: (part: Part) => void) =>
    onChange((s) => {
      const part = s.parts.find((p) => p.id === id);
      if (part) fn(part);
    });
  const number = (value: string, fallback: number, min: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };

  return (
    <div className="dialog-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-label="曲の設定">
        <header>
          <h1>曲の設定</h1>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className="dialog-tools">
          <button
            type="button"
            title="この楽譜の寸法・書体・字形の設定を、新しく作る楽譜の初期値にします"
            onClick={() => setNotice(saveDefaultStyle(settings.style ?? {}) ? "いまの寸法・書体・字形を、既定として保存しました。新しく作る楽譜と、下書きを取り込む楽譜に使われます。" : "保存できませんでした。")}
          >
            いまの設定を既定として保存
          </button>
          <button
            type="button"
            title="保存してある既定の設定を、この楽譜に読み込みます"
            onClick={() => {
              const saved = loadDefaultStyle();
              if (!saved) return setNotice("保存してある既定の設定はありません。");
              applyStyle(saved);
              setNotice("保存してある既定の設定を、この楽譜に読み込みました。");
            }}
          >
            既定の設定を読み込む
          </button>
          <button type="button" onClick={() => downloadText("koto-settings.json", JSON.stringify(toSettingsFile(settings.style ?? {}), null, 2), "application/json")}>
            設定をファイルに書き出す
          </button>
          <button type="button" onClick={() => settingsRef.current?.click()}>設定をファイルから読み込む</button>
          <button
            type="button"
            title="この楽譜の寸法・書体・字形を、アプリの初期値に戻します"
            onClick={() => { onChange((s) => { delete s.settings.style; }); setNotice("この楽譜の寸法・書体・字形を、アプリの初期値に戻しました。"); }}
          >
            アプリの初期値に戻す
          </button>
          <input ref={settingsRef} type="file" accept=".json" hidden aria-label="設定ファイル" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadSettingsFile(f); e.target.value = ""; }} />
        </div>
        {notice && <p className="conflict" role="status">{notice}</p>}
        <div className="dialog-body fields wide">
          <p className="hint">
            上のボタンで保存・読み込みするのは、「寸法と書体」の内容と絃名の字形です（曲名・調弦・拍数・段組は曲ごとのものなので含みません）。
            楽譜ファイルには、これまでどおり曲の設定がすべて一緒に保存されます。
          </p>
          <h2>見出し</h2>
          <label>曲名<input value={meta.title} onChange={(e) => onChange((s) => { s.meta.title = e.target.value; })} /></label>
          <label>副題<input value={meta.subtitle ?? ""} onChange={(e) => setText("subtitle", e.target.value)} /></label>
          <label>作曲者<input value={meta.composer ?? ""} onChange={(e) => setText("composer", e.target.value)} /></label>
          <label>
            調弦表（1行ずつ。「箏|弐」のように | で左右を分ける）
            <textarea rows={5} value={toLines(meta.tuning)} onChange={(e) => setList("tuning", e.target.value)} />
          </label>
          <label>
            注記（譜面に載せる文）
            <textarea rows={2} value={toLines(meta.notes)} onChange={(e) => setList("notes", e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={style.header} onChange={(e) => setStyle("header", e.target.checked)} />
            見出しを譜面に描く
          </label>

          <h2>パート</h2>
          {score.parts.map((part) => (
            <div key={part.id} className="inline">
              <input
                aria-label="パート名"
                placeholder="パート名（1パートなら空でよい）"
                value={part.name ?? ""}
                onChange={(e) => setPart(part.id, (p) => { if (e.target.value) p.name = e.target.value; else delete p.name; })}
              />
              <select aria-label="書体の太さ" value={part.weight} onChange={(e) => setPart(part.id, (p) => { p.weight = e.target.value as Part["weight"]; })}>
                <option value="bold">太い書体</option>
                <option value="regular">細い書体</option>
              </select>
              <button
                type="button"
                disabled={score.parts.length <= 1}
                onClick={() => { if (window.confirm(`パート「${part.name ?? part.id}」を、入力済みの音符ごと削除します。`)) apply((d) => removePart(d, part.id)); }}
              >
                削除
              </button>
            </div>
          ))}
          <button type="button" className="start" onClick={() => apply(addPart)}>パートを追加</button>

          <h2>補助行（歌詞・歌の節・他楽器）</h2>
          <p className="hint">パートの下に置く行です。上から順に並びます。内容のない段では行ごと省かれます。</p>
          {score.tracks.map((track, i) => (
            <div key={track.id} className="inline">
              <input aria-label="補助行の名前" value={track.name ?? ""} onChange={(e) => setTrack(track.id, (t) => { if (e.target.value) t.name = e.target.value; else delete t.name; })} />
              <select aria-label="種類" value={track.kind} onChange={(e) => setTrack(track.id, (t) => { t.kind = e.target.value as AuxTrack["kind"]; })}>
                {TRACK_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              {score.parts.length > 1 && (
                <select aria-label="置く場所" value={track.below} onChange={(e) => setTrack(track.id, (t) => { t.below = e.target.value; })}>
                  {score.parts.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.id} の下</option>)}
                </select>
              )}
              <input
                aria-label="添える文字"
                className="short"
                placeholder="添える文字"
                title="行の末尾に添える文字。例：（三絃）"
                value={track.label ?? ""}
                onChange={(e) => setTrack(track.id, (t) => { if (e.target.value) t.label = e.target.value; else delete t.label; })}
              />
              <button type="button" title="上へ" disabled={i === 0} onClick={() => apply((d) => moveTrack(d, track.id, -1))}>↑</button>
              <button type="button" title="下へ" disabled={i === score.tracks.length - 1} onClick={() => apply((d) => moveTrack(d, track.id, 1))}>↓</button>
              <button type="button" onClick={() => { if (window.confirm(`補助行「${track.name ?? track.id}」を、入力済みの内容ごと削除します。`)) apply((d) => removeTrack(d, track.id)); }}>削除</button>
            </div>
          ))}
          <div className="inline start">
            {TRACK_KINDS.map(([kind, label]) => (
              <button key={kind} type="button" onClick={() => apply((d) => addTrack(d, kind, d.cursor.partId))}>{label.replace(/（.*$/, "")}を追加</button>
            ))}
          </div>

          <h2>調弦（音高）</h2>
          <p className="hint">
            絃 壱〜巾 の開放の音を、音名で13個並べます（例：D4 G3 A3 A#3 …。C4 が中央のド）。
            五線譜に変換するときに使います。見出しの調弦表とは別に持ちます。
          </p>
          {score.parts.map((part) => (
            <div key={part.id} className="tuning">
              {score.parts.length > 1 && <strong>{part.name ?? part.id}</strong>}
              <label>
                調子の名前
                <input
                  value={part.tuning?.name ?? ""}
                  placeholder="例：平調子"
                  onChange={(e) => setPart(part.id, (p) => { p.tuning = { pitches: p.tuning?.pitches ?? [], ...(e.target.value && { name: e.target.value }) }; })}
                />
              </label>
              <label>
                壱〜巾の音高
                <input
                  value={(part.tuning?.pitches ?? []).join(" ")}
                  placeholder="未設定"
                  onChange={(e) =>
                    setPart(part.id, (p) => {
                      const pitches = e.target.value.split(/\s+/).filter(Boolean);
                      if (pitches.length === 0 && !p.tuning?.name) delete p.tuning;
                      else p.tuning = { ...p.tuning, pitches };
                    })
                  }
                />
              </label>
              <button type="button" onClick={() => setPart(part.id, (p) => { p.tuning = { name: "平調子", pitches: [...HIRAJOSHI] }; })}>
                平調子（壱＝D4）を入れる
              </button>
            </div>
          ))}

          <h2>拍と段組</h2>
          <label>
            1小節の拍数（既定）
            <input value={settings.beatsPerMeasure} onChange={(e) => onChange((s) => { s.settings.beatsPerMeasure = e.target.value.trim(); })} />
          </label>
          <label>
            拍子表示（空なら出さない）
            <input value={settings.meterLabel ?? ""} placeholder="例：4/4" onChange={(e) => onChange((s) => { if (e.target.value) s.settings.meterLabel = e.target.value; else delete s.settings.meterLabel; })} />
          </label>
          <label>
            1段の小節数
            <input type="number" min={1} value={settings.measuresPerSystem} onChange={(e) => onChange((s) => { s.settings.measuresPerSystem = Math.round(number(e.target.value, 4, 1)); })} />
          </label>
          <label>
            1ページの段数
            <input type="number" min={1} value={settings.systemsPerPage} onChange={(e) => onChange((s) => { s.settings.systemsPerPage = Math.round(number(e.target.value, 7, 1)); })} />
          </label>

          <h2>寸法と書体</h2>
          <label>譜面領域の幅（mm）<input type="number" min={50} value={style.areaWidth} onChange={(e) => setStyle("areaWidth", number(e.target.value, 180, 50))} /></label>
          <label>譜面領域の高さ（mm）<input type="number" min={50} value={style.areaHeight} onChange={(e) => setStyle("areaHeight", number(e.target.value, 250, 50))} /></label>
          <label>
            段の送り（mm。段から次の段までの距離を固定する。0 なら自動）
            <input type="number" min={0} step={0.5} value={style.systemPitch} onChange={(e) => setStyle("systemPitch", number(e.target.value, 0, 0))} />
          </label>
          <label>絃名の大きさ（mm）<input type="number" min={2} step={0.5} value={style.noteSize} onChange={(e) => setStyle("noteSize", number(e.target.value, 6.5, 2))} /></label>
          <table className="sizes">
            <thead>
              <tr><th>絃名の大きさ（四分音符を100として）</th><th>縦（%）</th><th>横（%）</th></tr>
            </thead>
            <tbody>
              {(["八分", "十六分", "三十二分"] as const).map((name, i) => (
                <tr key={name}>
                  <th>{name}</th>
                  {(["sizeByLines", "widthByLines"] as const).map((key) => (
                    <td key={key}>
                      <input
                        type="number"
                        min={20}
                        max={120}
                        aria-label={`${name}の${key === "sizeByLines" ? "縦" : "横"}`}
                        value={Math.round(style[key][i + 1]! * 100)}
                        onChange={(e) => {
                          const next = [...style[key]] as Style["sizeByLines"];
                          next[i + 1] = number(e.target.value, 80, 20) / 100;
                          setStyle(key, next);
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">縦は字の高さ、横は字の幅です。横を縦より小さくすると、細長い字になります。</p>
          <table className="sizes">
            <thead>
              <tr><th>記号の位置（曲全体。mm）</th><th>右へ</th><th>下へ</th></tr>
            </thead>
            <tbody>
              {([["supShift", "右肩記号（指番号・ヒ・オなど）"], ["prefixShift", "前記号（かき爪・わり爪）"]] as const).map(([key, name]) => (
                <tr key={key}>
                  <th>{name}</th>
                  {[0, 1].map((axis) => (
                    <td key={axis}>
                      <input
                        type="number"
                        step={0.1}
                        aria-label={`${name} ${axis === 0 ? "右へ" : "下へ"}`}
                        value={style[key][axis]}
                        onChange={(e) => {
                          const next: [number, number] = [...style[key]];
                          next[axis] = Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0;
                          setStyle(key, next);
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">左や上へ動かすときは、マイナスの数を入れます。音符ごとの調整は、右のパネルの「音符」でできます。</p>
          <label>
            主パートの書体
            <input value={style.fontMain.family} onChange={(e) => setStyle("fontMain", { ...style.fontMain, family: e.target.value })} />
          </label>
          <label>
            第二パート・補助行の書体
            <input value={style.fontSub.family} onChange={(e) => setStyle("fontSub", { ...style.fontSub, family: e.target.value })} />
          </label>
        </div>
      </div>
    </div>
  );
}
