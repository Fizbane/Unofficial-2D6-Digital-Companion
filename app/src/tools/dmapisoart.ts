// Isometric art for the dungeon map: furniture built from simple 3D shapes (boxes, cylinders,
// spheres), art that hangs on the back walls, and the doors. Flat things (rugs, blood, puddles,
// bones…) are not here: the isometric view paints their top-down drawing onto the floor.
// See docs/iso-art-plan.md for the plan to replace these with hand-drawn sprites.
import type { DecorItem } from "./dmapdecor";
import type { ExitType } from "./dmap";
import { html, type Raw } from "../ui/html";

export const HX = 17; // screen px per grid square along x (half a tile's width)
export const HY = 8.5; // screen px per grid square along y (half a tile's height)
export const WALL_H = 24; // wall height in screen px
const CELL = 26; // top-down px per square

export const iso = (gx: number, gy: number, z = 0): [number, number] => [(gx - gy) * HX, (gx + gy) * HY - z];
const f1 = (n: number) => Math.round(n * 10) / 10;
const pt = (p: [number, number]) => `${f1(p[0])} ${f1(p[1])}`;
const poly = (pts: [number, number][], fill: string, extra: Raw | "" = "") => html`<path d="M${pts.map(pt).join("L")}Z" fill="${fill}" ${extra}/>`;

function rnd(x: number, y: number, k = 0): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + k * 2246822519, 1274126177) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const pick = <T,>(a: T[], r: number) => a[Math.floor(r * a.length) % a.length];

/** Lighten (f > 1) or darken (f < 1) a #rrggbb colour. */
export function shade(hex: string, f: number): string {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m || m.length < 3) return hex;
  const c = m.slice(0, 3).map((x) => {
    const v = parseInt(x, 16);
    return Math.max(0, Math.min(255, Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f)));
  });
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const INK = "#1c1612";
const WOOD = "#8a5a32", WOOD_D = "#5e3b1f", WOOD_L = "#b58a55";
const STONE = "#bdb4a3", STONE_D = "#8f8676";
const GOLD = "#e2b44a", IRON = "#4a4f57", STEEL = "#c3cbd3";
const CLOTH = ["#a8323a", "#2f5b8a", "#3d7a4a", "#7a4a8a", "#b0742a"];
const BOOKS = ["#7b2d2d", "#2d4f7b", "#2d6b3f", "#8a6d2a", "#5b2d6b", "#a04a2a"];

// ---------- 3D primitives (grid units; z and h in screen px) ----------
/** A box centred on (gx,gy): w along x, d along y, h tall, sitting at height z. */
export function box(gx: number, gy: number, w: number, d: number, h: number, col: string, z = 0, line = INK): Raw {
  const x0 = gx - w / 2, x1 = gx + w / 2, y0 = gy - d / 2, y1 = gy + d / 2;
  const s = html`stroke="${line}" stroke-width=".6" stroke-linejoin="round"`;
  return (
    html`${poly([iso(x0, y1, z), iso(x1, y1, z), iso(x1, y1, z + h), iso(x0, y1, z + h)], col, s)}${poly([iso(x1, y0, z), iso(x1, y1, z), iso(x1, y1, z + h), iso(x1, y0, z + h)], shade(col, 0.78), s)}${poly([iso(x0, y0, z + h), iso(x1, y0, z + h), iso(x1, y1, z + h), iso(x0, y1, z + h)], shade(col, 1.18), s)}` // top
  );
}
/** A cylinder standing on (gx,gy), radius r (grid units), h tall. */
export function cyl(gx: number, gy: number, r: number, h: number, col: string, z = 0, line = INK): Raw {
  const [cx, cy] = iso(gx, gy, z);
  const rx = r * HX * 1.414, ry = r * HY * 1.414;
  return html`<path d="M${f1(cx - rx)} ${f1(cy - h)}L${f1(cx - rx)} ${f1(cy)}A${f1(rx)} ${f1(ry)} 0 0 0 ${f1(cx + rx)} ${f1(cy)}L${f1(cx + rx)} ${f1(cy - h)}Z" fill="${shade(col, 0.82)}" stroke="${line}" stroke-width=".6"/><ellipse cx="${f1(cx)}" cy="${f1(cy - h)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="${shade(col, 1.15)}" stroke="${line}" stroke-width=".6"/>`;
}
export function sphere(gx: number, gy: number, z: number, r: number, col: string): Raw {
  const [cx, cy] = iso(gx, gy, z);
  return html`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${r}" fill="${col}" stroke="${INK}" stroke-width=".6"/><circle cx="${f1(cx - r / 3)}" cy="${f1(cy - r / 3)}" r="${f1(r / 3)}" fill="#fff" opacity=".45"/>`;
}
export function flame(gx: number, gy: number, z: number, r = 3): Raw {
  const [cx, cy] = iso(gx, gy, z);
  return html`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r * 2.4)}" fill="#ffb347" opacity=".25"/><path d="M${f1(cx - r)} ${f1(cy)} Q${f1(cx)} ${f1(cy - r * 3)} ${f1(cx + r)} ${f1(cy)} Q${f1(cx)} ${f1(cy + r)} ${f1(cx - r)} ${f1(cy)}Z" fill="#f07b22"/><circle cx="${f1(cx)}" cy="${f1(cy - r * 0.4)}" r="${f1(r * 0.45)}" fill="#ffe08a"/>`;
}
/** Lines drawn on the +y face (along x) or the +x face (along y) of a box, at heights given in px. */
function faceStripes(gx: number, gy: number, w: number, d: number, alongX: boolean, colours: string[], z0: number, z1: number) {
  let g = html``;
  const n = colours.length;
  for (let i = 0; i < n; i++) {
    const t0 = 0.08 + (i / n) * 0.84, t1 = t0 + 0.84 / n - 0.03;
    const p = alongX
      ? [iso(gx - w / 2 + w * t0, gy + d / 2, z0), iso(gx - w / 2 + w * t1, gy + d / 2, z0), iso(gx - w / 2 + w * t1, gy + d / 2, z1), iso(gx - w / 2 + w * t0, gy + d / 2, z1)]
      : [iso(gx + w / 2, gy - d / 2 + d * t0, z0), iso(gx + w / 2, gy - d / 2 + d * t1, z0), iso(gx + w / 2, gy - d / 2 + d * t1, z1), iso(gx + w / 2, gy - d / 2 + d * t0, z1)];
    g = html`${g}${poly(p as [number, number][], colours[i])}`;
  }
  return g;
}

