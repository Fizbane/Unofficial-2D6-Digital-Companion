// Fix round 1: stored colours are validated before they reach a style attribute, and saved play
// state of any shape is drawn as text or dropped, never thrown and never markup.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cssColor, html } from "../src/ui/html";
import { DEFAULT_SETTINGS, getSettings, swatch } from "../src/dice3d";
import { doorHtml, rollHtml, type DoorNote, type SavedRoll } from "../src/tools/dungeon";
import { encounterHtml, ownerNoteHtml, rollNoteHtml, type EncounterNote, type OwnerNote, type RollNote } from "../src/tools/realm";
import { logHtml, type LogEntry, type LogNode } from "../src/tools/combat";

const inline = (s: string) => html`[${s}]`;
const follow = (s: string) => html`<i data-f="${s}"></i>`;
const XSS = `<img src=x onerror="alert(1)">`;
const EVIL = "red;background-image:url(https://evil.example/x)";
const safe = (h: unknown) => expect(String(h)).not.toMatch(/<img|<script|<b>|onerror="/);

describe("cssColor", () => {
  it("accepts only hex colours", () => {
    for (const c of ["#abc", "#abcd", "#a1b2c3", "#A1B2C3D4"]) expect(cssColor(c, "#888")).toBe(c);
    for (const c of [EVIL, "red", "#abcde", "#12345g", "", undefined, null, 5, "#abc;x:y", " #abc"]) expect(cssColor(c, "#888")).toBe("#888");
  });
});

describe("dice settings from storage", () => {
  let data: Record<string, string> = {};
  beforeEach(() => {
    data = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => void (data[k] = v),
      removeItem: (k: string) => void delete data[k],
    };
  });
  afterEach(() => void delete (globalThis as { localStorage?: unknown }).localStorage);

  it("drops a tampered colour (and a tampered dice list) on read", () => {
    data["2d6:dice-settings"] = JSON.stringify({ dice: [{ look: "classic", color: EVIL, name: "x" }, { look: "classic", color: "#123456", name: "y" }] });
    const s = getSettings();
    expect(s.dice[0].color).toBe("");
    expect(s.dice[1].color).toBe("#123456");
    expect(swatch(s.dice[0])).toMatch(/^#[0-9a-f]+$/i);
    expect(swatch({ look: "classic", color: EVIL, name: "" })).not.toContain("url(");
    data["2d6:dice-settings"] = JSON.stringify({ dice: "nope" });
    expect(getSettings().dice).toEqual(DEFAULT_SETTINGS.dice);
  });
});

const tampered: unknown[] = [null, 7, "x", [], {}, { rows: "x" }, { rows: [["a"], 5, null] }, { columns: 5, cells: { 1: XSS }, matched: true, title: { x: 1 } }, { k: "door", kind: XSS, value: "1<b>" }, { k: "pick", ok: false }, { k: "roll", roll: 3 }, { k: "zzz" }, { rolls: "x", dice: XSS, legacy: 4 }, { owned: true, roll: { rows: 9 } }];

describe("dungeon saved rolls and doors", () => {
  const roll: SavedRoll = { title: "L1R", dice: "2D6 3 + 4 = 7", value: 7, matched: true, columns: ["2D6", "Room", "Exits"], cells: ["7", "Hall <b>", "2"] };
  it("draws a saved roll, escaping its text", () => {
    const h = String(rollHtml(roll, inline, follow));
    expect(h).toContain('<span class="rc-dice">2D6 3 + 4 = 7</span>');
    expect(h).toContain('<div class="rc-title">[Hall &lt;b&gt;]</div>');
    expect(h).toContain("<dt>Exits</dt><dd>[2]</dd>");
    expect(h).toContain('data-f="7 Hall &lt;b&gt; 2"');
    expect(String(rollHtml({ ...roll, matched: false }, inline, follow))).toContain("L1R: rolled 7, no matching row.");
  });
  it("draws saved doors", () => {
    const o = { inline, followButtons: follow, patrol: "L1P" };
    expect(String(doorHtml({ k: "door", kind: "Wooden", value: 6, locked: true, marked: true }, o))).toContain("Marked L on the map.");
    const pick: DoorNote = { k: "pick", q: 7, mod: -2, quality: 5, a: 3, prec: 1, pick: 0, total: 4, ok: false };
    expect(String(doorHtml(pick, o))).toContain('data-follow="L1P|0"');
    expect(String(doorHtml(pick, { ...o, patrol: null }))).not.toContain("data-follow");
    expect(String(doorHtml({ k: "slab", value: 5, disc: 1 }, o))).toContain("It tips over!");
    expect(String(doorHtml({ k: "roll", roll }, o))).toContain("Hall &lt;b&gt;");
  });
  it("an old markup string is plain text; tampered shapes never throw or make markup", () => {
    expect(String(rollHtml(`<b>x</b>${XSS}`, inline, follow))).toBe('<div class="rc-text">x</div>');
    expect(String(doorHtml(XSS, { inline, followButtons: follow, patrol: null }))).not.toContain("<img");
    for (const t of tampered) {
      safe(rollHtml(t as SavedRoll, inline, follow));
      safe(doorHtml(t as DoorNote, { inline, followButtons: follow, patrol: "L1P" }));
    }
  });
});

describe("realm saved notes with tampered shapes", () => {
  it("never throw or make markup", () => {
    for (const t of tampered) {
      safe(rollNoteHtml(t as RollNote, inline));
      safe(encounterHtml(t as EncounterNote, inline));
      safe(ownerNoteHtml(t as OwnerNote, inline));
    }
  });
});

describe("combat log depth", () => {
  it("stops drawing nested nodes past 8 levels", () => {
    let n: LogNode = "deep";
    for (let i = 0; i < 50; i++) n = { el: "em", kids: [n] };
    const h = String(logHtml({ r: 1, n: [n] }, inline));
    expect(h.match(/<em>/g)?.length).toBe(8);
    expect(h).not.toContain("deep");
    safe(logHtml({ r: 1, n: "x" } as unknown as LogEntry, inline));
  });
});
