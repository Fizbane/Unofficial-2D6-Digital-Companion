import { html, type Raw } from "../ui/html";
// 2D6 Realm plot map: placement by the book's plot formation rules and a colour SVG renderer.
// Rules (docs/spec-realm.md §2.3): Unique = 1 square; Area = first square + D6 more, touching
// where possible; String = a 2nd square, then D6+2 more by D6 over the free sides
// (1-2 left, 3-4 straight, 5-6 right; two free sides: 1-3 / 4-6); strings may pass through
// other plots but never through their own squares.

export type Cell = [number, number];
export const SIZE = 25;
export const HOME: Cell = [12, 12];
export const STRINGS = new Set(["AR", "RI", "LC", "OC", "SW"]);

const COLORS: Record<string, string> = {
  GR: "#a9cc7e", HE: "#bba67a", HI: "#c8b07a", LA: "#77b2d9", MA: "#8db79c", ME: "#c6de8a", RK: "#b8b0a4", SH: "#9fb57a",
  WO: "#5d9150", FI: "#e5cf74", BR: "#d2c4ab", BW: "#7a665c",
  AD: "#c9a27a", AO: "#9fc46a", AB: "#b59468", BA: "#b0646a", BU: "#c99b6b", CA: "#857c74", DH: "#6b625b", DE: "#a07f5a",
  FM: "#b6a8c9", MO: "#a8b47a", OQ: "#a59c90", OW: "#8fb2bf", RO: "#9a9389", RU: "#b3a08a", SC: "#c4b7d6", SP: "#aaa49a",
};
const LINE: Record<string, { color: string; width: number; dash?: string }> = {
  AR: { color: "#8b6a43", width: 6, dash: "2 0" },
  RI: { color: "#3f7fc4", width: 8 },
  LC: { color: "#5e5247", width: 6, dash: "6 3" },
  OC: { color: "#2f2a26", width: 7 },
  SW: { color: "#8d8d8d", width: 5, dash: "4 2" },
};
export const landColor = (code: string) => (Object.hasOwn(COLORS, code) ? COLORS[code] : "#cfc6b3");

/** The legend under a realm map: a swatch per area code, a line per string code. */
export function mapLegendHtml(codes: readonly string[]): Raw {
  const sw = (k: string) => (STRINGS.has(k) ? `transparent;border-top:3px solid ${LINE[k]?.color ?? "#555"}` : landColor(k));
  return html`<div class="map-legend">${codes.map((k) => html`<span><i style="background:${sw(k)}"></i>${k}</span>`)}</div>`;
}