/** Put a wall-hugging piece of furniture against its wall: returns centre and (w,d) swapped for W/E walls. */
function againstWall(it: DecorItem, w: number, d: number): { gx: number; gy: number; w: number; d: number; alongX: boolean } {
  const gx = it.x / CELL, gy = it.y / CELL;
  switch (it.side) {
    case "N": return { gx, gy: gy - 0.5 + d / 2 + 0.04, w, d, alongX: true };
    case "S": return { gx, gy: gy + 0.5 - d / 2 - 0.04, w, d, alongX: true };
    case "W": return { gx: gx - 0.5 + d / 2 + 0.04, gy, w: d, d: w, alongX: false };
    case "E": return { gx: gx + 0.5 - d / 2 - 0.04, gy, w: d, d: w, alongX: false };
    default: return { gx, gy, w, d, alongX: true };
  }
}

// ---------- items that stand up ----------
type Art = (it: DecorItem) => Raw;
const WALL_FURNITURE: Record<string, Art> = {
  bookshelf: (it) => {
    const a = againstWall(it, 0.84, 0.24);
    return html`${box(a.gx, a.gy, a.w, a.d, 20, WOOD_D)}${faceStripes(a.gx, a.gy, a.w, a.d, a.alongX, [0, 1, 2, 3, 4].map((i) => pick(BOOKS, rnd(it.seed, i))), 11, 18)}${faceStripes(a.gx, a.gy, a.w, a.d, a.alongX, [0, 1, 2, 3].map((i) => pick(BOOKS, rnd(it.seed, i, 2))), 2, 9)}`;
  },
  flaskshelf: (it) => {
    const a = againstWall(it, 0.8, 0.22);
    return html`${box(a.gx, a.gy, a.w, a.d, 14, WOOD)}${faceStripes(a.gx, a.gy, a.w, a.d, a.alongX, [0, 1, 2, 3].map((i) => pick(["#5fbf6a", "#6a8fe0", "#d0503c", "#c58be0"], rnd(it.seed, i))), 8, 12)}`;
  },
  bed: (it) => {
    const a = againstWall(it, 0.5, 0.85);
    const c = pick(CLOTH, rnd(it.seed, 1));
    // a bunk: frame, two mattresses and corner posts
    return html`${box(a.gx, a.gy, a.w, a.d, 4, WOOD)}${box(a.gx, a.gy, a.w * 0.9, a.d * 0.92, 2, c, 4)}${box(a.gx, a.gy, a.w, a.d, 2, WOOD, 14)}${box(a.gx, a.gy, a.w * 0.9, a.d * 0.92, 2, pick(CLOTH, rnd(it.seed, 2)), 16)}`;
  },
  rack: (it) => {
    const a = againstWall(it, 0.8, 0.12);
    let g = html`${box(a.gx, a.gy, a.w, a.d, 3, WOOD_D)}${box(a.gx, a.gy, a.w, a.d, 2, WOOD_D, 14)}`;
    for (let i = 0; i < 4; i++) {
      const t = -0.35 + i * 0.23;
      const [x0, y0] = a.alongX ? iso(a.gx + t, a.gy, 0) : iso(a.gx, a.gy + t, 0);
      g = html`${g}<path d="M${f1(x0)} ${f1(y0)}V${f1(y0 - 22)}" stroke="${STEEL}" stroke-width="1.3"/><path d="M${f1(x0 - 1.6)} ${f1(y0 - 21)}L${f1(x0)} ${f1(y0 - 25)}L${f1(x0 + 1.6)} ${f1(y0 - 21)}Z" fill="${STEEL}" stroke="${INK}" stroke-width=".4"/>`;
    }
    return g;
  },
  hearth: (it) => {
    const a = againstWall(it, 0.9, 0.3);
    return html`${box(a.gx, a.gy, a.w, a.d, 16, STONE_D)}${flame(a.gx + (a.alongX ? 0 : a.w / 2), a.gy + (a.alongX ? a.d / 2 : 0), 4, 3)}`;
  },
  urnniche: (it) => {
    const a = againstWall(it, 0.8, 0.25);
    return html`${box(a.gx, a.gy, a.w, a.d, 9, STONE_D)}${html`${[-0.25, 0, 0.25].map((t, i) => cyl(a.alongX ? a.gx + t : a.gx, a.alongX ? a.gy : a.gy + t, 0.07, 6, pick(["#a0623a", "#8a7a5a", "#6b5a7a"], rnd(it.seed, i)), 9))}`}`;
  },
  crates: (it) => {
    const a = againstWall(it, 0.5, 0.5);
    return html`${box(a.gx, a.gy, a.w, a.d, 10, WOOD_L)}${box(a.gx, a.gy, a.w * 0.7, a.d * 0.7, 8, WOOD_L, 10)}`;
  },
  candles: (it) => {
    const a = againstWall(it, 0.6, 0.2);
    return html`${[-0.2, 0, 0.2].map((t) => {
      const gx = a.alongX ? a.gx + t : a.gx, gy = a.alongX ? a.gy : a.gy + t;
      return html`${cyl(gx, gy, 0.03, 5, "#f4ecd2")}${flame(gx, gy, 6, 1.4)}`;
    })}`;
  },
};

