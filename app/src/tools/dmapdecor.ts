// Room dressing for the dungeon map: furniture and scatter chosen from the room's name
// (e.g. LIBRARY → bookshelves and a desk, CRYPT → sarcophagus, urns and bones).
// The name comes from the room table through the content gateway (a generic "Room" while the book
// is locked), and the themes match single generic words: no room name from a locked page is kept here.
// Everything is seeded by the room id so a room always looks the same between redraws.
import type { MapRoom } from "./dmap";
import { inRoom } from "./dmapshape";
import { html, type Raw } from "../ui/html";
import { byGame } from "../games";

const C = 26;
const INK = "#2a211b";
const WOOD = "#8a5a32", WOOD_D = "#5e3b1f", WOOD_L = "#b58a55";
const STONE = "#bdb4a3", STONE_D = "#8f8676";
const GOLD = "#e2b44a", IRON = "#4a4f57", STEEL = "#c3cbd3";
const CLOTH = ["#a8323a", "#2f5b8a", "#3d7a4a", "#7a4a8a", "#b0742a"];
const BOOKS = ["#7b2d2d", "#2d4f7b", "#2d6b3f", "#8a6d2a", "#5b2d6b", "#a04a2a"];

function rnd(x: number, y: number, k = 0): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + k * 2246822519, 1274126177) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const f1 = (n: number) => Math.round(n * 10) / 10;
const pick = <T,>(a: T[], r: number) => a[Math.floor(r * a.length) % a.length];

/** A sprite draws itself centred on (0,0) in a one-square box; "wall" sprites have their back at y = -13. */
type Sprite = (s: number) => Raw;

function blob(r: number, s: number, n = 8, sq = 1): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.7 + rnd(s, i, 3) * 0.45);
    pts.push(`${f1(Math.cos(a) * rr)} ${f1(Math.sin(a) * rr * sq)}`);
  }
  return `M${pts.join("L")}Z`;
}
const flame = (x: number, y: number, r = 3) =>
  html`<circle cx="${x}" cy="${y}" r="${r * 2.2}" fill="#ffb347" opacity=".28"/><circle cx="${x}" cy="${y}" r="${r}" fill="#f07b22"/><circle cx="${x}" cy="${y + 0.4}" r="${r * 0.5}" fill="#ffe08a"/>`;
const candle = (x: number, y: number) => html`<circle cx="${x}" cy="${y}" r="4" fill="#ffd36b" opacity=".3"/><circle cx="${x}" cy="${y}" r="1.6" fill="#fff6d6" stroke="#b08a3a" stroke-width=".5"/>`;

// ---------- wall sprites ----------
export const W: Record<string, Sprite> = {
  bookshelf: (s) => {
    let g = html`<rect x="-12" y="-13" width="24" height="7.5" fill="${WOOD_D}" stroke="${INK}" stroke-width="1"/>`;
    for (let i = 0; i < 7; i++) g = html`${g}<rect x="${-11 + i * 3.2}" y="${-12.2 + rnd(s, i) * 1.2}" width="2.6" height="${5.4 - rnd(s, i) * 1.2}" fill="${pick(BOOKS, rnd(s, i, 2))}"/>`;
    return g;
  },
  flaskshelf: (s) => {
    let g = html`<rect x="-12" y="-13" width="24" height="6.5" fill="${WOOD}" stroke="${INK}" stroke-width="1"/>`;
    for (let i = 0; i < 5; i++) g = html`${g}<circle cx="${-9 + i * 4.5}" cy="-9.7" r="1.7" fill="${pick(["#5fbf6a", "#6a8fe0", "#d0503c", "#c58be0", "#e6c84a"], rnd(s, i))}" stroke="${INK}" stroke-width=".5"/>`;
    return g;
  },
  bed: (s) => {
    const c = pick(CLOTH, rnd(s, 1));
    return html`<rect x="-7" y="-12.5" width="14" height="22" rx="2" fill="${WOOD}" stroke="${INK}" stroke-width="1"/><rect x="-5.5" y="-11" width="11" height="19" rx="1.5" fill="#efe5cf"/><rect x="-4.5" y="-10.5" width="9" height="4" rx="1.5" fill="#fffaf0" stroke="#c9bda3" stroke-width=".5"/><rect x="-5.5" y="-3" width="11" height="11" rx="1" fill="${c}"/><path d="M-5.5 -1 H5.5" stroke="#00000033"/>`;
  },
  rack: (s) => {
    let g = html`<rect x="-11" y="-13" width="22" height="3" fill="${WOOD_D}" stroke="${INK}" stroke-width=".8"/>`;
    for (let i = 0; i < 4; i++) {
      const x = -8 + i * 5.3, t = rnd(s, i) > 0.5;
      g = html`${g}<path d="M${x} -10 L${x + (t ? 1.5 : -1.5)} 2" stroke="${STEEL}" stroke-width="1.4"/><path d="M${x + (t ? 1.5 : -1.5)} 2 l-1.6 2.6 l3.2 0 z" fill="${STEEL}" stroke="${INK}" stroke-width=".4"/>`;
    }
    return g;
  },
  banner: (s) => {
    const c = pick(CLOTH, rnd(s, 4));
    return html`<path d="M-5 -13 H5 V-1 L0 -4 L-5 -1 Z" fill="${c}" stroke="${INK}" stroke-width=".9"/><path d="M-3 -10 H3" stroke="${GOLD}" stroke-width="1.2"/>`;
  },
  torch: () => html`<rect x="-1.5" y="-13" width="3" height="5" fill="${IRON}"/>${flame(0, -6, 2.4)}`,
  shackles: () => {
    let g = html``;
    for (const x of [-5, 5]) {
      for (let i = 0; i < 4; i++) g = html`${g}<circle cx="${x + (i % 2) * 0.6}" cy="${-12 + i * 2.6}" r="1.2" fill="none" stroke="${IRON}" stroke-width=".9"/>`;
      g = html`${g}<path d="M${x - 2.2} -1 a2.2 2.2 0 1 0 4.4 0" fill="none" stroke="${IRON}" stroke-width="1.4"/>`;
    }
    return g;
  },
  urnniche: (s) => html`<rect x="-10" y="-13" width="20" height="6" fill="${STONE_D}" stroke="${INK}" stroke-width=".8"/>${[-6, 0, 6].map((x, i) => html`<circle cx="${x}" cy="-10" r="2.3" fill="${pick(["#a0623a", "#8a7a5a", "#6b5a7a"], rnd(s, i))}" stroke="${INK}" stroke-width=".5"/>`)}`,
  hearth: () => html`<rect x="-11" y="-13" width="22" height="9" rx="1.5" fill="${STONE_D}" stroke="${INK}" stroke-width="1"/><rect x="-7" y="-11" width="14" height="5" fill="#2b1d14"/>${flame(-2, -8.5, 2)}${flame(2.5, -8.5, 1.8)}`,
  hooks: (s) => html`${[-6, 0, 6].map((x, i) => html`<path d="M${x} -13 V-8 a1.6 1.6 0 1 0 3 0" fill="none" stroke="${IRON}" stroke-width="1"/>${rnd(s, i) > 0.4 ? html`<ellipse cx="${x + 1.5}" cy="-4" rx="2.2" ry="3.4" fill="#9a3b36" stroke="${INK}" stroke-width=".5"/>` : ""}`)}`,
  mural: (s) => html`<rect x="-11" y="-13" width="22" height="3.5" fill="${pick(["#c06a3a", "#4a7aa0", "#7a9a4a", "#a04a7a"], rnd(s, 1))}" stroke="${INK}" stroke-width=".7"/><path d="M-9 -11.3 l3 -1 l3 1 l3 -1 l3 1 l3 -1 l3 1" fill="none" stroke="${GOLD}" stroke-width=".7"/>`,
  icicles: () => html`${[-8, -3, 2, 7].map((x) => html`<path d="M${x - 2} -13 L${x} -5 L${x + 2} -13 Z" fill="#dff3ff" stroke="#7fb3d0" stroke-width=".6"/>`)}`,
  roots: (s) => html`<path d="M${-8 + rnd(s, 1) * 4} -13 q3 5 -1 9 t2 8 M${3 + rnd(s, 2) * 4} -13 q-3 4 1 7" fill="none" stroke="#6b5232" stroke-width="1.5" stroke-linecap="round"/><path d="M-4 -11 q2 2 4 1" stroke="#4f7a3a" stroke-width="1" fill="none"/>`,
  candles: () => html`${candle(-6, -10)}${candle(0, -11)}${candle(6, -10)}`,
  crates: (s) => html`<g transform="translate(0 -6)">${S.crate(s)}</g>`,
};

