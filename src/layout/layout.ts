// 楽譜データから描画要素を作る。SPEC.md 5章に対応する。

import { eventBeats, eventOffsets, measureBeats } from "../model/duration";
import { formatFraction, frac, parseFraction, toNumber } from "../model/fraction";
import {
  isEventsMeasure,
  type AuxItem,
  type AuxTrack,
  type Event,
  type Mark,
  type Measure,
  type Score,
  type Span,
  type StringRef,
} from "../model/types";
import {
  shiftPrim,
  type EventBox, type FontRole, type LaneBox, type LaneItemBox, type LayoutIssue, type LayoutOptions, type LayoutResult,
  type MeasureBox, type Page, type Prim,
} from "./prims";
import { resolveStyle, textEm, type GlyphDef, type Style } from "./style";
import { buildTimeMap, type TimeMap } from "./timemap";

/** 文字の下端からベースラインまでの距離（文字サイズ比） */
const DESCENT = 0.12;
const BRACKET_MARGIN = 2.5;
const PRESS_HEIGHT = 1.15;

interface SystemPlan {
  /** 小節の通し番号 */
  measures: number[];
  pageBreakAfter: boolean;
  /** 既定の小節数に満たず、改段指定もない（幅を引き伸ばさない） */
  short: boolean;
  /** この段に適用される1段の小節数 */
  perSystem: number;
}

/** 音符1つの枠。x0〜x1 が中央寄せの範囲、slotEnd は音符の長さ全体の右端 */
interface EventCell {
  onset: number;
  end: number;
  x0: number;
  x1: number;
  slotEnd: number;
}

interface EventGeom {
  cx: number;
  left: number;
  right: number;
  top: number;
  baseY: number;
}

interface Ctx {
  score: Score;
  st: Style;
  issues: LayoutIssue[];
  /** eventId → 小節の通し番号 */
  eventMeasure: Map<string, number>;
  measureIndexById: Map<string, number>;
  /** 補助行ごとの、延ばし線が次の段へ続いている状態 */
  extendOpen: Set<string>;
  /** 補助行ごとの、項目がある最後の小節 */
  lastAuxMeasure: Map<string, number>;
  forceLanes: Set<string>;
}

interface SystemResult {
  prims: Prim[];
  boxes: EventBox[];
  measureBoxes: MeasureBox[];
  lanes: LaneBox[];
  laneItems: LaneItemBox[];
  height: number;
  /** 段の上端から、いちばん上のパートの絃名の下端まで */
  baseline: number;
}

export function layoutScore(score: Score, overrides: Partial<Style> = {}, options: LayoutOptions = {}): LayoutResult {
  const st = resolveStyle(score, overrides);
  const ctx: Ctx = {
    score,
    st,
    issues: [],
    eventMeasure: new Map(),
    measureIndexById: new Map(),
    extendOpen: new Set(),
    lastAuxMeasure: new Map(),
    forceLanes: new Set(options.forceLanes ?? []),
  };
  score.measures.forEach((m, mi) => {
    ctx.measureIndexById.set(m.id, mi);
    for (const pm of Object.values(m.content)) {
      if (isEventsMeasure(pm)) for (const e of pm.events) ctx.eventMeasure.set(e.id, mi);
    }
    for (const [trackId, items] of Object.entries(m.aux ?? {})) {
      if (items.length > 0) ctx.lastAuxMeasure.set(trackId, mi);
    }
  });

  const pages: Page[] = [];
  const newPage = (): Page => {
    const page: Page = { index: pages.length, width: st.areaWidth, height: st.areaHeight, prims: [], boxes: [], measureBoxes: [], lanes: [], laneItems: [], systems: [] };
    pages.push(page);
    return page;
  };

  let page = newPage();
  let y = 0;
  let systemsOnPage = 0;
  /** 段の送りを固定するときの基準：ページ最初の段の、絃名の下端の位置 */
  let gridBase = 0;
  if (st.header) {
    const header = layoutHeader(ctx);
    page.prims.push(...header.prims);
    y = header.height;
  }

  const plans = planSystems(score);
  plans.forEach((plan, si) => {
    const sys = layoutSystem(ctx, plan, si === 0);
    const full = systemsOnPage >= score.settings.systemsPerPage;
    const fixed = st.systemPitch > 0;
    const topOf = () => (fixed && systemsOnPage > 0 ? gridBase + systemsOnPage * st.systemPitch - sys.baseline : y);
    const tooTall = systemsOnPage > 0 && topOf() + sys.height > st.areaHeight;
    if (full || tooTall) {
      page = newPage();
      y = 0;
      systemsOnPage = 0;
    }
    y = topOf();
    if (systemsOnPage === 0) gridBase = y + sys.baseline;
    if (y + sys.height > st.areaHeight) {
      ctx.issues.push({
        code: "page-overflow",
        message: "段が譜面領域の高さに収まりません",
        measureIndex: plan.measures[0],
      });
    }
    const primStart = page.prims.length;
    for (const p of sys.prims) {
      shiftPrim(p, y);
      page.prims.push(p);
    }
    page.systems.push({
      y, height: sys.height, primStart, primEnd: page.prims.length,
      firstMeasure: plan.measures[0]!, lastMeasure: plan.measures[plan.measures.length - 1]!,
    });
    for (const b of sys.boxes) page.boxes.push({ ...b, y: b.y + y });
    for (const b of sys.measureBoxes) page.measureBoxes.push({ ...b, y: b.y + y });
    for (const b of sys.lanes) page.lanes.push({ ...b, y: b.y + y });
    for (const b of sys.laneItems) page.laneItems.push({ ...b, y: b.y + y });
    y += sys.height + st.systemGap;
    systemsOnPage++;
    if (plan.pageBreakAfter && si < plans.length - 1) {
      page = newPage();
      y = 0;
      systemsOnPage = 0;
    }
  });

  return { pages, issues: ctx.issues };
}

function planSystems(score: Score): SystemPlan[] {
  const plans: SystemPlan[] = [];
  let current: number[] = [];
  let perSystem = Math.max(1, score.settings.measuresPerSystem);
  const close = (pageBreakAfter: boolean, short: boolean) => {
    if (current.length === 0) return;
    plans.push({ measures: current, pageBreakAfter, short, perSystem });
    current = [];
  };
  score.measures.forEach((m, mi) => {
    // 小節数の変更は、その小節を段の先頭にして、そこから先に効く
    if (m.measuresPerSystem !== undefined && m.measuresPerSystem >= 1) {
      close(false, false);
      perSystem = Math.floor(m.measuresPerSystem);
    }
    current.push(mi);
    if (m.break) close(m.break === "page", false);
    else if (current.length >= perSystem) close(false, false);
  });
  close(false, true);
  return plans;
}

