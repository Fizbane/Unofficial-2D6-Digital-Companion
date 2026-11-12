// Isometric view of the dungeon map. Same rooms, exits, dressing and tile sets as the top-down
// view, drawn as raised floor slabs over a dark void: back walls (north and west) stand up, front
// walls (south and east) are cut down to a low stub so you can see into every room.
import { DIR, NOTE_PENCIL, exitLabel, f1, floorTextureSvg, footprintsSvg, mapScene, openExits, rnd, stone, type DungeonMap, type MapExit, type MapRoom, type Side } from "./dmap";
import { itemSvg, type DecorItem } from "./dmapdecor";
import { CENTRE_FLAT, FACE_ART, HX, HY, WALL_H, cyl, doorFace, iso, isoItem, shade, sphere } from "./dmapisoart";
import { getTileSetId, tileSetById, type TileSet } from "./dmaptiles";
import { html, type Raw } from "../ui/html";

const C = 26; // top-down px per square (same as dmap.ts; not imported, to keep module loading order simple)
const SLAB = 8; // floor slab thickness, px
const STUB = 5; // height of the cut-down front walls, px
let uid = 0;
const pt = (p: [number, number]) => `${f1(p[0])} ${f1(p[1])}`;

/** Paint top-down map pixels onto the iso floor. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const FLOOR_M = `matrix(${r3(HX / C)} ${r3(HY / C)} ${-r3(HX / C)} ${r3(HY / C)} 0 0)`;
/** Wall-face coordinates (x 0..26 along the wall, y up is negative) for a wall starting at grid point (gx,gy). */
const faceM = (gx: number, gy: number, alongX: boolean) => {
  const [ox, oy] = iso(gx, gy);
  const a = HX / C, b = HY / C;
  return alongX ? `matrix(${a} ${b} 0 1 ${f1(ox)} ${f1(oy)})` : `matrix(${-a} ${b} 0 1 ${f1(ox)} ${f1(oy)})`;
};

/** The texture of one wall face, by tile set: brick courses, or rough rock. */
function wallFace(T: TileSet, h: number, alongX: boolean, seed: number, ends: [boolean, boolean]): Raw {
  const fill = alongX ? T.iso.wall : shade(T.iso.wall, 0.82);
  let g = html`<rect x="0" y="${-h}" width="${C}" height="${h}" fill="${fill}"/>`;
  if (T.walls === "rock" || T.walls === "organic") {
    for (let i = 0; i < 4; i++) g = html`${g}<path d="${stone(3 + rnd(seed, i) * 20, -h + 4 + rnd(seed, i, 1) * (h - 6), 4 + rnd(seed, i, 2) * 3, seed * 7 + i)}" fill="${shade(fill, 0.88 + rnd(seed, i, 3) * 0.2)}" stroke="${T.iso.wallLine}" stroke-width=".6"/>`;
  } else if (h > 8) {
    let d = "";
    for (let r = 1; r * 6 < h; r++) d += `M0 ${-r * 6}H${C}`;
    for (let r = 0; r * 6 < h; r++) for (let x = (r % 2) * 6.5 + 3; x < C; x += 13) d += `M${f1(x)} ${-r * 6}v${-Math.min(6, h - r * 6)}`;
    g = html`${g}<path d="${d}" stroke="${T.iso.wallLine}" stroke-width=".6" fill="none"/>`;
  }
  g = html`${g}<path d="M0 ${-h}H${C}" stroke="${T.ink}" stroke-width="1.8"/><path d="M0 0H${C}" stroke="${T.ink}" stroke-width=".7"/>`;
  if (ends[0]) g = html`${g}<path d="M0 ${-h}V0" stroke="${T.ink}" stroke-width=".9"/>`;
  if (ends[1]) g = html`${g}<path d="M${C} ${-h}V0" stroke="${T.ink}" stroke-width=".9"/>`;
  return g;
}