// ---------- floor sprites ----------
export const S: Record<string, Sprite> = {
  barrel: () => html`<circle r="6" fill="${WOOD}" stroke="${INK}" stroke-width="1.1"/><circle r="4.2" fill="none" stroke="${WOOD_D}" stroke-width=".9"/><circle r="1" fill="${WOOD_D}"/>`,
  crate: () => html`<rect x="-6" y="-6" width="12" height="12" fill="${WOOD_L}" stroke="${INK}" stroke-width="1.1"/><path d="M-6 -6 L6 6 M6 -6 L-6 6" stroke="${WOOD_D}" stroke-width=".8"/>`,
  sack: (s) => html`<path d="${blob(5.5, s, 7, 0.85)}" fill="#cdb789" stroke="${INK}" stroke-width=".9"/><path d="M-1.5 -4 l1.5 1.5 l1.5 -1.5" stroke="${WOOD_D}" fill="none" stroke-width=".7"/>`,
  chest: () => html`<rect x="-7.5" y="-5" width="15" height="10" rx="1.5" fill="#7a4a22" stroke="${INK}" stroke-width="1.1"/><path d="M-4 -5 V5 M4 -5 V5" stroke="${GOLD}" stroke-width="1.3"/><rect x="-1.4" y="-1.6" width="2.8" height="3.2" fill="${GOLD}" stroke="${INK}" stroke-width=".5"/>`,
  coins: (s) => html`${[0, 1, 2, 3, 4, 5].map((i) => html`<circle cx="${f1((rnd(s, i) - 0.5) * 10)}" cy="${f1((rnd(s, i, 1) - 0.5) * 8)}" r="1.5" fill="${GOLD}" stroke="#9a7420" stroke-width=".4"/>`)}`,
  bones: (s) => {
    const a = rnd(s, 1) * 180;
    return html`<g transform="rotate(${f1(a)})"><path d="M-5 0 H5" stroke="#efe8d6" stroke-width="1.6"/><circle cx="-5" cy="-.8" r="1" fill="#efe8d6"/><circle cx="-5" cy=".8" r="1" fill="#efe8d6"/><circle cx="5" cy="-.8" r="1" fill="#efe8d6"/><circle cx="5" cy=".8" r="1" fill="#efe8d6"/></g><path d="M-2 4 L3 2" stroke="#e2dac6" stroke-width="1.2" stroke-linecap="round"/>`;
  },
  skull: () => html`<circle r="3.4" fill="#f1ead8" stroke="${INK}" stroke-width=".7"/><circle cx="-1.2" cy="-.3" r=".8" fill="${INK}"/><circle cx="1.2" cy="-.3" r=".8" fill="${INK}"/><rect x="-1.3" y="2.2" width="2.6" height="1.6" fill="#f1ead8" stroke="${INK}" stroke-width=".4"/>`,
  skeleton: (s) => html`<g transform="rotate(${f1(rnd(s, 2) * 360)})"><g transform="translate(0 -6)">${S.skull(s)}</g><path d="M0 -2 V5 M-4 0 H4 M0 5 L-3 10 M0 5 L3 10 M-4 0 L-6 4 M4 0 L6 4" stroke="#efe8d6" stroke-width="1.2" stroke-linecap="round"/></g>`,
  urn: (s) => html`<circle r="4.2" fill="${pick(["#a0623a", "#8a7a5a", "#6b5a7a"], rnd(s, 1))}" stroke="${INK}" stroke-width=".9"/><circle r="1.6" fill="#2b1d14"/>`,
  candle: () => candle(0, 0),
  book: (s) => html`<rect x="-3.5" y="-2.5" width="7" height="5" fill="${pick(BOOKS, rnd(s, 1))}" stroke="${INK}" stroke-width=".6" transform="rotate(${f1(rnd(s, 2) * 60 - 30)})"/>`,
  paper: (s) => html`<rect x="-3" y="-4" width="6" height="8" fill="#fbf5e6" stroke="#b9a984" stroke-width=".5" transform="rotate(${f1(rnd(s, 2) * 60 - 30)})"/>`,
  stool: () => html`<circle r="3" fill="${WOOD_L}" stroke="${INK}" stroke-width=".8"/>`,
  sword: (s) => html`<g transform="rotate(${f1(rnd(s, 1) * 360)})"><path d="M0 -8 V5" stroke="${STEEL}" stroke-width="1.6"/><path d="M-3 4 H3" stroke="${GOLD}" stroke-width="1.4"/><path d="M0 4 V8" stroke="${WOOD_D}" stroke-width="1.6"/></g>`,
  shield: (s) => html`<path d="M-5 -5 H5 V0 Q5 5 0 7 Q-5 5 -5 0 Z" fill="${pick(CLOTH, rnd(s, 1))}" stroke="${INK}" stroke-width=".9"/><path d="M0 -5 V7 M-5 -1 H5" stroke="${GOLD}" stroke-width=".8"/>`,
  straw: (s) => {
    let d = "";
    for (let i = 0; i < 9; i++) {
      const a = rnd(s, i) * Math.PI, x = (rnd(s, i, 1) - 0.5) * 12, y = (rnd(s, i, 2) - 0.5) * 10;
      d += `M${f1(x - Math.cos(a) * 3.5)} ${f1(y - Math.sin(a) * 3.5)}L${f1(x + Math.cos(a) * 3.5)} ${f1(y + Math.sin(a) * 3.5)}`;
    }
    return html`<path d="${d}" stroke="#d6b44a" stroke-width="1" stroke-linecap="round"/>`;
  },
  rubble: (s) => html`${[0, 1, 2, 3].map((i) => html`<path d="${blob(1.6 + rnd(s, i) * 1.8, s * 7 + i, 6)}" transform="translate(${f1((rnd(s, i, 1) - 0.5) * 12)} ${f1((rnd(s, i, 2) - 0.5) * 12)})" fill="${pick([STONE, STONE_D, "#a89f8e"], rnd(s, i, 3))}" stroke="${INK}" stroke-width=".6"/>`)}`,
  crack: (s) => {
    let d = `M${f1((rnd(s, 1) - 0.5) * 10)} -10`;
    for (let i = 1; i <= 4; i++) d += `L${f1((rnd(s, i, 5) - 0.5) * 12)} ${-10 + i * 5}`;
    return html`<path d="${d}" stroke="#5a4636" stroke-width=".8" fill="none" opacity=".7"/>`;
  },
  puddle: (s) => html`<path d="${blob(6, s, 9, 0.7)}" fill="#6aa6d6" opacity=".45"/><path d="M-2 -1 q2 -1.5 4 0" stroke="#e8f4ff" stroke-width=".7" fill="none"/>`,
  blood: (s) => html`<path d="${blob(4.5, s, 9)}" fill="#8f1f22" opacity=".7"/>${[0, 1, 2].map((i) => html`<circle cx="${f1((rnd(s, i) - 0.5) * 14)}" cy="${f1((rnd(s, i, 1) - 0.5) * 14)}" r="${f1(0.8 + rnd(s, i, 2))}" fill="#8f1f22" opacity=".7"/>`)}`,
  slime: (s) => html`<path d="${blob(7, s, 10, 0.8)}" fill="#7cc04a" opacity=".55"/><circle cx="-2" cy="-1" r="1.2" fill="#c8f08a" opacity=".8"/>`,
  mushrooms: (s) => html`${[0, 1, 2].map((i) => {
    const x = (rnd(s, i) - 0.5) * 12, y = (rnd(s, i, 1) - 0.5) * 10, r = 2 + rnd(s, i, 2) * 2;
    const c = pick(["#c0392b", "#a0703a", "#8a5ab0", "#d08a2a"], rnd(s, 9));
    return html`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${c}" stroke="${INK}" stroke-width=".6"/><circle cx="${f1(x - r / 3)}" cy="${f1(y - r / 3)}" r=".7" fill="#fff"/>`;
  })}`,
  rootsF: (s) => html`<path d="M${f1((rnd(s, 1) - 0.5) * 10)} -9 q4 4 0 8 t3 9" fill="none" stroke="#6b5232" stroke-width="1.6" stroke-linecap="round"/><path d="M-6 3 q3 -2 6 0" stroke="#4f7a3a" stroke-width="1.2" fill="none"/>`,
  nest: () => html`<circle r="6.5" fill="#6b5232"/><circle r="4.3" fill="#3d2e1e"/>${[0, 60, 120].map((a) => html`<path d="M-7 0 H7" stroke="#8a6a42" stroke-width=".8" transform="rotate(${a})"/>`)}<circle cx="-1.2" cy=".5" r="1.4" fill="#efe8d6"/><circle cx="1.4" cy="-.6" r="1.4" fill="#efe8d6"/>`,
  hive: () => html`<ellipse rx="5.5" ry="7" fill="#d9a43a" stroke="${INK}" stroke-width=".9"/>${[-3.5, 0, 3.5].map((y) => html`<path d="M-5 ${y} H5" stroke="#8a5a1a" stroke-width=".8"/>`)}<circle cy="3" r="1.2" fill="#2b1d14"/>`,
  ice: (s) => html`<path d="${blob(7, s, 9, 0.8)}" fill="#cfeaff" stroke="#8fc1e0" stroke-width=".6" opacity=".85"/><path d="M-3 -2 l3 -1 M0 2 l3 -1" stroke="#fff" stroke-width=".8"/>`,
  embers: (s) => html`${[0, 1, 2, 3].map((i) => html`<circle cx="${f1((rnd(s, i) - 0.5) * 12)}" cy="${f1((rnd(s, i, 1) - 0.5) * 12)}" r="${f1(0.8 + rnd(s, i, 2) * 0.8)}" fill="${pick(["#f07b22", "#ffb347", "#c0392b"], rnd(s, i, 3))}"/>`)}`,
  flask: (s) => html`<circle r="2.6" fill="${pick(["#5fbf6a", "#6a8fe0", "#d0503c", "#c58be0"], rnd(s, 1))}" stroke="${INK}" stroke-width=".6"/><rect x="-.8" y="-5" width="1.6" height="2.6" fill="#dfe8ea" stroke="${INK}" stroke-width=".4"/>`,
  spikes: () => html`${[-6, 0, 6].flatMap((x) => [-6, 0, 6].map((y) => html`<path d="M${x - 2} ${y + 2} L${x} ${y - 2.5} L${x + 2} ${y + 2} Z" fill="${STEEL}" stroke="${INK}" stroke-width=".5"/>`))}`,
  stoneblock: (s) => html`<rect x="-5" y="-3.5" width="10" height="7" fill="${pick([STONE, "#cfc6b4", STONE_D], rnd(s, 1))}" stroke="${INK}" stroke-width=".9" transform="rotate(${f1(rnd(s, 2) * 40 - 20)})"/>`,
  pillar: () => html`<circle r="6.3" fill="${STONE}" stroke="${INK}" stroke-width="1.2"/><circle r="4.2" fill="#d4ccbc" stroke="${STONE_D}" stroke-width=".8"/>`,
  statue: (s) => html`<rect x="-8" y="-8" width="16" height="16" rx="1.5" fill="${STONE_D}" stroke="${INK}" stroke-width="1"/><ellipse cy="1.5" rx="5" ry="4" fill="${pick(["#9aa89a", "#b7b0a0", "#8a9aa8"], rnd(s, 1))}" stroke="${INK}" stroke-width=".8"/><circle cy="-3.5" r="2.8" fill="${pick(["#9aa89a", "#b7b0a0", "#8a9aa8"], rnd(s, 1))}" stroke="${INK}" stroke-width=".8"/>`,
  cage: () => html`<rect x="-8" y="-8" width="16" height="16" fill="#00000014" stroke="${IRON}" stroke-width="1.4"/>${[-4, 0, 4].map((v) => html`<path d="M${v} -8 V8 M-8 ${v} H8" stroke="${IRON}" stroke-width=".8"/>`)}`,
  dummy: () => html`<circle r="5" fill="#d6b44a" stroke="${INK}" stroke-width=".9"/><path d="M-7 0 H7" stroke="${WOOD_D}" stroke-width="1.6"/><circle cy="-1" r="1.3" fill="#8a5a1a"/>`,
  target: () => html`<circle r="7" fill="#f2ead6" stroke="${INK}" stroke-width=".9"/><circle r="4.8" fill="#c0392b"/><circle r="2.6" fill="#f2ead6"/><circle r="1" fill="#c0392b"/>`,
  pit: () => html`<ellipse rx="9" ry="8" fill="#1d1712" stroke="${INK}" stroke-width="1.2"/><ellipse rx="6" ry="5" fill="#000" opacity=".6"/>`,
  orb: (s) => {
    const c = pick(["#8a5ad0", "#3aa0d0", "#d04a8a", "#4ad08a"], rnd(s, 1));
    return html`<circle r="9" fill="${c}" opacity=".18"/><circle r="5" fill="${c}" stroke="${INK}" stroke-width=".8"/><circle cx="-1.6" cy="-1.6" r="1.6" fill="#fff" opacity=".8"/>`;
  },
  cauldron: () => html`<circle r="7.5" fill="#26221f" stroke="${INK}" stroke-width="1.1"/><circle r="5.5" fill="#6fcf5a"/><circle cx="-2" cy="-1" r="1.2" fill="#c8f5a0"/><circle cx="2" cy="1.5" r=".9" fill="#c8f5a0"/>`,
  firepit: (s) => {
    let g = html``;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g = html`${g}<path d="${blob(2.2, s * 3 + i, 6)}" transform="translate(${f1(Math.cos(a) * 7)} ${f1(Math.sin(a) * 7)})" fill="${STONE}" stroke="${INK}" stroke-width=".6"/>`;
    }
    return html`<circle r="6" fill="#2b1d14"/>${g}${flame(0, 0, 3.6)}`;
  },
  brazier: () => html`<circle r="6" fill="${IRON}" stroke="${INK}" stroke-width="1"/>${flame(0, 0, 3)}`,
  anvil: () => html`<path d="M-8 -3 H6 Q9 -3 9 -1 L6 0 H3 V3 H5 V5 H-5 V3 H-3 V0 H-6 Q-8 0 -8 -3 Z" fill="#5a6068" stroke="${INK}" stroke-width=".9"/>`,
  gong: () => html`<rect x="-9" y="-9" width="18" height="2" fill="${WOOD_D}"/><circle r="7" fill="${GOLD}" stroke="#8a6a1a" stroke-width="1.2"/><circle r="3" fill="none" stroke="#8a6a1a" stroke-width=".8"/>`,
  idol: () => html`<rect x="-5" y="-5" width="10" height="10" fill="${STONE_D}" stroke="${INK}" stroke-width=".9"/><circle r="3.2" fill="${GOLD}" stroke="${INK}" stroke-width=".7"/><circle cx="-1" cy="-.6" r=".6" fill="${INK}"/><circle cx="1" cy="-.6" r=".6" fill="${INK}"/>`,
  headstone: () => html`<path d="M-5 5 V-2 Q-5 -6 0 -6 Q5 -6 5 -2 V5 Z" fill="${STONE}" stroke="${INK}" stroke-width=".9"/><path d="M0 -3 V2 M-2 -1 H2" stroke="${STONE_D}" stroke-width=".8"/>`,
  coffin: (s) => html`<g transform="rotate(${rnd(s, 3) > 0.5 ? 90 : 0})"><path d="M-3 -9 H3 L5 -4 L3 9 H-3 L-5 -4 Z" fill="${WOOD}" stroke="${INK}" stroke-width=".9"/><path d="M0 -6 V0 M-2 -3.5 H2" stroke="${WOOD_D}" stroke-width=".8"/></g>`,
  web: () => {
    // corner cobweb anchored at (-13,-13)
    let d = "";
    for (const a of [0, 22, 45, 68, 90]) {
      const r = (a * Math.PI) / 180;
      d += `M-13 -13 L${f1(-13 + Math.cos(r) * 13)} ${f1(-13 + Math.sin(r) * 13)}`;
    }
    for (const r of [4, 7.5, 11]) d += `M${-13 + r} -13 Q${f1(-13 + r * 0.62)} ${f1(-13 + r * 0.62)} -13 ${-13 + r}`;
    return html`<path d="${d}" stroke="#f4f1ea" stroke-width=".6" fill="none" opacity=".85"/>`;
  },
};