// ---------------------------------------------------------------- 見出し

function layoutHeader(ctx: Ctx): { prims: Prim[]; height: number } {
  const { score, st } = ctx;
  const { meta } = score;
  const prims: Prim[] = [];
  const layer = "header";
  const lineH = 4.2;
  const size = 3;

  let y = 0;
  for (const line of meta.tuning ?? []) {
    y += lineH;
    const [label, value] = line.split("\t");
    prims.push({ t: "text", layer, x: 2, y, text: label ?? "", size, font: "sub", anchor: "start" });
    if (value !== undefined) {
      const from = 2 + textEm(label ?? "") * size + 1;
      const to = 40;
      if (to - from > 2) {
        prims.push({ t: "line", layer, x1: from, y1: y - size * 0.35, x2: to, y2: y - size * 0.35, width: 0.2, dash: [0.6, 0.6] });
      }
      prims.push({ t: "text", layer, x: to + 1, y, text: value, size, font: "sub", anchor: "start" });
    }
  }
  if (score.settings.meterLabel) {
    y += lineH + 1;
    prims.push({ t: "text", layer, x: 2, y, text: score.settings.meterLabel, size: 3.4, font: "main", anchor: "start" });
  }
  const leftHeight = y;

  const center = st.areaWidth / 2;
  let ty = 13;
  prims.push({ t: "text", layer, x: center, y: ty, text: meta.title, size: 11, font: "main", anchor: "middle" });
  if (meta.subtitle) {
    ty += 7;
    prims.push({ t: "text", layer, x: center, y: ty, text: meta.subtitle, size: 5, font: "main", anchor: "middle" });
  }

  let ry = ty + 5;
  if (meta.composer) {
    prims.push({ t: "text", layer, x: st.areaWidth - 2, y: ry, text: meta.composer, size: 4.4, font: "main", anchor: "end" });
  }
  for (const note of meta.notes ?? []) {
    ry += 4.2;
    prims.push({ t: "text", layer, x: st.areaWidth - 2, y: ry, text: note, size: 2.8, font: "sub", anchor: "end" });
  }

  return { prims, height: Math.max(leftHeight, ry) + 5 };
}

// ---------------------------------------------------------------- 段

