// The play tools with locked books: the steps that need a locked table show the locked card, and the
// rest of each tool still works. Uses the real manifest and free.json (skipped when they're absent).
import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { initContent } from "../src/content";
import { forgetAll } from "../src/lock/store";
import { rebuildLibrary } from "../src/library";
import { manualCreature } from "../src/tools/combat";

const nodeMod = (m: string) => import(/* @vite-ignore */ m);
const { existsSync, readFileSync } = await nodeMod("node:fs");
const { fileURLToPath } = await nodeMod("node:url");
const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const realManifest = here("../public/data/manifest.json");
const realFree = here("../public/data/free.json");
const haveData = existsSync(realManifest) && existsSync(realFree);

beforeAll(async () => {
  if (!haveData) return;
  await forgetAll();
  await initContent(async (p) => JSON.parse(readFileSync(p.endsWith("manifest.json") ? realManifest : realFree, "utf8")));
  rebuildLibrary();
});

describe("dungeon while the Codex is locked", () => {
  it.skipIf(!haveData)("level 2's room-type step shows the locked card; level 1 rolls", async () => {
    const { roomTypeStep } = await import("../src/tools/dungeon");
    const l2 = String(roomTypeStep(2, "regular", false));
    expect(l2).toContain('data-act="unlock"');
    expect(l2).toContain("Open your <em>Codex Full</em> PDF to unlock");
    expect(l2).not.toContain('data-act="type"');
    const l1 = String(roomTypeStep(1, "regular", false));
    expect(l1).toContain('data-act="type"');
    expect(l1).not.toContain('data-act="unlock"');
  });
});

describe("combat: a creature entered by hand", () => {
  it("parses the stats and manoeuvres", () => {
    const c = manualCreature({ name: "Cave thing", level: "2", hp: "9", sh: "1", xp: "4", man: "[5][4] Claw = 1D6+1\n[2][3] Bite = 2D6", int: "" }, "MANUAL|1");
    expect(typeof c).toBe("object");
    if (typeof c === "string") return;
    expect(c).toMatchObject({ name: "Cave thing", level: 2, hp: 9, sh: 1, xp: 4, sectionId: "" });
    expect(c.man.map((m) => [m.a, m.b, m.name, m.dmg.n, m.dmg.mod])).toEqual([[5, 4, "Claw", 1, 1], [2, 3, "Bite", 2, 0]]);
  });

  it("refuses one with no name, no HP or no manoeuvre", () => {
    const base = { name: "X", level: "1", hp: "5", sh: "0", xp: "0", man: "[5][4] Claw = 1D6", int: "" };
    expect(typeof manualCreature({ ...base, name: " " }, "k")).toBe("string");
    expect(typeof manualCreature({ ...base, hp: "0" }, "k")).toBe("string");
    expect(typeof manualCreature({ ...base, man: "claw" }, "k")).toBe("string");
  });
});

describe("realm while the Realm is locked", () => {
  it.skipIf(!haveData)("the Buildings tab shows the locked card and a by-hand add works", async () => {
    const { addBuildingByHand, buildingsHtml, freshRealm } = await import("../src/tools/realm");
    const s = freshRealm();
    let html = String(buildingsHtml(s));
    expect(html).toContain('data-act="unlock"');
    expect(html).toContain("Open your <em>Realm</em> PDF to unlock");
    expect(html).toContain('data-act="build-hand"');
    expect(html).not.toContain('id="nb-type"'); // no card list while locked
    expect(addBuildingByHand(s, { name: "Barn", hp: "5", workers: "1", plot: "Homestead", note: "east field" })).toBeNull();
    expect(s.buildings).toMatchObject([{ type: "Barn", maxHp: 5, needWorkers: 1, hp: 1, plot: "Homestead", note: "east field" }]);
    expect(addBuildingByHand(s, { name: "", hp: "5", workers: "0", plot: "Homestead", note: "" })).toMatch(/name/i);
    html = String(buildingsHtml(s));
    expect(html).toContain("Barn");
  });

  it.skipIf(!haveData)("saved buildings from before the lock still show, by name or as Building", async () => {
    const { buildingsHtml, freshRealm } = await import("../src/tools/realm");
    const s = freshRealm();
    s.buildings.push({ id: 1, plot: "1AB", type: "Farm", level: 2, hp: 7, workers: 2, unrest: 0, note: "" });
    s.buildings.push({ id: 2, plot: "1AB", type: "", level: 1, hp: 3, workers: 0, unrest: 0, note: "" });
    const html = String(buildingsHtml(s));
    expect(html).toContain("Farm");
    expect(html).toContain(">Building<");
  });

  it.skipIf(!haveData)("the Owner step shows LAIT1's locked card only after a roll of 1–2", async () => {
    const { ownerLockedHtml } = await import("../src/tools/realm");
    expect(ownerLockedHtml({})).toBe("");
    expect(ownerLockedHtml({ owner: "Unclaimed", claim: true })).toBe("");
    expect(String(ownerLockedHtml({ owner: "Owned", claim: false }))).toContain('data-act="unlock"');
  });

  it("realm.ts holds no building card names", () => {
    const src: string = readFileSync(here("../src/tools/realm.ts"), "utf8");
    // built from pieces so the names aren't in the repo as literals either
    const names = [["Alch", "emist's Lab", "oratory"], ["Kol Ke", "eper's Lo", "dge"], ["Manifold Gra", "nite Qua", "rry"], ["Ramana Ste", "el Sme", "lter"]]
      .map((p) => p.join(""));
    for (const n of names) expect(src.toLowerCase()).not.toContain(n.toLowerCase());
  });
});

