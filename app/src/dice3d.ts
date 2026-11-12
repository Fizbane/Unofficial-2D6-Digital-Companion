// 3D physics dice thrown across the screen (dice-box: BabylonJS + Ammo physics).
// The physical dice decide the result. Falls back to instant random rolls if WebGL
// is unavailable or 3D dice are switched off in Settings.
import { byGame, gk } from "./games";
import DiceBox from "@3d-dice/dice-box";
import { d6, rollValues, type RollResult } from "./dice";
import { cssColor } from "./ui/html";
import { bus } from "./shell/events";
import { playSfx } from "./audio/sound";

export interface Look {
  id: string;
  name: string;
  theme: string; // dice-box theme folder
  pips: boolean; // pip die mesh instead of numbers
  tint: boolean; // body colour comes from the user's colour
  color?: string; // default colour for tintable looks
  group: string;
}
const DUNGEON_LOOKS: Look[] = [
  { id: "classic", name: "Classic", theme: "default", pips: false, tint: true, color: "#b8432a", group: "Classic" },
  { id: "pips", name: "Classic pips", theme: "smooth-pip", pips: true, tint: true, color: "#f4f1e8", group: "Classic" },
  { id: "smooth", name: "Smooth", theme: "smooth", pips: false, tint: true, color: "#3d6bb3", group: "Classic" },
  { id: "glass", name: "Glass / crystal", theme: "gemstone", pips: false, tint: true, color: "#7fd3ff", group: "Fancy" },
  { id: "marble", name: "Rainbow marble", theme: "gemstoneMarble", pips: false, tint: false, group: "Fancy" },
  { id: "galaxy", name: "Galaxy", theme: "galaxy", pips: true, tint: false, group: "Fancy" },
  { id: "lava", name: "Lava", theme: "lava", pips: true, tint: false, group: "Fancy" },
  { id: "gold", name: "Gold", theme: "gold", pips: true, tint: false, group: "Metal" },
  { id: "silver", name: "Silver", theme: "silver", pips: true, tint: false, group: "Metal" },
  { id: "copper", name: "Copper", theme: "copper", pips: true, tint: false, group: "Metal" },
  { id: "weathered", name: "Weathered metal", theme: "blueGreenMetal", pips: false, tint: false, group: "Metal" },
  { id: "rust", name: "Rust", theme: "rust", pips: false, tint: true, color: "#aa4f4a", group: "Metal" },
  { id: "stone", name: "Stone", theme: "rock", pips: false, tint: true, color: "#b7aca1", group: "Natural" },
  { id: "wood", name: "Wood", theme: "wooden", pips: false, tint: false, group: "Natural" },
  { id: "rolling", name: "Dice of Rolling", theme: "diceOfRolling", pips: false, tint: false, group: "Natural" },
  { id: "starOrb", name: "Star orb", theme: "starOrb", pips: true, tint: true, color: "#f7a21b", group: "Fun" },
  { id: "pirate", name: "Pirate skulls", theme: "pirate", pips: true, tint: true, color: "#202020", group: "Fun" },
];
/**
 * 2D6 Void's dice: sci-fi, cyberpunk, steampunk and space-opera skins (pipeline/make_dice_themes.py),
 * plus a few plain looks.
 */
