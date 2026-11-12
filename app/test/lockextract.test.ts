import { describe, it, expect } from "vitest";
import { textInBox, type TextItem } from "../src/lock/extract";
import { verifyCell, type CellSource } from "../src/lock/verify";
import { fieldHash, makePatch, type Patch } from "../src/lock/hash";

const item = (str: string, x: number, y: number, w: number, extra: Partial<TextItem> = {}): TextItem => ({
  str, x, y, w, h: 0.02, bold: false, italic: false, ...extra,
});

describe("textInBox", () => {
  it("joins lines in reading order, skips items outside and records bold spans", () => {
    const items = [
      item("world", 0.1, 0.2, 0.05),
      item("there", 0.2, 0.101, 0.05),
      item("Hello", 0.1, 0.1, 0.05, { bold: true }),
      item("outside", 0.9, 0.1, 0.05),
    ];
    const r = textInBox(items, [0, 0, 0.5, 0.5]);
    expect(r.text).toBe("Hello there world");
    expect(r.marks).toEqual([[0, 5, "b"]]);
  });
  it("counts an item by its centre", () => {
    // Starts inside the box but its centre is outside.
    const r = textInBox([item("in", 0.1, 0.1, 0.05), item("edge", 0.45, 0.1, 0.2)], [0, 0, 0.5, 0.5]);
    expect(r.text).toBe("in");
  });
  it("adds no space across a tight gap and merges adjacent spans", () => {
    const items = [
      item("Cur", 0.1, 0.1, 0.03, { italic: true }),
      item("sed", 0.1301, 0.1, 0.03, { italic: true }),
      item("blade", 0.18, 0.1, 0.05, { italic: true }),
      item("x", 0.25, 0.1, 0.01),
    ];
    const r = textInBox(items, [0, 0, 1, 1]);
    expect(r.text).toBe("Cursed blade x");
    expect(r.marks).toEqual([[0, 12, "i"]]);
  });
  it("applies fixText", () => {
    const r = textInBox([item("Orc�s axe � 2", 0.1, 0.1, 0.1)], [0, 0, 1, 1]);
    expect(r.text).toBe("Orc's axe – 2");
  });
  it("returns empty for an empty box", () => {
    expect(textInBox([], [0, 0, 1, 1])).toEqual({ text: "", marks: [] });
  });
});

describe("verifyCell", () => {
  const key = new Uint8Array(32).fill(7);
  const hashOf = (t: string) => fieldHash(key, "cell", "codex/p10-1", 0, 2, 1, t);
  const text = (s: string): CellSource => ({ text: () => s });
  const ocr = (s: string): CellSource => ({ ocr: async () => s });

  it("passes the raw text when it matches", async () => {
    expect(await verifyCell(text("Gold"), hashOf("Gold"), hashOf, undefined, hashOf)).toEqual({ text: "Gold", ok: true });
  });
  it("passes automatically when there is no hash", async () => {
    expect(await verifyCell(ocr("anything"), "", hashOf, undefined, hashOf)).toEqual({ text: "anything", ok: true });
  });
  it("uses a patch keyed by the raw output when the raw text fails", async () => {
    const raw = "Tbe Wizzard";
    const truth = "The Wizard";
    const p = makePatch(raw, truth) as Patch;
    const patches = { [hashOf(raw)]: p };
    expect(await verifyCell(ocr(raw), hashOf(truth), hashOf, patches, hashOf)).toEqual({ text: truth, ok: true, patch: "hit" });
  });
  it("reports a stored patch that was tried and missed", async () => {
    const patches = { [hashOf("c1oak")]: [[0, 1, "X"]] as Patch };
    expect(await verifyCell(ocr("c1oak"), hashOf("cloak"), hashOf, patches, hashOf)).toEqual({ text: "cloak", ok: true, patch: "miss" });
    expect(await verifyCell(ocr("zzz"), hashOf("cloak"), hashOf, { [hashOf("zzz")]: [[0, 1, "y"]] }, hashOf)).toEqual({ text: "zzz", ok: false, patch: "miss" });
  });
  it("falls back to the confusion search for OCR", async () => {
    expect(await verifyCell(ocr("c1oak"), hashOf("cloak"), hashOf, {}, hashOf)).toEqual({ text: "cloak", ok: true });
  });
  it("retries pips at the other thresholds and skips confusions", async () => {
    const seen: number[] = [];
    const src: CellSource = { pips: (t) => (seen.push(t), t === 160 ? "[5][4]" : "[5][1]") };
    expect(await verifyCell(src, hashOf("[5][4]"), hashOf, {}, hashOf)).toEqual({ text: "[5][4]", ok: true });
    expect(seen).toEqual([128, 96, 160]);
    // "[5][1]" -> "[5][l]" is a confusion candidate; a pips source must not try it.
    const r = await verifyCell({ pips: () => "[5][1]" }, hashOf("[5][l]"), hashOf, {}, hashOf);
    expect(r).toEqual({ text: "[5][1]", ok: false });
  });
  it("returns the raw text unverified when nothing matches", async () => {
    expect(await verifyCell(ocr("zzz"), hashOf("Dragon"), hashOf, { [hashOf("other")]: [[0, 1, "D"]] }, hashOf))
      .toEqual({ text: "zzz", ok: false });
  });
});