const STANDING: Record<string, Art> = {
  barrel: (it) => cyl(it.x / CELL, it.y / CELL, 0.2, 11, WOOD),
  crate: (it) => box(it.x / CELL, it.y / CELL, 0.42, 0.42, 10, WOOD_L),
  sack: (it) => cyl(it.x / CELL, it.y / CELL, 0.17, 6, "#cdb789"),
  chest: (it) => html`${box(it.x / CELL, it.y / CELL, 0.5, 0.32, 7, "#7a4a22")}${box(it.x / CELL, it.y / CELL, 0.12, 0.33, 7.4, GOLD)}`,
  stool: (it) => cyl(it.x / CELL, it.y / CELL, 0.1, 5, WOOD_L),
  urn: (it) => cyl(it.x / CELL, it.y / CELL, 0.14, 8, pick(["#a0623a", "#8a7a5a", "#6b5a7a"], rnd(it.seed, 1))),
  candle: (it) => html`${cyl(it.x / CELL, it.y / CELL, 0.03, 5, "#f4ecd2")}${flame(it.x / CELL, it.y / CELL, 6, 1.4)}`,
  flask: (it) => cyl(it.x / CELL, it.y / CELL, 0.06, 5, pick(["#5fbf6a", "#6a8fe0", "#d0503c", "#c58be0"], rnd(it.seed, 1))),
  pillar: (it) => html`${cyl(it.x / CELL, it.y / CELL, 0.24, 30, STONE)}${cyl(it.x / CELL, it.y / CELL, 0.3, 3, STONE, 30)}`,
  statue: (it) => html`${box(it.x / CELL, it.y / CELL, 0.55, 0.55, 6, STONE_D)}${cyl(it.x / CELL, it.y / CELL, 0.12, 12, "#9aa89a", 6)}${sphere(it.x / CELL, it.y / CELL, 22, 3.6, "#9aa89a")}`,
  cage: (it) => cage(it.x / CELL, it.y / CELL, 0.6, 16),
  dummy: (it) => html`${cyl(it.x / CELL, it.y / CELL, 0.04, 14, WOOD_D)}${sphere(it.x / CELL, it.y / CELL, 15, 4, "#d6b44a")}`,
  brazier: (it) => html`${cyl(it.x / CELL, it.y / CELL, 0.15, 8, IRON)}${flame(it.x / CELL, it.y / CELL, 10, 3)}`,
  anvil: (it) => box(it.x / CELL, it.y / CELL, 0.45, 0.2, 7, "#5a6068"),
  headstone: (it) => box(it.x / CELL, it.y / CELL, 0.35, 0.08, 11, STONE),
  coffin: (it) => box(it.x / CELL, it.y / CELL, 0.3, 0.7, 5, WOOD),
  stoneblock: (it) => box(it.x / CELL, it.y / CELL, 0.35, 0.25, 6, STONE),
  hive: (it) => cyl(it.x / CELL, it.y / CELL, 0.15, 12, "#d9a43a"),
  mushrooms: (it) => html`${[0, 1, 2].map((i) => {
    const gx = it.x / CELL + (rnd(it.seed, i) - 0.5) * 0.5, gy = it.y / CELL + (rnd(it.seed, i, 1) - 0.5) * 0.5;
    const c = pick(["#c0392b", "#a0703a", "#8a5ab0", "#d08a2a"], rnd(it.seed, 9));
    return html`${cyl(gx, gy, 0.03, 4 + i * 2, "#efe3c8")}${cyl(gx, gy, 0.1 + i * 0.02, 2, c, 4 + i * 2)}`;
  })}`,
  target: (it) => {
    const [cx, cy] = iso(it.x / CELL, it.y / CELL, 9);
    return html`${cyl(it.x / CELL, it.y / CELL, 0.03, 4, WOOD_D)}<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="6" ry="8" fill="#f2ead6" stroke="${INK}" stroke-width=".6"/><ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="4" ry="5.4" fill="#c0392b"/><ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="1.6" ry="2.2" fill="#f2ead6"/>`;
  },
};

