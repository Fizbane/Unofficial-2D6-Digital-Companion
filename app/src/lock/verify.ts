// Verifies one extracted cell against its keyed hash, trying cheap repairs in a fixed order.
import { applyPatch, norm, type Patch } from "./hash";
import { confusions } from "./confuse";

export type CellSource =
  | { ocr: () => Promise<string> }
  | { text: () => string }
  | { pips: (threshold: number) => string };

/** The first is the reading the locator builds pip patches from. */
export const PIP_THRESHOLDS = [128, 96, 160];

/**
 * Order: raw output, the patch keyed by patchKey(raw), then the confusion search (OCR and text) or
 * pips at the remaining thresholds. The raw output is norm()ed first, so patches (made by the locator
 * from norm(raw) to norm(truth)) never spend their ops on line breaks or spacing. An empty `expected`
 * (no hash) passes the raw text. On failure the raw text from the first attempt comes back with ok: false.
 */
export async function verifyCell(
  src: CellSource,
  expected: string,
  hashOf: (t: string) => string,
  patches: Record<string, Patch> | undefined,
  patchKey: (t: string) => string,
): Promise<{ text: string; ok: boolean; patch?: "hit" | "miss" }> {
  const raw = norm("pips" in src ? src.pips(PIP_THRESHOLDS[0]) : "ocr" in src ? await src.ocr() : src.text());
  if (expected === "" || hashOf(raw) === expected) return { text: raw, ok: true };

  // `patch` reports a stored patch that was tried: "hit" when it verified, else "miss".
  const p = patches && Object.hasOwn(patches, patchKey(raw)) ? patches[patchKey(raw)] : undefined;
  if (p) {
    const t = applyPatch(raw, p);
    if (hashOf(t) === expected) return { text: t, ok: true, patch: "hit" };
  }
  const tried = p ? { patch: "miss" as const } : {};

  if ("pips" in src) {
    for (const th of PIP_THRESHOLDS.slice(1)) {
      const t = src.pips(th);
      if (hashOf(t) === expected) return { text: t, ok: true, ...tried };
    }
  } else {
    for (const t of confusions(raw)) if (hashOf(t) === expected) return { text: t, ok: true, ...tried };
  }
  return { text: raw, ok: false, ...tried };
}