function layoutSystem(ctx: Ctx, plan: SystemPlan, isFirst: boolean): SystemResult {
  const { score, st } = ctx;
  const prims: Prim[] = [];
  const boxes: EventBox[] = [];
  const measureBoxes: MeasureBox[] = [];
  const lanes: LaneBox[] = [];
  const laneItems: LaneItemBox[] = [];
  const parts = score.parts;
  const first = plan.measures[0]!;
  const last = plan.measures[plan.measures.length - 1]!;

  // 横方向：小節幅は拍数に比例
  const left = parts.length > 1 ? BRACKET_MARGIN : 0;
  const usable = st.areaWidth - left;
  const defaultBeats = toNumber(parseFraction(score.settings.beatsPerMeasure) ?? { n: 4, d: 1 });
  const beatsOf = (mi: number) => {
    const b = measureBeats(score, score.measures[mi]!);
    return b ? Math.max(toNumber(b), 0.25) : defaultBeats;
  };
  let beatSum = plan.measures.reduce((sum, mi) => sum + beatsOf(mi), 0);
  if (plan.short) {
    beatSum += (plan.perSystem - plan.measures.length) * defaultBeats;
  }
  const beatWidth = usable / beatSum;
  const mx = new Map<number, number>();
  const mw = new Map<number, number>();
  let x = left;
  for (const mi of plan.measures) {
    mx.set(mi, x);
    mw.set(mi, beatsOf(mi) * beatWidth);
    x += beatsOf(mi) * beatWidth;
  }
  const systemRight = x;

  // 拍位置 → 横位置（小節ごとに全パート共通）
  const maps = new Map<number, TimeMap>();
  for (const mi of plan.measures) {
    // 拍は常に均等に割り付ける。音符が多い拍も広げず、字のほうを寄せて（必要なら重ねて）収める
    const tm = buildTimeMap([], beatsOf(mi), mx.get(mi)! + st.measurePad, mx.get(mi)! + mw.get(mi)! - st.measurePad);
    maps.set(mi, tm);
  }
  // 音符を置く枠。音符は、開始位置からその拍の終わりまで（短い音符なら自分の長さ分）の枠の中央に置く
  const cells = new Map<string, EventCell[]>();
  /** 字が半分以上重なる拍がある小節 */
  const crowded = new Set<number>();
  for (const mi of plan.measures) {
    const tm = maps.get(mi)!;
    for (const [partId, pm] of Object.entries(score.measures[mi]!.content)) {
      if (!isEventsMeasure(pm)) continue;
      const { events } = pm;
      const offsets = eventOffsets(events).map(toNumber);
      const list: EventCell[] = events.map((e, i) => {
        const onset = offsets[i]!;
        const end = onset + toNumber(eventBeats(e));
        const x0 = tm.x(onset);
        return { onset, end, x0, x1: tm.x(Math.min(end, Math.floor(onset + 1e-9) + 1)), slotEnd: tm.x(end) };
      });
      // 1拍を分ける音符は、時間に比例して散らさず、字を寄せてひとかたまりにし、その範囲の中央に置く
      for (const [i, j] of beatGroups(offsets)) {
        const beat = Math.floor(list[i]!.onset + 1e-9);
        if (j > i) {
          const left = list[i]!.x0;
          const right = tm.x(Math.min(list[j]!.end, beat + 1));
          const units = events.slice(i, j + 1).map((e) => unitWidth(st, e));
          const total = units.reduce((sum, u) => sum + u, 0);
          // 入りきらないときは、かたまり全体を同じ割合で詰める
          const span = right - left;
          const lastUnit = units[units.length - 1]!;
          // 入りきらないときは、字の幅は変えずに字と字の間隔を詰め、字どうしを重ねる。
          // 両端の字が拍からはみ出さないよう、最初の字を左端、最後の字を右端に合わせる
          const step = total > span ? Math.max(0, (span - lastUnit) / (total - lastUnit)) : 1;
          // 字の4分の3以上が隠れるほど詰まったら知らせる
          if (step < 0.25) crowded.add(mi);
          // 余裕があれば拍の中央へ。付点で始まるかたまりは前の音符の続きなので、左から並べる
          const lead = total > span || events[i]!.type === "dot" ? 0 : (span - total) / 2;
          let x = left + lead;
          for (let k = i; k <= j; k++) {
            list[k]!.x0 = x;
            list[k]!.x1 = x + units[k - i]!;
            x += units[k - i]! * step;
          }
        }
      }
      // 選択用の範囲は、次の音符の枠の手前まで
      list.forEach((cell, i) => {
        const next = list[i + 1];
        if (next) cell.slotEnd = next.x0;
      });
      cells.set(`${mi}/${partId}`, list);
    }
  }
  for (const mi of crowded) {
    ctx.issues.push({ code: "overflow", message: "音符が大きく重なっています（1拍に字が入りきりません）", measureIndex: mi, measureId: score.measures[mi]!.id });
  }
  /**
   * 口唱歌・補助行の項目の中心位置。
   * 音符の開始位置なら音符の真上・真下に来る。音符の途中の位置なら、その音符と次の音符の間に、
   * 時間の割合どおりに置く。
   */
  const anchorX = (mi: number, at: string, partId: string) => {
    const tm = maps.get(mi)!;
    const t = toNumber(parseFraction(at) ?? { n: 0, d: 1 });
    const list = cells.get(`${mi}/${partId}`) ?? [];
    const index = list.findIndex((c) => t >= c.onset - 1e-9 && t < c.end - 1e-9);
    const cell = list[index];
    if (!cell) {
      const beat = Math.floor(t + 1e-9);
      return tm.x(t) + (tm.x(beat + 1) - tm.x(beat)) / 2;
    }
    const center = (cell.x0 + cell.x1) / 2;
    const next = list[index + 1];
    const nextCenter = next ? (next.x0 + next.x1) / 2 : center + (tm.x(cell.end) - tm.x(cell.onset));
    return center + ((t - cell.onset) / (cell.end - cell.onset)) * (nextCenter - center);
  };

  /** 入力欄：小節ごとに、1/8拍刻みの置き場所を付けて返す */
  const pushLane = (lane: string, mi: number, partId: string, top: number, height: number) => {
    const stops: LaneBox["stops"] = [];
    const count = Math.ceil(beatsOf(mi) * 8 - 1e-9);
    for (let k = 0; k < count; k++) {
      const at = formatFraction(frac(k, 8));
      stops.push({ at, x: anchorX(mi, at, partId) });
    }
    lanes.push({ lane, measureId: score.measures[mi]!.id, x: mx.get(mi)!, y: top, w: mw.get(mi)!, h: height, stops });
  };

  const spansHere = score.spans.filter((s) => {
    const range = spanRange(ctx, s);
    return range !== null && range[0] <= last && range[1] >= first;
  });

  let y = 0;
  let baseline = 0;
  const rowBounds: { top: number; bottom: number }[] = [];

  parts.forEach((part, pi) => {
    if (pi > 0) y += st.partGap;
    const role: FontRole = part.weight === "bold" ? "main" : "sub";
    const notesLayer = `notes-${part.id}`;
    const tracks = score.tracks.filter((t) => t.below === part.id);

    // この行に置く標記
    const marksHere: { mi: number; mark: Mark }[] = [];
    for (const mi of plan.measures) {
      for (const mark of score.measures[mi]!.marks ?? []) {
        if (mark.part === part.id || (mark.part === undefined && pi === 0)) marksHere.push({ mi, mark });
      }
    }
    const voltas = pi === 0 ? spansHere.filter((s) => s.kind === "volta") : [];
    const partName = isFirst && part.name ? part.name : undefined;
    const rowSpans = spansHere.filter((s) => s.kind !== "volta" && spanPart(ctx, s) === part.id);

    // 行の内容を集める
    const rowEvents: { mi: number; events: Event[] }[] = [];
    let hasShoka = false;
    let maxLines = 0;
    let headroom = 0.5;
    for (const mi of plan.measures) {
      const pm = score.measures[mi]!.content[part.id];
      if (!pm || !isEventsMeasure(pm)) continue;
      rowEvents.push({ mi, events: pm.events });
      if ((pm.shoka?.length ?? 0) > 0 || ctx.forceLanes.has(`shoka:${part.id}`)) hasShoka = true;
      for (const e of pm.events) {
        maxLines = Math.max(maxLines, e.lines);
        headroom = Math.max(headroom, eventTopExtent(st, e, 1) - st.noteSize);
      }
    }

    // 縦方向の帯
    const marksH = marksHere.length > 0 || voltas.length > 0 || partName ? st.markSize * 1.6 : 0;
    const spanH = rowSpans.length > 0 ? 3.4 : 0;
    const shokaH = hasShoka ? st.shokaSize * 1.35 : 0;
    const marksTop = y;
    const spanTop = marksTop + marksH;
    const shokaTop = spanTop + spanH;
    const bodyTop = shokaTop + shokaH + headroom;
    const baseY = bodyTop + st.noteSize;
    const beamH = 0.6 + maxLines * st.beamGap;
    y = baseY + beamH;
    rowBounds.push({ top: bodyTop - 1, bottom: baseY + beamH });
    if (pi === 0) baseline = baseY;

    // 小節線
    for (const mi of plan.measures) {
      const m = score.measures[mi]!;
      drawBarlines(prims, st, m, mx.get(mi)!, mx.get(mi)! + mw.get(mi)!, bodyTop - 1, baseY + beamH, mi === last);
      measureBoxes.push({ measureId: m.id, partId: part.id, x: mx.get(mi)!, y: bodyTop, w: mw.get(mi)!, h: st.noteSize + beamH });
    }

    // 音符
    const geoms = new Map<string, EventGeom>();
    for (const { mi, events } of rowEvents) {
      const m = score.measures[mi]!;
      const rowCells = cells.get(`${mi}/${part.id}`)!;
      const list: EventGeom[] = [];
      events.forEach((e, i) => {
        const cell = rowCells[i]!;
        const g = drawEvent(prims, st, e, cell.x0, cell.x1 - cell.x0, baseY, 1, role, notesLayer);
        list.push(g);
        geoms.set(e.id, g);
        boxes.push({ eventId: e.id, measureId: m.id, partId: part.id, x: cell.x0, y: bodyTop, w: cell.slotEnd - cell.x0, h: st.noteSize + beamH });
      });
      drawBeams(prims, st, events, list, baseY, 1);
    }
    for (const mi of plan.measures) {
      const pm = score.measures[mi]!.content[part.id];
      if (!pm) continue;
      if (!isEventsMeasure(pm)) {
        drawMeasureRepeat(prims, st, mx.get(mi)! + mw.get(mi)! / 2, baseY - st.noteSize / 2, notesLayer, role);
        continue;
      }
      if (hasShoka) pushLane(`shoka:${part.id}`, mi, part.id, shokaTop, shokaH);
      (pm.shoka ?? []).forEach((item, index) => {
        const cx = anchorX(mi, item.at, part.id);
        prims.push({
          t: "text", layer: "shoka", x: cx, y: shokaTop + st.shokaSize * (1 - DESCENT) + 0.2,
          text: item.text, size: st.shokaSize, font: "sub", anchor: "middle",
        });
        const w = Math.max(textEm(item.text) * st.shokaSize, st.shokaSize);
        laneItems.push({ lane: `shoka:${part.id}`, measureId: score.measures[mi]!.id, index, x: cx - w / 2, y: shokaTop, w, h: shokaH });
      });
    }

    // スパン
    for (const span of rowSpans) {
      drawSpan(ctx, prims, span, geoms, first, last, left, systemRight, spanTop, spanH);
    }

    // 標記・1番2番括弧・パート名
    const cursor = new Map<number, number>();
    const markBase = marksTop + st.markSize * 1.2;
    if (partName) {
      const size = st.markSize * 0.75;
      prims.push({ t: "text", layer: "marks", x: left, y: markBase, text: partName, size, font: "sub", anchor: "start" });
      cursor.set(first, left + textEm(partName) * size + 1.5);
    }
    for (const volta of voltas) {
      const [from, to] = spanRange(ctx, volta)!;
      const x1 = from >= first ? mx.get(from)! + 0.4 : left;
      const x2 = to <= last ? mx.get(to)! + mw.get(to)! - 0.4 : systemRight;
      const top = marksTop + 0.4;
      const dash = [0.8, 0.6];
      prims.push({ t: "line", layer: "marks", x1, y1: top, x2, y2: top, width: st.lineWidth, dash });
      if (from >= first) {
        prims.push({ t: "line", layer: "marks", x1, y1: top, x2: x1, y2: top + st.markSize * 1.1, width: st.lineWidth, dash });
        if (volta.startText) {
          const size = st.markSize * 0.7;
          prims.push({ t: "text", layer: "marks", x: x1 + 0.8, y: markBase, text: volta.startText, size, font: "sub", anchor: "start" });
          cursor.set(from, Math.max(cursor.get(from) ?? 0, x1 + 0.8 + textEm(volta.startText) * size + 1));
        }
      }
    }
    for (const { mi, mark } of marksHere) {
      const start = mark.at !== undefined
        ? maps.get(mi)!.x(toNumber(parseFraction(mark.at) ?? { n: 0, d: 1 }))
        : Math.max(cursor.get(mi) ?? 0, mx.get(mi)! + 0.6);
      const end = drawMark(prims, st, mark, start, markBase);
      if (mark.at === undefined) cursor.set(mi, end + 1);
    }

    // 補助行
    for (const track of tracks) {
      const rowH = auxRowHeight(ctx, track, plan);
      if (rowH === 0) continue;
      const placed = drawAuxRow(ctx, prims, track, plan, (mi, at) => anchorX(mi, at, part.id), (mi) => mx.get(mi)! + mw.get(mi)! - st.measurePad, left, systemRight, y, rowH);
      for (const mi of plan.measures) pushLane(`aux:${track.id}`, mi, part.id, y, rowH);
      for (const p of placed) {
        const w = Math.max(p.right - p.left, st.auxTextSize);
        const cx = (p.left + p.right) / 2;
        laneItems.push({ lane: `aux:${track.id}`, measureId: score.measures[p.mi]!.id, index: p.index, x: cx - w / 2, y, w, h: rowH });
      }
      y += rowH;
    }

    // 代替譜
    let hasOssia = false;
    const ossiaSize = st.noteSize * st.ossiaScale;
    const ossiaBase = y + 1 + ossiaSize;
    for (const mi of plan.measures) {
      (score.measures[mi]!.ossia ?? []).forEach((ossia, oi) => {
        if (ossia.part !== part.id) return;
        hasOssia = true;
        const start = maps.get(mi)!.x(toNumber(parseFraction(ossia.at) ?? { n: 0, d: 1 }));
        const labelSize = st.auxTextSize * 0.8;
        prims.push({ t: "text", layer: "ossia", x: start - 1, y: ossiaBase - ossiaSize * 0.2, text: `${ossia.label}…`, size: labelSize, font: "sub", anchor: "end" });
        let ox = start;
        const list: EventGeom[] = [];
        for (const e of ossia.events) {
          const slot = unitWidth(st, e) * st.ossiaScale;
          list.push(drawEvent(prims, st, e, ox, slot, ossiaBase, st.ossiaScale, role, "ossia"));
          boxes.push({ eventId: e.id, measureId: score.measures[mi]!.id, partId: part.id, ossia: oi, x: ox, y: ossiaBase - ossiaSize, w: slot, h: ossiaSize + 2 });
          ox += slot;
        }
        drawBeams(prims, st, ossia.events, list, ossiaBase, st.ossiaScale, "ossia");
        lanes.push({
          lane: `ossia:${part.id}:${oi}`, measureId: score.measures[mi]!.id,
          x: start, y: ossiaBase - ossiaSize, w: Math.max(ox - start, ossiaSize * 2), h: ossiaSize + 2, stops: [],
        });
      });
    }
    if (hasOssia) y = ossiaBase + 0.6 + 3 * st.beamGap * st.ossiaScale;

  });

  // 複数パートをつなぐ角括弧
  if (parts.length > 1 && rowBounds.length > 0) {
    const top = rowBounds[0]!.top - 0.8;
    const bottom = rowBounds[rowBounds.length - 1]!.bottom + 0.8;
    prims.push({ t: "path", layer: "barlines", x: 0.5, y: top, d: `M 1.6 0 H 0 V ${r(bottom - top)} H 1.6`, fill: false, width: 0.6 });
  }

  return { prims, boxes, measureBoxes, lanes, laneItems, height: y, baseline };
}

