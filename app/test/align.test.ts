import { describe, it, expect } from "vitest";
import { align, alignDetail, alignGrid, alignWords, similarity, tokens, ratio } from "../scripts/locator/align";
import type { Box } from "../src/lock/manifest";

const w = (text: string, x0: number, y0: number, x1: number, y1: number) => ({ text, box: [x0, y0, x1, y1] as Box });

describe("tokens and ratio", () => {
  it("lowercases, strips punctuation and drops empty tokens", () => {
    expect(tokens("STONE GATES (ALL BARRED) - 2")).toEqual(["stone", "gates", "all", "barred", "2"]);
  });
  it("scores partial matches by Levenshtein ratio", () => {
    expect(ratio("goblin", "goblin")).toBe(1);
    expect(ratio("goblin", "gob1in")).toBeCloseTo(5 / 6);
    expect(ratio("goblin", "xyz")).toBeLessThan(0.6);
  });
});

describe("align", () => {
  // Two rows of a two-column table; each row has one OCR typo.
  const cells = [
    ["1", "Rusty Sword"],
    ["2", "Golden Amulet"],
  ];
  const words = [
    w("1", 0.10, 0.10, 0.12, 0.12),
    w("Rusty", 0.30, 0.10, 0.40, 0.12),
    w("Swcrd", 0.42, 0.10, 0.50, 0.12),
    w("2", 0.10, 0.20, 0.12, 0.22),
    w("Go1den", 0.30, 0.20, 0.41, 0.22),
    w("Amulet", 0.43, 0.20, 0.52, 0.22),
  ];

  it("maps two rows with one typo each to the union boxes of their words", () => {
    expect(align(cells, words)).toEqual([
      [[0.10, 0.10, 0.12, 0.12], [0.30, 0.10, 0.50, 0.12]],
      [[0.10, 0.20, 0.12, 0.22], [0.30, 0.20, 0.52, 0.22]],
    ]);
  });

  it("gives null for a cell with no matching words", () => {
    const out = align([["1", "Rusty Sword"], ["2", "Golden Amulet"], ["3", "Silver Chalice"]], words);
    expect(out[2]).toEqual([null, null]);
    expect(out[1][1]).toEqual([0.30, 0.20, 0.52, 0.22]);
    const d = alignDetail([["1", "Rusty Sword"], ["2", "Golden Amulet"], ["3", "Silver Chalice"]], words);
    expect(d.matched).toEqual([[1, 2], [1, 2], [0, 0]]);
    expect(d.total).toEqual([[1, 2], [1, 2], [1, 2]]);
  });

  it("ignores stray words before, between and after the table", () => {
    const noisy = [w("Treasure", 0.1, 0.0, 0.3, 0.02), ...words.slice(0, 3), w("|", 0.6, 0.1, 0.61, 0.12), ...words.slice(3), w("Notes", 0.1, 0.9, 0.2, 0.92)];
    expect(align(cells, noisy)).toEqual(align(cells, words));
  });

  it("recovers a cell whose words come out of order in the word stream (multi-line cells)", () => {
    // Row 1, column 1 wraps onto a second line that the stream lists after row 1's other cell.
    const cells2 = [["Sword of light", "Yes"], ["Shield", "No"]];
    const words2 = [
      w("Sword", 0.30, 0.10, 0.38, 0.12), w("of", 0.39, 0.10, 0.41, 0.12), w("Yes", 0.70, 0.11, 0.75, 0.13),
      w("light", 0.30, 0.13, 0.37, 0.15),
      w("Shield", 0.30, 0.20, 0.38, 0.22), w("No", 0.70, 0.20, 0.73, 0.22),
    ];
    expect(align(cells2, words2)).toEqual([
      [[0.30, 0.10, 0.41, 0.15], [0.70, 0.11, 0.75, 0.13]],
      [[0.30, 0.20, 0.38, 0.22], [0.70, 0.20, 0.73, 0.22]],
    ]);
  });

  it("aligns a table printed folded: rows 1-2 on the left, rows 3-4 on the right", () => {
    const folded = [
      w("1", 0.1, 0.1, 0.12, 0.12), w("Goblin", 0.2, 0.1, 0.3, 0.12), w("3", 0.6, 0.1, 0.62, 0.12), w("Troll", 0.7, 0.1, 0.8, 0.12),
      w("2", 0.1, 0.2, 0.12, 0.22), w("Orc", 0.2, 0.2, 0.3, 0.22), w("4", 0.6, 0.2, 0.62, 0.22), w("Wyrm", 0.7, 0.2, 0.8, 0.22),
    ];
    expect(align([["1", "Goblin"], ["2", "Orc"], ["3", "Troll"], ["4", "Wyrm"]], folded)).toEqual([
      [[0.1, 0.1, 0.12, 0.12], [0.2, 0.1, 0.3, 0.12]],
      [[0.1, 0.2, 0.12, 0.22], [0.2, 0.2, 0.3, 0.22]],
      [[0.6, 0.1, 0.62, 0.12], [0.7, 0.1, 0.8, 0.12]],
      [[0.6, 0.2, 0.62, 0.22], [0.7, 0.2, 0.8, 0.22]],
    ]);
  });

  it("keeps a single cell's words together instead of borrowing a far-off duplicate", () => {
    const words3 = [w("the", 0.1, 0.1, 0.15, 0.12), ...Array.from({ length: 80 }, (_, i) => w(`filler${i}`, 0.1, 0.2, 0.2, 0.22)),
      w("the", 0.5, 0.5, 0.55, 0.52), w("dark", 0.56, 0.5, 0.6, 0.52), w("tower", 0.61, 0.5, 0.7, 0.52)];
    expect(align([["The Dark Tower"]], words3)).toEqual([[[0.5, 0.5, 0.7, 0.52]]]);
    expect(alignWords([["The Dark Tower"]], words3)[0][0]).toEqual([81, 82, 83]);
  });
});

describe("alignGrid (one OCR text per ruled cell)", () => {
  it("scores whole cells: merged words and stray rule marks don't matter", () => {
    expect(similarity("L3GH - LEVEL 3 GHOULS", " L3GH-LEVEL3 GHOULS")).toBe(1);
    expect(similarity("L3GH - LEVEL 3 GHOULS", "| LAGH-LEVEL4 GHOULS")).toBeLessThan(1);
    expect(similarity("FORSAKEN", "FORSAKEN ]")).toBe(1);
    expect(similarity("2", "[7]")).toBe(0);
  });

  it("maps cells to texts in order, skipping junk and leaving unreadable cells null", () => {
    const texts = ["L3W - LEVEL 3 WATCH |", "ROLL", "ENCOUNTERED", "1", "FORSAKEN ]", "[7]", "FORSAKEN", "3", "THE LOST ONES i"];
    const cells = [["ROLL", "ENCOUNTERED"], ["1", "FORSAKEN"], ["2", "FORSAKEN"], ["3", "THE LOST ONES"]];
    expect(alignGrid(cells, texts)).toEqual([[1, 2], [3, 4], [null, 6], [7, 8]]);
  });

  it("aligns a folded table half by half", () => {
    const texts = ["1", "GOBLIN", "3", "TROLL", "2", "ORC", "4", "WYRM"];
    expect(alignGrid([["1", "Goblin"], ["2", "Orc"], ["3", "Troll"], ["4", "Wyrm"]], texts)).toEqual([[0, 1], [4, 5], [2, 3], [6, 7]]);
  });
});