describe("realm once the Realm is unlocked", () => {
  it.skipIf(!haveData)("reads the building cards from the unlocked sections", async () => {
    const { addUnlocked, lockAll } = await import("../src/content");
    const { buildingCards, buildingsHtml, freshRealm } = await import("../src/tools/realm");
    const text = "A test hut. **HP:** 6 **Size:** 10 **Cost:** 25 GC **Plot Rank Modifier:** +2 **Requires:** 2 workers and a Mine " +
      "**Plot Requirements:** None **Benefit:** At full HP it gives 3 GC per turn. **Upgrade:** L2 for 10 GC. Gives 4 GC per turn. L3 for 20 GC. Gives you 6 GC income.";
    await addUnlocked([{ section: { id: "realm/p137-3", book: "realm", title: "Test Hut", level: 3, chapter: null, pages: [137], blocks: [{ type: "para", text, page: 137 }] }, unverified: [] }]);
    try {
      const c = buildingCards().find((b) => b.name === "Test Hut");
      expect(c).toMatchObject({ id: "realm/p137-3", hp: 6, size: 10, cost: 25, rank: 2, workers: 2, req: "2 workers and a Mine", plot: "None", income: [3, 4, 6] });
      const html = String(buildingsHtml(freshRealm()));
      expect(html).toContain('id="nb-type"');
      expect(html).toContain("<option>Test Hut</option>");
      // the other cards are still locked
      expect(html).toContain('data-act="unlock"');
    } finally {
      await lockAll();
    }
  });
});


describe("fix round 2: saved buildings while the Realm is locked", () => {
  it.skipIf(!haveData)("a saved building with no size is not complete and adds no workers", async () => {
    const { buildingsHtml, freshRealm, workersAvailable } = await import("../src/tools/realm");
    const s = freshRealm();
    // saved before the lock: a full House and a half-built Farm, neither with its size stored
    s.buildings.push({ id: 1, plot: "Homestead", type: "House", level: 1, hp: 6, workers: 0, unrest: 2, note: "" });
    s.buildings.push({ id: 2, plot: "1AB", type: "Farm", level: 1, hp: 3, workers: 0, unrest: 0, note: "" });
    expect(workersAvailable(s)).toMatchObject({ total: 0 });
    const html = String(buildingsHtml(s));
    expect(html).toContain("Workers 0/0 assigned");
    expect(html).not.toContain("complete");
    expect(html).toContain("HP 6 so far");
    expect(html).toContain("HP 3 so far");
    expect(html).toContain("size filled in after you unlock the Realm");
    expect(html).not.toContain('data-hp="1"'); // no HP boxes of a made-up size
    expect(html).not.toContain('data-unrest="1"');
    expect(html).toContain("Unrest 2");
  });

  it.skipIf(!haveData)("a building started from a card keeps its size, so it stays right after a lock", async () => {
    const { buildingsHtml, freshRealm, startBuilding, workersAvailable } = await import("../src/tools/realm");
    const s = freshRealm();
    const c = { name: "Test Hut", id: "realm/p137-3", hp: 6, size: 10, cost: 25, rank: 2, workers: 2, req: "—", plot: "None", benefit: "", up: "" };
    startBuilding(s, c, "Homestead", 25);
    expect(s.buildings[0]).toMatchObject({ type: "Test Hut", hp: 1, maxHp: 6, needWorkers: 2 });
    expect(s.gc).toBe(-25);
    s.buildings.push({ id: 9, plot: "Homestead", type: "House", level: 1, hp: 6, workers: 0, unrest: 0, note: "", maxHp: 6, needWorkers: 0 });
    expect(workersAvailable(s).total).toBe(2);
    const html = String(buildingsHtml(s));
    expect(html).toContain("building 1/6");
    expect(html).toContain('data-hp="9" data-n="6" checked');
  });

  it.skipIf(!haveData)("a saved building with no type doesn't throw", async () => {
    const { buildingsHtml, freshRealm, workersAvailable } = await import("../src/tools/realm");
    const s = freshRealm();
    s.buildings.push({ id: 1, plot: "Homestead", level: 1, hp: 2, workers: 0, unrest: 0, note: "" } as never);
    expect(() => workersAvailable(s)).not.toThrow();
    expect(String(buildingsHtml(s))).toContain(">Building<");
  });
});

