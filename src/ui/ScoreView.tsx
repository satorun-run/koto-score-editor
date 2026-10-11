import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { laneItems, nextOnset, parseLane, type Cursor, type LaneItem, type LaneRef } from "../editor/commands";
import type { Keymap } from "../editor/keymap";
import { equals, formatFraction, frac, parseFraction } from "../model/fraction";
import type { LaneBox, LayoutResult, Page } from "../layout/prims";
import type { Style } from "../layout/style";
import { isEventsMeasure, type Score } from "../model/types";
import { renderSvg } from "../render/svg";
import { LaneEditor, type LaneKind } from "./LaneEditor";
import { ReferenceOverlay, type RefState } from "./Reference";

interface Props {
  score: Score;
  layout: LayoutResult;
  style: Style;
  cursor: Cursor;
  /** スパンの始点として印を付けた音符 */
  mark: string | null;
  /** 元画像を譜面に重ねる設定。重ねないなら null */
  overlay: RefState | null;
  keymap: Keymap;
  /** 1mm あたりの画面上のピクセル数 */
  zoom: number;
  onCursor: (cursor: Cursor, extend: boolean) => void;
  /** 入力欄の項目を置く・置き換える・消す（index が null なら新規、item が null なら削除） */
  onPutItem: (lane: LaneRef, mi: number, index: number | null, item: LaneItem | null) => void;
  onMoveItem: (lane: LaneRef, fromMi: number, index: number, toMi: number, at: string) => void;
}

/** 編集中の入力欄の位置。項目は番号ではなく拍位置で指す（並べ替えで番号が変わるため） */
interface Editing {
  lane: string;
  measureId: string;
  at: string;
}

interface Drag {
  lane: string;
  measureId: string;
  index: number;
  startX: number;
  pageIndex: number;
}

const sameAt = (a: string, b: string) => {
  const fa = parseFraction(a);
  const fb = parseFraction(b);
  return !!fa && !!fb && equals(fa, fb);
};

/** 横位置にいちばん近い置き場所。free なら置き場所の間を 1/64 拍刻みで補間する */
function atFromX(lane: LaneBox, x: number, free: boolean): string | null {
  const stops = lane.stops;
  if (stops.length === 0) return null;
  let best = 0;
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i]!.x - x) < Math.abs(stops[best]!.x - x)) best = i;
  }
  if (!free) return stops[best]!.at;
  const i = x >= stops[best]!.x ? best : Math.max(0, best - 1);
  const a = stops[i]!;
  const b = stops[i + 1];
  const t = b && b.x > a.x ? Math.max(0, Math.min(1, (x - a.x) / (b.x - a.x))) : 0;
  return formatFraction(frac(i * 8 + Math.round(t * 8), 64));
}

