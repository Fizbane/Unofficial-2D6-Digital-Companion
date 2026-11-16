// Tile sets for the dungeon map: each one has its own colours and its own way of drawing the
// rock around the rooms, the floors and the walls. Separate from the site's colour themes.
import { byGame, gk } from "../games";
import type { RoomKind } from "./dmap";

export interface TileSet {
  id: string;
  name: string;
  blurb: string;
  paper: string; // background
  dots: string | null; // dot grid colour (null = none)
  vignette: string;
  edge: string; // dashed Outer Boundary line
  ink: string; // outlines and the wall core line
  surround: "hatch" | "cave" | "hull" | "none"; // how the rock around rooms is drawn (hull = riveted plating)
  surroundInk: string;
  surroundOp: number;
  rockFill: string[]; // cave rock lumps
  floorStyle: "flags" | "slabs" | "cutstone" | "inlaid" | "earth" | "plates" | "grate" | "blueprint";
  floor: Record<RoomKind, string>;
  flag: string; // flagstone / slab shading colour
  grid: string; // grid or mortar lines
  gridOp: number;
  walls: "stones" | "bricks" | "rock" | "plating" | "pipes" | "organic" | "blueprint";
  wallFill: string[];
  wallShadow: string;
  light?: string; // reflected light on the floor around fixtures
  steps: string; // footprints
  unexplored: string;
  labelBg: string;
  labelInk: string;
  sub: string;
  draft: string;
  iso: { wall: string; wallLine: string; sideS: string; sideE: string; void: string }; // isometric view
  /** Cut 45° corners off rooms and corridors (2D6 Void's Dark Hulk rule). */
  chamfer?: boolean;
}

const DUNGEON_TILESETS: TileSet[] = [
  {
    id: "paper", name: "Paper", blurb: "Hand-drawn on parchment: stone-block walls, cross-hatched rock, dot grid",
    paper: "#f1e6cc", dots: "#a8956f", vignette: "#5a3d1e", edge: "#9c8862", ink: "#2a211b",
    surround: "hatch", surroundInk: "#4e3b2c", surroundOp: 0.7, rockFill: [],
    floorStyle: "flags", floor: { entrance: "#f2d697", regular: "#ebe1c9", small: "#d2e4d4", large: "#efd2a7", corridor: "#e0d5bd" },
    flag: "#6b4f2e", grid: "#7a6446", gridOp: 0.35,
    walls: "stones", wallFill: ["#cfc5b1", "#bfb39c", "#d9cfbb", "#b5aa95"], wallShadow: "#3a2a1c",
    steps: "#6b4a2f", unexplored: "#e0a33a", labelBg: "#fffaf0", labelInk: "#2a211b", sub: "#6e5a43", draft: "#8a7350",
    iso: { wall: "#f7f2e6", wallLine: "#c7b89a", sideS: "#b8aa8e", sideE: "#9c8f75", void: "#1e1a16" },
  },
  {
    id: "dungeon", name: "Dungeon", blurb: "Dingy grey stonework: brick walls, worn flagstones, grime and damp",
    paper: "#2a2b2e", dots: null, vignette: "#000000", edge: "#55585e", ink: "#141517",
    surround: "hatch", surroundInk: "#6a6e75", surroundOp: 0.5, rockFill: [],
    floorStyle: "slabs", floor: { entrance: "#9e9a8c", regular: "#8b8d8e", small: "#848a84", large: "#929089", corridor: "#7c7e80" },
    flag: "#000000", grid: "#3b3d41", gridOp: 0.7,
    walls: "bricks", wallFill: ["#5d6065", "#53565b", "#676a70", "#4b4e53"], wallShadow: "#000000",
    steps: "#2b2c2f", unexplored: "#e0a33a", labelBg: "#e6e4de", labelInk: "#17181a", sub: "#4a4c50", draft: "#c9c4b4",
    iso: { wall: "#8a8d92", wallLine: "#4f5257", sideS: "#5a5d62", sideE: "#46494e", void: "#111214" },
  },
  {
    id: "torchlit", name: "Torchlit Halls", blurb: "Dark flagstones, warm masonry and amber torchlight",
    paper: "#0c0b10", dots: null, vignette: "#050409", edge: "#3b3339", ink: "#100d11",
    surround: "none", surroundInk: "#000000", surroundOp: 0, rockFill: [],
    floorStyle: "cutstone", floor: { entrance: "#594b40", regular: "#4b4343", small: "#463d40", large: "#544745", corridor: "#3a3438" },
    flag: "#e2bb93", grid: "#19141b", gridOp: 0.93,
    walls: "bricks", wallFill: ["#68584e", "#5b4c46", "#756357", "#504342"], wallShadow: "#070508", light: "#ffae50",
    steps: "#b99a7b", unexplored: "#f7b858", labelBg: "#251d23", labelInk: "#fff0dc", sub: "#ccac96", draft: "#ae8b73",
    iso: { wall: "#6e5e54", wallLine: "#35272a", sideS: "#393036", sideE: "#28232b", void: "#09080d" },
  },
  {
    id: "moonstone", name: "Moonstone Crypt", blurb: "Blue slate, silver inlays and cool light around relics",
    paper: "#090d17", dots: null, vignette: "#03050b", edge: "#323b53", ink: "#111726",
    surround: "none", surroundInk: "#000000", surroundOp: 0, rockFill: [],
    floorStyle: "inlaid", floor: { entrance: "#526279", regular: "#424c62", small: "#39495a", large: "#505978", corridor: "#313b50" },
    flag: "#a8c3e6", grid: "#151e31", gridOp: 0.95,
    walls: "bricks", wallFill: ["#505f78", "#444f68", "#606b83", "#3b455d"], wallShadow: "#030611", light: "#87c8f4",
    steps: "#a4b6d0", unexplored: "#9ed9ff", labelBg: "#172132", labelInk: "#eef5ff", sub: "#b2c3dd", draft: "#91a7cc",
    iso: { wall: "#65748e", wallLine: "#313b53", sideS: "#333e55", sideE: "#232c40", void: "#080c16" },
  },
  {
    id: "caves", name: "Caves", blurb: "Natural caverns: rough rock walls, earthen floors, pebbles and stalagmites",
    paper: "#1d1712", dots: null, vignette: "#000000", edge: "#4a3c2f", ink: "#120d09",
    surround: "cave", surroundInk: "#120d09", surroundOp: 1, rockFill: ["#3b3028", "#33291f", "#43372c", "#2c231b"],
    floorStyle: "earth", floor: { entrance: "#c4a272", regular: "#a68863", small: "#998a64", large: "#ae8e66", corridor: "#977b5a" },
    flag: "#3a2a1a", grid: "#000000", gridOp: 0,
    walls: "rock", wallFill: ["#5b4a3b", "#504032", "#665443", "#47392c"], wallShadow: "#1a120b",
    steps: "#4a3420", unexplored: "#f2b33d", labelBg: "#f3e6cf", labelInk: "#22170e", sub: "#5e4a33", draft: "#e8d2a8",
    iso: { wall: "#6a5847", wallLine: "#3d3127", sideS: "#4a3c2f", sideE: "#3a2f24", void: "#0d0a07" },
  },
];