const VOID_LOOKS: Look[] = [
  { id: "hologram", name: "Hologram", theme: "hologram", pips: true, tint: false, group: "Sci-fi" },
  { id: "plasma", name: "Plasma core", theme: "plasma", pips: true, tint: false, group: "Sci-fi" },
  { id: "hyperspace", name: "Hyperspace", theme: "hyperspace", pips: true, tint: false, group: "Sci-fi" },
  { id: "neon", name: "Neon grid", theme: "neon", pips: true, tint: false, group: "Cyberpunk" },
  { id: "circuit", name: "Circuit board", theme: "circuit", pips: true, tint: false, group: "Cyberpunk" },
  { id: "glitch", name: "Glitch chrome", theme: "glitch", pips: true, tint: false, group: "Cyberpunk" },
  { id: "clockwork", name: "Clockwork brass", theme: "clockwork", pips: true, tint: false, group: "Steampunk" },
  { id: "aether", name: "Aether copper", theme: "aether", pips: true, tint: false, group: "Steampunk" },
  { id: "saberBlue", name: "Light blade (blue)", theme: "saberBlue", pips: true, tint: false, group: "Space opera" },
  { id: "saberRed", name: "Light blade (red)", theme: "saberRed", pips: true, tint: false, group: "Space opera" },
  ...DUNGEON_LOOKS.filter((l) => ["classic", "pips", "glass", "galaxy", "silver"].includes(l.id)).map((l) => ({ ...l, group: "Plain" })),
];
/** The current game's dice looks (Settings lists these). */
export const LOOKS: Look[] = byGame({ dungeon: DUNGEON_LOOKS, void: VOID_LOOKS });

export const lookById = (id: string) => LOOKS.find((l) => l.id === id) ?? LOOKS[0];

export interface DieStyle { look: string; color: string; name: string }
export interface DiceSettings {
  enabled: boolean;
  size: number;
  dice: [DieStyle, DieStyle];
  tens: 0 | 1; // which die gives the D66 tens digit (and is the Primary die)
}
export const DEFAULT_SETTINGS: DiceSettings = {
  enabled: true,
  size: 4.5,
  dice: byGame<[DieStyle, DieStyle]>({
    dungeon: [
      { look: "classic", color: "#b8432a", name: "Red" },
      { look: "classic", color: "#e9dfc7", name: "Ivory" },
    ],
    void: [
      { look: "hologram", color: "", name: "Hologram" },
      { look: "plasma", color: "", name: "Plasma core" },
    ],
  }),
  tens: 0,
};
/** One quick look per Void dice set (both dice the same skin), then the mixed pairs. */
const VOID_PRESETS: { name: string; dice: [DieStyle, DieStyle] }[] = [
  ...(["hologram", "plasma", "hyperspace", "neon", "circuit", "glitch", "clockwork", "aether", "saberBlue", "saberRed"] as const).map((id) => {
    const name = VOID_LOOKS.find((l) => l.id === id)!.name;
    return { name, dice: [{ look: id, color: "", name }, { look: id, color: "", name }] as [DieStyle, DieStyle] };
  }),
  { name: "Hologram & plasma (default)", dice: DEFAULT_SETTINGS.dice },
  { name: "Light blade duel", dice: [{ look: "saberBlue", color: "", name: "Blue blade" }, { look: "saberRed", color: "", name: "Red blade" }] },
  { name: "Netrunner", dice: [{ look: "neon", color: "", name: "Neon grid" }, { look: "glitch", color: "", name: "Glitch chrome" }] },
  { name: "Steam & gears", dice: [{ look: "clockwork", color: "", name: "Clockwork brass" }, { look: "aether", color: "", name: "Aether copper" }] },
];
const DUNGEON_PRESETS: { name: string; dice: [DieStyle, DieStyle] }[] = [
  { name: "Red & ivory (default)", dice: DEFAULT_SETTINGS.dice },
  { name: "Star orbs", dice: [{ look: "starOrb", color: "#f7a21b", name: "Orange orb" }, { look: "starOrb", color: "#ffcf3f", name: "Gold orb" }] },
  { name: "Straw-hat pirates", dice: [{ look: "pirate", color: "#c1121f", name: "Red skull" }, { look: "pirate", color: "#e9c46a", name: "Straw skull" }] },
  { name: "Jolly Roger", dice: [{ look: "pirate", color: "#151515", name: "Black flag" }, { look: "pirate", color: "#f2f2f2", name: "White flag" }] },
  { name: "Treasure", dice: [{ look: "gold", color: "", name: "Gold" }, { look: "silver", color: "", name: "Silver" }] },
  { name: "Ice & fire glass", dice: [{ look: "glass", color: "#ff5a3c", name: "Fire glass" }, { look: "glass", color: "#7fd3ff", name: "Ice glass" }] },
  { name: "Molten & cosmic", dice: [{ look: "lava", color: "", name: "Lava" }, { look: "galaxy", color: "", name: "Galaxy" }] },
  { name: "Old forge", dice: [{ look: "copper", color: "", name: "Copper" }, { look: "weathered", color: "", name: "Weathered" }] },
  { name: "Woodland", dice: [{ look: "wood", color: "", name: "Wood" }, { look: "stone", color: "#8f9779", name: "Moss stone" }] },
];
/** The current game's one-tap dice pairs. */
export const PRESETS = byGame({ dungeon: DUNGEON_PRESETS, void: VOID_PRESETS });

