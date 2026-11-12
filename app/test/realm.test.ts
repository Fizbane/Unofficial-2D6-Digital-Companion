import { describe, it, expect } from "vitest";
import { plotCardHtml, plotsForMap, rankText, type Bldg, type Land } from "../src/tools/realm";
import { mapLegendHtml } from "../src/tools/rmap";
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