/** 2D6 Void's map styles: the Dark Hulk's decks, drawn four ways. */
const VOID_TILESETS: TileSet[] = [
  {
    chamfer: true, id: "hull", name: "Hull Plating", blurb: "Riveted steel decks, plated walls, the hull pressing in around the rooms",
    paper: "#15181c", dots: null, vignette: "#000000", edge: "#3a4048", ink: "#0b0d10",
    surround: "hull", surroundInk: "#2c3239", surroundOp: 1, rockFill: [],
    floorStyle: "plates", floor: { entrance: "#8a9aa6", regular: "#6f7a83", small: "#6a7a76", large: "#77808a", corridor: "#626b73" },
    flag: "#000000", grid: "#2a3036", gridOp: 0.8,
    walls: "plating", wallFill: ["#4a535c", "#434b53", "#525b65", "#3d444b"], wallShadow: "#000000",
    steps: "#1c2126", unexplored: "#ff9a3d", labelBg: "#dfe6ec", labelInk: "#0f1418", sub: "#3c4650", draft: "#b8c4ce",
    iso: { wall: "#7d8892", wallLine: "#3c444c", sideS: "#4c555e", sideE: "#3b434b", void: "#07090b" },
  },
  {
    chamfer: true, id: "grate", name: "Grated Deck", blurb: "Mesh floors over the dark, pipe-lined walls, amber work lights",
    paper: "#1a1712", dots: null, vignette: "#000000", edge: "#4a4033", ink: "#0f0c08",
    surround: "hull", surroundInk: "#2b261e", surroundOp: 0.9, rockFill: [],
    floorStyle: "grate", floor: { entrance: "#8c7b55", regular: "#6a6152", small: "#606553", large: "#71654f", corridor: "#5c5547" },
    flag: "#000000", grid: "#231f18", gridOp: 0.9,
    walls: "pipes", wallFill: ["#8a6a3c", "#6f7378", "#9a7a46", "#5d6166"], wallShadow: "#000000",
    steps: "#2a241b", unexplored: "#ffb627", labelBg: "#f1e7d2", labelInk: "#1a150d", sub: "#4f4535", draft: "#d2c09a",
    iso: { wall: "#7a6f5c", wallLine: "#3e372b", sideS: "#4e4639", sideE: "#3e382d", void: "#0a0806" },
  },
  {
    chamfer: true, id: "infested", name: "Infested", blurb: "Alien growth over the metal: fleshy walls, slime, glowing spores",
    paper: "#0e1210", dots: null, vignette: "#000000", edge: "#2c3a30", ink: "#070a08",
    surround: "cave", surroundInk: "#070a08", surroundOp: 1, rockFill: ["#2a3b2e", "#3a2a33", "#24332a", "#33262e"],
    floorStyle: "plates", floor: { entrance: "#7d8a6a", regular: "#5c6b5a", small: "#566856", large: "#62705c", corridor: "#536150" },
    flag: "#000000", grid: "#1e2a20", gridOp: 0.7,
    walls: "organic", wallFill: ["#5a3a4a", "#4a5a3c", "#6a4256", "#3e4e34"], wallShadow: "#000000",
    steps: "#1a2219", unexplored: "#7dff6b", labelBg: "#e4eedf", labelInk: "#0d140d", sub: "#3c4a3a", draft: "#b9d0a8",
    iso: { wall: "#5d6a52", wallLine: "#2c3527", sideS: "#3e4a36", sideE: "#31392b", void: "#050705" },
  },
  {
    chamfer: true, id: "blueprint", name: "Blueprint", blurb: "A schematic on blueprint paper: white linework, fine grid",
    paper: "#123a6b", dots: null, vignette: "#04152e", edge: "#9cc3ee", ink: "#e9f3ff",
    surround: "none", surroundInk: "#9cc3ee", surroundOp: 0, rockFill: [],
    floorStyle: "blueprint", floor: { entrance: "#1f5c9c", regular: "#174a82", small: "#1a5288", large: "#1b4f8c", corridor: "#15437a" },
    flag: "#ffffff", grid: "#9cc3ee", gridOp: 0.35,
    walls: "blueprint", wallFill: ["#e9f3ff"], wallShadow: "#04152e",
    steps: "#cfe4ff", unexplored: "#ffd166", labelBg: "#e9f3ff", labelInk: "#0d2c52", sub: "#2f5a8a", draft: "#9cc3ee",
    iso: { wall: "#2a6aae", wallLine: "#e9f3ff", sideS: "#1d528c", sideE: "#164576", void: "#0a2648" },
  },
];