// ---------------------------------------------------------------- 音符

function glyphSize(st: Style, e: Event, scale: number): number {
  return st.noteSize * st.sizeByLines[e.lines] * scale;
}

/** 重ねた絃名1つ分の大きさ（1つだけなら等倍） */
function chordSubScale(count: number): number {
  return count <= 1 ? 1 : count === 2 ? 0.62 : 0.46;
}

function naturalWidth(st: Style, e: Event, scale: number): number {
  const size = glyphSize(st, e, scale);
  if (e.type === "rest") return size * 0.5;
  if (e.type === "dot") return st.noteSize * scale * 0.34;
  const width = size * widthAspect(st, e);
  if (e.type === "note" && e.strings.length > 1) return width * chordSubScale(e.strings.length) + 1.2 * scale;
  return width;
}

/** 字の縦に対する横の比。音価ごとの縦・横の倍率から決まる（縦横が同じ倍率なら 1） */
function widthAspect(st: Style, e: Event): number {
  return st.widthByLines[e.lines] / st.sizeByLines[e.lines];
}

function prefixWidth(e: Event, scale: number): number {
  return e.type === "note" && e.prefix ? 1.15 * scale : 0;
}

/** 記号の位置の調整：曲全体の分と、音符ごとの分を足す */
function shiftOf(base: readonly [number, number], own: readonly [number, number] | undefined, scale: number): [number, number] {
  return [(base[0] + (own?.[0] ?? 0)) * scale, (base[1] + (own?.[1] ?? 0)) * scale];
}

