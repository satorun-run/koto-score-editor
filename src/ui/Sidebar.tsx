import type { Dispatch } from "react";
import {
  addOssia, addSpan, addVolta, beatGroupOfCurrent, currentEvent, patchEventAt, deleteOssia, deleteSpan, eventsAt, patchCurrent, patchMeasure, patchOssia, patchSpan,
  spansAtMeasure, type Doc, type Lines,
} from "../editor/commands";
import { ABOVE_MARKS, SIGNS, SUP_MARKS, formatBinding, type Keymap } from "../editor/keymap";
import type { EditorAction } from "../editor/store";
import { isEventsMeasure, type Barline, type Event, type Mark, type Measure, type Note, type Span } from "../model/types";

export interface IssueItem {
  message: string;
  measureIndex?: number;
  partId?: string;
}

interface Props {
  doc: Doc;
  inputLines: Lines;
  /** スパンの始点として印を付けた音符 */
  mark: string | null;
  keymap: Keymap;
  issues: IssueItem[];
  dispatch: Dispatch<EditorAction>;
  /** 枠の幅（px） */
  width: number;
}

const LINE_LABELS = ["四分（線なし）", "八分（1本）", "十六分（2本）", "三十二分（3本）"];

export function Sidebar({ doc, inputLines, mark, keymap, issues, dispatch, width }: Props) {
  const event = currentEvent(doc);
  const measure = doc.score.measures[doc.cursor.mi];
  return (
    <aside className="sidebar" style={{ width }}>
      <Palette keymap={keymap} inputLines={inputLines} dispatch={dispatch} />
      <section>
        <h2>音符</h2>
        {event ? (
          <EventPanel event={event} next={eventsAt(doc.score, doc.cursor)?.[doc.cursor.index]} dispatch={dispatch} />
        ) : (
          <p className="hint">カーソルの手前に音符がありません。</p>
        )}
        <BeatPanel doc={doc} dispatch={dispatch} />
      </section>
      {measure && (
        <section>
          <h2>小節 {doc.cursor.mi + 1}</h2>
          <MeasurePanel doc={doc} measure={measure} dispatch={dispatch} />
        </section>
      )}
      <section>
        <h2>スパン（複数の音符にまたがる記号）</h2>
        <SpanPanel doc={doc} mark={mark} keymap={keymap} dispatch={dispatch} />
      </section>
      <section>
        <h2>警告 {issues.length > 0 && <span className="badge">{issues.length}</span>}</h2>
        {issues.length === 0 ? (
          <p className="hint">問題は見つかっていません。</p>
        ) : (
          <ul className="issues">
            {issues.map((issue, i) => (
              <li key={i}>
                <button
                  type="button"
                  disabled={issue.measureIndex === undefined}
                  onClick={() =>
                    dispatch({
                      type: "setCursor",
                      cursor: { mi: issue.measureIndex ?? 0, partId: issue.partId ?? doc.cursor.partId, index: 0 },
                    })
                  }
                >
                  {issue.measureIndex !== undefined && <b>小節{issue.measureIndex + 1}</b>} {issue.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

// ---------------------------------------------------------------- 記号パレット

function Palette({ keymap, inputLines, dispatch }: Pick<Props, "keymap" | "inputLines" | "dispatch">) {
  const button = (id: string, label: string, title: string) => {
    const keys = formatBinding(keymap[id]);
    return (
      <button key={id} type="button" title={keys ? `${title}（${keys}）` : title} onClick={() => dispatch({ type: "perform", id })}>
        {label}
        {keys && <kbd>{keys.replace("テンキー", "Num")}</kbd>}
      </button>
    );
  };
  return (
    <section>
      <h2>記号</h2>
      <div className="row">
        <label>
          次に入れる音価
          <select value={inputLines} onChange={(e) => dispatch({ type: "setInputLines", lines: Number(e.target.value) as Lines })}>
            {LINE_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="palette">
        {button("rest", "○", "休符")}
        {button("dot.event", "●", "付点を1つの音符として入れる。次の拍に入る付点（五 ●● 四 など）に使う。長さは音価線の本数で決まる")}
        {button("dots", "付点", "付点（なし→1→2）")}
        {button("join.prev", "前とつなぐ", "音価線を前の音符とつなぐ／切る")}
        {button("join.next", "次とつなぐ", "音価線を次の音符とつなぐ／切る")}
        {button("pattern.dotted", "付点＋十六分", "手前の2音を「付点八分＋十六分」にする")}
        {button("chord.next", "重ねる", "次に押す絃を手前の音符に重ねる（合せ爪）")}
        {button("press", "押し手", "押し手（なし→一重→二重→三重）")}
        {button("prefix.kaki", "かき爪", "かき爪")}
        {button("prefix.wari", "わり爪", "わり爪")}
        {button("chord.style", "囲み", "合せ爪の囲みを切り替え")}
      </div>
      <div className="palette">
        {SUP_MARKS.map((m) => button(`sup.${m}`, m, `右肩記号 ${m}`))}
      </div>
      <div className="palette">
        {ABOVE_MARKS.map((m) => button(`above.${m.id}`, m.id === "fermata" ? "フェルマータ" : m.id === "甲" ? "甲点" : m.id, `上記号 ${m.label}`))}
        {SIGNS.map((s) => button(`sign.${s.id}`, s.id, `記号音符 ${s.label}`))}
      </div>
      <div className="palette">
        {button("fill.rest", "休符で埋めて次へ", "小節の残りを休符で埋めて次の小節へ")}
        {button("measure.copyPrev", "前の小節を写す", "前の小節の内容をこの小節に写す")}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 音符の属性

function describeEvent(event: Event): string {
  if (event.type === "rest") return "休符";
  if (event.type === "dot") return "付点（前の音を延ばす）";
  if (event.type === "sign") return `記号音符「${event.sign}」`;
  const names = "壱弐三四五六七八九十斗為巾";
  return event.strings.map((s) => names[s.n - 1] ?? "？").join("・") + (event.strings.length > 1 ? "（合せ爪）" : "");
}

const splitMarks = (text: string) => text.split(/[\s,、]+/).filter(Boolean);

function EventPanel({ event, next, dispatch }: { event: Event; next: Event | undefined; dispatch: Dispatch<EditorAction> }) {
  const patch = (fn: (e: Event) => void) => dispatch({ type: "apply", fn: (doc) => patchCurrent(doc, fn) });
  const patchNote = (fn: (n: Note) => void) => patch((e) => { if (e.type === "note") fn(e); });
  const setList = (key: "sup" | "above", text: string) =>
    patch((e) => {
      const list = splitMarks(text);
      if (list.length > 0) e[key] = list;
      else delete e[key];
    });

  return (
    <div className="fields">
      <div className="what">{describeEvent(event)}</div>
      <label>
        音価線
        <select value={event.lines} onChange={(e) => patch((ev) => { ev.lines = Number(e.target.value) as Lines; })}>
          {LINE_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}
        </select>
      </label>
      <label>
        付点
        <select value={event.dots} onChange={(e) => patch((ev) => { ev.dots = Number(e.target.value) as Event["dots"]; })}>
          <option value={0}>なし</option>
          <option value={1}>1つ</option>
          <option value={2}>2つ</option>
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={!!event.joinPrev}
          disabled={event.lines === 0}
          onChange={() => dispatch({ type: "perform", id: "join.prev" })}
        />
        音価線を前の音符とつなぐ
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={!!next?.joinPrev}
          disabled={event.lines === 0 || !next || next.lines === 0}
          onChange={() => dispatch({ type: "perform", id: "join.next" })}
        />
        音価線を次の音符とつなぐ
      </label>
      {event.type === "note" && (
        <>
          <label>
            押し手
            <select
              value={event.strings[0]?.press ?? 0}
              onChange={(e) =>
                patchNote((n) => {
                  const first = n.strings[0];
                  if (!first) return;
                  const press = Number(e.target.value);
                  if (press === 0) delete first.press;
                  else first.press = press as 1 | 2 | 3;
                })
              }
            >
              <option value={0}>なし</option>
              <option value={1}>一重（半音）</option>
              <option value={2}>二重（一音）</option>
              <option value={3}>三重（一音半）</option>
            </select>
          </label>
          <label>
            前記号
            <select
              value={event.prefix ?? ""}
              onChange={(e) => patchNote((n) => { if (e.target.value) n.prefix = e.target.value as Note["prefix"]; else delete n.prefix; })}
            >
              <option value="">なし</option>
              <option value="kaki">かき爪</option>
              <option value="wari">わり爪</option>
            </select>
          </label>
          {event.prefix && (
            <ShiftFields label="前記号の位置" value={event.prefixShift} onChange={(v) => patchNote((n) => { if (v) n.prefixShift = v; else delete n.prefixShift; })} />
          )}
          {event.strings.length > 1 && (
            <label>
              合せ爪の囲み
              <select value={event.chord ?? "arc"} onChange={(e) => patchNote((n) => { n.chord = e.target.value as Note["chord"]; })}>
                <option value="arc">左弧</option>
                <option value="circle">丸囲み</option>
                <option value="stack">なし</option>
              </select>
            </label>
          )}
        </>
      )}
      {event.type === "sign" && (
        <label>
          記号
          <input value={event.sign} onChange={(e) => patch((ev) => { if (ev.type === "sign") ev.sign = e.target.value; })} />
        </label>
      )}
      <label>
        右肩記号
        <input value={(event.sup ?? []).join(" ")} placeholder="例：3 ヒ" onChange={(e) => setList("sup", e.target.value)} />
      </label>
      {(event.sup?.length ?? 0) > 0 && (
        <ShiftFields label="右肩記号の位置" value={event.supShift} onChange={(v) => patch((ev) => { if (v) ev.supShift = v; else delete ev.supShift; })} />
      )}
      <label>
        上記号
        <input value={(event.above ?? []).join(" ")} placeholder="例：左" onChange={(e) => setList("above", e.target.value)} />
      </label>
    </div>
  );
}

/** 1拍に複数の音符があるとき、その拍だけ、かたまりの幅と字間を変える欄。空欄なら曲の設定に従う */
function BeatPanel({ doc, dispatch }: Pick<Props, "doc" | "dispatch">) {
  const group = beatGroupOfCurrent(doc);
  if (!group) return null;
  const first = group[0];
  const events = eventsAt(doc.score, doc.cursor)!;
  const tune = events[first]!.beat;
  const set = (key: "spread" | "gap", text: string) =>
    dispatch({
      type: "apply",
      fn: (d) =>
        patchEventAt(d, first, (event) => {
          const next = { ...event.beat };
          if (text.trim() === "" || !Number.isFinite(Number(text))) delete next[key];
          else next[key] = Number(text);
          if (Object.keys(next).length > 0) event.beat = next;
          else delete event.beat;
        }),
    });
  return (
    <div className="shift" title="この拍（音符 が複数ある拍）だけの調整です。空欄にすると「曲の設定」の値に従います">
      <span>この拍の音符の並べ方（{group[1] - group[0] + 1}つの音符）</span>
      <label>
        表示範囲％
        <input type="number" step={5} min={10} aria-label="この拍の表示範囲" placeholder="曲の設定" value={tune?.spread ?? ""} onChange={(e) => set("spread", e.target.value)} />
      </label>
      <label>
        字間mm
        <input type="number" step={0.1} aria-label="この拍の字間" placeholder="曲の設定" value={tune?.gap ?? ""} onChange={(e) => set("gap", e.target.value)} />
      </label>
    </div>
  );
}

/** 記号の位置を、この音符だけ左右・上下にずらす欄（mm）。両方 0 なら指定なしに戻す */
function ShiftFields({ label, value, onChange }: { label: string; value: [number, number] | undefined; onChange: (value: [number, number] | undefined) => void }) {
  const [dx, dy] = value ?? [0, 0];
  const set = (x: number, y: number) => onChange(x === 0 && y === 0 ? undefined : [x, y]);
  const read = (text: string) => (Number.isFinite(Number(text)) ? Math.round(Number(text) * 100) / 100 : 0);
  return (
    <div className="shift" title="この音符だけの調整です。曲全体の位置は「曲の設定」で変えられます">
      <span>{label}（mm）</span>
      <label>
        右へ
        <input type="number" step={0.1} aria-label={`${label} 右へ`} value={dx} onChange={(e) => set(read(e.target.value), dy)} />
      </label>
      <label>
        下へ
        <input type="number" step={0.1} aria-label={`${label} 下へ`} value={dy} onChange={(e) => set(dx, read(e.target.value))} />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- 小節の属性

const BARLINES: [Barline, string][] = [
  ["single", "単線"], ["double", "複縦線"], ["final", "終止線"], ["repeatEnd", "反復終了"], ["none", "なし"],
];
const MARK_KINDS: [Mark["kind"], string][] = [
  ["section", "段名"], ["rehearsal", "練習番号"], ["tempo", "速度"], ["text", "文字指示"],
];
const ENCLOSURES: [NonNullable<Mark["enclosure"]>, string][] = [
  ["none", "囲みなし"], ["circle", "丸"], ["box", "四角"], ["paren", "( )"],
];

function MeasurePanel({ doc, measure, dispatch }: { doc: Doc; measure: Measure; dispatch: Dispatch<EditorAction> }) {
  const patch = (fn: (m: Measure) => void) => dispatch({ type: "apply", fn: (d) => patchMeasure(d, fn) });
  const perform = (id: string) => dispatch({ type: "perform", id });
  const pm = measure.content[doc.cursor.partId];
  const isRepeat = !!pm && !isEventsMeasure(pm);
  const marks = measure.marks ?? [];
  const patchMark = (i: number, fn: (mark: Mark) => void) =>
    patch((m) => {
      const mark = m.marks?.[i];
      if (mark) fn(mark);
    });

  return (
    <div className="fields">
      <label>
        拍数
        <input
          value={measure.beats ?? ""}
          placeholder={`既定（${doc.score.settings.beatsPerMeasure}）`}
          onChange={(e) => patch((m) => { if (e.target.value.trim()) m.beats = e.target.value.trim(); else delete m.beats; })}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={!!measure.free} onChange={(e) => patch((m) => { if (e.target.checked) m.free = true; else delete m.free; })} />
        拍数を検算しない
      </label>
      <label>
        右の小節線
        <select value={measure.barline ?? "single"} onChange={(e) => patch((m) => { const v = e.target.value as Barline; if (v === "single") delete m.barline; else m.barline = v; })}>
          {BARLINES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={!!measure.startRepeat} onChange={(e) => patch((m) => { if (e.target.checked) m.startRepeat = true; else delete m.startRepeat; })} />
        左に反復開始線
      </label>
      <label>
        この小節の後で
        <select value={measure.break ?? ""} onChange={(e) => patch((m) => { const v = e.target.value; if (v) m.break = v as Measure["break"]; else delete m.break; })}>
          <option value="">自動</option>
          <option value="system">改段</option>
          <option value="page">改ページ</option>
        </select>
      </label>
      <label>
        この小節から、1段の小節数を変える
        <input
          type="number"
          min={1}
          value={measure.measuresPerSystem ?? ""}
          placeholder="変えない"
          onChange={(e) =>
            patch((m) => {
              const n = Math.floor(Number(e.target.value));
              if (e.target.value && n >= 1) m.measuresPerSystem = n;
              else delete m.measuresPerSystem;
            })
          }
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={isRepeat} onChange={() => perform("measure.repeat")} />
        前小節くり返し
      </label>

      <h3>標記</h3>
      {marks.map((mark, i) => (
        <div key={i} className="mark">
          <select value={mark.kind} onChange={(e) => patchMark(i, (k) => { k.kind = e.target.value as Mark["kind"]; })}>
            {MARK_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input value={mark.text} placeholder="文字" onChange={(e) => patchMark(i, (k) => { k.text = e.target.value; })} />
          <select
            value={mark.enclosure ?? "none"}
            onChange={(e) => patchMark(i, (k) => { const v = e.target.value as NonNullable<Mark["enclosure"]>; if (v === "none") delete k.enclosure; else k.enclosure = v; })}
          >
            {ENCLOSURES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input value={mark.note ?? ""} placeholder="添え書き" onChange={(e) => patchMark(i, (k) => { if (e.target.value) k.note = e.target.value; else delete k.note; })} />
          <button type="button" title="この標記を削除" onClick={() => patch((m) => { m.marks?.splice(i, 1); if (m.marks?.length === 0) delete m.marks; })}>×</button>
        </div>
      ))}
      <button type="button" onClick={() => patch((m) => { (m.marks ??= []).push({ kind: "section", text: "" }); })}>標記を追加</button>

      <h3>調弦の変更（この小節から）</h3>
      {(measure.retune ?? []).map((change, i) => (
        <div key={i} className="retune">
          {doc.score.parts.length > 1 && (
            <select value={change.part} onChange={(e) => patch((m) => { const c = m.retune?.[i]; if (c) c.part = e.target.value; })}>
              {doc.score.parts.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.id}</option>)}
            </select>
          )}
          <select value={change.string} onChange={(e) => patch((m) => { const c = m.retune?.[i]; if (c) c.string = Number(e.target.value); })}>
            {[..."壱弐三四五六七八九十斗為巾"].map((name, n) => <option key={n} value={n + 1}>{name}</option>)}
          </select>
          <select value={change.semitones} onChange={(e) => patch((m) => { const c = m.retune?.[i]; if (c) c.semitones = Number(e.target.value); })}>
            <option value={2}>一音上げる</option>
            <option value={1}>半音上げる</option>
            <option value={-1}>半音下げる</option>
            <option value={-2}>一音下げる</option>
          </select>
          <button type="button" title="この変更を削除" onClick={() => patch((m) => { m.retune?.splice(i, 1); if (m.retune?.length === 0) delete m.retune; })}>×</button>
        </div>
      ))}
      <button type="button" onClick={() => patch((m) => { (m.retune ??= []).push({ part: doc.cursor.partId, string: 1, semitones: 1 }); })}>調弦の変更を追加</button>

      <h3>代替譜（或は…）</h3>
      {(measure.ossia ?? []).map((ossia, i) => (
        <div key={i} className="retune">
          <input aria-label="ラベル" value={ossia.label} onChange={(e) => dispatch({ type: "apply", fn: (d) => patchOssia(d, i, (o) => { o.label = e.target.value; }) })} />
          <input aria-label="拍位置" title="差し替える範囲の開始拍（0 が小節の頭）" value={ossia.at} onChange={(e) => dispatch({ type: "apply", fn: (d) => patchOssia(d, i, (o) => { o.at = e.target.value.trim() || "0"; }) })} />
          <button
            type="button"
            title="この代替譜に音符を入力する"
            onClick={() => dispatch({ type: "setCursor", cursor: { mi: doc.cursor.mi, partId: ossia.part, index: Number.MAX_SAFE_INTEGER, ossia: i } })}
          >
            {doc.cursor.ossia === i ? "編集中" : "編集"}
          </button>
          <button type="button" title="この代替譜を削除" onClick={() => dispatch({ type: "apply", fn: (d) => deleteOssia(d, i) })}>×</button>
        </div>
      ))}
      <button type="button" disabled={doc.cursor.ossia !== undefined} onClick={() => dispatch({ type: "apply", fn: addOssia })}>
        カーソル位置に代替譜を追加
      </button>

      <h3>小節の操作</h3>
      <div className="palette">
        <button type="button" onClick={() => perform("measure.insertBefore")}>前に挿入</button>
        <button type="button" onClick={() => perform("measure.insertAfter")}>後ろに挿入</button>
        <button type="button" onClick={() => perform("measure.delete")}>削除</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- スパン

const SPAN_KINDS: [Exclude<Span["kind"], "volta">, string, string][] = [
  ["wave", "波線", "引き連・流し爪など"],
  ["dash", "破線", "指番号や「左」の継続"],
  ["pressBracket", "押し手括弧", "かけ押し"],
];
const SPAN_NAMES: Record<Span["kind"], string> = { wave: "波線", dash: "破線", pressBracket: "押し手括弧", volta: "1番・2番括弧" };

function SpanPanel({ doc, mark, keymap, dispatch }: Pick<Props, "doc" | "mark" | "keymap" | "dispatch">) {
  const current = currentEvent(doc);
  const spans = spansAtMeasure(doc.score, doc.cursor.mi);
  const markKey = formatBinding(keymap["select.mark"]);
  const ready = !!mark && !!current && doc.cursor.ossia === undefined;
  const add = (kind: Exclude<Span["kind"], "volta">) => {
    if (!mark || !current) return;
    dispatch({ type: "apply", fn: (d) => addSpan(d, kind, mark, current.id) });
    dispatch({ type: "setMark", eventId: null });
  };
  const setText = (id: string, key: "startText" | "endText", value: string) =>
    dispatch({ type: "apply", fn: (d) => patchSpan(d, id, (s) => { if (value) s[key] = value; else delete s[key]; }) });

  return (
    <div className="fields">
      <p className="hint">
        {mark
          ? "始点に印を付けました。終点の音符へ移動して、種類を選んでください。"
          : `始点の音符で「始点にする」${markKey ? `（${markKey}）` : ""}を押し、終点の音符へ移動して種類を選びます。Shift+クリックでも範囲を指定できます。`}
      </p>
      <div className="palette">
        <button type="button" disabled={!current} onClick={() => dispatch({ type: "perform", id: "select.mark" })}>
          {mark ? "印を外す" : "始点にする"}
          {markKey && <kbd>{markKey}</kbd>}
        </button>
        {SPAN_KINDS.map(([kind, label, title]) => (
          <button key={kind} type="button" title={title} disabled={!ready} onClick={() => add(kind)}>{label}</button>
        ))}
        <button
          type="button"
          title="この小節に1番括弧・2番括弧を付ける"
          onClick={() => dispatch({ type: "apply", fn: (d) => addVolta(d, d.cursor.mi, d.cursor.mi) })}
        >
          1番・2番括弧
        </button>
      </div>
      {spans.map((span) => (
        <div key={span.id} className="mark">
          <strong>{SPAN_NAMES[span.kind]}</strong>
          <input aria-label="始点の文字" placeholder="始点の文字" value={span.startText ?? ""} onChange={(e) => setText(span.id, "startText", e.target.value)} />
          <span />
          {span.kind === "wave" ? (
            <input aria-label="終点の文字" placeholder="終点の文字" value={span.endText ?? ""} onChange={(e) => setText(span.id, "endText", e.target.value)} />
          ) : (
            <span />
          )}
          <button type="button" title="このスパンを削除" onClick={() => dispatch({ type: "apply", fn: (d) => deleteSpan(d, span.id) })}>×</button>
        </div>
      ))}
    </div>
  );
}