/** Every map style of both games. */
export const ALL_TILESETS: TileSet[] = [...DUNGEON_TILESETS, ...VOID_TILESETS];

/** The current game's map styles. */
export const TILESETS: TileSet[] = byGame({ dungeon: DUNGEON_TILESETS, void: VOID_TILESETS });

const KEY = gk("2d6:maptiles");
export const tileSetById = (id: string | null | undefined) => TILESETS.find((t) => t.id === id) ?? TILESETS[0];
export function getTileSetId(): string {
  try {
    return tileSetById(JSON.parse(localStorage.getItem(KEY) || '"paper"')).id;
  } catch {
    return "paper";
  }
}
export type MapView = "top" | "iso";
const VIEW_KEY = gk("2d6:mapview");
export function getMapView(): MapView {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || '"top"') === "iso" ? "iso" : "top";
  } catch {
    return "top";
  }
}
export function setMapView(v: MapView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
/** Which way the isometric camera looks: 0..3 quarter turns clockwise (dmaprotate.ts), saved beside the view. */
export const MAP_TURN_KEY = gk("2d6:mapturn");
export function getMapTurn(): number {
  try {
    const q = JSON.parse(localStorage.getItem(MAP_TURN_KEY) || "0");
    return Number.isInteger(q) ? ((q % 4) + 4) % 4 : 0;
  } catch {
    return 0;
  }
}
export function setMapTurn(q: number) {
  try {
    localStorage.setItem(MAP_TURN_KEY, JSON.stringify(((Math.round(q) % 4) + 4) % 4));
  } catch {
    /* ignore */
  }
}
export function setTileSetId(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* ignore */
  }
}