/** 字を寄せて並べるときの、音符1つ分の幅（前記号・絃名・付点と、次の字との間隔） */
function unitWidth(st: Style, e: Event): number {
  return naturalWidth(st, e, 1) + dotsWidth(e, glyphSize(st, e, 1)) + prefixWidth(e, 1) + 0.5;
}

/** 付点が取る幅。四分音符の付点は大きいので広め、短い音符の付点は字に寄せる */
function dotsWidth(e: Event, size: number): number {
  return e.dots * size * (e.lines === 0 ? 0.36 : 0.26);
}

/** 同じ拍の中で始まる音符のまとまり。[最初の番号, 最後の番号] の並びで返す */
function beatGroups(offsets: readonly number[]): [number, number][] {
  const groups: [number, number][] = [];
  for (let i = 0; i < offsets.length; ) {
    const beat = Math.floor(offsets[i]! + 1e-9);
    let j = i;
    while (j + 1 < offsets.length && Math.floor(offsets[j + 1]! + 1e-9) === beat) j++;
    groups.push([i, j]);
    i = j + 1;
  }
  return groups;
}

function pressOf(e: Event): StringRef["press"] {
  return e.type === "note" ? e.strings.find((s) => s.press)?.press : undefined;
}

/** ベースラインの下端から、上記号を含めた上端までの高さ */
function eventTopExtent(st: Style, e: Event, scale: number): number {
  const size = glyphSize(st, e, scale);
  const count = e.type === "note" ? e.strings.length : 1;
  const glyphH = count > 1 ? size * chordSubScale(count) * count : size;
  const above = (pressOf(e) ? PRESS_HEIGHT + 0.4 : 0) + (e.above?.length ?? 0) * st.supSize * 1.1;
  const sup = (e.sup?.length ?? 0) > 0 ? st.supSize * 0.7 : 0;
  return glyphH + Math.max(above * scale, sup * scale);
}