// ---------- centre pieces (sized to the room) ----------
type Centre = (w: number, h: number, s: number) => { svg: Raw; flat?: Raw; cw: number; ch: number } | null;
const table = (len: number, stools: boolean, s: number, extra: Raw | "" = "") => {
  const L = len * C - 8;
  let g = html`<rect x="${-L / 2}" y="-6" width="${L}" height="12" rx="1.5" fill="${WOOD}" stroke="${INK}" stroke-width="1.1"/><path d="M${-L / 2 + 2} -2 H${L / 2 - 2} M${-L / 2 + 2} 2 H${L / 2 - 2}" stroke="${WOOD_D}" stroke-width=".6"/>`;
  if (stools) for (let i = 0; i < len; i++) for (const y of [-11, 11]) if (rnd(s, i, y) > 0.2) g = html`<circle cx="${-L / 2 + 4 + i * C + 5}" cy="${y}" r="3" fill="${WOOD_L}" stroke="${INK}" stroke-width=".8"/>${g}`;
  return html`${g}${extra}`;
};
export const CENTRE: Record<string, Centre> = {
  longtable: (w, h, s) => {
    const len = Math.max(1, Math.min(w - 2, 5));
    return w >= 3 && h >= 3 ? { svg: table(len, true, s, html`${candle(-((len - 1) * C) / 2 + 6, 0)}${len > 2 ? html`<circle cx="6" cy="0" r="3.5" fill="#d9cdb0" stroke="${INK}" stroke-width=".6"/>` : ""}`), cw: len, ch: 1 } : null;
  },
  desk: (w, h, s) => (w >= 3 && h >= 3 ? { svg: table(1, false, s, html`${candle(-6, -1)}<rect x="0" y="-4" width="6" height="7" fill="#fbf5e6" stroke="#b9a984" stroke-width=".5"/><g transform="translate(0 12)">${S.stool(s)}</g>`), cw: 1, ch: 1 } : null),
  altar: (w, h, s) => ({ svg: html`<rect x="-11" y="-6.5" width="22" height="13" fill="${STONE}" stroke="${INK}" stroke-width="1.1"/><rect x="-11" y="-2" width="22" height="4" fill="${pick(CLOTH, rnd(s, 1))}"/>${candle(-8, -4)}${candle(8, -4)}${w >= 4 && h >= 4 ? html`<rect x="-9" y="12" width="18" height="13" fill="#8a2a2a" stroke="${GOLD}" stroke-width="1" opacity=".85"/>` : ""}`, cw: 1, ch: 1 }),
  sarcophagus: (w, h) => (w >= 2 && h >= 3 ? { svg: html`<path d="M-7 -20 H7 L10 -10 L7 20 H-7 L-10 -10 Z" fill="${STONE}" stroke="${INK}" stroke-width="1.2"/><path d="M-5 -17 H5 L7.5 -10 L5 17 H-5 L-7.5 -10 Z" fill="none" stroke="${STONE_D}" stroke-width=".9"/><path d="M0 -12 V2 M-4 -7 H4" stroke="${STONE_D}" stroke-width="1.4"/>`, cw: 1, ch: 2 } : { svg: S.coffin(1), cw: 1, ch: 1 }),
  fountain: (w, h) => {
    const r = Math.min(w, h) >= 3 ? 16 : 11;
    return { svg: html`<circle r="${r}" fill="${STONE}" stroke="${INK}" stroke-width="1.2"/><circle r="${r - 3}" fill="#5b9bd5"/><circle r="${r - 6}" fill="none" stroke="#a8d0f0" stroke-width=".8"/><circle r="3.5" fill="${STONE}" stroke="${INK}" stroke-width=".9"/><circle r="1.4" fill="#cfe8ff"/>`, cw: r > 12 ? 2 : 1, ch: r > 12 ? 2 : 1 };
  },
  pool: (w, h, s) => {
    const rx = Math.max(9, (Math.min(w, 5) * C) / 2 - 12), ry = Math.max(8, (Math.min(h, 4) * C) / 2 - 12);
    return { svg: html`<path d="${blob(1, s, 12).replace(/[-\d.]+ [-\d.]+/g, (p) => { const [a, b] = p.split(" ").map(Number); return `${f1(a * rx)} ${f1(b * ry)}`; })}" fill="#4f8fc8" stroke="#2f5f8a" stroke-width="1.4"/><path d="M${-rx / 2} -2 q${rx / 4} -3 ${rx / 2} 0 M${-rx / 4} ${ry / 3} q${rx / 5} -2 ${rx / 2.5} 0" stroke="#bfe0ff" stroke-width=".9" fill="none"/>`, cw: Math.round((rx * 2) / C), ch: Math.round((ry * 2) / C) };
  },
  firepit: (_w, _h, s) => ({ svg: S.firepit(s), cw: 1, ch: 1 }),
  forge: (w, _h, s) => ({ svg: html`<g transform="translate(${w >= 3 ? -13 : 0} 0)">${S.anvil(s)}</g>${w >= 3 ? html`<g transform="translate(13 0)">${S.brazier(s)}</g>` : ""}`, cw: w >= 3 ? 2 : 1, ch: 1 }),
  throne: (w, h, s) => {
    const runner = h >= 3 ? html`<rect x="-7" y="0" width="14" height="${(h - 2) * C}" fill="#8a2a2a" stroke="${GOLD}" stroke-width="1" opacity=".85"/>` : html``;
    return { flat: runner, svg: html`${runner}<path d="M-9 -12 H9 V4 H6 V-6 H-6 V4 H-9 Z" fill="${GOLD}" stroke="${INK}" stroke-width="1"/><rect x="-6" y="-6" width="12" height="9" fill="${pick(CLOTH, rnd(s, 1))}" stroke="${INK}" stroke-width=".8"/>`, cw: 1, ch: 1 };
  },
  statue: (_w, _h, s) => ({ svg: S.statue(s), cw: 1, ch: 1 }),
  cauldron: (_w, _h, s) => ({ svg: S.cauldron(s), cw: 1, ch: 1 }),
  orb: (_w, _h, s) => ({ svg: html`<rect x="-7" y="-7" width="14" height="14" fill="${STONE_D}" stroke="${INK}" stroke-width=".9" transform="rotate(45)"/>${S.orb(s)}`, cw: 1, ch: 1 }),
  portal: (_w, _h, s) => ({ svg: html`<ellipse rx="11" ry="11" fill="#5a2a8a" opacity=".25"/><ellipse rx="8" ry="8" fill="#2a1240" stroke="#b07ae0" stroke-width="1.5"/><path d="M0 0 m-5 0 a5 5 0 1 1 5 5 a3 3 0 1 1 -3 -3" fill="none" stroke="#d0a8ff" stroke-width="1" transform="rotate(${f1(rnd(s, 1) * 360)})"/>`, cw: 1, ch: 1 }),
  pit: (_w, _h, s) => ({ svg: S.pit(s), cw: 1, ch: 1 }),
  gong: (_w, _h, s) => ({ svg: S.gong(s), cw: 1, ch: 1 }),
  idol: (_w, _h, s) => ({ svg: S.idol(s), cw: 1, ch: 1 }),
  optable: (_w, _h, s) => ({ svg: html`<rect x="-11" y="-5.5" width="22" height="11" rx="1" fill="#9aa2aa" stroke="${INK}" stroke-width="1"/><g transform="translate(2 0)">${S.blood(s)}</g>`, cw: 1, ch: 1 }),
  cages: (w, h, s) => ({ svg: html`${[-1, 1].slice(0, w >= 4 ? 2 : 1).map((k, i) => html`<g transform="translate(${w >= 4 ? k * 13 : 0} 0)">${S.cage(s + i)}</g>`)}`, cw: w >= 4 ? 2 : 1, ch: 1 }),
  stonecircle: (w, h, s) => {
    if (w < 3 || h < 3) return null;
    let g = html``;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      g = html`${g}<rect x="-3" y="-4" width="6" height="8" rx="1" fill="${STONE}" stroke="${INK}" stroke-width=".9" transform="translate(${f1(Math.cos(a) * 17)} ${f1(Math.sin(a) * 17)}) rotate(${f1((a * 180) / Math.PI)})"/>`;
    }
    return { svg: html`${g}${S.candle(s)}`, cw: 2, ch: 2 };
  },
  pews: (w, h) => {
    if (w < 3 || h < 4) return null;
    const rows = Math.min(h - 2, 4), len = w - 2;
    let g = html``;
    for (let i = 0; i < rows; i++) for (const side of [-1, 1]) g = html`${g}<rect x="${side < 0 ? -(len * C) / 2 + 3 : 4}" y="${(i - rows / 2) * C + 6}" width="${(len * C) / 2 - 7}" height="5" fill="${WOOD}" stroke="${INK}" stroke-width=".8"/>`;
    return { svg: g, cw: len, ch: rows };
  },
};