function cage(gx: number, gy: number, s: number, h: number): Raw {
  const x0 = gx - s / 2, x1 = gx + s / 2, y0 = gy - s / 2, y1 = gy + s / 2;
  let d = "";
  const up = (x: number, y: number) => {
    const [a, b] = iso(x, y, 0);
    d += `M${f1(a)} ${f1(b)}V${f1(b - h)}`;
  };
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    up(x0 + s * t, y0); up(x0 + s * t, y1); up(x0, y0 + s * t); up(x1, y0 + s * t);
  }
  const ring = (z: number) => `M${pt(iso(x0, y0, z))}L${pt(iso(x1, y0, z))}L${pt(iso(x1, y1, z))}L${pt(iso(x0, y1, z))}Z`;
  return html`<path d="${d}${ring(0)}${ring(h)}" stroke="${IRON}" stroke-width="1" fill="none"/>`;
}

const CENTRES: Record<string, Art> = {
  longtable: (it) => {
    const gx = it.x / CELL, gy = it.y / CELL, len = Math.max(1, it.cw ?? 1) - 0.25;
    let g = html``;
    for (let i = 0; i < Math.round(len); i++) g = html`${g}${cyl(gx - len / 2 + 0.4 + i, gy - 0.42, 0.1, 5, WOOD_L)}`;
    g = html`${g}${box(gx, gy, len, 0.45, 8, WOOD)}`;
    for (let i = 0; i < Math.round(len); i++) g = html`${g}${cyl(gx - len / 2 + 0.4 + i, gy + 0.42, 0.1, 5, WOOD_L)}`;
    return html`${g}${cyl(gx - len / 2 + 0.25, gy, 0.03, 4, "#f4ecd2", 8)}${flame(gx - len / 2 + 0.25, gy, 13, 1.4)}`;
  },
  desk: (it) => html`${box(it.x / CELL, it.y / CELL, 0.75, 0.42, 8, WOOD)}${cyl(it.x / CELL - 0.25, it.y / CELL, 0.03, 4, "#f4ecd2", 8)}${flame(it.x / CELL - 0.25, it.y / CELL, 13, 1.4)}${cyl(it.x / CELL, it.y / CELL + 0.45, 0.1, 5, WOOD_L)}`,
  altar: (it) => html`${box(it.x / CELL, it.y / CELL, 0.85, 0.5, 9, STONE)}${box(it.x / CELL, it.y / CELL, 0.25, 0.52, 9.3, pick(CLOTH, rnd(it.seed, 1)))}${html`${[-0.32, 0.32].map((t) => html`${cyl(it.x / CELL + t, it.y / CELL, 0.03, 4, "#f4ecd2", 9)}${flame(it.x / CELL + t, it.y / CELL, 14, 1.4)}`)}`}`,
  sarcophagus: (it) => (it.ch ?? 1) >= 2
    ? html`${box(it.x / CELL, it.y / CELL, 0.55, 1.5, 9, STONE)}${box(it.x / CELL, it.y / CELL, 0.45, 1.35, 2, STONE_D, 9)}`
    : box(it.x / CELL, it.y / CELL, 0.3, 0.7, 5, WOOD),
  fountain: (it) => {
    const gx = it.x / CELL, gy = it.y / CELL, r = (it.cw ?? 1) > 1 ? 0.6 : 0.4;
    const [cx, cy] = iso(gx, gy, 6);
    return html`${cyl(gx, gy, r, 6, STONE)}<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(r * HX * 1.414 - 3)}" ry="${f1(r * HY * 1.414 - 1.5)}" fill="#5b9bd5"/>${cyl(gx, gy, 0.08, 14, STONE, 0)}${sphere(gx, gy, 16, 2.4, "#cfe8ff")}`;
  },
  firepit: (it) => flame(it.x / CELL, it.y / CELL, 2, 4.5),
  forge: (it) => html`${box(it.x / CELL - ((it.cw ?? 1) > 1 ? 0.5 : 0), it.y / CELL, 0.45, 0.2, 7, "#5a6068")}${((it.cw ?? 1) > 1 ? html`${cyl(it.x / CELL + 0.5, it.y / CELL, 0.18, 9, IRON)}${flame(it.x / CELL + 0.5, it.y / CELL, 11, 3)}` : "")}`,
  throne: (it) => {
    const gx = it.x / CELL, gy = it.y / CELL;
    return html`${box(gx, gy - 0.28, 0.7, 0.14, 24, GOLD)}${box(gx, gy, 0.6, 0.45, 6, GOLD)}${box(gx, gy + 0.02, 0.44, 0.36, 2, pick(CLOTH, rnd(it.seed, 1)), 6)}`;
  },
  statue: (it) => STANDING.statue(it),
  cauldron: (it) => {
    const [cx, cy] = iso(it.x / CELL, it.y / CELL, 9);
    return html`${cyl(it.x / CELL, it.y / CELL, 0.28, 9, "#2a2623")}<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="8" ry="4" fill="#6fcf5a"/><circle cx="${f1(cx - 2)}" cy="${f1(cy - 1)}" r="1.2" fill="#c8f5a0"/>`;
  },
  orb: (it) => {
    const col = pick(["#8a5ad0", "#3aa0d0", "#d04a8a"], rnd(it.seed, 1));
    const [cx, cy] = iso(it.x / CELL, it.y / CELL, 15);
    return html`${box(it.x / CELL, it.y / CELL, 0.4, 0.4, 9, STONE_D)}<circle cx="${f1(cx)}" cy="${f1(cy)}" r="10" fill="${col}" opacity=".2"/>${sphere(it.x / CELL, it.y / CELL, 15, 5, col)}`;
  },
  portal: (it) => {
    const [cx, cy] = iso(it.x / CELL, it.y / CELL, 14);
    return html`<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="14" ry="18" fill="#5a2a8a" opacity=".25"/><ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="8" ry="13" fill="#2a1240" stroke="#b07ae0" stroke-width="2"/><path d="M${f1(cx - 3)} ${f1(cy)} a3 5 0 1 1 3 5" fill="none" stroke="#d0a8ff" stroke-width="1"/>`;
  },
  gong: (it) => {
    const gx = it.x / CELL, gy = it.y / CELL;
    const [cx, cy] = iso(gx, gy, 14);
    return html`${cyl(gx - 0.3, gy, 0.03, 24, WOOD_D)}${cyl(gx + 0.3, gy, 0.03, 24, WOOD_D)}<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="8" ry="9" fill="${GOLD}" stroke="#8a6a1a" stroke-width="1.2"/>`;
  },
  idol: (it) => html`${box(it.x / CELL, it.y / CELL, 0.35, 0.35, 8, STONE_D)}${sphere(it.x / CELL, it.y / CELL, 13, 4, GOLD)}`,
  optable: (it) => box(it.x / CELL, it.y / CELL, 0.85, 0.42, 8, "#9aa2aa"),
  cages: (it) => ((it.cw ?? 1) > 1 ? html`${cage(it.x / CELL - 0.5, it.y / CELL, 0.6, 16)}${cage(it.x / CELL + 0.5, it.y / CELL, 0.6, 16)}` : cage(it.x / CELL, it.y / CELL, 0.6, 16)),
  stonecircle: (it) => {
    let g = html``;
    const pts = [0, 1, 2, 3, 4, 5, 6].map((i) => (i / 7) * Math.PI * 2).sort((a, b) => Math.sin(a) + Math.cos(a) - (Math.sin(b) + Math.cos(b)));
    for (const a of pts) g = html`${g}${box(it.x / CELL + Math.cos(a) * 0.65, it.y / CELL + Math.sin(a) * 0.65, 0.16, 0.16, 12, STONE)}`;
    return g;
  },
  pews: (it) => {
    const rows = Math.max(1, it.ch ?? 1), len = Math.max(1, it.cw ?? 1);
    let g = html``;
    for (let i = 0; i < rows; i++) for (const side of [-1, 1]) g = html`${g}${box(it.x / CELL + side * (len / 4 + 0.05), it.y / CELL + (i - (rows - 1) / 2), len / 2 - 0.25, 0.22, 6, WOOD)}`;
    return g;
  },
};