function drawEvent(
  prims: Prim[],
  st: Style,
  e: Event,
  x0: number,
  /** 音符を置く枠の幅。前記号・絃名・付点をひとまとまりとして、この中央に置く */
  slotW: number,
  baseY: number,
  scale: number,
  role: FontRole,
  layer: string,
): EventGeom {
  const size = glyphSize(st, e, scale);
  const natural = naturalWidth(st, e, scale);
  const prefixW = prefixWidth(e, scale);
  const dotsW = dotsWidth(e, size);
  // 字は枠に合わせて詰めない。横の倍率は、音価ごとの縦横比だけで決まる
  const sx = e.type === "rest" || e.type === "dot" ? 1 : widthAspect(st, e);
  const w = natural;
  const unitLeft = x0 + (slotW - prefixW - w - dotsW) / 2;
  const left = unitLeft + prefixW;
  const cx = left + w / 2;
  let top = baseY - size;
  const techLayer = layer === "ossia" ? "ossia" : "techniques";
  const durLayer = layer === "ossia" ? "ossia" : "durations";

  if (e.type === "dot") {
    // 拍の中に置く付点：長いほど大きい点。四分音符の付点と同じ高さに打つ
    const unit = st.noteSize * scale;
    prims.push({ t: "circle", layer: durLayer, cx, cy: baseY - unit * 0.34, r: unit * (e.lines <= 1 ? 0.1 : 0.08), fill: true });
  } else if (e.type === "rest") {
    const custom = customGlyph(st, "○", role);
    if (custom) prims.push(placeGlyph(custom, layer, cx, baseY, size, 1));
    else {
      // 元譜の休符は、太い線の大きめの丸
      const rad = size * 0.27;
      prims.push({ t: "circle", layer, cx, cy: baseY - size * 0.45, r: rad, fill: false, width: size * 0.085 });
    }
  } else if (e.type === "sign") {
    const custom = customGlyph(st, e.sign, role);
    prims.push(custom ? placeGlyph(custom, layer, cx, baseY, size, sx) : glyph(layer, cx, baseY, e.sign, size, role, sx));
  } else if (e.strings.length <= 1) {
    const s = e.strings[0];
    prims.push(s ? stringPrim(st, layer, cx, baseY, s.n, size, role, sx) : glyph(layer, cx, baseY, "？", size, role, sx));
  } else {
    const count = e.strings.length;
    const sub = size * chordSubScale(count);
    const gx = cx + (e.chord === "arc" ? 0.4 * scale : 0);
    top = baseY - sub * count;
    e.strings.forEach((s, i) => {
      prims.push(stringPrim(st, layer, gx, top + sub * (i + 1), s.n, sub, role, sx));
    });
    const h = sub * count;
    const halfW = (sub * sx) / 2;
    if (e.chord === "arc") {
      const bulge = 1.3 * scale;
      prims.push({ t: "path", layer: techLayer, x: gx - halfW - 0.3 * scale, y: top, d: `M 0 0 Q ${r(-bulge)} ${r(h / 2)} 0 ${r(h)}`, fill: false, width: st.lineWidth });
    } else if (e.chord === "circle") {
      const rx = halfW + 0.7 * scale;
      const ry = h / 2 + 0.4 * scale;
      prims.push({
        t: "path", layer: techLayer, x: gx - rx, y: top + h / 2,
        d: `M 0 0 a ${r(rx)} ${r(ry)} 0 1 0 ${r(rx * 2)} 0 a ${r(rx)} ${r(ry)} 0 1 0 ${r(-rx * 2)} 0 Z`, fill: false, width: st.lineWidth,
      });
    }
  }
  const right = cx + w / 2;

  // 付点。元譜では、四分音符の付点は大きく中ほどに、短い音符の付点は小さく下寄りに打つ
  const bigDot = e.lines === 0;
  for (let i = 0; i < e.dots; i++) {
    prims.push({
      t: "circle", layer: durLayer,
      cx: right + size * (bigDot ? 0.2 + 0.36 * i : 0.14 + 0.26 * i), cy: baseY - size * (bigDot ? 0.34 : 0.14), r: size * (bigDot ? 0.1 : 0.07), fill: true,
    });
  }

  // 前記号（かき爪・わり爪）：左上から、やや右下がりの短い線を引き、そのまま細かい波を打ちながら下りる。
  // かき爪は絃名の中ほどまで、わり爪はそれより短い。次の音符の記号に掛からないよう、絃名に寄せて置く
  if (e.type === "note" && e.prefix) {
    const rise = 0.9 * scale;
    const length = rise + (baseY - top) * (e.prefix === "kaki" ? 0.7 : 0.42);
    const wave = 0.42 * scale;
    const count = Math.max(4, Math.round(length / wave));
    const step = length / count;
    const amp = 0.55 * scale;
    const bar = 0.95 * scale;
    const drop = 0.18 * scale;
    let d = `M ${r(-bar)} ${r(-drop)} L 0 0`;
    for (let i = 0; i < count; i++) d += ` q ${r(i % 2 === 0 ? amp : -amp)} ${r(step / 2)} 0 ${r(step)}`;
    const [px, py] = shiftOf(st.prefixShift, e.prefixShift, scale);
    prims.push({ t: "path", layer: techLayer, x: unitLeft + bar + 0.05 * scale + px, y: top - rise + drop + py, d, fill: false, width: st.lineWidth * 0.9 });
  }

  // 上記号：押し手、文字
  // 絃名の字は枠より少し小さいので、押し手は枠の上端に少し食い込ませて字に寄せる
  let ay = top + size * 0.04;
  const press = pressOf(e);
  if (press) {
    drawPress(prims, techLayer, cx, ay, press, scale, st.lineWidth);
    ay -= (PRESS_HEIGHT + 0.45) * scale;
  }
  const aboveSize = st.supSize * scale;
  for (const a of e.above ?? []) {
    if (a === "fermata") {
      const rad = aboveSize * 0.6;
      prims.push({ t: "path", layer: techLayer, x: cx, y: ay, d: `M ${r(-rad)} 0 A ${r(rad)} ${r(rad)} 0 0 1 ${r(rad)} 0`, fill: false, width: st.lineWidth });
      prims.push({ t: "circle", layer: techLayer, cx, cy: ay - rad * 0.25, r: rad * 0.16, fill: true });
    } else if (a === "甲") {
      prims.push({ t: "circle", layer: techLayer, cx, cy: ay - aboveSize * 0.4, r: aboveSize * 0.14, fill: true });
    } else {
      prims.push({ t: "text", layer: techLayer, x: cx, y: ay - aboveSize * DESCENT, text: a, size: aboveSize, font: "sub", anchor: "middle" });
    }
    ay -= aboveSize * 1.1;
  }

  // 右肩記号
  const supSize = st.supSize * scale;
  // 次の音符の前記号に掛からないよう、絃名の右上の角に食い込ませて置く
  const [supX, supY] = shiftOf(st.supShift, e.supShift, scale);
  let sxPos = right - supSize * 1.05 + supX;
  for (const s of e.sup ?? []) {
    prims.push({ t: "text", layer: techLayer, x: sxPos, y: top + supSize * 0.22 + supY, text: s, size: supSize, font: "sub", anchor: "start" });
    sxPos += textEm(s) * supSize;
  }

  return { cx, left, right, top, baseY };
}

function glyph(layer: string, cx: number, bottom: number, text: string, size: number, font: FontRole, sx: number): Prim {
  return {
    t: "text", layer, x: cx, y: bottom - size * DESCENT, text, size, font, anchor: "middle",
    ...(Math.abs(sx - 1) > 0.001 ? { scaleX: sx } : {}),
  };
}

/** 絃名1字。独自字形が登録されていればその形で、なければフォントの文字で描く */
function stringPrim(st: Style, layer: string, cx: number, bottom: number, n: number, size: number, role: FontRole, sx: number): Prim {
  const custom = customGlyph(st, `${n}`, role);
  return custom ? placeGlyph(custom, layer, cx, bottom, size, sx) : glyph(layer, cx, bottom, stringGlyph(st, n), size, role, sx);
}

/** 登録されている独自字形。使う範囲の外（細い書体のパートなど）なら undefined */
function customGlyph(st: Style, key: string, role: FontRole): GlyphDef | undefined {
  return role === "main" || st.glyphScope === "all" ? st.glyphs?.glyphs[key] : undefined;
}

/** 独自字形を、枠の高さが size になるように置く。(cx, bottom) が枠の下辺の中央 */
function placeGlyph(def: GlyphDef, layer: string, cx: number, bottom: number, size: number, sx: number): Prim {
  const [bx, by, bw, bh] = def.box;
  const k = size / bh;
  return {
    t: "path", layer, x: cx - (bw * k * sx) / 2, y: bottom - size, d: def.d, fill: true,
    place: { sx: k * sx, sy: k, ox: bx, oy: by },
  };
}

function stringGlyph(st: Style, n: number): string {
  return st.stringGlyphs[n - 1] ?? "？";
}

/**
 * 押し手の三角。(cx, bottom) が底辺の中央。絃名のすぐ上に小さく載せる。
 * 一重は白抜き、二重は黒、三重は白抜きの中に点
 */
function drawPress(prims: Prim[], layer: string, cx: number, bottom: number, press: 1 | 2 | 3, scale: number, lineWidth: number): void {
  const w = 0.8 * scale;
  const h = PRESS_HEIGHT * scale;
  prims.push({ t: "path", layer, x: cx, y: bottom, d: `M ${r(-w)} 0 L ${r(w)} 0 L 0 ${r(-h)} Z`, fill: press === 2, width: lineWidth });
  if (press === 3) prims.push({ t: "circle", layer, cx, cy: bottom - h * 0.32, r: h * 0.17, fill: true });
}

