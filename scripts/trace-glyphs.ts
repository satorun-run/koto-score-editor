// スキャン画像から絃名と記号の字形を起こし、字形セット（glyphs/*.glyphs.json）を作る。
// 使い方: npm run trace-glyphs
//
// 字形の切り出し位置は下の SOURCES に、元画像のピクセル座標で書く。
// 出来上がりは out/glyphs-preview.svg で確認できる。

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Jimp from "jimp";
import potrace from "potrace";
import type { GlyphDef, GlyphSet } from "../src/layout/style";

interface Source {
  /** 絃番号 "1"〜"13"、または記号（ワ・ス・○・⁒） */
  key: string;
  image: string;
  /** 切り出す範囲 [x, y, 幅, 高さ]。隣の字や記号が入らないように取る */
  box: [number, number, number, number];
  /** 範囲の中で白く消す部分（右肩の指番号など）[x, y, 幅, 高さ] */
  erase?: [number, number, number, number][];
  /** 切り出し元が四分音符の大きさでないとき、四分音符に対する比（八分なら 0.92 など） */
  sourceScale?: number;
  /** 他の字と倍率をそろえず、字の大きいほうの辺が枠のこの割合になるようにする（別の譜面から取る記号用） */
  fit?: number;
  /** 字の枠を、字の幅に合わせて狭くする（休符の丸など、幅の狭い記号用） */
  tight?: boolean;
}

const SOURCES: Source[] = [
  { key: "1", image: "rokudan/p1.jpg", box: [1068, 738, 88, 96], erase: [[1129, 734, 27, 23]] },
  { key: "2", image: "rokudan/p4.jpg", box: [490, 2612, 86, 90] },
  { key: "3", image: "rokudan/p5.jpg", box: [342, 366, 92, 80] },
  { key: "4", image: "rokudan/p5.jpg", box: [228, 374, 96, 64] },
  { key: "5", image: "rokudan/p2.jpg", box: [1653, 1878, 96, 78] },
  { key: "6", image: "rokudan/p2.jpg", box: [1550, 1875, 80, 80] },
  { key: "7", image: "rokudan/p2.jpg", box: [1780, 1872, 76, 80], erase: [[1834, 1866, 26, 27]] },
  { key: "8", image: "rokudan/p4.jpg", box: [1410, 366, 104, 72] },
  { key: "9", image: "rokudan/p4.jpg", box: [1300, 364, 98, 76] },
  { key: "10", image: "rokudan/p1.jpg", box: [703, 2245, 92, 100] },
  { key: "11", image: "rokudan/p1.jpg", box: [598, 2248, 82, 100] },
  { key: "12", image: "rokudan/p2.jpg", box: [1896, 1873, 76, 82] },
  { key: "13", image: "rokudan/p1.jpg", box: [938, 2248, 88, 100] },
  { key: "ワ", image: "rokudan/p2.jpg", box: [1668, 1124, 80, 68] },
  { key: "ス", image: "rokudan/p2.jpg", box: [630, 2254, 56, 60], erase: [[681, 2278, 8, 38]], sourceScale: 0.92 },
  { key: "○", image: "rokudan/p1.jpg", box: [250, 753, 80, 76], tight: true },
  { key: "⁒", image: "ikuyamakawa/p2.jpg", box: [1206, 1378, 82, 80], fit: 0.8 },
];

/** 拡大してからなぞると、輪郭がなめらかになる */
const UPSCALE = 6;
const EM = 1000;
const root = new URL("../", import.meta.url);