// ---------- 2D6 Void props (the rest fall back to their top-down drawing on the floor) ----------
const MET = "#7d8892", MET_D = "#4a535c", MET_L = "#b4bec7", SCR = "#38c6ff", HAZ = "#e0b020";
Object.assign(WALL_FURNITURE, {
  vconsole: (it) => {
    const a = againstWall(it, 0.84, 0.36);
    return html`${box(a.gx, a.gy, a.w, a.d, 9, MET_D)}${faceStripes(a.gx, a.gy, a.w, a.d, a.alongX, [SCR, "#0b1a24", SCR], 3, 7)}`;
  },
  vrack: (it) => {
    const a = againstWall(it, 0.8, 0.3);
    return html`${box(a.gx, a.gy, a.w, a.d, 22, "#2b3138")}${faceStripes(a.gx, a.gy, a.w, a.d, a.alongX, ["#6bff8a", "#3b434b", SCR, "#3b434b", HAZ], 14, 18)}${faceStripes(a.gx, a.gy, a.w, a.d, a.alongX, ["#3b434b", SCR, "#3b434b", "#6bff8a"], 5, 9)}`;
  },
  vlocker: (it) => {
    const a = againstWall(it, 0.84, 0.26);
    return html`${box(a.gx, a.gy, a.w, a.d, 20, MET)}${faceStripes(a.gx, a.gy, a.w, a.d, a.alongX, [MET_L, MET_L, MET_L], 2, 18)}`;
  },
  vbunk: (it) => {
    const a = againstWall(it, 0.5, 0.85);
    return html`${box(a.gx, a.gy, a.w, a.d, 4, MET_D)}${box(a.gx, a.gy, a.w * 0.9, a.d * 0.92, 2, "#5b6f86", 4)}${box(a.gx, a.gy, a.w, a.d, 2, MET_D, 14)}${box(a.gx, a.gy, a.w * 0.9, a.d * 0.92, 2, "#6a7a5a", 16)}`;
  },
  vtank: (it) => {
    const a = againstWall(it, 0.5, 0.5);
    return html`${cyl(a.gx, a.gy, 0.22, 20, pick(["#6bd08a", "#5ab0e0", "#c07ae0"], rnd(it.seed, 1)))}${cyl(a.gx, a.gy, 0.24, 3, MET_D, 20)}`;
  },
  vmedpod: (it) => {
    const a = againstWall(it, 0.42, 0.7);
    return html`${box(a.gx, a.gy, a.w, a.d, 6, MET_L)}${box(a.gx, a.gy, a.w * 0.8, a.d * 0.8, 3, "#bfe9ff", 6)}`;
  },
} satisfies Record<string, Art>);
Object.assign(STANDING, {
  vcrate: (it) => html`${box(it.x / CELL, it.y / CELL, 0.46, 0.46, 11, "#6d7a52")}${box(it.x / CELL, it.y / CELL, 0.47, 0.47, 2, HAZ, 5)}`,
  vbarrel: (it) => cyl(it.x / CELL, it.y / CELL, 0.19, 12, HAZ),
  vcanister: (it) => cyl(it.x / CELL, it.y / CELL, 0.1, 8, MET_L),
  vdrone: (it) => html`${cyl(it.x / CELL, it.y / CELL, 0.16, 4, MET_D)}${sphere(it.x / CELL, it.y / CELL, 6, 2, "#d0402c")}`,
  vplant: (it) => html`${box(it.x / CELL, it.y / CELL, 0.44, 0.44, 5, MET_D)}${sphere(it.x / CELL, it.y / CELL, 9, 5, "#4f9a3a")}`,
} satisfies Record<string, Art>);
Object.assign(CENTRES, {
  vholo: (it) => {
    const gx = it.x / CELL, gy = it.y / CELL;
    const [cx, cy] = iso(gx, gy, 16);
    return html`${cyl(gx, gy, 0.4, 8, MET_D)}<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="9" ry="10" fill="${SCR}" opacity=".18"/><path d="M${f1(cx - 5)} ${f1(cy + 4)} L${f1(cx)} ${f1(cy - 7)} L${f1(cx + 5)} ${f1(cy + 4)} Z" fill="none" stroke="${SCR}" stroke-width="1"/>`;
  },
  vreactor: (it) => {
    const gx = it.x / CELL, gy = it.y / CELL, r = (it.cw ?? 1) > 1 ? 0.55 : 0.35;
    return html`${cyl(gx, gy, r, 6, MET_D)}${cyl(gx, gy, r * 0.6, 22, SCR, 6)}${cyl(gx, gy, r * 0.75, 3, MET, 28)}`;
  },
  vvat: (it) => {
    const gx = it.x / CELL, gy = it.y / CELL, c = pick(["#6bd08a", "#5ab0e0", "#c07ae0", "#d0a04a"], rnd(it.seed, 1));
    const one = (x: number) => html`${cyl(x, gy, 0.33, 4, MET_D)}${cyl(x, gy, 0.3, 20, c, 4)}${cyl(x, gy, 0.33, 3, MET_D, 24)}`;
    return (it.cw ?? 1) > 1 ? html`${one(gx - 0.5)}${one(gx + 0.5)}` : one(gx);
  },
  vmedbed: (it) => html`${box(it.x / CELL, it.y / CELL, 0.45, 0.85, 7, MET_L)}${box(it.x / CELL, it.y / CELL, 0.38, 0.75, 1.5, "#e8eef2", 7)}`,
  vmachine: (it) => html`${box(it.x / CELL, it.y / CELL, 0.9, 0.7, 14, MET)}${cyl(it.x / CELL + 0.2, it.y / CELL, 0.16, 6, MET_D, 14)}`,
  vtable: (it) => box(it.x / CELL, it.y / CELL, 0.9, 0.45, 8, MET_L),
  vpod: (it) => html`${box(it.x / CELL, it.y / CELL, 0.8, 1.1, 10, MET_L)}${box(it.x / CELL, it.y / CELL - 0.2, 0.5, 0.4, 4, "#0b1a24", 10)}`,
} satisfies Record<string, Art>);