function drawBeams(prims: Prim[], st: Style, events: readonly Event[], geoms: readonly EventGeom[], baseY: number, scale: number, layer = "durations"): void {
  events.forEach((e, i) => {
    const g = geoms[i]!;
    const next = events[i + 1];
    const nextG = geoms[i + 1];
    // 拍の中に置く付点には音価線を引かない
    if (e.type === "dot") return;
    for (let k = 1; k <= e.lines; k++) {
      const y = baseY + (0.5 + (k - 1) * st.beamGap) * scale;
      const joined = next?.joinPrev && nextG && next.lines >= k && next.type !== "dot";
      prims.push({ t: "line", layer, x1: g.left, y1: y, x2: joined ? nextG.left : g.right, y2: y, width: st.beamWidth * scale });
    }
  });
}

/** 前小節くり返し */
function drawMeasureRepeat(prims: Prim[], st: Style, cx: number, cy: number, layer: string, role: FontRole): void {
  const custom = customGlyph(st, "⁒", role);
  if (custom) {
    prims.push(placeGlyph(custom, layer, cx, cy + st.noteSize / 2, st.noteSize, 1));
    return;
  }
  const h = st.noteSize * 0.3;
  prims.push({ t: "line", layer, x1: cx - h, y1: cy + h, x2: cx + h, y2: cy - h, width: 0.5 });
  prims.push({ t: "circle", layer, cx: cx - h * 0.75, cy: cy - h * 0.55, r: 0.4, fill: true });
  prims.push({ t: "circle", layer, cx: cx + h * 0.75, cy: cy + h * 0.55, r: 0.4, fill: true });
}

// ---------------------------------------------------------------- 小節線

function drawBarlines(prims: Prim[], st: Style, m: Measure, x1: number, x2: number, top: number, bottom: number, isSystemEnd: boolean): void {
  const layer = "barlines";
  const thin = (x: number) => prims.push({ t: "line", layer, x1: x, y1: top, x2: x, y2: bottom, width: st.lineWidth });
  const thick = (x: number) => prims.push({ t: "line", layer, x1: x, y1: top, x2: x, y2: bottom, width: 0.8 });
  const dots = (x: number) => {
    const mid = (top + bottom) / 2;
    prims.push({ t: "circle", layer, cx: x, cy: mid - 1.1, r: 0.35, fill: true });
    prims.push({ t: "circle", layer, cx: x, cy: mid + 1.1, r: 0.35, fill: true });
  };

  if (m.startRepeat) {
    thick(x1 + 0.4);
    thin(x1 + 1.3);
    dots(x1 + 2.2);
  }
  switch (m.barline ?? "single") {
    case "single":
      // 段の右端は枠に任せて引かない
      if (!isSystemEnd) thin(x2);
      break;
    case "double":
      thin(x2 - 0.9);
      thin(x2);
      break;
    case "final":
      thin(x2 - 1.3);
      thick(x2 - 0.4);
      break;
    case "repeatEnd":
      dots(x2 - 2.2);
      thin(x2 - 1.3);
      thick(x2 - 0.4);
      break;
    case "none":
      break;
  }
}

// ---------------------------------------------------------------- 標記

/** 標記を描き、右端の x を返す */
function drawMark(prims: Prim[], st: Style, mark: Mark, x: number, baseline: number): number {
  const layer = "marks";
  const size = mark.kind === "section" || mark.kind === "rehearsal" ? st.markSize : st.markSize * 0.8;
  const text = mark.enclosure === "paren" ? `(${mark.text})` : mark.text;
  const w = textEm(text) * size;
  let end: number;

  if (mark.enclosure === "circle" || mark.enclosure === "box") {
    const inner = size * 0.82;
    const half = Math.max(size * 0.62, (textEm(text) * inner) / 2 + 0.5);
    const cy = baseline - size * 0.36;
    if (mark.enclosure === "circle") {
      prims.push({ t: "circle", layer, cx: x + half, cy, r: half, fill: false, width: st.lineWidth });
    } else {
      const hh = size * 0.62;
      prims.push({ t: "path", layer, x: x, y: cy - hh, d: `M 0 0 H ${r(half * 2)} V ${r(hh * 2)} H 0 Z`, fill: false, width: st.lineWidth });
    }
    prims.push({ t: "text", layer, x: x + half, y: cy + inner * (0.5 - DESCENT), text, size: inner, font: "sub", anchor: "middle" });
    end = x + half * 2;
  } else {
    prims.push({ t: "text", layer, x, y: baseline, text, size, font: "sub", anchor: "start" });
    end = x + w;
  }

  if (mark.note) {
    const noteSize = size * 0.8;
    prims.push({ t: "text", layer, x: end + 1, y: baseline, text: mark.note, size: noteSize, font: "sub", anchor: "start" });
    end += 1 + textEm(mark.note) * noteSize;
  }
  return end;
}

// ---------------------------------------------------------------- スパン

/** スパンが掛かる小節の範囲（通し番号） */
function spanRange(ctx: Ctx, span: Span): [number, number] | null {
  const lookup = span.kind === "volta" ? ctx.measureIndexById : ctx.eventMeasure;
  const from = lookup.get(span.from);
  const to = lookup.get(span.to);
  return from === undefined || to === undefined ? null : [from, to];
}

function spanPart(ctx: Ctx, span: Span): string | undefined {
  if (span.part) return span.part;
  const mi = ctx.eventMeasure.get(span.from);
  if (mi === undefined) return undefined;
  for (const [partId, pm] of Object.entries(ctx.score.measures[mi]!.content)) {
    if (isEventsMeasure(pm) && pm.events.some((e) => e.id === span.from)) return partId;
  }
  return undefined;
}