const KEY = gk("2d6:dice-settings");
export function getSettings(): DiceSettings {
  try {
    const raw = localStorage.getItem(KEY);
    const base: DiceSettings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    // a stored value can come from an imported backup: keep only well-formed dice and hex colours
    const die = (d: unknown, i: number): DieStyle => {
      if (!d || typeof d !== "object") return { ...DEFAULT_SETTINGS.dice[i] };
      const x = d as Partial<Record<keyof DieStyle, unknown>>;
      return { look: typeof x.look === "string" ? x.look : DEFAULT_SETTINGS.dice[i].look, color: cssColor(x.color, ""), name: typeof x.name === "string" ? x.name : "" };
    };
    base.dice = Array.isArray(base.dice) && base.dice.length === 2 ? [die(base.dice[0], 0), die(base.dice[1], 1)] : [{ ...DEFAULT_SETTINGS.dice[0] }, { ...DEFAULT_SETTINGS.dice[1] }];
    if (base.tens !== 0 && base.tens !== 1) base.tens = DEFAULT_SETTINGS.tens;
    if (typeof base.size !== "number" || !Number.isFinite(base.size)) base.size = DEFAULT_SETTINGS.size;
    // migrate the old on/off flag
    if (!raw && localStorage.getItem(gk("2d6:dice3d")) === "false") base.enabled = false;
    return base;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function saveSettings(s: DiceSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  if (!s.enabled) box?.clear();
  box?.updateConfig?.({ scale: s.size });
}
export const is3D = () => getSettings().enabled;
export function set3D(on: boolean) {
  saveSettings({ ...getSettings(), enabled: on });
}

/** Display name for die i (0/1), e.g. "Red". */
export const dieName = (s: DiceSettings, i: number) => s.dice[i].name || lookById(s.dice[i].look).name;
/** CSS colour to show for a die (swatches in the UI). */
export function swatch(d: DieStyle) {
  const look = lookById(d.look);
  if (look.tint) return cssColor(d.color, "") || look.color || "#888";
  const fixed: Record<string, string> = { gold: "#d8b04a", silver: "#c9ced6", copper: "#c4734a", lava: "#ff6a00", galaxy: "#3b2a8a", marble: "#c86fd0", weathered: "#5f8f86", wood: "#9b6a3c", rolling: "#e7e2d6",
    hologram: "#28dcff", plasma: "#d23cff", hyperspace: "#3a5bd8", neon: "#ff28c8", circuit: "#1f8a4c", glitch: "#c4cad4",
    clockwork: "#d6a848", aether: "#3fa58e", saberBlue: "#2a8cff", saberRed: "#ff2a2a" };
  return fixed[look.id] ?? "#888";
}

let box: any = null;
let ready: Promise<boolean> | null = null;
let busy = false;
let clearTimer = 0;

function init(): Promise<boolean> {
  if (ready) return ready;
  ready = (async () => {
    try {
      const dir = location.pathname.replace(/[^/]*$/, ""); // works under any base path
      box = new DiceBox({
        container: "#dice-layer",
        assetPath: `${dir}assets/dice-box/`,
        origin: location.origin,
        theme: "default",
        themeColor: DEFAULT_SETTINGS.dice[0].color,
        scale: getSettings().size,
        gravity: 1.6,
        settleTimeout: 4000,
        throwForce: 6,
        spinForce: 5,
        startingHeight: 9,
        lightIntensity: 1.1,
        enableShadows: true,
        shadowTransparency: 0.7,
      });
      await box.init();
      return true;
    } catch (e) {
      console.warn("3D dice unavailable, using instant rolls", e);
      box = null;
      return false;
    }
  })();
  return ready;
}

/** Warm up the physics engine in the background so the first roll is quick. */
export function preload() {
  if (is3D()) setTimeout(() => init(), 1500);
}

type Group = { qty: number; sides: number | string; theme: string; themeColor: string };
function groupFor(style: DieStyle): Group {
  const look = lookById(style.look);
  return { qty: 1, sides: look.pips ? "pip" : 6, theme: look.theme, themeColor: (look.tint ? style.color || look.color : look.color) || "#888888" };
}

function plan(kind: string): { styles: DieStyle[]; finish: (vals: number[]) => RollResult } {
  const s = getSettings();
  const first = s.dice[s.tens]; // the tens/Primary die always rolls first
  const second = s.dice[1 - s.tens];
  const n1 = dieName(s, s.tens), n2 = dieName(s, 1 - s.tens);
  const k = kind.toUpperCase().replace(/\s/g, "");
  if (k === "D66")
    return {
      styles: [first, second],
      finish: ([a, b]) => ({ label: "D66", dice: [a, b], value: a * 10 + b, text: `${a}${b}  (${n1} ${a} tens, ${n2} ${b} units)` }),
    };
  if (k === "D3")
    return {
      styles: [first],
      finish: ([a]) => {
        const v = Math.ceil(a / 2);
        return { label: "D3", dice: [a], value: v, text: `${v}  (d6 showed ${a})` };
      },
    };
  const m = k.match(/^(\d*)D(\d+)$/);
  const n = m ? parseInt(m[1] || "1", 10) : 1;
  const styles = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? first : second));
  return {
    styles,
    finish: (vals) => {
      const total = vals.reduce((t, x) => t + x, 0);
      const text = n === 2 ? `${n1} ${vals[0]} + ${n2} ${vals[1]} = ${total}` : n > 1 ? `${vals.join(" + ")} = ${total}` : `${total}`;
      return { label: `${n}D6`, dice: vals, value: total, text };
    },
  };
}