/** 出力と同じSVGを表示し、その上に選択用の透明な領域・カーソル・入力欄を重ねる */
export function ScoreView({ score, layout, style, cursor, mark, overlay, keymap, zoom, onCursor, onPutItem, onMoveItem }: Props) {
  /** カーソルの位置（ページ番号と、ページ内の mm 座標）。描画のたびに更新する */
  const caretPos = useRef<{ page: number; x: number; y1: number; y2: number } | null>(null);
  caretPos.current = null;
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  /** いま表示欄の中央に見えているページ（0始まり） */
  const [visiblePage, setVisiblePage] = useState(0);
  const pagesRef = useRef<HTMLDivElement>(null);

  // スクロールに合わせて、見えているページの番号を更新する
  useEffect(() => {
    const scroller = pagesRef.current?.closest(".canvas");
    if (!(scroller instanceof HTMLElement)) return;
    const update = () => {
      const view = scroller.getBoundingClientRect();
      const center = view.top + view.height / 2;
      let best = 0;
      let bestDistance = Infinity;
      pageRefs.current.forEach((el, i) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        // 表示欄の中央を含むページ。どのページも含まなければ、中央にいちばん近いページ
        const distance = center < rect.top ? rect.top - center : center > rect.bottom ? center - rect.bottom : 0;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      });
      setVisiblePage(best);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroller.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [layout, zoom]);
  const svgs = useMemo(() => layout.pages.map((page) => renderSvg(page, style)), [layout, style]);

  const measureIndex = useMemo(() => new Map(score.measures.map((m, i) => [m.id, i])), [score]);
  const measure = score.measures[cursor.mi];
  const cursorEvents =
    cursor.ossia !== undefined
      ? (measure?.ossia?.[cursor.ossia]?.events ?? [])
      : (() => {
          const pm = measure?.content[cursor.partId];
          return pm && isEventsMeasure(pm) ? pm.events : [];
        })();
  const currentId = cursorEvents[cursor.index - 1]?.id;

  useEffect(() => {
    // カーソルを動かしたとき（音符の入力・移動・クリック）に、カーソルが見える範囲の外にあれば、
    // 譜面の表示欄を必要な分だけ送る。ブラウザ任せ（scrollIntoView）にすると、iPad の Safari では画面全体がずれる。
    //
    // カーソルが動いていないのに組み直しが起きただけのとき（属性の変更、口唱歌や補助行の編集、設定の変更など）は送らない。
    // そのとき見ている場所や編集している場所は、カーソルの位置とは限らないため
    const pos = caretPos.current;
    const pageEl = pos ? pageRefs.current[pos.page] : null;
    const scroller = pageEl?.closest(".canvas");
    if (!pos || !pageEl || !(scroller instanceof HTMLElement)) return;
    const page = pageEl.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (view.width === 0 || view.height === 0) return;
    const margin = Math.min(40, view.height / 4, view.width / 4);
    const x = page.left + pos.x * zoom;
    const top = page.top + pos.y1 * zoom;
    const bottom = page.top + pos.y2 * zoom;
    if (top < view.top + margin) scroller.scrollTop -= view.top + margin - top;
    else if (bottom > view.bottom - margin) scroller.scrollTop += bottom - (view.bottom - margin);
    if (x < view.left + margin) scroller.scrollLeft -= view.left + margin - x;
    else if (x > view.right - margin) scroller.scrollLeft += x - (view.right - margin);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 上の理由で、組み直し（layout）や拡大率では動かさない
  }, [cursor.mi, cursor.partId, cursor.index, cursor.ossia]);

  const laneKind = (lane: string): LaneKind => {
    const ref = parseLane(lane);
    if (!ref || ref.kind === "shoka") return "shoka";
    return score.tracks.find((t) => t.id === ref.trackId)?.kind ?? "text";
  };
  /** 入力欄が属するパート（Enter で次へ進むとき、このパートの音符の位置に合わせる） */
  const lanePart = (lane: string): string => {
    const ref = parseLane(lane);
    if (!ref) return cursor.partId;
    return ref.kind === "shoka" ? ref.partId : (score.tracks.find((t) => t.id === ref.trackId)?.below ?? cursor.partId);
  };

  const pageX = (pageIndex: number, clientX: number) => {
    const rect = pageRefs.current[pageIndex]?.getBoundingClientRect();
    return rect ? (clientX - rect.left) / zoom : 0;
  };

  const onEventDown = (e: ReactMouseEvent, measureId: string, partId: string, eventId: string, ossia: number | undefined) => {
    const mi = measureIndex.get(measureId);
    if (mi === undefined) return;
    const m = score.measures[mi]!;
    const pm = m.content[partId];
    const events = ossia !== undefined ? m.ossia?.[ossia]?.events : pm && isEventsMeasure(pm) ? pm.events : undefined;
    const index = events?.findIndex((ev) => ev.id === eventId) ?? -1;
    if (index < 0) return;
    setEditing(null);
    onCursor({ mi, partId, index: index + 1, ...(ossia !== undefined && { ossia }) }, e.shiftKey);
  };

  // 項目のドラッグ：ほとんど動かさずに離したら編集、動かしたら移動
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      const ref = parseLane(drag.lane);
      const fromMi = measureIndex.get(drag.measureId);
      if (!ref || fromMi === undefined) return;
      const item = laneItems(score, ref, fromMi)[drag.index];
      if (!item) return;
      if (Math.abs(e.clientX - drag.startX) < 4) {
        setEditing({ lane: drag.lane, measureId: drag.measureId, at: item.at });
        return;
      }
      const x = pageX(drag.pageIndex, e.clientX);
      const page = layout.pages[drag.pageIndex];
      const from = page?.lanes.find((l) => l.lane === drag.lane && l.measureId === drag.measureId);
      const target = page?.lanes.find((l) => l.lane === drag.lane && l.y === from?.y && x >= l.x && x < l.x + l.w);
      const at = target && atFromX(target, x, e.altKey);
      const toMi = target && measureIndex.get(target.measureId);
      if (at && toMi !== undefined) onMoveItem(ref, fromMi, drag.index, toMi, at);
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  });

  const commit = (item: LaneItem | null, advance: boolean) => {
    if (!editing) return;
    const ref = parseLane(editing.lane);
    const mi = measureIndex.get(editing.measureId);
    if (!ref || mi === undefined) return;
    const index = laneItems(score, ref, mi).findIndex((it) => sameAt(it.at, editing.at));
    if (item || index >= 0) onPutItem(ref, mi, index >= 0 ? index : null, item);
    if (!advance) {
      setEditing(null);
      return;
    }
    // 次の音符の位置へ。小節内になければ次の小節の頭へ
    const partId = lanePart(editing.lane);
    const next = nextOnset(score, mi, partId, editing.at);
    if (next) setEditing({ ...editing, at: next });
    else if (score.measures[mi + 1]) setEditing({ lane: editing.lane, measureId: score.measures[mi + 1]!.id, at: "0" });
    else setEditing(null);
  };

  const renderEditor = (page: Page) => {
    if (!editing) return null;
    const lane = page.lanes.find((l) => l.lane === editing.lane && l.measureId === editing.measureId);
    const ref = parseLane(editing.lane);
    const mi = measureIndex.get(editing.measureId);
    if (!lane || !ref || mi === undefined) return null;
    const items = laneItems(score, ref, mi);
    const index = items.findIndex((it) => sameAt(it.at, editing.at));
    const box = index >= 0 ? page.laneItems.find((b) => b.lane === editing.lane && b.measureId === editing.measureId && b.index === index) : undefined;
    const stop = lane.stops.find((s) => sameAt(s.at, editing.at));
    const x = box ? box.x + box.w / 2 : (stop?.x ?? lane.x);
    const kind = laneKind(editing.lane);
    const above = kind === "shoka";
    return (
      <div
        className={above ? "lane-editor above" : "lane-editor"}
        style={{ left: x * zoom, top: (above ? lane.y : lane.y + lane.h) * zoom }}
      >
        <LaneEditor
          key={`${editing.lane}/${editing.measureId}/${editing.at}`}
          kind={kind}
          at={editing.at}
          item={items[index]}
          keymap={keymap}
          onCommit={commit}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  };

  return (
    <div className="pages" ref={pagesRef}>
      <div className="page-badge" aria-label="表示中のページ">
        {Math.min(visiblePage, layout.pages.length - 1) + 1} / {layout.pages.length} ページ
      </div>
      {layout.pages.map((page, pi) => {
        const mbox = page.measureBoxes.find((b) => b.measureId === measure?.id && b.partId === cursor.partId);
        const cbox = currentId ? page.boxes.find((b) => b.eventId === currentId) : undefined;
        const obox =
          cursor.ossia !== undefined
            ? page.lanes.find((l) => l.lane === `ossia:${cursor.partId}:${cursor.ossia}` && l.measureId === measure?.id)
            : undefined;
        // カーソル：手前の音符の右端。なければ小節（または代替譜）の頭
        const anchor = cursor.ossia !== undefined ? obox : mbox;
        const caret = anchor && {
          x: (cbox ? cbox.x + cbox.w : anchor.x + (cursor.ossia !== undefined ? 0 : style.measurePad)) - 0.3,
          y1: anchor.y - 1.5,
          y2: anchor.y + anchor.h + 1.5,
        };
        if (caret) caretPos.current = { page: pi, ...caret };
        return (
          <div
            key={pi}
            ref={(el) => { pageRefs.current[pi] = el; }}
            className="page"
            style={{ width: page.width * zoom, height: page.height * zoom }}
          >
            <div className="page-number">{pi + 1} ページ</div>
            {overlay && <ReferenceOverlay state={overlay} pageIndex={pi} pageWidth={page.width} zoom={zoom} />}
            <div className="page-art" dangerouslySetInnerHTML={{ __html: svgs[pi]! }} />
            <svg className="page-overlay" viewBox={`0 0 ${page.width} ${page.height}`}>
              {page.measureBoxes.map((b) => (
                <rect
                  key={`${b.measureId}/${b.partId}`}
                  className="hit-measure"
                  x={b.x} y={b.y - 1} width={b.w} height={b.h + 2}
                  onMouseDown={(e) => {
                    setEditing(null);
                    onCursor({ mi: measureIndex.get(b.measureId) ?? 0, partId: b.partId, index: Number.MAX_SAFE_INTEGER }, e.shiftKey);
                  }}
                />
              ))}
              {mbox && cursor.ossia === undefined && (
                <rect className="current-measure" x={mbox.x} y={mbox.y - 1} width={mbox.w} height={mbox.h + 2} />
              )}
              {page.lanes.map((l) =>
                l.lane.startsWith("ossia:") ? (
                  <rect
                    key={`${l.lane}/${l.measureId}`}
                    className={l === obox ? "hit-lane ossia current" : "hit-lane ossia"}
                    x={l.x} y={l.y} width={l.w} height={l.h}
                    onMouseDown={() => {
                      const [, partId = "", oi = "0"] = l.lane.split(":");
                      setEditing(null);
                      onCursor({ mi: measureIndex.get(l.measureId) ?? 0, partId, index: Number.MAX_SAFE_INTEGER, ossia: Number(oi) }, false);
                    }}
                  />
                ) : (
                  <rect
                    key={`${l.lane}/${l.measureId}`}
                    className="hit-lane"
                    x={l.x} y={l.y} width={l.w} height={l.h}
                    onMouseDown={(e) => {
                      const at = atFromX(l, pageX(pi, e.clientX), e.altKey);
                      if (at) setEditing({ lane: l.lane, measureId: l.measureId, at });
                    }}
                  />
                ),
              )}
              {page.laneItems.map((b) => (
                <rect
                  key={`${b.lane}/${b.measureId}/${b.index}`}
                  className="hit-item"
                  x={b.x} y={b.y} width={b.w} height={b.h}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    dragRef.current = { lane: b.lane, measureId: b.measureId, index: b.index, startX: e.clientX, pageIndex: pi };
                  }}
                />
              ))}
              {page.boxes.map((b) => (
                <rect
                  key={b.eventId}
                  className={["hit-event", b.eventId === currentId && "current", b.eventId === mark && "marked"].filter(Boolean).join(" ")}
                  x={b.x} y={b.y - 1} width={b.w} height={b.h + 2}
                  onMouseDown={(e) => onEventDown(e, b.measureId, b.partId, b.eventId, b.ossia)}
                />
              ))}
              {caret && <line className="caret" x1={caret.x} x2={caret.x} y1={caret.y1} y2={caret.y2} />}
            </svg>
            {renderEditor(page)}
          </div>
        );
      })}
    </div>
  );
}