// ---------- 2D6 Void props (consoles, racks, pods, crates, conduits, vats, the reactor, slime…) ----------
const MET = "#7d8892", MET_D = "#4a535c", MET_L = "#b4bec7", SCR = "#38c6ff", GRN = "#6bff8a", HAZ = "#e0b020", WARN = "#d0402c";
const led = (x: number, y: number, c: string) => html`<circle cx="${x}" cy="${y}" r=".9" fill="${c}"/>`;
Object.assign(W, {
  vconsole: (s: number) => html`<rect x="-11" y="-13" width="22" height="9" rx="1.5" fill="${MET_D}" stroke="${INK}" stroke-width="1"/><rect x="-9" y="-12" width="18" height="4.5" rx="1" fill="#0b1a24"/><rect x="-8" y="-11.3" width="${f1(6 + rnd(s, 1) * 9)}" height="1.2" fill="${SCR}" opacity=".85"/><rect x="-8" y="-9.3" width="${f1(4 + rnd(s, 2) * 8)}" height="1" fill="${SCR}" opacity=".55"/>${led(-7, -5.6, GRN)}${led(-4, -5.6, HAZ)}${led(7, -5.6, WARN)}`,
  vpanel: (s: number) => html`<rect x="-9" y="-13" width="18" height="4" fill="#0b1a24" stroke="${MET_D}" stroke-width="1.2"/><path d="M-7 -11 h${f1(5 + rnd(s, 1) * 8)}" stroke="${SCR}" stroke-width="1.2" opacity=".8"/>`,
  vrack: (s: number) => {
    let g = html`<rect x="-11" y="-13" width="22" height="7" fill="#2b3138" stroke="${INK}" stroke-width="1"/>`;
    for (let i = 0; i < 6; i++) g = html`${g}<rect x="${f1(-10 + i * 3.4)}" y="-12" width="2.6" height="5" fill="#3b434b"/>${led(f1(-8.7 + i * 3.4), -10.5, pick([GRN, SCR, HAZ, GRN], rnd(s, i)))}`;
    return g;
  },
  vlocker: (s: number) => html`${[-8, -2.7, 2.6].map((x, i) => html`<rect x="${x}" y="-13" width="5" height="7" fill="${pick([MET, "#6d7f8f", "#7a8a7a"], rnd(s, i))}" stroke="${INK}" stroke-width=".8"/><path d="M${x + 1} -11.5 h3 M${x + 1} -10.3 h3" stroke="${MET_D}" stroke-width=".5"/><circle cx="${f1(x + 4)}" cy="-8" r=".5" fill="${MET_L}"/>`)}`,
  vbunk: (s: number) => html`<rect x="-7" y="-12.5" width="14" height="22" rx="1" fill="${MET_D}" stroke="${INK}" stroke-width="1"/><rect x="-5.5" y="-11" width="11" height="19" rx="1" fill="${pick(["#5b6f86", "#6a7a5a", "#7a6a5a"], rnd(s, 1))}"/><rect x="-4.5" y="-10.5" width="9" height="3.5" rx="1" fill="#c9d1d8"/>`,
  vpipes: () => html`<path d="M-13 -11.5 H13" stroke="${MET_D}" stroke-width="3.2"/><path d="M-13 -11.5 H13" stroke="${MET_L}" stroke-width="1" opacity=".5"/><path d="M-13 -7.5 H13" stroke="#8a6a4a" stroke-width="2.4"/><rect x="-2" y="-13" width="4" height="7" fill="${MET}" stroke="${INK}" stroke-width=".6"/>`,
  vtank: (s: number) => html`<circle cx="0" cy="-6" r="6.5" fill="${MET_D}" stroke="${INK}" stroke-width="1"/><circle cx="0" cy="-6" r="4.6" fill="${pick(["#6bd08a", "#5ab0e0", "#c07ae0"], rnd(s, 1))}" opacity=".75"/><circle cx="-1.5" cy="-7.5" r="1.2" fill="#fff" opacity=".6"/>`,
  vmedpod: () => html`<rect x="-6" y="-12.5" width="12" height="20" rx="5" fill="${MET_L}" stroke="${INK}" stroke-width="1"/><rect x="-4" y="-10.5" width="8" height="15" rx="3.5" fill="#bfe9ff" opacity=".7"/><path d="M-1.5 -4 h3 M0 -5.5 v3" stroke="${WARN}" stroke-width="1"/>`,
} satisfies Record<string, Sprite>);
Object.assign(S, {
  vcrate: (s: number) => html`<rect x="-6.5" y="-6.5" width="13" height="13" rx="1" fill="${pick(["#6d7a52", "#7a6a4a", "#5a6a7a"], rnd(s, 1))}" stroke="${INK}" stroke-width="1"/><rect x="-6.5" y="-1.5" width="13" height="3" fill="${HAZ}" opacity=".8"/><path d="M-4 -1.5 l2 3 M0 -1.5 l2 3 M4 -1.5 l2 3" stroke="#1d1f22" stroke-width=".8"/>`,
  vbarrel: () => html`<circle r="5.5" fill="${HAZ}" stroke="${INK}" stroke-width="1"/><circle r="3.6" fill="none" stroke="#8a6a1a" stroke-width=".8"/><path d="M0 -2.2 l2 3.6 h-4 z" fill="#1d1f22"/>`,
  vcanister: (s: number) => html`<circle r="3.4" fill="${pick([MET_L, "#d0d8de", "#9ab0c0"], rnd(s, 1))}" stroke="${INK}" stroke-width=".8"/><circle r="1.6" fill="${pick([GRN, SCR, WARN], rnd(s, 2))}"/>`,
  vdebris: (s: number) => html`${[0, 1, 2].map((i) => html`<rect x="-2.5" y="-1.5" width="${f1(3 + rnd(s, i) * 4)}" height="${f1(1.5 + rnd(s, i, 1) * 2)}" fill="${pick([MET, MET_D, "#5a5048"], rnd(s, i, 2))}" stroke="${INK}" stroke-width=".4" transform="translate(${f1((rnd(s, i, 3) - 0.5) * 12)} ${f1((rnd(s, i, 4) - 0.5) * 12)}) rotate(${f1(rnd(s, i, 5) * 180)})"/>`)}`,
  vscrap: (s: number) => html`<path d="${blob(5, s, 7, 0.8)}" fill="${MET_D}" stroke="${INK}" stroke-width=".7"/><path d="M-3 -1 l5 2 M-1 3 l3 -5" stroke="${MET_L}" stroke-width=".8"/>`,
  vcables: (s: number) => html`<path d="M-10 ${f1((rnd(s, 1) - 0.5) * 8)} q5 -6 10 0 t10 0" fill="none" stroke="#1d1f22" stroke-width="1.8"/><path d="M-9 ${f1((rnd(s, 2) - 0.5) * 8)} q4 5 9 0 t9 1" fill="none" stroke="${WARN}" stroke-width="1.2"/>`,
  vslime: (s: number) => html`<path d="${blob(7.5, s, 11, 0.75)}" fill="#7ad04a" opacity=".5"/><path d="${blob(3.5, s + 3, 8)}" fill="#b8f070" opacity=".6"/>`,
  veggs: (s: number) => html`<path d="${blob(6, s, 9, 0.8)}" fill="#7ad04a" opacity=".25"/>${[0, 1, 2, 3].map((i) => html`<ellipse cx="${f1((rnd(s, i) - 0.5) * 11)}" cy="${f1((rnd(s, i, 1) - 0.5) * 10)}" rx="2.6" ry="3.4" fill="#c8b07a" stroke="#5a4a2a" stroke-width=".6"/>`)}`,
  vplant: (s: number) => html`<rect x="-6" y="-6" width="12" height="12" rx="1" fill="${MET_D}" stroke="${INK}" stroke-width=".8"/>${[0, 1, 2, 3].map((i) => html`<circle cx="${f1((rnd(s, i) - 0.5) * 7)}" cy="${f1((rnd(s, i, 1) - 0.5) * 7)}" r="2.6" fill="${pick(["#4f9a3a", "#6ab04a", "#3d7a2a"], rnd(s, i, 2))}"/>`)}`,
  vcrystal: (s: number) => html`${[0, 1, 2].map((i) => html`<path d="M0 -5 L2 0 L0 5 L-2 0 Z" fill="${pick(["#7ad0f0", "#c07ae0", "#f07a9a"], rnd(s, 9))}" stroke="${INK}" stroke-width=".5" opacity=".85" transform="translate(${f1((rnd(s, i) - 0.5) * 10)} ${f1((rnd(s, i, 1) - 0.5) * 10)}) rotate(${f1(rnd(s, i, 2) * 60 - 30)})"/>`)}`,
  vdrone: (s: number) => html`<g transform="rotate(${f1(rnd(s, 1) * 360)})"><path d="M-8 0 H8 M0 -8 V8" stroke="${MET}" stroke-width="1.4"/><circle r="4.5" fill="${MET_D}" stroke="${INK}" stroke-width=".8"/><circle r="1.5" fill="${WARN}" opacity=".6"/></g>`,
} satisfies Record<string, Sprite>);
Object.assign(CENTRE, {
  vholo: (w, h) => (w >= 3 && h >= 3 ? { svg: html`<circle r="12" fill="${SCR}" opacity=".12"/><circle r="11" fill="${MET_D}" stroke="${INK}" stroke-width="1.1"/><circle r="8" fill="#0b1a24"/><path d="M-6 2 l6 -9 l6 9 z M-4 2 l4 -5 l4 5" fill="none" stroke="${SCR}" stroke-width=".9" opacity=".9"/><circle r="2" fill="${SCR}" opacity=".7"/>`, cw: 1, ch: 1 } : null),
  vreactor: (w, h) => {
    const r = Math.min(w, h) >= 3 ? 14 : 9;
    return { svg: html`<circle r="${r + 4}" fill="${SCR}" opacity=".12"/><circle r="${r}" fill="${MET_D}" stroke="${INK}" stroke-width="1.2"/><circle r="${r - 3}" fill="#123a4a" stroke="${MET}" stroke-width="1"/><circle r="${r - 6}" fill="${SCR}" opacity=".85"/><circle r="${f1((r - 6) / 2)}" fill="#e6fbff"/>${[0, 90, 180, 270].map((a) => html`<rect x="-1.5" y="${-r - 2}" width="3" height="4" fill="${HAZ}" transform="rotate(${a})"/>`)}`, cw: r > 9 ? 2 : 1, ch: r > 9 ? 2 : 1 };
  },
  vvat: (w, _h, s) => {
    const n = w >= 4 ? 2 : 1;
    const c = pick(["#6bd08a", "#5ab0e0", "#c07ae0", "#d0a04a"], rnd(s, 1));
    return { svg: html`${[-1, 1].slice(0, n).map((k) => html`<g transform="translate(${n > 1 ? k * 13 : 0} 0)"><circle r="9" fill="${MET_D}" stroke="${INK}" stroke-width="1.1"/><circle r="6.8" fill="${c}" opacity=".7"/><circle cx="-2" cy="-2" r="2" fill="#fff" opacity=".45"/><circle cx="2" cy="2.5" r="1" fill="#fff" opacity=".5"/></g>`)}`, cw: n, ch: 1 };
  },
  vmedbed: (w, h) => (w >= 2 && h >= 2 ? { svg: html`<rect x="-6" y="-11" width="12" height="22" rx="2" fill="${MET_L}" stroke="${INK}" stroke-width="1"/><rect x="-4.5" y="-9.5" width="9" height="19" rx="1.5" fill="#e8eef2"/><rect x="-4" y="-9" width="8" height="4" rx="1.5" fill="#fff"/><rect x="6" y="-8" width="5" height="6" fill="#0b1a24" stroke="${MET_D}"/><path d="M6.8 -5 h1 l.8 -1.6 l.8 3 l.8 -1.4 h.9" fill="none" stroke="${GRN}" stroke-width=".6"/>`, cw: 1, ch: 1 } : null),
  vmachine: (w, h, s) => (w >= 2 && h >= 2 ? { svg: html`<rect x="-12" y="-9" width="24" height="18" rx="2" fill="${MET}" stroke="${INK}" stroke-width="1.2"/><rect x="-9" y="-6" width="9" height="12" fill="${MET_D}"/><circle cx="6" cy="-1" r="4.5" fill="${MET_D}" stroke="${INK}" stroke-width=".8"/><path d="M6 -5.5 V3.5 M1.5 -1 H10.5" stroke="${MET_L}" stroke-width=".8"/>${led(-7, -3, pick([GRN, HAZ], rnd(s, 1)))}${led(-4, -3, WARN)}<path d="M-12 7 h24" stroke="${HAZ}" stroke-width="1.6" stroke-dasharray="3 3"/>`, cw: 1, ch: 1 } : null),
  vtable: (w, h) => (w >= 3 && h >= 3 ? { svg: html`<rect x="-12" y="-6" width="24" height="12" rx="1.5" fill="${MET_L}" stroke="${INK}" stroke-width="1.1"/><path d="M-12 -2 H12 M-12 2 H12" stroke="${MET}" stroke-width=".6"/><rect x="2" y="-4" width="6" height="4" fill="#0b1a24"/><path d="M3 -2 h4" stroke="${SCR}" stroke-width=".8"/>`, cw: 1, ch: 1 } : null),
  vpod: (w, h) => (w >= 2 && h >= 2 ? { svg: html`<ellipse rx="11" ry="15" fill="${MET_L}" stroke="${INK}" stroke-width="1.2"/><ellipse cy="-5" rx="6" ry="5" fill="#0b1a24"/><ellipse cy="-6" rx="4" ry="2.5" fill="${SCR}" opacity=".5"/><path d="M-11 4 H11" stroke="${HAZ}" stroke-width="2"/><path d="M-6 15 l-2 4 M6 15 l2 4" stroke="${WARN}" stroke-width="2"/>`, cw: 1, ch: 1 } : null),
} satisfies Record<string, Centre>);