function drawSpan(
  ctx: Ctx,
  prims: Prim[],
  span: Span,
  geoms: Map<string, EventGeom>,
  first: number,
  last: number,
  left: number,
  right: number,
  top: number,
  height: number,
): void {
  const { st } = ctx;
  const layer = "techniques";
  const [fromMi, toMi] = spanRange(ctx, span)!;
  const from = fromMi >= first ? geoms.get(span.from) : undefined;
  const to = toMi <= last ? geoms.get(span.to) : undefined;
  const mid = top + height / 2;
  const size = st.supSize;
  const textY = mid + size * (0.5 - DESCENT);

  if (span.kind === "pressBracket") {
    const x1 = from ? from.cx : left;
    const x2 = to ? to.cx : right;
    const h = height - 0.8;
    const d = `${from ? `M 0 ${r(h)} V 0` : "M 0 0"} H ${r(x2 - x1)}${to ? ` V ${r(h)}` : ""}`;
    prims.push({ t: "path", layer, x: x1, y: top + 0.4, d, fill: false, width: st.lineWidth });
    return;
  }

  let x1 = from ? from.cx : left;
  let x2 = to ? (span.kind === "dash" ? to.right : to.cx) : right;
  if (from && span.startText) {
    prims.push({ t: "text", layer, x: x1, y: textY, text: span.startText, size, font: "sub", anchor: "middle" });
    x1 += (textEm(span.startText) * size) / 2 + 0.4;
  }
  if (to && span.endText) {
    prims.push({ t: "text", layer, x: x2, y: textY, text: span.endText, size, font: "sub", anchor: "middle" });
    x2 -= (textEm(span.endText) * size) / 2 + 0.4;
  }
  if (x2 - x1 < 0.5) return;

  if (span.kind === "dash") {
    prims.push({ t: "line", layer, x1, y1: mid, x2, y2: mid, width: st.lineWidth, dash: [0.9, 0.7] });
  } else {
    const half = 0.8;
    const count = Math.max(2, Math.floor((x2 - x1) / half));
    const step = (x2 - x1) / count;
    let d = "M 0 0";
    for (let i = 0; i < count; i++) d += ` q ${r(step / 2)} ${i % 2 === 0 ? -1 : 1} ${r(step)} 0`;
    prims.push({ t: "path", layer, x: x1, y: mid, d, fill: false, width: st.lineWidth });
  }
}

// ---------------------------------------------------------------- 補助行

function trackHasPress(ctx: Ctx, track: AuxTrack, plan: SystemPlan): boolean {
  return plan.measures.some((mi) =>
    (ctx.score.measures[mi]!.aux?.[track.id] ?? []).some((item) => item.notes?.some((n) => n.press)),
  );
}

/** この段での補助行の高さ。項目も延ばし線もなければ 0 */
function auxRowHeight(ctx: Ctx, track: AuxTrack, plan: SystemPlan): number {
  const { st, score } = ctx;
  const hasItems = plan.measures.some((mi) => (score.measures[mi]!.aux?.[track.id]?.length ?? 0) > 0);
  if (!hasItems && !ctx.extendOpen.has(track.id) && !ctx.forceLanes.has(`aux:${track.id}`)) return 0;
  switch (track.kind) {
    case "pitch":
      return st.auxNoteSize * 1.3 + (trackHasPress(ctx, track, plan) ? PRESS_HEIGHT * 0.6 + 0.3 : 0);
    case "rhythm":
      return st.auxTextSize * 1.3 + 3 * st.beamGap * 0.7;
    default:
      return st.auxTextSize * 1.35;
  }
}

interface PlacedAuxItem {
  left: number;
  right: number;
  item: AuxItem;
  mi: number;
  index: number;
}

function auxItemText(item: AuxItem): string {
  const text = item.text ?? "";
  if (item.enclosure === "paren") return `(${text})`;
  if (item.enclosure === "bracket") return `〔${text}〕`;
  return text;
}

function drawAuxRow(
  ctx: Ctx,
  prims: Prim[],
  track: AuxTrack,
  plan: SystemPlan,
  anchorX: (mi: number, at: string) => number,
  measureRight: (mi: number) => number,
  left: number,
  right: number,
  top: number,
  height: number,
): PlacedAuxItem[] {
  const { st, score } = ctx;
  const layer = `aux-${track.id}`;
  const isPitch = track.kind === "pitch";
  const isRhythm = track.kind === "rhythm";
  const size = isPitch ? st.auxNoteSize : st.auxTextSize;
  const bottom = isRhythm ? top + st.auxTextSize * 1.3 : top + height;
  const baseline = bottom - size * (DESCENT + 0.1);
  const lineY = bottom - size * 0.55;

  const placed: PlacedAuxItem[] = [];
  for (const mi of plan.measures) {
    (score.measures[mi]!.aux?.[track.id] ?? []).forEach((item, index) => {
      const cx = anchorX(mi, item.at);
      let w: number;
      if (item.notes && item.notes.length > 0) {
        w = item.notes.length * size;
        item.notes.forEach((n, i) => {
          const nx = cx - w / 2 + size * (i + 0.5);
          prims.push({ t: "text", layer, x: nx, y: baseline, text: stringGlyph(st, n.n), size, font: "sub", anchor: "middle" });
          if (n.press) drawPress(prims, layer, nx, bottom - size * 1.1, n.press, 0.6, st.lineWidth * 0.8);
        });
      } else {
        const text = auxItemText(item);
        w = textEm(text) * size;
        prims.push({ t: "text", layer, x: cx, y: baseline, text, size, font: "sub", anchor: "middle" });
      }
      placed.push({ left: cx - w / 2, right: cx + w / 2, item, mi, index });
    });
  }

  if (track.label && placed.length > 0) {
    const last = placed[placed.length - 1]!;
    prims.push({ t: "text", layer, x: last.right + 1, y: baseline, text: track.label, size: size * 0.8, font: "sub", anchor: "start" });
  }

  // リズム唱歌の音価線
  if (isRhythm) {
    placed.forEach((p, i) => {
      const next = placed[i + 1];
      for (let k = 1; k <= (p.item.lines ?? 0); k++) {
        const y = bottom + (0.3 + (k - 1) * st.beamGap) * 0.7;
        const joined = next?.item.joinPrev && (next.item.lines ?? 0) >= k;
        prims.push({ t: "line", layer, x1: p.left, y1: y, x2: joined ? next.left : p.right, y2: y, width: st.beamWidth * 0.7 });
      }
    });
  }

  // 延ばし線
  const gap = 0.6;
  const line = (x1: number, x2: number) => {
    if (x2 - x1 > 0.8) prims.push({ t: "line", layer, x1, y1: lineY, x2, y2: lineY, width: 0.18 });
  };
  if (ctx.extendOpen.has(track.id)) {
    line(left, placed.length > 0 ? placed[0]!.left - gap : right);
  }
  const lastMeasure = plan.measures[plan.measures.length - 1]!;
  const continues = (ctx.lastAuxMeasure.get(track.id) ?? -1) > lastMeasure;
  placed.forEach((p, i) => {
    if (!p.item.extend) return;
    const next = placed[i + 1];
    if (next) line(p.right + gap, next.left - gap);
    else line(p.right + gap, continues ? right : measureRight(p.mi));
  });
  if (placed.length > 0) {
    if (placed[placed.length - 1]!.item.extend && continues) ctx.extendOpen.add(track.id);
    else ctx.extendOpen.delete(track.id);
  } else if (!continues) {
    ctx.extendOpen.delete(track.id);
  }
  return placed;
}

function r(n: number): number {
  return Math.round(n * 1000) / 1000;
}