/**
 * The 3D drawing of a placed item, in screen px — or null when the item is flat and should be
 * painted onto the floor instead. Wall-face art is handled by `faceArt`.
 */
export function isoItem(it: DecorItem): Raw | null {
  if (it.kind === "overlay" || it.kind === "mist" || it.kind === "web" || it.kind === "grime") return null;
  if (it.kind === "centre") return CENTRES[it.name]?.(it) ?? null;
  if (it.kind === "wall") return WALL_FURNITURE[it.name]?.(it) ?? null;
  return STANDING[it.name]?.(it) ?? null;
}
/** Centre pieces that also want their top-down drawing painted on the floor under them (rugs, blood). */
export const CENTRE_FLAT = new Set(["altar", "optable", "pool", "pit", "firepit", "stonecircle"]);

// ---------- art on the wall face (face coords: x 0..26 along the wall, y -WALL_H..0) ----------
export const FACE_ART: Record<string, (seed: number) => Raw> = {
  banner: (s) => html`<path d="M8 ${-WALL_H + 3} H18 V-7 L13 -10 L8 -7 Z" fill="${pick(CLOTH, rnd(s, 4))}" stroke="${INK}" stroke-width=".7"/><path d="M8 ${-WALL_H + 6} H18" stroke="${GOLD}" stroke-width="1.2"/>`,
  mural: (s) => {
    const c = [0, 1, 2].map((i) => pick(["#4a7aa0", "#7a9a4a", "#c06a3a", "#a04a7a", "#d9b44a"], rnd(s, i)));
    return html`<rect x="3" y="${-WALL_H + 4}" width="20" height="12" fill="${c[0]}" stroke="#6b4a22" stroke-width="1.6"/><path d="M5 ${-WALL_H + 13} q4 -6 8 -2 t8 -3" stroke="${c[1]}" stroke-width="2" fill="none"/><circle cx="17" cy="${-WALL_H + 8}" r="2" fill="${c[2]}"/>`;
  },
  torch: () => html`<rect x="12" y="-12" width="2" height="5" fill="${IRON}"/><circle cx="13" cy="-15" r="6" fill="#ffb347" opacity=".28"/><path d="M11 -13 Q13 -20 15 -13 Q13 -11 11 -13Z" fill="#f07b22"/><circle cx="13" cy="-14" r="1" fill="#ffe08a"/>`,
  shackles: () => html`${[8, 18].map((x) => html`${[0, 1, 2, 3].map((i) => html`<circle cx="${x}" cy="${-WALL_H + 6 + i * 3}" r="1.2" fill="none" stroke="${IRON}" stroke-width=".9"/>`)}<path d="M${x - 2} -8 a2 2 0 1 0 4 0" fill="none" stroke="${IRON}" stroke-width="1.3"/>`)}`,
  hooks: (s) => html`${[7, 13, 19].map((x, i) => html`<path d="M${x} ${-WALL_H + 3} V-14 a1.5 1.5 0 1 0 3 0" fill="none" stroke="${IRON}" stroke-width="1"/>${rnd(s, i) > 0.4 ? html`<ellipse cx="${x + 1.5}" cy="-10" rx="2.2" ry="3.4" fill="#9a3b36" stroke="${INK}" stroke-width=".5"/>` : ""}`)}`,
  icicles: () => html`${[4, 9, 14, 19, 23].map((x) => html`<path d="M${x - 2} ${-WALL_H} L${x} ${-WALL_H + 7} L${x + 2} ${-WALL_H} Z" fill="#dff3ff" stroke="#7fb3d0" stroke-width=".5"/>`)}`,
  roots: (s) => html`<path d="M${6 + rnd(s, 1) * 6} ${-WALL_H} q3 5 -1 9 t2 9 M${16 + rnd(s, 2) * 5} ${-WALL_H} q-3 4 1 8" fill="none" stroke="#6b5232" stroke-width="1.6" stroke-linecap="round"/><path d="M8 ${-WALL_H + 6} q2 2 4 1" stroke="#4f7a3a" stroke-width="1.2" fill="none"/>`,
  candles: () => html`${[6, 13, 20].map((x) => html`<rect x="${x - 1}" y="-14" width="2" height="4" fill="#f4ecd2"/><circle cx="${x}" cy="-15.5" r="3" fill="#ffd36b" opacity=".35"/><circle cx="${x}" cy="-15.5" r="1" fill="#fff6d6"/>`)}`,
};