// ---------- themes ----------
interface Theme { re: RegExp; wall?: string[]; wallP?: number; centre?: string[]; scatter?: string[]; scatterP?: number; overlay?: "flood" | "mist" | "ice" | "lava" | "mosaic" | "rug" | "blood"; pillars?: boolean }
const THEMES: Theme[] = [
  { re: /LIBRAR|STUDY|SCRIBE|BOOK|CARTOGRAPH|LEARNING|SCHOLAR|NOTICE|TEXT|WORDS|RUNES?\b/, wall: ["bookshelf"], wallP: 0.7, centre: ["desk", "longtable"], scatter: ["book", "paper", "candle"], scatterP: 0.12 },
  { re: /TOMB|CRYPT|MAUSOLEUM|SARCOPH|COFFIN|GRAVE|COLUMBARIUM|OSSUARY|CHARNEL|MORGUE|NECROPSY|HEADSTONE|RESTING|UNDERCROFT/, wall: ["urnniche", "candles"], wallP: 0.45, centre: ["sarcophagus"], scatter: ["bones", "skull", "urn", "coffin", "headstone"], scatterP: 0.14 },
  { re: /URN/, centre: ["idol"], scatter: ["urn", "urn", "urn", "rubble"], scatterP: 0.25 },
  { re: /SKULL|BONE|SKELETON|CORPSE|CARCASS|BODIES|CRUSHED|WARRIOR|DEAD|TEETH|MASS/, scatter: ["bones", "skull", "skeleton", "bones", "blood"], scatterP: 0.22 },
  { re: /CHURCH|PEW|CHAPEL|CEREMONIAL|CLOISTER|CHANTRY/, wall: ["candles", "banner"], wallP: 0.35, centre: ["pews", "altar"], scatter: ["candle", "candle", "urn"], scatterP: 0.12, overlay: "rug" },
  { re: /SHRINE|TEMPLE|PRAYER|ALTAR|SANCT|WORSHIP|HOLY|VESTRY|D[EI]VINE|RITE|OATH|PLINTH|OFFERING|GOD|RELIGIOUS|SYMBOL|EXPIATORY|SACRED|ENCLAVE|HEX|DOOM|PRACTICE/, wall: ["candles", "banner", "mural"], wallP: 0.35, centre: ["altar"], scatter: ["candle", "candle", "urn"], scatterP: 0.08 },
  { re: /IDOL|EFFIGY|STATUE|MONUMENT|SCULPT|GARGOYLE|MASK|CONSTRUCT|DOLL|PUPPET|CARVING/, wall: ["mural"], wallP: 0.2, centre: ["statue", "idol"], scatter: ["rubble", "candle"], scatterP: 0.06 },
  { re: /MURAL|MOSAIC|TAPESTRY|PAINTING|GLYPH|TILED|BANNER|LEATHER/, wall: ["mural", "banner"], wallP: 0.5, overlay: "mosaic", scatter: ["rubble", "candle", "urn", "candle"], scatterP: 0.08 },
  { re: /BARRACKS|DORM|SLEEPING|BEDROOM|REST|LOUNGE|SHELTER|HARBORAGE|HUDDLE|FUR/, wall: ["bed"], wallP: 0.6, scatter: ["chest", "sack", "stool"], scatterP: 0.07 },
  { re: /CAMP|FIRE PIT|SMOKING|HEATED|BURNER/, centre: ["firepit"], scatter: ["sack", "bones", "embers", "stool"], scatterP: 0.1 },
  { re: /MESS|CANTEEN|KITCHEN|DINING|STOVE|FEAST|TABLE|MEETING|COUNCIL|FOOD|PRESERV|DRYING|\bDRY\b/, wall: ["hearth", "flaskshelf"], wallP: 0.2, centre: ["longtable"], scatter: ["barrel", "sack", "crate"], scatterP: 0.07 },
  { re: /BUTCHER|ABATTOIR|EXTRACTION|HOOK|MEAT/, wall: ["hooks"], wallP: 0.5, centre: ["optable"], scatter: ["blood", "bones"], scatterP: 0.12 },
  { re: /TREATMENT|MEDIC|INFIRMARY|\bPREP\b|SURGERY/, wall: ["bed", "flaskshelf"], wallP: 0.4, centre: ["optable"], scatter: ["flask", "blood"], scatterP: 0.06 },
  { re: /VAULT|LOOT|TREASURE|LOCK-UP|SECURE|METAL BOX/, scatter: ["chest", "coins", "chest", "crate"], scatterP: 0.22 },
  { re: /STORE|STORAGE|CRATE|DUMP|QUARTERMASTER|MATERIALS|SUPPLY|SHELF|LOCKER|SCRAP|HEAP|BOXES|CASE|DUMPED/, wall: ["crates"], wallP: 0.35, scatter: ["crate", "barrel", "sack", "crate"], scatterP: 0.25 },
  { re: /ARMOU?RY|WEAPON|SPEAR|ARMS/, wall: ["rack"], wallP: 0.65, scatter: ["sword", "shield"], scatterP: 0.08 },
  { re: /GARRISON|GUARD|SPARRING|TRAINING|BARRACK/, wall: ["rack", "torch"], wallP: 0.35, centre: ["longtable"], scatter: ["dummy", "shield", "stool"], scatterP: 0.06 },
  { re: /ARCHERY|RANGE|ARROW/, wall: ["rack"], wallP: 0.3, scatter: ["target"], scatterP: 0.12 },
  { re: /BLACKSMITH|SMITH|FORGE|METAL/, wall: ["rack", "hearth"], wallP: 0.3, centre: ["forge"], scatter: ["embers", "sword", "crate"], scatterP: 0.08 },
  { re: /MASON|STONE WORKSHOP|SLAB|STONES|BLOCK/, centre: ["forge"], scatter: ["stoneblock", "stoneblock", "rubble"], scatterP: 0.15 },
  { re: /WORKSHOP|\bWORK\b|WORKSPACE|MANIKIN|TOOL/, wall: ["flaskshelf"], wallP: 0.3, centre: ["longtable"], scatter: ["crate", "stoneblock", "paper"], scatterP: 0.08 },
  { re: /FOUNTAIN|FONT|BASIN|WATER/, centre: ["fountain"], scatter: ["puddle", "candle", "urn", "puddle"], scatterP: 0.12 },
  { re: /WASH/, centre: ["longtable"], wall: ["flaskshelf"], wallP: 0.3, scatter: ["barrel", "flask", "puddle", "sack"], scatterP: 0.14 },
  { re: /POOL|BATH|STREAM|FISHERY|JELLYFISH|PIRANHA|SEAWEED|TIDE/, centre: ["pool"], scatter: ["puddle", "puddle", "candle", "sack"], scatterP: 0.12 },
  { re: /FLOOD|DAMP|SWAMP|BOG|MUD/, overlay: "flood", scatter: ["puddle", "slime", "mushrooms"], scatterP: 0.15 },
  { re: /JAIL|PRISON|PENITENTIARY|SHACKLE|HOLDING|CELLS?\b|CHAIN|QUARANTINE|BOUND|TRUSSED|WHIPPING/, wall: ["shackles"], wallP: 0.45, scatter: ["straw", "bones", "straw"], scatterP: 0.14 },
  { re: /CAGE|PEN|KENNEL|AVIARY|BEAR|BREEDING/, centre: ["cages"], scatter: ["straw", "bones", "cage"], scatterP: 0.12 },
  { re: /THRONE|KING|COURT/, wall: ["banner", "torch"], wallP: 0.4, centre: ["throne"], pillars: true },
  { re: /HALL|GALLERY|PILLAR|COLUMN|ARCADE|AISLE|ARCHES|MARBLE|JADE|GRAND|ELEGANT/, wall: ["banner", "torch"], wallP: 0.2, pillars: true, overlay: "rug", scatter: ["rubble", "candle", "urn"], scatterP: 0.06 },
  { re: /STANDING|MENHIR|MONOLITH|CIRCLE|BALANCED/, centre: ["stonecircle", "idol"] },
  { re: /FIRE|BURN|LAVA|HEAT|INFERNAL|BRAZIER|CHARRED|BOILING|EMBER/, wall: ["torch"], wallP: 0.3, centre: ["firepit"], scatter: ["embers", "brazier"], scatterP: 0.1, overlay: "lava" },
  { re: /LANTERN|TORCH|CANDLE|SCONCE/, wall: ["torch", "candles"], wallP: 0.5, scatter: ["candle"], scatterP: 0.12 },
  { re: /ALCHEMY|APOTHECARY|ARCANE|SPECIMEN|VATS|JAR|LIQUID|EYEBALL/, wall: ["flaskshelf"], wallP: 0.6, centre: ["cauldron"], scatter: ["flask", "flask", "paper"], scatterP: 0.1 },
  { re: /MAGIC|ORB|GLASS|PSYCHE|DISPLACEMENT|METAMORPH|AURA|SHIFTING|LOOPING|WARPING|REPLICATING/, wall: ["candles"], wallP: 0.2, centre: ["orb"], scatter: ["flask", "candle"], scatterP: 0.06 },
  { re: /PORTAL|VOID|VORTEX/, centre: ["portal"], scatter: ["rubble", "crack"], scatterP: 0.08 },
  { re: /GONG/, centre: ["gong"] },
  { re: /PIT|CHASM|HOLE|DEPRESSION|MORT|SINK/, centre: ["pit"], scatter: ["bones", "rubble"], scatterP: 0.08 },
  { re: /SPIKE/, scatter: ["spikes", "blood"], scatterP: 0.18 },
  { re: /SACRIFIC|BLOOD|BLOODIED|RED/, centre: ["altar"], scatter: ["blood", "blood", "skull"], scatterP: 0.12, overlay: "blood" },
  { re: /MUSHROOM|FUNG|CREEPING/, scatter: ["mushrooms", "mushrooms", "slime"], scatterP: 0.3 },
  { re: /ROOT|VINE|WEED|BRANCH|TENDRIL|HANGING|GREEN|SEAWEED|SLIME|PUS|INFECT|PLAGUE|POCKED/, wall: ["roots"], wallP: 0.45, scatter: ["slime", "rootsF", "mushrooms"], scatterP: 0.14 },
  { re: /WEB|COBWEB|NEST|COCOON|SPIDER|UMBRA|BAT/, scatter: ["nest", "web", "bones"], scatterP: 0.12 },
  { re: /HIVE|TERMITE|BEE|INSECT|FLY|SWARM/, scatter: ["hive", "slime", "hive"], scatterP: 0.14 },
  { re: /DEN|LAIR|SNAKE|DIRTY|SOILED|LITTERED|MESSY|DUSTY|SCUFFED|WRECK|SMASHED|BOTTLES/, scatter: ["bones", "rubble", "straw", "sack"], scatterP: 0.16 },
  { re: /ICE|FROZEN|FREEZ|COLD|SNOW|ICICLE/, wall: ["icicles"], wallP: 0.5, scatter: ["ice", "ice", "rubble"], scatterP: 0.14, overlay: "ice" },
  { re: /COLLAPSE|RUBBLE|FALL|BROKEN|CRUMBL|CRACKED|ROCKS|SCRATCH|SCARRED|HACKED|GROTTO|CAVE|EARTHEN/, scatter: ["rubble", "rubble", "crack"], scatterP: 0.25 },
  { re: /MIST|FOG|GAS|MIASMA|METHANE|CLOUD|SMOK/, overlay: "mist", scatter: ["crack", "bones"], scatterP: 0.05 },
  { re: /TROPHY|STUFFED|HIDE/, wall: ["banner", "hooks"], wallP: 0.45, centre: ["statue"] },
];