describe("fix round 2: card fields", () => {
  it("keeps a field whole when it contains an asterisk", async () => {
    const { parseBuildingCard } = await import("../src/tools/realm");
    const c = parseBuildingCard("realm/p137-1", "Hut", "**HP:** 3 **Size:** 2 **Cost:** 7 GC **Requires:** Nothing **Benefit:** Gives a *small* bonus, see note*. **Upgrade:** L2 for 5 GC. Gives 1 GC per turn.");
    expect(c?.benefit).toBe("Gives a *small* bonus, see note*.");
    expect(c?.income).toEqual([0, 1]);
  });
});

describe("fix round 2: combat by-hand values survive a redraw", () => {
  it("typing updates the draft, and the redrawn form shows it", async () => {
    const { applyManualInput, manualFormHtml } = await import("../src/tools/combat");
    const draft = { name: "", level: "1", hp: "5", sh: "0", xp: "0", man: "", int: "" };
    expect(applyManualInput(draft, "cm-name", `Grub "big"`)).toBe(true);
    expect(applyManualInput(draft, "cm-man", "[5][4] Claw = 1D6")).toBe(true);
    expect(applyManualInput(draft, "cb-search", "x")).toBe(false);
    const html = String(manualFormHtml(draft, true));
    expect(html).toContain('value="Grub &quot;big&quot;"');
    expect(html).toContain(">[5][4] Claw = 1D6</textarea>");
    expect(html).toContain('<details class="cb-manual" open>');
    expect(String(manualFormHtml(draft, false))).toContain('<details class="cb-manual">');
  });
});

describe("addon tools hide until their book is unlocked", () => {
  it.skipIf(!haveData)("Realm is hidden while its book is locked, and everything else stays listed", async () => {
    const { availableTools, toolHidden, PLAY_TOOLS } = await import("../src/tools/common");
    expect(toolHidden("realm")).toBe(true);
    expect(availableTools().some((t) => t.id === "realm")).toBe(false);
    expect(availableTools().some((t) => t.id === "dungeon")).toBe(true);
    expect(PLAY_TOOLS.some((t) => t.id === "realm")).toBe(true); // titles and icons still resolve
    expect(toolHidden("dungeon")).toBe(false);
    expect(toolHidden("nonsense")).toBe(false);
  });
});

describe("per-character expansions and classes", () => {
  it("an older character (no class, no expansions) is an adventurer with none, and validates", async () => {
    const { blankCharacter, classOf, hasExpansion, validateCharacter, levelOf, levelFn, levelTitle } = await import("../src/tools/sheet");
    const old: Record<string, unknown> = { ...blankCharacter() };
    delete old.class;
    delete old.expansions;
    expect(() => validateCharacter(old)).not.toThrow();
    expect(classOf(old)).toBe("adventurer");
    expect(hasExpansion(old as never, "lairs")).toBe(false);
    expect(levelOf(0)).toBe(1);
    expect(levelFn(old)(100)).toBe(2);
    expect(levelTitle(old, 1)).toBe("Raw");
  });
  it("rejects a bad class or expansion value", async () => {
    const { blankCharacter, validateCharacter } = await import("../src/tools/sheet");
    expect(() => validateCharacter({ ...blankCharacter(), class: "wizard" })).toThrow();
    expect(() => validateCharacter({ ...blankCharacter(), expansions: { lairs: "yes" } })).toThrow();
    expect(() => validateCharacter({ ...blankCharacter(), class: "constable", expansions: { lairs: true } })).not.toThrow();
  });
  it("a flag is never on while its book is locked; a constable falls back to the adventurer ladder while Lairs is locked", async () => {
    const { blankCharacter, hasExpansion, levelOf, levelTitle } = await import("../src/tools/sheet");
    const c = { ...blankCharacter(), class: "constable" as const, expansions: { lairs: true } };
    expect(hasExpansion(c, "lairs")).toBe(false);
    expect(levelOf(500, "constable")).toBe(levelOf(500));
    expect(levelTitle(c, 1)).toBe("Raw");
  });
});

describe("animal companion card", () => {
  it("shares up to half the damage and never kills the companion", async () => {
    const { shareDamage } = await import("../src/tools/sheet");
    expect(shareDamage(10, 20)).toEqual({ you: 5, companion: 5 });
    expect(shareDamage(11, 20)).toEqual({ you: 6, companion: 5 });
    expect(shareDamage(10, 3)).toEqual({ you: 8, companion: 2 });
    expect(shareDamage(10, 1)).toEqual({ you: 10, companion: 0 });
    expect(shareDamage(-4, 9)).toEqual({ you: 0, companion: 0 });
  });
  it("validates a companion sheet and rejects bad shapes", async () => {
    const { blankCharacter, validateCharacter } = await import("../src/tools/sheet");
    expect(() => validateCharacter({ ...blankCharacter(), companion: { name: "Rex", a1desc: "x" } })).not.toThrow();
    expect(() => validateCharacter({ ...blankCharacter(), companion: { name: 5 } })).toThrow();
    expect(() => validateCharacter({ ...blankCharacter(), companion: { "bad key": "x" } })).toThrow();
  });
});
