// Task 13: tampered saved tool state cannot throw while drawing, and a tool whose render throws gets a recovery card.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanDungeonState, roomCell, roomColumns, uniqueSeenIn } from "../src/tools/dungeon";
import { addEncounterRoll } from "../src/tools/realm";
import { guardTool, toolKeys, type GuardEnv } from "../src/shell/toolguard";

describe("dungeon: tampered rooms", () => {
  it("roomColumns / roomCell never throw", () => {
    for (const r of [undefined, null, 5, "x", {}, { columns: "x", cells: 5 }, { columns: [1, null, "A"], cells: { 0: "x" } }]) {
      expect(Array.isArray(roomColumns(r))).toBe(true);
      expect(typeof roomCell(r, 1)).toBe("string");
    }
    expect(roomColumns({ columns: ["A", 2, "B"] })).toEqual(["A", "", "B"]); // positions kept, so they line up with the cells
    expect(roomCell({ cells: ["a", "b"] }, 1)).toBe("b");
    expect(roomCell({ cells: ["a", "b"] }, 9)).toBe("");
  });
  it("uniqueSeenIn tolerates non-array rooms and rooms without a type", () => {
    expect(uniqueSeenIn("x", "Hall")).toBe(false);
    expect(uniqueSeenIn([null, 3, { unique: true }, { unique: true, type: 5 }], "Hall")).toBe(false);
    expect(uniqueSeenIn([{ unique: true, type: "hall" }], "Hall")).toBe(true);
  });
  it("cleanDungeonState repairs the shape", () => {
    const s = cleanDungeonState({ level: "x", rooms: "no", current: { n: 1, room: { columns: 3, cells: "x" } } });
    expect(Array.isArray(s.rooms)).toBe(true);
    expect(Array.isArray(s.current?.room?.columns)).toBe(true);
    expect(Array.isArray(s.current?.room?.cells)).toBe(true);
    expect(cleanDungeonState({ level: 2, rooms: [null, { n: 1, type: 5 }], current: 7 })).toMatchObject({ level: 2, rooms: [], current: null });
    expect(cleanDungeonState(null).level).toBe(1);
  });
});

describe("realm: tampered encounter", () => {
  const rn = { title: "t", dice: "d", mod: 0, value: 1, rows: null };
  it("adds a roll when rolls is missing or not an array", () => {
    for (const enc of [{ dice: "", value: 0, land: "", text: "" }, { dice: "", value: 0, land: "", text: "", rolls: "x" }, { dice: "", value: 0, land: "", text: "", rolls: 5 }])
      expect(addEncounterRoll(enc as never, rn).rolls).toEqual([rn]);
    expect(addEncounterRoll({ dice: "", value: 0, land: "", text: "", rolls: [rn] }, rn).rolls).toHaveLength(2);
  });
});

// --- the tool-level safety net, against a fake root and storage
const fakeRoot = () => {
  const els: Record<string, { onclick?: () => unknown }> = {};
  return {
    innerHTML: "",
    els,
    querySelector(sel: string) {
      const m = /data-guard="([a-z]+)"/.exec(sel);
      return m && this.innerHTML.includes(`data-guard="${m[1]}"`) ? (els[m[1]] ??= {}) : null;
    },
  };
};
const mem = (init: Record<string, string>) => {
  const d = { ...init };
  return { d, removeItem: (k: string) => void delete d[k], keys: () => Object.keys(d) };
};
const env = (st: ReturnType<typeof mem>, ok: boolean): GuardEnv & { confirm: ReturnType<typeof vi.fn> } => ({ storage: st, confirm: vi.fn(() => ok) });

describe("guardTool", () => {
  beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => void vi.restoreAllMocks());
  const boom = (n = { v: 0 }) => ({ render: () => { n.v++; if (n.v < 3) throw new Error("bad saved data <b>x</b>"); } });

  it("passes a healthy tool through untouched", async () => {
    const r = fakeRoot();
    let ran = 0;
    await guardTool("dungeon", { render: () => void ran++ }, env(mem({}), true)).render(r as never, {} as never, "#/play/dungeon");
    expect(ran).toBe(1);
    expect(r.innerHTML).toBe("");
  });

  it("shows the message and both buttons when render throws", async () => {
    const r = fakeRoot();
    await guardTool("dungeon", boom(), env(mem({}), true)).render(r as never, {} as never, "#/play/dungeon");
    expect(r.innerHTML).toContain("This saved game couldn't be read.");
    expect(r.innerHTML).toContain("Keep it");
    expect(r.innerHTML).toContain("Start over");
  });

  it("Keep it leaves the data and shows a start screen", async () => {
    const r = fakeRoot();
    const st = mem({ "2d6:play:dungeon": "{bad" });
    await guardTool("dungeon", boom(), env(st, true)).render(r as never, {} as never, "#/play/dungeon");
    await r.els.keep.onclick!();
    expect(st.d["2d6:play:dungeon"]).toBe("{bad");
    expect(r.innerHTML).toContain("Dungeon turn");
    expect(r.innerHTML).not.toContain('data-guard="keep"');
  });

  it("Start over asks first, then clears only that tool's play keys and renders again", async () => {
    const st = mem({ "2d6:play:dungeon": "x", "2d6:play:realm": "r", "2d6:play:character": "c", "2d6:fixes": "[]" });
    const n = { v: 0 };
    const e = env(st, false);
    const r = fakeRoot();
    await guardTool("dungeon", boom(n), e).render(r as never, {} as never, "#/play/dungeon");
    await r.els.reset.onclick!();
    expect(e.confirm).toHaveBeenCalledOnce();
    expect(st.keys()).toContain("2d6:play:dungeon"); // declined: nothing deleted
    (e.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await r.els.reset.onclick!();
    expect(st.keys().sort()).toEqual(["2d6:fixes", "2d6:play:character", "2d6:play:realm"]);
    expect(n.v).toBeGreaterThan(1); // drew again
  });

  it("leaves a keyless tool alone (generic error and Retry stay)", () => {
    const page = { render: () => { throw new Error("x"); } };
    expect(guardTool("map", page, env(mem({}), true))).toBe(page);
    expect(guardTool("settings", page, env(mem({}), true))).toBe(page);
  });

  it("knows each tool's own keys", () => {
    expect(toolKeys("sheet")).toEqual(["2d6:play:character"]);
    expect(toolKeys("settings")).toEqual([]);
  });
});