/** 2D6 Void's room names (Level N Rooms, small and large room tables) and their sci-fi props. */
const VOID_THEMES: Theme[] = [
  { re: /ESCAPE POD|EVACUATION|CAPSULE BAY|POD STORAGE/, centre: ["vpod"], wall: ["vpanel"], wallP: 0.3, scatter: ["vcrate"], scatterP: 0.06 },
  { re: /PORTAL|VOID|VORTEX|NULL|ANOMALY|MATTER|SHIFTING|TWISTING|LOOPING|UNSTABLE REALITY|CROSSOVER|ECHO|SHATTERED AIR/, centre: ["portal"], scatter: ["crack", "vcrystal", "vdebris"], scatterP: 0.08 },
  { re: /REACTOR|POWER|CORE|CAPACITOR|SPARK|ENERGY|FLUX|CHARG|PULSE|LIGHTNING|STATIC|FIELD|RELAY|CELL\b|BATTERY|GENERATOR/, centre: ["vreactor"], wall: ["vpipes", "vpanel"], wallP: 0.3, scatter: ["vcables", "vcanister"], scatterP: 0.1 },
  { re: /MED|SURGICAL|INFIRMARY|DISSECT|MORGUE|PREP ROOM|PREPARATION|TREATMENT|HEALING|IMPLANT/, centre: ["vmedbed"], wall: ["vmedpod", "vconsole"], wallP: 0.4, scatter: ["vcanister", "blood"], scatterP: 0.08 },
  { re: /VAT|TANK|CYLINDER|CRYO|INCUBATION|GESTATION|PROTOFORM|SPECIMEN|PODS|CONTAINMENT|FRIDGE|SUSPENSION|CRADLE|EMERGENCE|MATURATION|GROWTH|BASIN|BATH|GLOBES/, centre: ["vvat"], wall: ["vtank", "vmedpod"], wallP: 0.4, scatter: ["vcanister", "puddle"], scatterP: 0.07 },
  { re: /SERVER|DATA|COMPUTER|PROCESSOR|ARCHIVE|RECORDS|GENOME|CATALOGUE|REFERENCE|INFO|CODE|NEXUS|HALO|HUB|TERMINAL|CONSOLE|COMS?\b|SCREEN|MONITOR|READOUT|INTERFACE|SURVEILLANCE|CONTROL|PANELS?\b|SCANN|SENSOR|ARRAY|CHART|MAP CHAMBER|NUMBER/, wall: ["vconsole", "vrack", "vpanel"], wallP: 0.55, centre: ["vholo"], scatter: ["vcables"], scatterP: 0.06 },
  { re: /LIBRARY|STUDY|READING|LECTURE|MANUSCRIPT|SCROLL|BOOK|SHELV|CABINET|ALCOVE/, wall: ["bookshelf", "vrack"], wallP: 0.6, centre: ["vtable"], scatter: ["paper", "vcanister"], scatterP: 0.06 },
  { re: /LAB|RESEARCH|SCIENCE|ANALYS|EXPERIMENT|SPLICING|BIOFORM|SPECIES|TESTING|ASTRO|OBSERVATION|VIEWING/, wall: ["vconsole", "vtank", "flaskshelf"], wallP: 0.45, centre: ["vtable"], scatter: ["vcanister", "flask"], scatterP: 0.08 },
  { re: /LOCKER|ARMOU?RY|WEAPON|ARSENAL|MUNITIONS|AMMO|MISSILE|GAS WEAPONS|SHELL BAYS/, wall: ["vlocker"], wallP: 0.6, scatter: ["vcrate", "vbarrel"], scatterP: 0.1 },
  { re: /CARGO|STORE|STORAGE|SUPPLY|LOADING|DEPOT|WAREHOUSE|CRATE|STACKS|RACK|HOLD|STRONG ROOM|TRUNK|BOX/, wall: ["vlocker", "vrack"], wallP: 0.3, scatter: ["vcrate", "vcrate", "vbarrel"], scatterP: 0.22 },
  { re: /GUARD|SECURITY|CHECKPOINT|SENTINEL|PATROL|COMBAT|BATTLE|TRAINING|BRIEFING|STAGING|TROOP|WAR\b|RESPONSE|LOCKDOWN|SUPPRESSION|RECON/, wall: ["vlocker", "vconsole"], wallP: 0.35, centre: ["vholo"], scatter: ["vcrate", "vdrone"], scatterP: 0.06 },
  { re: /BUNK|LIVING|REST\b|LOUNGE|SLEEP|RELAX|MESS HALL|CLOTHING|CUBICLE|QUARTERS|GATHERING/, wall: ["vbunk", "vlocker"], wallP: 0.5, centre: ["vtable"], scatter: ["vcrate", "vcanister"], scatterP: 0.06 },
  { re: /PIPE|CONDUIT|VENT|PLASMA|FUEL|GAS|PUMP|WATER|RADIATOR|HEAT|PRESSURE|HYDRAULIC|TUBE|ATMOS|SEWAGE|INTAKE|DECON|PURGE|WASTE|RECLAIM|THERMAL/, wall: ["vpipes", "vtank"], wallP: 0.5, scatter: ["vcanister", "vbarrel", "puddle"], scatterP: 0.1 },
  { re: /WORKSHOP|REPAIR|MAINTENANCE|FABRICATION|WELD|PARTS|TOOL|MACHINE|PRESS|PISTON|DRILL|EXCAVATOR|CONVEYOR|BELT|MINING|REFINERY|SMELT|FORGE|MELTWORKS|POUNDING|BOREHEAD|EXO-SUIT|POWER SUIT|DRONE|MECH\b|ROBOT/, centre: ["vmachine"], wall: ["vrack", "vlocker"], wallP: 0.3, scatter: ["vscrap", "vcrate", "vdrone"], scatterP: 0.1 },
  { re: /HANGAR|DOCK|BAY\b|VEHICLE|LAUNCH|TRANSPORT|MAG-LIFT|MAG RAIL|LIFT|PLATFORM|YARD|TRACK/, scatter: ["vcrate", "vbarrel", "vcrate"], scatterP: 0.12, wall: ["vpanel"], wallP: 0.2 },
  { re: /NEST|HIVE|SPAWN|HATCHERY|BREED|EGG|SLUDGE|GLOOM|BIOMATTER|ORGANIC|FLESH|SKIN|VEIN|SPORE|INFEST|MUTA|FEEDING|PENS?\b|PREDATOR|LAIR|DEN\b|GUNK|BONE|TISSUE|EYEBALL|BRAIN|SACKS|TENTACLE|ALIEN|BULBOUS|GNARLED|MONSTROUS/, scatter: ["vslime", "veggs", "vslime", "bones"], scatterP: 0.2, wall: ["roots"], wallP: 0.2 },
  { re: /CELLS?\b|CAGE|DETENTION|CONFINEMENT|RESTRAINT|SHACKLE|INTERROGATION|COMPLIANCE|CAPTOR|LOCKUP|PRISON|HOLDING/, wall: ["shackles", "vpanel"], wallP: 0.4, scatter: ["bones", "vdebris"], scatterP: 0.08 },
  { re: /THRONE|SHRINE|ALTAR|RELIC|ORNATE|PROCESSION|BANNER|DECORATED|PATTERNS/, centre: ["throne", "altar"], wall: ["banner", "vpanel"], wallP: 0.3 },
  { re: /STATUE|SCULPT|FOSSIL|TROPHY/, centre: ["statue"], scatter: ["rubble"], scatterP: 0.06 },
  { re: /GARDEN|HYDROPONIC|PLANT|GREEN|VINE|NATURAL|FRUIT|SEED|BLOOMS|FOREST/, scatter: ["vplant", "vplant", "rootsF"], scatterP: 0.25, wall: ["roots"], wallP: 0.3 },
  { re: /CRYSTAL|GEM|RUBY|STONE|ROCK|ORE\b|OBSIDIAN|STALAGMITE|GRAPHITE|METEOR|REGOLITH|SAND|HEARTSTONE/, scatter: ["vcrystal", "rubble", "rubble"], scatterP: 0.2 },
  { re: /FLOOD|BLACK WATER|RAIN|FOUNTAIN|LIQUID|FLUID|LEAK|SPILL|CHEMICAL|STINKING|MELT|SLURRY/, overlay: "flood", scatter: ["puddle", "vslime"], scatterP: 0.12 },
  { re: /SMOG|SMOKE|CLOUD|HAZE|MIST|CHILLING|SUSPENDED GAS|TENSE AIR/, overlay: "mist", scatter: ["vcanister"], scatterP: 0.04 },
  { re: /IRRADIATED|RADIATION|HAZARD|BIOHAZARD|VOLATILE|BURNING|INCINERATION/, scatter: ["vbarrel", "vcanister", "vdebris"], scatterP: 0.14, overlay: "lava" },
  { re: /CABLE|WIRE|HANGING|CHAINS/, scatter: ["vcables", "vcables", "vdebris"], scatterP: 0.2 },
  { re: /DEBRIS|SCRAP|JUNK|COLLAPSED|DAMAGED|SMASHED|BROKEN|RUNDOWN|DUMP|CLUTTER|RUIN|WRECK|TANGLED|SCATTERED|FALLEN|CRACKED|SHATTERED|DISARRAY|DISTURBED|GOUGED|MESS\b/, scatter: ["vdebris", "vscrap", "vdebris", "crack"], scatterP: 0.22 },
  { re: /BLOOD/, scatter: ["blood", "blood", "vdebris"], scatterP: 0.14, overlay: "blood" },
];

