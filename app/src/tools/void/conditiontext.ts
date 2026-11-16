// Stunned and Bloodied in Void table and room text (not combat cards: combatmodel.ts reads those).
//   conditionsIn(text)        the condition changes a text calls for, each marked auto (a plain statement:
//                             apply it now) or not (it depends on a roll or a choice: offer a button)
//   applyCondition(c, hit)    apply one to the survivor; returns a short message, or null when nothing changed
import { bloody, stun, type VoidCharacter } from "./sheetmodel";

export type ConditionKind = "stun" | "bloodied" | "clearBloodied" | "clearStunned";
export interface ConditionHit { kind: ConditionKind; n: number; auto: boolean }

/** Words that make a sentence depend on a roll, a choice or a circumstance. */
const CONDITIONAL = /\b(if|unless|until|while|when|whenever|may|can|could|might|risk|or lower|or higher|or less|or more|instead)\b|\bon (a )?\d/i;

export function conditionsIn(text: string): ConditionHit[] {
  const out: ConditionHit[] = [];
  const add = (h: ConditionHit) => {
    if (!out.some((x) => x.kind === h.kind)) out.push(h);
  };
  for (const raw of String(text).split(/(?<=[.;!?])\s+|\n+/)) {
    const s = raw.replace(/\bif you have (it|them|one)\b/gi, ""); // "remove X if you have it" is still a plain statement
    const auto = !CONDITIONAL.test(s);
    const st = /\bgain(?:s|ing)?\s+(?:the\s+)?Stunned\s+(\d)\b/i.exec(s);
    if (st) add({ kind: "stun", n: +st[1], auto });
    if (/\b(?:gain(?:s|ing)?|become|becomes|are now)\s+(?:the\s+)?Bloodied\b/i.test(s)) add({ kind: "bloodied", n: 1, auto });
    const clear = /\b(?:remove|removes|lose|loses)\s+(?:the\s+|any\s+)?((?:Bloodied|Stunned)(?:\s+(?:and(?:\/or)?|or)\s+(?:Bloodied|Stunned|Soaked|Poisoned))*)/i.exec(s);
    if (clear) {
      if (/Bloodied/i.test(clear[1])) add({ kind: "clearBloodied", n: 0, auto });
      if (/Stunned/i.test(clear[1])) add({ kind: "clearStunned", n: 0, auto });
    }
  }
  return out;
}

export const conditionLabel = (h: ConditionHit): string =>
  h.kind === "stun" ? `Gain Stunned ${h.n}` : h.kind === "bloodied" ? "Gain Bloodied" : h.kind === "clearBloodied" ? "Remove Bloodied" : "Remove Stunned";

export function applyCondition(c: VoidCharacter, h: ConditionHit): string | null {
  const before = { bloodied: c.bloodied, stunned: c.stunned };
  if (h.kind === "stun") stun(c, h.n);
  else if (h.kind === "bloodied") bloody(c);
  else if (h.kind === "clearBloodied") c.bloodied = 0;
  else c.stunned = 0;
  if (c.bloodied === before.bloodied && c.stunned === before.stunned) return null;
  if (h.kind === "stun") return `Stunned ${c.stunned}.`;
  if (h.kind === "bloodied") return `Bloodied ${c.bloodied}/8.`;
  return h.kind === "clearBloodied" ? "Bloodied removed." : "No longer Stunned.";
}
