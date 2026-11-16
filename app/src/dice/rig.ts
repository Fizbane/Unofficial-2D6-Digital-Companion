// Scripted dice for the gameplay tutorial. The coach arms entries for the step it is on; rollDice() takes the
// first armed entry that matches the roll's kind (and tag), and anything unmatched rolls normally. Nothing is
// armed outside the tutorial, so ordinary play never touches this.
export interface RigEntry {
  /** "D66", "D6", "2D6", "D3"… (case and spaces ignored; "1D6" is "D6"); "*" matches any kind. */
  kind: string;
  /** The faces to show, or a function giving them for `n` dice when the roll is made (null: roll normally). */
  dice: number[] | ((n: number) => number[] | null);
  /** Only rolls made with this tag match (combat: whose roll it is). Untagged entries only match untagged rolls. */
  tag?: string;
  /** Stay armed after use (every matching roll gets these faces). */
  keep?: boolean;
}

let armed: RigEntry[] = [];

export const normKind = (k: string): string => k.toUpperCase().replace(/\s/g, "").replace(/^1D/, "D");

/** Arm `entries` (replacing anything armed before). */
export function rig(entries: RigEntry[]): void {
  armed = [...entries];
}

/** Disarm everything. */
export function clearRig(): void {
  armed = [];
}

/** Is anything armed? */
export const rigArmed = (): boolean => armed.length > 0;

/** The scripted faces for a roll of `n` dice of `kind` (with `tag`), or null to roll normally. */
export function takeRig(kind: string, tag?: string, n = 1): number[] | null {
  const k = normKind(kind);
  const i = armed.findIndex((e) => (e.kind === "*" || normKind(e.kind) === k) && e.tag === tag);
  if (i < 0) return null;
  const e = armed[i];
  if (!e.keep) armed.splice(i, 1);
  const v = typeof e.dice === "function" ? e.dice(n) : e.dice;
  return v && v.every((n) => Number.isInteger(n) && n >= 1 && n <= 6) ? [...v] : null;
}