function instant(kind: string): RollResult {
  const { styles, finish } = plan(kind);
  return finish(styles.map(() => d6()));
}

/** An instant roll still sounds like a throw. */
function thrownInstantly(kind: string): RollResult {
  playSfx("dice-throw");
  return instant(kind);
}

/** Roll dice: physically in 3D when available, otherwise instantly. Every result is announced on the bus. */
export async function rollDice(kind: string): Promise<RollResult> {
  const r = await rollDiceRaw(kind);
  bus.emit("dice:rolled", { kind, dice: [...r.dice] });
  return r;
}

async function rollDiceRaw(kind: string): Promise<RollResult> {
  if (!is3D() || busy) return thrownInstantly(kind);
  const ok = await init();
  if (!ok || !box) return thrownInstantly(kind);
  const { styles, finish } = plan(kind);
  busy = true;
  clearTimeout(clearTimer);
  document.body.classList.add("dice-rolling");
  try {
    box.show();
    playSfx("dice-throw");
    const results: unknown = await box.roll(styles.map(groupFor));
    playSfx("dice-land");
    // in throw order (groupId): the first group is the tens/Primary die
    const vals = rollValues(results);
    if (vals.length !== styles.length || vals.some((v) => !(v >= 1 && v <= 6))) {
      console.warn("Unexpected 3D result, using instant roll", results);
      return instant(kind);
    }
    return finish(vals);
  } catch (e) {
    console.warn("3D roll failed, using instant roll", e);
    return instant(kind);
  } finally {
    busy = false;
    document.body.classList.remove("dice-rolling");
    clearTimer = window.setTimeout(() => box?.clear(), 4500);
  }
}

/** Clear dice off the screen immediately (e.g. on tap). */
export function clearDice() {
  clearTimeout(clearTimer);
  if (!busy) box?.clear();
}