/** Which themes apply to a room name (the first two that match). */
export function roomThemes(name: string): Theme[] {
  const n = name.toUpperCase();
  return byGame({ dungeon: THEMES, void: VOID_THEMES }).filter((t) => t.re.test(n)).slice(0, 2);
}

export interface DressingInput {
  room: MapRoom;
  reserved: Set<string>; // cells to keep clear (doorways, stairs, the label)
  wallSides: (x: number, y: number) => ("N" | "E" | "S" | "W")[]; // which sides of a room cell are solid wall
  ids?: string; // id prefix of the map's SVG defs (clip paths, mist filter)
}
const ROT = { N: 0, E: 90, S: 180, W: 270 } as const;

/**
 * One placed piece of dressing. `x`,`y` are its centre in top-down map pixels; `svg` is its top-down
 * drawing around (0,0) (or in map pixels when `abs`). The isometric view uses `kind`/`name`/`side`
 * to draw its own 3D version instead.
 */
export interface DecorItem {
  kind: "overlay" | "pillar" | "centre" | "wall" | "scatter" | "web" | "grime" | "mist";
  name: string;
  x: number;
  y: number;
  rot: number;
  side?: "N" | "E" | "S" | "W";
  seed: number;
  svg: Raw;
  flat?: Raw; // the throne: the part that stays on the floor in the 3D view (its runner)
  abs?: boolean; // svg already in map pixels
  cw?: number; // centre pieces: footprint in squares
  ch?: number;
  turn?: number; // quarter turns clockwise since it was planned (dmaprotate.ts): the 3D art turns its shape to match
}