/** Draw the map in isometric view as an SVG string (same interactions as the top-down map). */
export function renderIsoMap(m: DungeonMap, current: number | null, focus: number | null = null, tiles?: string): Raw {
  const T = tileSetById(tiles ?? getTileSetId());
  const P = `di${++uid}`;
  const sc = mapScene(m, P);
  const { owner, key, edgeBetween, isFloor, roomById, exitById, entranceRoom, labels } = sc;
  const cells = [...owner.keys()].map((k) => k.split(",").map(Number) as [number, number]);

  // zoom to the explored part of the level (at least 8 squares across), not the whole board
  let [gx0, gy0, gx1, gy1] = [0, 0, m.w, m.h];
  if (cells.length) {
    gx0 = Math.min(...cells.map((c) => c[0])) - 2; gx1 = Math.max(...cells.map((c) => c[0])) + 3;
    gy0 = Math.min(...cells.map((c) => c[1])) - 2; gy1 = Math.max(...cells.map((c) => c[1])) + 3;
    const grow = (a: number, b: number, max: number): [number, number] => {
      const need = Math.max(0, 8 - (b - a));
      let [lo, hi] = [a - Math.ceil(need / 2), b + Math.floor(need / 2)];
      if (lo < 0) [lo, hi] = [0, hi - lo];
      if (hi > max) [lo, hi] = [Math.max(0, lo - (hi - max)), max];
      return [lo, hi];
    };
    [gx0, gx1] = grow(Math.max(0, gx0), Math.min(m.w, gx1), m.w);
    [gy0, gy1] = grow(Math.max(0, gy0), Math.min(m.h, gy1), m.h);
  }
  const minX = iso(gx0, gy1)[0] - 24, maxX = iso(gx1, gy0)[0] + 24, minY = iso(gx0, gy0)[1] - WALL_H - 30, maxY = iso(gx1, gy1)[1] + SLAB + 24;
  const parts: Raw[] = [];
  parts.push(html`<svg class="dmap dmap-iso" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Dungeon map (isometric)">
  <defs>
    <linearGradient id="${P}-shN" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.wallShadow}" stop-opacity=".35"/><stop offset="1" stop-color="${T.wallShadow}" stop-opacity="0"/></linearGradient>
    <linearGradient id="${P}-shW" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${T.wallShadow}" stop-opacity=".3"/><stop offset="1" stop-color="${T.wallShadow}" stop-opacity="0"/></linearGradient>
    <filter id="${P}-glow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${P}-mist" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    ${m.rooms.map((r) => html`<clipPath id="${P}-clip-${r.id}"><rect x="${r.x * C}" y="${r.y * C}" width="${r.w * C}" height="${r.h * C}"/></clipPath>`)}
  </defs>
  <rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="${T.paper}" rx="8"/>
  <path d="M${pt(iso(0, 0))}L${pt(iso(m.w, 0))}L${pt(iso(m.w, m.h))}L${pt(iso(0, m.h))}Z" fill="${T.iso.void}"/>
  <path d="M${pt(iso(0, m.h))}L${pt(iso(m.w, m.h))}L${pt(iso(m.w, m.h, -SLAB))}L${pt(iso(0, m.h, -SLAB))}Z" fill="${shade(T.iso.void, 1.25)}"/>
  <path d="M${pt(iso(m.w, 0))}L${pt(iso(m.w, m.h))}L${pt(iso(m.w, m.h, -SLAB))}L${pt(iso(m.w, 0, -SLAB))}Z" fill="${shade(T.iso.void, 1.1)}"/>
  <path d="M${pt(iso(0, 0))}L${pt(iso(m.w, 0))}L${pt(iso(m.w, m.h))}L${pt(iso(0, m.h))}Z" fill="none" stroke="${T.edge}" stroke-width="1" stroke-dasharray="6 4"/>`);

  // 1. slab sides under the front edges of every floor square
  let sides = html``;
  for (const [x, y] of cells) {
    if (!isFloor(x, y + 1)) sides = html`${sides}<path d="M${pt(iso(x, y + 1))}L${pt(iso(x + 1, y + 1))}L${pt(iso(x + 1, y + 1, -SLAB))}L${pt(iso(x, y + 1, -SLAB))}Z" fill="${T.iso.sideS}"/>`;
    if (!isFloor(x + 1, y)) sides = html`${sides}<path d="M${pt(iso(x + 1, y))}L${pt(iso(x + 1, y + 1))}L${pt(iso(x + 1, y + 1, -SLAB))}L${pt(iso(x + 1, y, -SLAB))}Z" fill="${T.iso.sideE}"/>`;
  }
  parts.push(html`<g pointer-events="none">${sides}</g>`);

  // 2. floors: rooms are the click targets; exit squares and the entrance square
  const diamond = (x: number, y: number, w = 1, h = 1) => `M${pt(iso(x, y))}L${pt(iso(x + w, y))}L${pt(iso(x + w, y + h))}L${pt(iso(x, y + h))}Z`;
  for (const [x, y] of cells) {
    const o = owner.get(key(x, y))!;
    if (o.kind !== "room") parts.push(html`<path d="${diamond(x, y)}" fill="${o.kind === "entrance" ? T.floor.entrance : T.floor.corridor}"/>`);
  }
  for (const r of m.rooms)
    parts.push(html`<path class="dmap-room" data-room="${r.id}" d="${diamond(r.x, r.y, r.w, r.h)}" fill="${T.floor[r.kind]}" ${r.draft ? html`opacity=".7"` : ""} style="cursor:pointer"/>`);

  // 3. everything painted on the floor, drawn top-down through the floor matrix
  const flat: Raw[] = [floorTextureSvg(sc, T, P), footprintsSvg(m, sc, T)];
  const standing = new Map<string, Raw[]>(); // 3D items by the square they stand in
  const onFace = new Map<string, Raw[]>(); // wall art by wall face ("N:x,y" / "W:x,y")
  for (const r of m.rooms) {
    const items: DecorItem[] = sc.dressing.get(r.id) ?? [];
    const flatHere: Raw[] = [];
    for (const it of items) {
      const cx = Math.floor(it.x / C), cy = Math.floor(it.y / C);
      if (it.kind === "wall" && FACE_ART[it.name]) {
        if (it.side === "N" || it.side === "W") {
          const k = `${it.side}:${cx},${cy}`;
          onFace.set(k, [...(onFace.get(k) ?? []), FACE_ART[it.name](it.seed)]);
        }
        continue;
      }
      if (it.kind === "mist") continue; // drawn last, over the walls
      const up = isoItem(it);
      if (it.kind === "centre" && (up === null || CENTRE_FLAT.has(it.name))) flatHere.push(itemSvg(it));
      if (up === null) {
        if (it.kind !== "centre") flatHere.push(itemSvg(it));
        continue;
      }
      // the throne's runner carpet stays on the floor; the chair itself stands up
      if (it.kind === "centre" && it.name === "throne") flatHere.push(itemSvg({ ...it, svg: it.flat ?? html`` }));
      const k = key(cx, cy);
      standing.set(k, [...(standing.get(k) ?? []), up]);
    }
    if (flatHere.length) flat.push(html`<g clip-path="url(#${P}-clip-${r.id})">${flatHere}</g>`);
  }
  // unexplored ends, entrance arrow, stairs, current/focused room and draft outlines
  let dashed = "";
  for (const [x, y] of cells)
    for (const sd of ["N", "E", "S", "W"] as Side[]) {
      const [dx, dy] = DIR[sd];
      if (edgeBetween(x, y, x + dx, y + dy) !== "unexplored") continue;
      const [x1, y1, x2, y2] = sd === "N" ? [x, y, x + 1, y] : sd === "S" ? [x, y + 1, x + 1, y + 1] : sd === "W" ? [x, y, x, y + 1] : [x + 1, y, x + 1, y + 1];
      dashed += `M${x1 * C} ${y1 * C}L${x2 * C} ${y2 * C}`;
    }
  if (dashed) flat.push(html`<path d="${dashed}" stroke="${T.unexplored}" stroke-width="3" stroke-dasharray="5 4" stroke-linecap="round"/>`);
  if (m.entrance) {
    const cx = (m.entrance.x + 0.5) * C, by = (m.entrance.y + 1) * C;
    flat.push(html`<path d="M${cx - 7} ${by - 4} L${cx} ${by - 11} L${cx + 7} ${by - 4}" fill="none" stroke="#2f6b3a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  if (m.stairs !== null) {
    const r = roomById.get(m.stairs);
    if (r) {
      const sx = (r.x + r.w - 1) * C + 3, sy = (r.y + r.h - 1) * C + 3, s = C - 6;
      flat.push(html`<rect x="${sx}" y="${sy}" width="${s}" height="${s}" fill="#1a1410" stroke="${T.ink}" stroke-width="1.2"/>${[0, 1, 2, 3].map((i) => html`<rect x="${sx + 1}" y="${sy + 1 + i * (s / 4)}" width="${s - 2}" height="${s / 5}" fill="${["#efe2c4", "#c9b48c", "#9e8a66", "#6f5f46"][i]}"/>`)}`);
    }
  }
  for (const r of m.rooms) {
    if (r.id === current || r.id === focus)
      flat.push(html`<rect x="${r.x * C + 5}" y="${r.y * C + 5}" width="${r.w * C - 10}" height="${r.h * C - 10}" rx="4" fill="none" stroke="${r.id === current ? "#d0582c" : "#2f7fd8"}" stroke-width="3" ${r.id === current ? "" : html`stroke-dasharray="6 4"`} opacity=".9"/>`);
    if (r.draft) flat.push(html`<rect x="${r.x * C + 4}" y="${r.y * C + 4}" width="${r.w * C - 8}" height="${r.h * C - 8}" fill="none" stroke="${T.draft}" stroke-width="1.5" stroke-dasharray="5 4"/>`);
  }
  parts.push(html`<g pointer-events="none" transform="${FLOOR_M}">${flat}</g>`);

  // 4. walls, doors and standing things, back to front
  const doorOn = (x: number, y: number, nx: number, ny: number): MapExit | undefined => {
    for (const [cx, cy] of [[x, y], [nx, ny]]) {
      const o = owner.get(key(cx, cy));
      if (o?.kind === "exit") return exitById.get(o.id);
    }
    return undefined;
  };
  const backWall = (x: number, y: number, sd: "N" | "W") => {
    const [dx, dy] = DIR[sd];
    return ["wall", "door"].includes(edgeBetween(x, y, x + dx, y + dy));
  };
  const frontWall = (x: number, y: number, sd: "S" | "E") => {
    const [dx, dy] = DIR[sd];
    return !isFloor(x + dx, y + dy) && edgeBetween(x, y, x + dx, y + dy) === "wall";
  };
  const order = [...cells].sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
  const vert: Raw[] = [];
  for (const [x, y] of order) {
    let g = html``;
    for (const sd of ["N", "W"] as const) {
      const [dx, dy] = DIR[sd];
      const e = edgeBetween(x, y, x + dx, y + dy);
      if (e !== "wall" && e !== "door") continue;
      const alongX = sd === "N";
      const tr = alongX ? faceM(x, y, true) : faceM(x, y + 1, false);
      if (e === "door") {
        const ex = doorOn(x, y, x + dx, y + dy);
        const fill = alongX ? T.iso.wall : shade(T.iso.wall, 0.82);
        g = html`${g}<g class="dmap-door" transform="${tr}">${ex ? html`<title>${exitLabel(ex)}</title>` : ""}${doorFace(ex?.type ?? "unknown", !!ex?.locked, fill, T.ink)}</g>`;
      } else {
        // a wall run's visible ends get an outline
        const ends: [boolean, boolean] = alongX
          ? [!backWall(x - 1, y, "N"), !backWall(x + 1, y, "N")]
          : [!backWall(x, y + 1, "W"), !backWall(x, y - 1, "W")];
        g = html`${g}<g transform="${tr}">${wallFace(T, WALL_H, alongX, x * 131 + y * 7 + (alongX ? 1 : 2), ends)}${onFace.get(`${sd}:${x},${y}`) ?? []}</g>`;
      }
    }
    g = html`${g}${standing.get(key(x, y)) ?? []}`;
    if (frontWall(x, y, "S")) g = html`${g}<g transform="${faceM(x, y + 1, true)}">${wallFace(T, STUB, true, x * 17 + y, [!frontWall(x - 1, y, "S"), !frontWall(x + 1, y, "S")])}</g>`;
    if (frontWall(x, y, "E")) g = html`${g}<g transform="${faceM(x + 1, y + 1, false)}">${wallFace(T, STUB, false, x * 19 + y, [!frontWall(x, y + 1, "E"), !frontWall(x, y - 1, "E")])}</g>`;
    if (String(g)) vert.push(g); // nothing drawn on this square
  }
  parts.push(html`<g pointer-events="none">${vert}</g>`);

  // 5. haze over misty rooms
  const mist = m.rooms.flatMap((r) => (sc.dressing.get(r.id) ?? []).filter((it) => it.kind === "mist").map(itemSvg));
  if (mist.length) parts.push(html`<g pointer-events="none" transform="${FLOOR_M}" opacity=".8">${mist}</g>`);

  // 6. labels painted on the floor, notes badges, the party token, clickable exits
  let lab = html``;
  for (const r of m.rooms) {
    const { lines, fs, bw, bh, cx, cy, sub } = labels.get(r.id)!;
    lab = html`${lab}<g font-family="Georgia, 'Palatino Linotype', serif" text-anchor="middle">
      <rect x="${f1(cx - bw / 2)}" y="${f1(cy - bh / 2)}" width="${f1(bw)}" height="${f1(bh)}" rx="2" fill="${T.labelBg}" stroke="${T.labelInk}" stroke-width="1" opacity=".95"/>
      ${lines.map((ln, i) => html`<text x="${cx}" y="${f1(cy - bh / 2 + 2 + (i + 0.8) * fs * 1.2)}" font-size="${fs}" fill="${T.labelInk}">${ln}</text>`)}
      ${sub ? html`<text x="${cx}" y="${f1(cy + bh / 2 - 3.5)}" font-size="7" font-style="italic" fill="${T.sub}">${r.sub}</text>` : ""}
    </g>`;
  }
  parts.push(html`<g pointer-events="none" transform="${FLOOR_M}">${lab}</g>`);
  for (const r of m.rooms)
    if (r.notes?.trim()) {
      const [nx, ny] = iso(r.x + r.w - 0.5, r.y + 0.5, 20);
      parts.push(html`<g pointer-events="none" transform="translate(${f1(nx)} ${f1(ny)})"><circle r="6.5" fill="#2f7fd8" stroke="#fff" stroke-width="1.5"/>${NOTE_PENCIL}</g>`);
    }
  const cur = current !== null ? roomById.get(current) : undefined;
  if (cur) {
    const roomCell = (r: MapRoom, nx: number, ny: number): [number, number] => [Math.min(Math.max(nx, r.x), r.x + r.w - 1), Math.min(Math.max(ny, r.y), r.y + r.h - 1)];
    const via = m.exits.find((e) => e.to === cur.id);
    let [tx, ty] = [cur.x, cur.y + cur.h - 1];
    if (via) [tx, ty] = roomCell(cur, via.x + DIR[via.side][0], via.y + DIR[via.side][1]);
    else if (m.entrance && entranceRoom?.id === cur.id) [tx, ty] = [m.entrance.x, m.entrance.y - 1];
    const [sx, sy] = iso(tx + 0.5, ty + 0.5);
    parts.push(html`<g pointer-events="none"><ellipse cx="${f1(sx)}" cy="${f1(sy)}" rx="7" ry="3.5" fill="#000" opacity=".3"/>${cyl(tx + 0.5, ty + 0.5, 0.16, 12, "#c0392b")}${sphere(tx + 0.5, ty + 0.5, 17, 4.5, "#e8d2b0")}</g>`);
  }
  for (const e of openExits(m)) {
    const sel = m.sel === e.id;
    const [dx, dy] = DIR[e.side];
    const [cx, cy] = iso(e.x + 0.5, e.y + 0.5, 6);
    const ang = (Math.atan2((dx + dy) * HY, (dx - dy) * HX) * 180) / Math.PI;
    parts.push(html`<g class="dmap-exit${sel ? " sel" : ""}" data-exit="${e.id}" style="cursor:pointer">
      <title>${exitLabel(e)} — tap to go this way</title>
      <circle cx="${f1(cx)}" cy="${f1(cy)}" r="14" fill="transparent"/>
      <circle cx="${f1(cx)}" cy="${f1(cy)}" r="${sel ? 9 : 7}" fill="${sel ? "#d0582c" : "#e0a33a"}" stroke="#fff" stroke-width="2" ${sel ? html`filter="url(#${P}-glow)"` : ""}/>
      <path d="M-3.5 -4 L3.5 0 L-3.5 4 Z" fill="#fff" transform="translate(${f1(cx)} ${f1(cy)}) rotate(${f1(ang)})"/>
    </g>`);
  }
  parts.push(html`</svg>`);
  return html`${parts}`;
}