// ---------- doors (face coords) ----------
export const DOOR_COL: Record<ExitType, string> = { archway: "#b89a6a", wooden: "#9a5b2a", metal: "#8fa3b5", reinforced: "#3f4b5c", portcullis: "#4a4a4a", curtain: "#b3243b", slab: "#7d7768", unknown: "#a8987c",
  sliding: "#8fa3b5", security: "#d9a521", biocoded: "#3f9a5a", barrier: "#38c6ff", secret: "#6b6f75" };
/** A doorway in a wall face: jambs and lintel in the wall colour, and the door itself. */
export function doorFace(type: ExitType, locked: boolean, wall: string, line: string): Raw {
  const H = WALL_H, top = -H + 8;
  const s = html`stroke="${line}" stroke-width=".8"`;
  let g = html`<rect x="0" y="${-H}" width="5" height="${H}" fill="${wall}" ${s}/><rect x="21" y="${-H}" width="5" height="${H}" fill="${wall}" ${s}/><rect x="5" y="${-H}" width="16" height="8" fill="${wall}" ${s}/>`;
  const c = DOOR_COL[type];
  switch (type) {
    case "archway":
      g = html`${g}<path d="M5 ${top} L21 ${top} L21 ${top + 5} Q13 ${top - 3} 5 ${top + 5} Z" fill="${wall}"/><path d="M5 ${top + 5} Q13 ${top - 3} 21 ${top + 5}" fill="none" stroke="${c}" stroke-width="1.8"/>`;
      break;
    case "portcullis":
      g = html`${g}<path d="M5 ${top + 4} H21 M5 ${top + 10} H21 ${[7.5, 10.5, 13.5, 16.5, 19.5].map((x) => `M${x} ${top} V0`).join(" ")}" stroke="${c}" stroke-width="1.3"/>`;
      break;
    case "curtain":
      g = html`${g}<path d="M5 ${top} H21 V-1 Q19 1 17 -1 Q15 1 13 -1 Q11 1 9 -1 Q7 1 5 -1 Z" fill="${c}" stroke="${INK}" stroke-width=".6"/><path d="M9 ${top} V-2 M13 ${top} V-2 M17 ${top} V-2" stroke="#00000033" stroke-width="1"/>`;
      break;
    case "barrier":
      g = html`${g}<rect x="5" y="${top}" width="16" height="${-top}" fill="${c}" opacity=".18"/><path d="M7 ${top + 2} l4 4 l-3 4 l5 4 l-3 4 l4 3" fill="none" stroke="${c}" stroke-width="2.4" opacity=".5"/><path d="M7 ${top + 2} l4 4 l-3 4 l5 4 l-3 4 l4 3" fill="none" stroke="#e6fbff" stroke-width=".9"/>`;
      break;
    case "secret":
      g = html`${g}<rect x="5" y="${top}" width="16" height="${-top}" fill="${wall}" ${s} stroke-dasharray="2 1.5"/><text x="13" y="${top / 2 + 3}" font-size="8" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="${c}">s</text>`;
      break;
    case "slab":
      g = html`${g}<rect x="5" y="${top}" width="16" height="${-top}" fill="${c}" stroke="${INK}" stroke-width=".8"/><path d="M9 ${top + 3} l2 5 l-1 4 M16 ${top + 8} l-2 4" stroke="#00000044" fill="none"/>`;
      break;
    default: {
      g = html`${g}<rect x="5" y="${top}" width="16" height="${-top}" fill="${c}" stroke="${INK}" stroke-width=".8"/>`;
      if (type === "wooden" || type === "unknown") g = html`${g}<path d="M9 ${top} V0 M13 ${top} V0 M17 ${top} V0" stroke="#00000033" stroke-width=".8"/>`;
      if (type === "metal") g = html`${g}${[8, 18].map((x) => html`<circle cx="${x}" cy="${top + 3}" r=".9" fill="#e9eef3"/><circle cx="${x}" cy="-3" r=".9" fill="#e9eef3"/>`)}`;
      if (type === "sliding") g = html`${g}<path d="M13 ${top} V0" stroke="${INK}" stroke-width="1"/>`;
      if (type === "security") g = html`${g}<path d="M5 ${top + 3} H21 M5 -3 H21" stroke="#1d1f22" stroke-width="1.6" stroke-dasharray="2 2"/>`;
      if (type === "biocoded") g = html`${g}<circle cx="13" cy="${top / 2}" r="2.2" fill="#bff5c8" stroke="${INK}" stroke-width=".5"/>`;
      if (type === "reinforced") g = html`${g}<path d="M5 ${top + 4} H21 M5 -4 H21" stroke="#c8ccd2" stroke-width="1.4"/>`;
      g = html`${g}<circle cx="18.5" cy="${top / 2}" r="1" fill="${GOLD}"/>`;
    }
  }
  if (locked) g = html`${g}<g transform="translate(13 ${top / 2})"><rect x="-4" y="-1.5" width="8" height="6" rx="1.3" fill="#c62828" stroke="#fff" stroke-width=".9"/><path d="M-2.2 -1.5 V-3.2 a2.2 2.2 0 0 1 4.4 0 V-1.5" fill="none" stroke="#c62828" stroke-width="1.3"/></g>`;
  return g;
}