/** Choose and place a room's dressing from its name. */
export function planDressing({ room: r, reserved, wallSides, ids = "dm" }: DressingInput): DecorItem[] {
  if (r.draft) return [];
  const isVoidGame = byGame({ dungeon: false, void: true });
  const entranceTheme: Theme = isVoidGame ? { re: /./, wall: ["vpanel", "vlocker"], wallP: 0.3, scatter: ["vcrate"], scatterP: 0.08 } : { re: /./, wall: ["torch"], wallP: 0.35 };
  const themes = r.kind === "entrance" ? [entranceTheme] : roomThemes(r.label);
  const seed = r.id * 7919 + r.x * 31 + r.y;
  const used = new Set(reserved);
  const k = (x: number, y: number) => `${x},${y}`;
  const out: DecorItem[] = [];
  const mid = (v: number) => (v + 0.5) * C;
  const rx = r.x * C, ry = r.y * C, rw = r.w * C, rh = r.h * C;
  const rcx = rx + rw / 2, rcy = ry + rh / 2;
  const overlayItem = (name: string, svg: Raw) => out.push({ kind: "overlay", name, x: rcx, y: rcy, rot: 0, seed, svg, abs: true });

  // floor overlays
  const overlay = themes.find((t) => t.overlay)?.overlay;
  if (overlay === "flood") overlayItem("flood", html`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="#4f8fc8" opacity=".28"/>`);
  if (overlay === "ice") overlayItem("ice", html`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="#bfe3ff" opacity=".3"/>`);
  if (overlay === "lava") overlayItem("lava", html`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="#e0662a" opacity=".1"/>`);
  if (overlay === "blood") overlayItem("blood", html`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="#8f1f22" opacity=".08"/>`);
  if (overlay === "mosaic" && r.w >= 3 && r.h >= 3) {
    let d = "";
    for (let x = r.x + 1; x < r.x + r.w - 1; x++) for (let y = r.y + 1; y < r.y + r.h - 1; y++) d += `M${(x + 0.5) * C} ${y * C + 3}L${(x + 1) * C - 3} ${(y + 0.5) * C}L${(x + 0.5) * C} ${(y + 1) * C - 3}L${x * C + 3} ${(y + 0.5) * C}Z`;
    overlayItem("mosaic", html`<path d="${d}" fill="${pick(["#c06a3a", "#4a7aa0", "#7a9a4a"], rnd(seed, 5))}" opacity=".22"/>`);
  }
  if (overlay === "rug" && r.w >= 3 && r.h >= 3)
    overlayItem("rug", html`<rect x="${(r.x + r.w / 2) * C - 9}" y="${ry + 6}" width="18" height="${rh - 12}" fill="#8a2a2a" stroke="${GOLD}" stroke-width="1" opacity=".75"/>`);

  // pillars in two rows for halls
  if (themes.some((t) => t.pillars) && r.w >= 4 && r.h >= 4) {
    for (let x = r.x + 1; x < r.x + r.w - 1; x += 2)
      for (const y of [r.y + 1, r.y + r.h - 2]) if (inRoom(r, x, y) && !used.has(k(x, y))) {
        out.push({ kind: "pillar", name: "pillar", x: mid(x), y: mid(y), rot: 0, seed, svg: S.pillar(seed) });
        used.add(k(x, y));
      }
  }

  // centre piece
  const centred = r.w * r.h >= 2
    ? themes.flatMap((t) => t.centre ?? []).map((name) => ({ name, c: CENTRE[name](r.w, r.h, seed) })).find((x) => x.c)
    : undefined;
  if (centred) {
    const { name: centreName, c } = centred;
    if (c) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const x0 = Math.round(cx - c.cw / 2), y0 = Math.round(cy - c.ch / 2);
      // a centre piece must sit wholly on the room's squares (a shaped room may not have room for it)
      let fits = true;
      for (let i = 0; i < Math.max(1, c.cw); i++) for (let j = 0; j < Math.max(1, c.ch); j++) if (!inRoom(r, x0 + i, y0 + j)) fits = false;
      if (fits) {
        out.push({ kind: "centre", name: centreName, x: f1(cx * C), y: f1(cy * C), rot: 0, seed, svg: c.svg, flat: c.flat, cw: c.cw, ch: c.ch });
        for (let x = x0; x < x0 + Math.max(1, c.cw); x++) for (let y = y0; y < y0 + Math.max(1, c.ch); y++) used.add(k(x, y));
      }
    }
  }

  // wall furniture
  const wallItems = themes.flatMap((t) => t.wall ?? []);
  const wallP = Math.max(0, ...themes.map((t) => t.wallP ?? 0));
  if (wallItems.length) {
    let i = 0;
    for (let x = r.x; x < r.x + r.w; x++)
      for (let y = r.y; y < r.y + r.h; y++) {
        i++;
        if (!inRoom(r, x, y) || used.has(k(x, y))) continue;
        const sides = wallSides(x, y);
        if (!sides.length || rnd(seed, i, 1) > wallP) continue;
        const side = pick(sides, rnd(seed, i, 2));
        const item = pick(wallItems, rnd(seed, i, 3));
        if (item === "bed" && (r.w < 2 || r.h < 2)) continue;
        out.push({ kind: "wall", name: item, x: mid(x), y: mid(y), rot: ROT[side], side, seed: seed + i, svg: W[item](seed + i) });
        used.add(k(x, y));
      }
  }

  // scatter
  const scatter = themes.flatMap((t) => t.scatter ?? []);
  const scatterP = Math.max(0, ...themes.map((t) => t.scatterP ?? 0));
  const free: [number, number][] = [];
  for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) if (inRoom(r, x, y) && !used.has(k(x, y))) free.push([x, y]);
  if (scatter.length) {
    free.forEach(([x, y], i) => {
      if (rnd(seed, i, 7) > scatterP) return;
      const item = pick(scatter, rnd(seed, i, 8));
      if (item === "web") return;
      const jx = (rnd(seed, i, 9) - 0.5) * 8, jy = (rnd(seed, i, 10) - 0.5) * 8;
      out.push({ kind: "scatter", name: item, x: f1(mid(x) + jx), y: f1(mid(y) + jy), rot: f1(rnd(seed, i, 11) * 40 - 20), seed: seed + i * 13, svg: S[item](seed + i * 13) });
      used.add(k(x, y));
    });
  }

  // a little grime everywhere: cobwebs in corners, the odd bit of rubble or bone
  const corners: [number, number, number, "N" | "E" | "S" | "W"][] = [[r.x, r.y, 0, "N"], [r.x + r.w - 1, r.y, 90, "E"], [r.x + r.w - 1, r.y + r.h - 1, 180, "S"], [r.x, r.y + r.h - 1, 270, "W"]];
  const webby = isVoidGame ? 0 : scatter.includes("web") ? 0.8 : 0.3; // no cobwebs in the Hulk
  corners.forEach(([x, y, rot, side], i) => {
    if (r.w < 2 || r.h < 2 || !inRoom(r, x, y) || reserved.has(k(x, y))) return;
    if (rnd(seed, i, 20) < webby) out.push({ kind: "web", name: "web", x: mid(x), y: mid(y), rot, side, seed, svg: S.web(0) });
  });
  const grime = isVoidGame ? ["vdebris", "crack", "vcables", "vscrap"] : ["rubble", "crack", "bones", "rubble"];
  free.forEach(([x, y], i) => {
    if (used.has(k(x, y)) || rnd(seed, i, 30) > 0.06) return;
    const name = pick(grime, rnd(seed, i, 31));
    out.push({ kind: "grime", name, x: mid(x), y: mid(y), rot: 0, seed: seed + i, svg: html`<g transform="scale(.75)" opacity=".85">${S[name](seed + i)}</g>` });
  });

  // misty rooms get a drifting haze on top
  if (overlay === "mist") {
    const col = /GAS|MIASMA|METHANE|GREEN/.test(r.label.toUpperCase()) ? "#9ad07a" : "#d8dde6";
    let svg = html``;
    for (let i = 0; i < Math.max(2, Math.round((r.w * r.h) / 4)); i++)
      svg = html`${svg}<ellipse cx="${f1(rx + rnd(seed, i, 40) * rw)}" cy="${f1(ry + rnd(seed, i, 41) * rh)}" rx="${f1(14 + rnd(seed, i, 42) * 16)}" ry="${f1(8 + rnd(seed, i, 43) * 8)}" fill="${col}" opacity=".55" filter="url(#${ids}-mist)"/>`;
    out.push({ kind: "mist", name: "mist", x: rcx, y: rcy, rot: 0, seed, svg, abs: true });
  }
  return out;
}

/** Draw one placed item top-down (in map pixels). */
export const itemSvg = (it: DecorItem) =>
  it.abs ? it.svg : html`<g transform="translate(${f1(it.x)} ${f1(it.y)})${it.rot ? ` rotate(${it.rot})` : ""}">${it.svg}</g>`;

/** The SVG for one room's dressing, top-down (drawn over the floor, under the walls). */
export function roomDressing(input: DressingInput): Raw {
  const items = planDressing(input);
  const ids = input.ids ?? "dm";
  return items.length ? html`<g class="dmap-decor" pointer-events="none" clip-path="url(#${ids}-clip-${input.room.id})">${items.map(itemSvg)}</g>` : html``;
}
