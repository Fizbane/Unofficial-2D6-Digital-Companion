import { describe, it, expect } from "vitest";
import { freshRealm, kaladearFp, payTax, plotCardHtml, plotsForMap, rankText, removeBuilding, startBuilding, type Bldg, type Land } from "../src/tools/realm";
import { fairIndex, mapLegendHtml } from "../src/tools/rmap";
import { html } from "../src/ui/html";

const land = (over: Partial<Land>): Land => ({
  id: 1, tag: "1FO", land: "Forest", base: "", size: 2, rank: 1, rankMod: 0, details: "", bp: 0, claimed: true, owner: "", ...over,
});
const bldg = (plot: string, id: number): Bldg => ({ id, plot, type: "House", level: 1, hp: 4, workers: 0, unrest: 0, note: "" });

describe("plotsForMap", () => {
  it("keeps only placed lands, with the code from the tag and a building count", () => {
    const lands = [
      land({ id: 1, tag: "1fo", cells: [[12, 11], [12, 10]] }),
      land({ id: 2, tag: "2RI", claimed: false, cells: [[11, 12]] }),
      land({ id: 3, tag: "3HI" }), // explored before the map existed
      land({ id: 4, tag: "4PL", cells: [] }),
    ];
    const plots = plotsForMap(lands, [bldg("1fo", 1), bldg("1fo", 2), bldg("2RI", 3), bldg("9XX", 4)]);
    expect(plots).toEqual([
      { id: 1, code: "FO", cells: [[12, 11], [12, 10]], claimed: true, tag: "1fo", buildings: 2 },
      { id: 2, code: "RI", cells: [[11, 12]], claimed: false, tag: "2RI", buildings: 1 },
    ]);
  });

  it("is empty with no lands", () => {
    expect(plotsForMap([], [])).toEqual([]);
  });
});

describe("plot card and map legend helpers", () => {
  const land = (o: Partial<Land>): Land => ({ id: 1, tag: "1SH", land: "Shrubland", base: "", size: 3, rank: 2, rankMod: 0, details: "", bp: 0, claimed: true, owner: "You", cells: [[12, 11]], ...o });
  it("writes the rank modifier with its sign", () => {
    expect(rankText(2, 0)).toBe("rank 2");
    expect(rankText(2, 1)).toBe("rank 2 +1");
    expect(rankText(2, -1)).toBe("rank 2 −1");
  });
  it("plotCardHtml lists owner, size, rank, tax and buildings", () => {
    const b: Bldg = { id: 1, plot: "1SH", type: "House", level: 1, hp: 0, workers: 0, unrest: 0, note: "" };
    const h = String(plotCardHtml(land({ rankMod: -1 }), [b], html`<button>x</button>`));
    expect(h).toContain("1SH Shrubland");
    expect(h).toContain("Yours · 3 squares · rank 2 −1 · tax 5 SC");
    expect(h).toContain("House L1");
    expect(h).not.toContain("+-");
    expect(String(plotCardHtml(land({ claimed: false, owner: "Lord X", size: 1 }), [], html``))).toContain("Unclaimed · Lord X · 1 square · rank 2");
  });
  it("mapLegendHtml colours areas and draws strings as lines", () => {
    const h = String(mapLegendHtml(["SH", "RI"]));
    expect(h).toContain("background:#9fb57a");
    expect(h).toContain("border-top:3px solid #3f7fc4");
  });
});

describe("payTax", () => {
  it("pays from silver, then breaks gold and gives change", () => {
    expect(payTax({ gc: 5, sc: 30, cc: 0 }, 25)).toEqual({ gc: 5, sc: 5, cc: 0 });
    expect(payTax({ gc: 5, sc: 3, cc: 0 }, 25)).toEqual({ gc: 2, sc: 8, cc: 0 });
  });
  it("uses copper last, and never goes into debt", () => {
    expect(payTax({ gc: 0, sc: 3, cc: 250 }, 25)).toEqual({ gc: 0, sc: 0, cc: 30 });
    expect(payTax({ gc: 0, sc: 3, cc: 0 }, 25)).toBeNull();
    expect(payTax({ gc: 1, sc: 3, cc: 0 }, 25)).toBeNull();
  });
});

describe("fairIndex", () => {
  it("gives each of four options the same share of a D6, re-rolling 5 and 6", () => {
    const counts = [0, 0, 0, 0];
    for (let first = 1; first <= 6; first++)
      for (let second = 1; second <= 4; second++) {
        const rolls = [first, second];
        counts[fairIndex(4, () => rolls.shift() ?? 1)]++;
      }
    expect(new Set(counts).size).toBe(1);
  });
  it("uses every face for two, three and six options", () => {
    for (const n of [2, 3, 6]) {
      const counts = Array(n).fill(0);
      for (let v = 1; v <= 6; v++) counts[fairIndex(n, () => v)]++;
      expect(new Set(counts).size).toBe(1);
    }
  });
});

describe("Kaladear favour and corruption", () => {
  it("counts only the boxes corruption hasn't crossed out", () => {
    expect(kaladearFp({ kaladear: 6, corruption: 0 })).toBe(6);
    expect(kaladearFp({ kaladear: 6, corruption: 3 })).toBe(3);
    expect(kaladearFp({ kaladear: 2, corruption: 3 })).toBe(2);
    expect(kaladearFp({ kaladear: 6, corruption: 6 })).toBe(0);
    expect(kaladearFp({ kaladear: 6, corruption: 10 })).toBe(0);
  });
});

describe("removing a building", () => {
  it("gives its plot back the Building Points and rank it took", () => {
    const s = freshRealm();
    s.gc = 100;
    s.lands.push({ id: 1, tag: "3LA", claimed: true, owner: "", size: 2, rank: 2, rankMod: 0, bp: 6 } as never);
    const b = startBuilding(s, { name: "Mill", cost: 30, size: 2, rank: 1, hp: 4, workers: 0 } as never, "3LA", 30);
    expect([s.lands[0].bp, s.lands[0].rankMod]).toEqual([4, 1]);
    removeBuilding(s, b.id);
    expect([s.lands[0].bp, s.lands[0].rankMod]).toEqual([6, 0]);
    expect(s.buildings).toEqual([]);
    expect(s.gc).toBe(70); // the gold stays spent
  });
});