interface Traced {
  source: Source;
  /** パスの命令ごとの点の並び */
  segments: { cmd: string; points: [number, number][] }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

async function traceOne(source: Source): Promise<Traced> {
  const image = await Jimp.read(fileURLToPath(new URL(`scans/${source.image}`, root)));
  const [x, y, w, h] = source.box;
  for (const [ex, ey, ew, eh] of source.erase ?? []) {
    image.scan(ex, ey, ew, eh, function (_px, _py, idx) {
      this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = 255;
    });
  }
  // 印刷のかすれやスキャンのざらつきで輪郭ががたつくので、ぼかしてから白黒に分ける
  image.crop(x, y, w, h).scale(UPSCALE, Jimp.RESIZE_BICUBIC).greyscale().blur(Math.round(UPSCALE * 0.9));
  const png = await image.getBufferAsync(Jimp.MIME_PNG);

  const tag = await new Promise<string>((resolve, reject) => {
    const tracer = new potrace.Potrace({ threshold: 128, turdSize: 12 * UPSCALE * UPSCALE, alphaMax: 1.1, optTolerance: 1.2 });
    // ライブラリの版によって、コールバックの引数が (エラー) の場合と (本体, エラー) の場合がある
    tracer.loadImage(png, (first: unknown, second?: Error | null) => {
      const err = first instanceof Error ? first : second;
      if (err) reject(err);
      else resolve((tracer as unknown as { getPathTag(): string }).getPathTag());
    });
  });
  const d = /\sd="([^"]+)"/.exec(tag)?.[1];
  if (!d) throw new Error(`「${source.key}」の輪郭を取れませんでした`);

  const segments: Traced["segments"] = [];
  for (const m of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const cmd = m[1]!;
    if (!"MLCZ".includes(cmd)) throw new Error(`想定外のパス命令 ${cmd}`);
    const nums = (m[2]!.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
    const points: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i]!, nums[i + 1]!]);
    segments.push({ cmd, points });
  }
  const all = segments.flatMap((s) => s.points);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  return { source, segments, bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
}

const traced: Traced[] = [];
for (const source of SOURCES) traced.push(await traceOne(source));

const extent = (t: Traced) => Math.max(t.bounds.maxX - t.bounds.minX, t.bounds.maxY - t.bounds.minY);
// 絃名には同じ倍率を掛け、字の大小の関係を保つ。いちばん大きい字が枠の 94% になるようにする
const largest = Math.max(...traced.filter((t) => /^\d+$/.test(t.source.key)).map(extent));
const common = (EM * 0.94) / largest;

const glyphs: Record<string, GlyphDef> = {};
for (const t of traced) {
  const k = t.source.fit ? (EM * t.source.fit) / extent(t) : common / (t.source.sourceScale ?? 1);
  const cx = (t.bounds.minX + t.bounds.maxX) / 2;
  const cy = (t.bounds.minY + t.bounds.maxY) / 2;
  // 枠の幅：ふつうは正方形。tight なら字の幅に左右の余白を足した幅
  const width = t.source.tight ? Math.round((t.bounds.maxX - t.bounds.minX) * k + EM * 0.16) : EM;
  const fmt = (v: number) => `${Math.round(v * 10) / 10}`;
  const d = t.segments
    .map((s) => `${s.cmd}${s.points.map(([px, py]) => `${fmt((px - cx) * k + width / 2)} ${fmt((py - cy) * k + EM / 2)}`).join(" ")}`)
    .join("");
  glyphs[t.source.key] = { d, box: [0, 0, width, EM] };
}

const set: GlyphSet = { name: "元譜から起こした字形", glyphs };
mkdirSync(new URL("glyphs/", root), { recursive: true });
writeFileSync(new URL("glyphs/rokudan-traced.glyphs.json", root), JSON.stringify(set));

// 確認用：横に並べる
mkdirSync(new URL("out/", root), { recursive: true });
const cell = 60;
const preview = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${cell * traced.length}" height="${cell}" viewBox="0 0 ${cell * traced.length} ${cell}">`,
  `<rect width="100%" height="100%" fill="#fff"/>`,
  ...traced.map((t, i) => `<path transform="translate(${i * cell} 0) scale(${cell / EM})" d="${glyphs[t.source.key]!.d}" fill-rule="evenodd"/>`),
  ...traced.map((t, i) => `<rect x="${i * cell}" y="0" width="${(cell * glyphs[t.source.key]!.box[2]) / EM}" height="${cell}" fill="none" stroke="#f99" stroke-width="0.3"/>`),
  "</svg>",
].join("\n");
writeFileSync(new URL("out/glyphs-preview.svg", root), preview);
console.log(`字形 ${traced.length} 個を glyphs/rokudan-traced.glyphs.json に書き出しました`);