const key = (c: Cell) => `${c[0]},${c[1]}`;
const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
const N4: Cell[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export interface PlotLike { code: string; cells: Cell[]; claimed: boolean; tag: string; id?: number }

/** Squares taken by areas/uniques (and the homestead). Strings are overlays and don't block. */
export function blocked(plots: PlotLike[]): Set<string> {
  const s = new Set<string>([key(HOME)]);
  for (const p of plots) if (!STRINGS.has(p.code)) for (const c of p.cells) s.add(key(c));
  return s;
}
/** Every square with anything on it (for tapping empty squares). */
export function used(plots: PlotLike[]): Set<string> {
  const s = new Set<string>([key(HOME)]);
  for (const p of plots) for (const c of p.cells) s.add(key(c));
  return s;
}

/** Area: grow from `start` to `size` squares, each touching the area. Returns as many as fit. */
export function placeArea(start: Cell, size: number, occ: Set<string>, rnd = Math.random): Cell[] {
  const cells: Cell[] = [start];
  const has = new Set([key(start)]);
  while (cells.length < size) {
    const frontier: Cell[] = [];
    for (const [x, y] of cells)
      for (const [dx, dy] of N4) {
        const c: Cell = [x + dx, y + dy];
        if (inB(c[0], c[1]) && !occ.has(key(c)) && !has.has(key(c)) && !frontier.some((f) => f[0] === c[0] && f[1] === c[1])) frontier.push(c);
      }
    if (!frontier.length) break;
    // prefer squares touching more of the area, so it stays compact
    const touch = (c: Cell) => N4.filter(([dx, dy]) => has.has(`${c[0] + dx},${c[1] + dy}`)).length;
    frontier.sort((a, b) => touch(b) - touch(a) + (rnd() - 0.5) * 1.5);
    const pick = frontier[0];
    cells.push(pick);
    has.add(key(pick));
  }
  return cells;
}

/**
 * String: start square, a 2nd square (random free neighbour if not given), then `extra`
 * steps by D6 over the free sides relative to the direction of travel.
 */
export function placeString(start: Cell, extra: number, d6: () => number, second?: Cell): { cells: Cell[]; rolls: string[] } {
  const cells: Cell[] = [start];
  const has = new Set([key(start)]);
  const rolls: string[] = [];
  const free = (c: Cell) => inB(c[0], c[1]) && !has.has(key(c));
  let next = second;
  if (!next || !free(next)) {
    const opts = N4.map(([dx, dy]) => [start[0] + dx, start[1] + dy] as Cell).filter(free);
    if (!opts.length) return { cells, rolls: ["No room to extend: the string stays one square."] };
    next = opts[Math.floor(d6() / 6.0001 * opts.length)];
  }
  cells.push(next);
  has.add(key(next));
  for (let i = 0; i < extra; i++) {
    const cur = cells[cells.length - 1], prev = cells[cells.length - 2];
    const dir: Cell = [cur[0] - prev[0], cur[1] - prev[1]];
    const left: Cell = [dir[1], -dir[0]], right: Cell = [-dir[1], dir[0]];
    const sides = [{ name: "left", d: left }, { name: "straight", d: dir }, { name: "right", d: right }]
      .map((s) => ({ ...s, c: [cur[0] + s.d[0], cur[1] + s.d[1]] as Cell }))
      .filter((s) => free(s.c));
    if (!sides.length) {
      rolls.push(`Step ${i + 1}: no free side, the string ends here.`);
      break;
    }
    const v = d6();
    const idx = sides.length === 3 ? (v <= 2 ? 0 : v <= 4 ? 1 : 2) : sides.length === 2 ? (v <= 3 ? 0 : 1) : 0;
    rolls.push(`Step ${i + 1}: D6 ${v} → ${sides[idx].name}`);
    cells.push(sides[idx].c);
    has.add(key(sides[idx].c));
  }
  return { cells, rolls };
}

export interface RenderOpts {
  plots: (PlotLike & { label?: string; buildings?: number })[];
  draft?: PlotLike | null;
  pick?: Cell | null;
  focus?: number | null; // plot id highlighted
  pickable?: boolean; // empty squares are tappable
}

export function renderRealmMap(o: RenderOpts): Raw {
  const C = 24, W = SIZE * C;
  // zoom to the explored area plus a 3-square margin (at least 11 squares), so the map stays readable
  const pts: Cell[] = [HOME, ...o.plots.flatMap((p) => p.cells), ...(o.draft?.cells ?? []), ...(o.pick ? [o.pick] : [])];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  let span = Math.max(11, Math.max(...xs) - Math.min(...xs) + 7, Math.max(...ys) - Math.min(...ys) + 7);
  span = Math.min(SIZE, span);
  const cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2, cy = (Math.min(...ys) + Math.max(...ys) + 1) / 2;
  const vx = Math.max(0, Math.min(SIZE - span, Math.round(cx - span / 2))), vy = Math.max(0, Math.min(SIZE - span, Math.round(cy - span / 2)));
  const out: Raw[] = [];
  out.push(html`<svg class="rmap" viewBox="${vx * C - 8} ${vy * C - 8} ${span * C + 16} ${span * C + 16}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Realm map">
    <defs>
      <pattern id="rm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#00000033" stroke-width="2"/></pattern>
      <pattern id="rm-grid" width="${C}" height="${C}" patternUnits="userSpaceOnUse"><path d="M ${C} 0 L 0 0 0 ${C}" fill="none" stroke="#00000014"/></pattern>
    </defs>
    <rect x="-8" y="-8" width="${W + 16}" height="${W + 16}" rx="10" fill="#e9dfc7"/>
    <rect x="0" y="0" width="${W}" height="${W}" fill="#efe6cf" stroke="#9c8a6a" stroke-width="2"/>`);
  const usedSet = used([...o.plots, ...(o.draft ? [o.draft] : [])]);
  if (o.pickable)
    for (let x = 0; x < SIZE; x++)
      for (let y = 0; y < SIZE; y++)
        if (!usedSet.has(`${x},${y}`)) out.push(html`<rect class="rm-empty" data-cell="${x},${y}" x="${x * C}" y="${y * C}" width="${C}" height="${C}" fill="transparent"/>`);

  const fills = (p: PlotLike, draft: boolean) => {
    if (STRINGS.has(p.code)) return html``;
    return html`${p.cells
      .map(([x, y]) => html`<rect ${p.id !== undefined ? html`data-plot="${p.id}"` : ""} x="${x * C}" y="${y * C}" width="${C}" height="${C}" fill="${landColor(p.code)}" ${draft ? html`opacity=".8"` : ""}/>${!p.claimed && !draft ? html`<rect pointer-events="none" x="${x * C}" y="${y * C}" width="${C}" height="${C}" fill="url(#rm-hatch)"/>` : ""}`)}`;
  };
  for (const p of o.plots) out.push(fills(p, false));
  if (o.draft) out.push(fills(o.draft, true));
  out.push(html`<rect x="0" y="0" width="${W}" height="${W}" fill="url(#rm-grid)" pointer-events="none"/>`);

  // plot outlines: claimed land gets a gold border, the focused plot a blue one
  const outline = (p: PlotLike, color: string, w: number, dash = "") => {
    const set = new Set(p.cells.map(key));
    const segs: string[] = [];
    for (const [x, y] of p.cells)
      for (const [dx, dy] of N4)
        if (!set.has(`${x + dx},${y + dy}`)) {
          const x1 = (dx === 1 ? x + 1 : x) * C, y1 = (dy === 1 ? y + 1 : y) * C;
          segs.push(dx === 0 ? `M${x * C} ${y1} H${(x + 1) * C}` : `M${x1} ${y * C} V${(y + 1) * C}`);
        }
    return html`<path pointer-events="none" d="${segs.join(" ")}" stroke="${color}" stroke-width="${w}" fill="none" ${dash ? html`stroke-dasharray="${dash}"` : ""} stroke-linecap="square"/>`;
  };
  for (const p of o.plots) if (!STRINGS.has(p.code)) out.push(outline(p, p.id === o.focus ? "#2f7fd8" : p.claimed ? "#b8860b" : "#6b5d4a", p.id === o.focus ? 3.5 : p.claimed ? 2.5 : 1.2));

  // strings as lines through square centres
  const strLine = (p: PlotLike, draft: boolean) => {
    const st = LINE[p.code] ?? { color: "#555", width: 5 };
    const d = p.cells.map(([x, y], i) => `${i ? "L" : "M"}${x * C + C / 2} ${y * C + C / 2}`).join(" ");
    return html`<path ${p.id !== undefined ? html`data-plot="${p.id}"` : ""} d="${d}" stroke="${p.id === o.focus ? "#2f7fd8" : st.color}" stroke-width="${st.width + 6}" stroke-opacity="0" fill="none"/>
      <path pointer-events="none" d="${d}" stroke="${st.color}" stroke-width="${st.width}" ${st.dash ? html`stroke-dasharray="${st.dash}"` : ""} fill="none" stroke-linecap="round" stroke-linejoin="round" ${draft ? html`opacity=".75"` : ""}/>
      ${!p.claimed && !draft ? html`<path pointer-events="none" d="${d}" stroke="#fff" stroke-width="1.5" stroke-dasharray="2 4" fill="none"/>` : ""}`;
  };
  for (const p of o.plots) if (STRINGS.has(p.code)) out.push(strLine(p, false));
  if (o.draft) {
    out.push(STRINGS.has(o.draft.code) ? strLine(o.draft, true) : outline(o.draft, "#d0582c", 3, "5 3"));
  }

  // homestead
  const [hx, hy] = HOME;
  out.push(html`<g pointer-events="none" transform="translate(${hx * C} ${hy * C})"><rect width="${C}" height="${C}" fill="#f4e3b5" stroke="#7a5a2c" stroke-width="2"/>
    <path d="M4 12 L12 5 L20 12 V20 H4 Z" fill="#b5482a" stroke="#5a2a16" stroke-width="1.2"/><rect x="10" y="14" width="4" height="6" fill="#5a2a16"/></g>`);

  // labels + building markers on each plot's first square
  for (const p of o.plots) {
    const [x, y] = p.cells[0];
    out.push(html`<text pointer-events="none" x="${x * C + 2}" y="${y * C + 9}" font-size="7.5" font-weight="700" font-family="system-ui" fill="#2b231b" paint-order="stroke" stroke="#ffffffcc" stroke-width="2">${p.tag}</text>`);
    // unclaimed: a small cross in the first square's bottom-left corner (drawn, not a text glyph)
    if (!p.claimed) out.push(html`<path pointer-events="none" d="M${x * C + 3} ${y * C + C - 9} l6 6 m0 -6 l-6 6" stroke="#2b231b" stroke-width="1.6" stroke-linecap="round" fill="none"/>`);
    if (p.buildings) out.push(html`<g pointer-events="none" transform="translate(${x * C + C - 11} ${y * C + C - 11})"><rect width="10" height="10" rx="2" fill="#7a3b1f" stroke="#fff" stroke-width="1"/><text x="5" y="8" text-anchor="middle" font-size="7" font-weight="700" fill="#fff" font-family="system-ui">${p.buildings}</text></g>`);
  }
  if (o.pick) out.push(html`<rect pointer-events="none" x="${o.pick[0] * C + 2}" y="${o.pick[1] * C + 2}" width="${C - 4}" height="${C - 4}" fill="none" stroke="#d0582c" stroke-width="3" rx="3"/>`);
  out.push(html`</svg>`);
  return html`${out}`;
}
