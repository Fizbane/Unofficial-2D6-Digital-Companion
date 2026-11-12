// DOM-free helpers for the character bar and its character card.

/**
 * HP after a ± tap: never below 0, and not capped at the baseline. The Core Rules' baseline is
 * not a cap: level-ups, Gain Health potions, Surging Strength and magic items can exceed it
 * (only a Potion of Healing stops at the baseline; the sheet's heal buttons handle that).
 */
export function stepHp(hp: number, delta: number): number {
  return Math.max(0, hp + delta);
}

/** The Fatigue die while a fight is on (your turn or theirs), else "—". */
export function fatigueText(combat: { phase?: string; fatigue?: number } | null | undefined): string {
  if (!combat || (combat.phase !== "you" && combat.phase !== "foes")) return "—";
  return String(combat.fatigue ?? 1);
}

/** XP bar fill, 0–100, towards the next level (full at the top level). */
export function xpPct(xp: number, nextXp: number): number {
  if (!Number.isFinite(nextXp) || nextXp <= 0) return 100;
  return Math.max(0, Math.min(100, (xp / nextXp) * 100));
}

export const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** Typed or stepped XP: a whole number, never below 0. */
export const clampXp = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/**
 * Set XP (sheet and character bar). Core Rules, Health Points: each level gained adds 10 HP at
 * once, even above the baseline. XP never goes down in play, so a drop below `lastLevel` is a
 * correction and takes those 10 HP per level back (never below 0); an XP round trip across a
 * threshold leaves HP where it was. `lastLevel` always follows the level. Mutates `c`.
 */
export function applyXp(c: { xp: number; hp: number; lastLevel: number }, xp: number, levelOf: (xp: number) => number): { from: number; to: number } {
  const from = c.lastLevel;
  c.xp = clampXp(xp);
  const to = levelOf(c.xp);
  if (to > from) c.hp += 10 * (to - from);
  else if (to < from) c.hp = Math.max(0, c.hp - 10 * (from - to));
  c.lastLevel = to;
  return { from, to };
}

/** The toast for a level change (the sheet's level-up wording), or null when the level held. */
export function levelChangeText(ch: { from: number; to: number }, title: string): string | null {
  if (ch.to > ch.from) return `Level up! ${title} (level ${ch.to}). +10 HP. You may gain or swap a manoeuvre.`;
  if (ch.to < ch.from) return `Back to ${title} (level ${ch.to}). −${10 * (ch.from - ch.to)} HP.`;
  return null;
}

/** Bloodied / Soaked ticks: 0–8. */
export const stepCondition = (n: number | undefined, delta: number): number => Math.max(0, Math.min(8, (n ?? 0) + delta));

/** The Fatigue die can be changed only while a fight is on (your turn or theirs). */
export const fatigueEditable = (combat: { phase?: string } | null | undefined): boolean => combat?.phase === "you" || combat?.phase === "foes";

/** The Fatigue die: 1–6. */
export const stepFatigue = (f: number | undefined, delta: number): number => Math.max(1, Math.min(6, (f ?? 1) + delta));

/** Permanent HP bonus: like the sheet's stepper, no minimum. */
export const stepBonusHp = (b: number, delta: number): number => (b || 0) + delta;

/** The centred square of an image (source rectangle for a canvas drawImage). */
export function squareCrop(w: number, h: number): { sx: number; sy: number; size: number } {
  const size = Math.min(w, h);
  return { sx: Math.floor((w - size) / 2), sy: Math.floor((h - size) / 2), size };
}

/** A saved portrait, only if it is a base64 image data URL (anything else, e.g. from an imported file, shows the placeholder). */
export const safePortrait = (p: unknown): string =>
  typeof p === "string" && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(p) ? p : "";

/**
 * Set a new portrait, save, and check it stuck. If the save didn't take (storage full), put the
 * previous value back in memory so later saves of `c` don't keep carrying the oversized picture.
 * `saved()` reads the portrait back from storage. Returns whether the new picture was kept.
 */
export function setPortrait<C extends { portrait?: string }>(c: C, pic: string, persist: (c: C) => void, saved: () => string | undefined): boolean {
  const had = "portrait" in c;
  const prev = c.portrait;
  c.portrait = pic;
  persist(c);
  if (saved() === pic) return true;
  if (had) c.portrait = prev;
  else delete c.portrait;
  return false;
}

/** XP gained in play (Combat's bank XP…): applied at once, "the minute you have enough XP" (Core Rules). */
export const addXp = (c: { xp: number; hp: number; lastLevel: number }, gained: number, levelOf: (xp: number) => number) =>
  applyXp(c, c.xp + gained, levelOf);

/**
 * `lastLevel` for an imported character: kept when it is a positive whole number (the app's own
 * exports carry it); otherwise the level for its XP, so the next save neither grants nor takes
 * back level-up HP.
 */
export function importedLastLevel(d: { xp: number; lastLevel?: unknown }, levelOf: (xp: number) => number): number {
  const l = d.lastLevel;
  return typeof l === "number" && Number.isInteger(l) && l > 0 ? l : levelOf(clampXp(d.xp));
}
