// Saved play state (localStorage, or an imported backup) holds data, never markup: what was saved as
// markup by an older version is shown as plain text, and saved data is escaped when drawn.
import { describe, expect, it } from "vitest";
import { logHtml, type LogEntry } from "../src/tools/combat";
import { encounterHtml, ownerNoteHtml, rollNoteHtml, type RollNote } from "../src/tools/realm";
import { html } from "../src/ui/html";

const inline = (s: string) => html`[${s}]`;
const XSS = `<img src=x onerror="alert(1)">`;

describe("combat log entries", () => {
  it("draws a saved entry with only its own elements and classes, text escaped", () => {
    const e: LogEntry = { r: 2, n: ["You ", { el: "strong", cls: "tone-miss", kids: [{ icon: "circle-x" }, " miss <b>"] }, ": ", { book: "Bite" }] };
    const h = String(logHtml(e, inline));
    expect(h).toContain('<span class="muted">R2</span> You <strong class="tone-miss"><svg class="icon"');
    expect(h).toContain(" miss &lt;b&gt;</strong>: [Bite]");
  });

  it("an old markup entry, or tampered data, never becomes markup", () => {
    expect(String(logHtml(XSS, inline))).not.toContain("<img");
    const bad = { r: "1<x>", n: [{ el: "script", kids: [XSS] }, { el: "em", cls: 'x" onclick="y', kids: ["t"] }, { icon: "nope" }, 7] } as unknown as LogEntry;
    const h = String(logHtml(bad, inline));
    expect(h).not.toMatch(/<script|<img|onclick|<x>/);
    expect(h).toContain("&lt;img");
    expect(h).toContain("<em>t</em>");
  });
});

describe("realm explore notes", () => {
  const roll: RollNote = { title: "LAIT1", dice: "2D6 3 + 4 = 7", mod: -2, value: 5, rows: [["Owner", "Lord <X>"]] };

  it("draws saved rolls and notes, escaping their text", () => {
    expect(String(rollNoteHtml(roll, inline))).toContain("<strong>LAIT1</strong> <span class=\"log-roll\">2D6 3 + 4 = 7 -2 → 5</span>");
    expect(String(rollNoteHtml(roll, inline))).toContain("<dt>Owner</dt><dd>[Lord &lt;X&gt;]</dd>");
    expect(String(rollNoteHtml({ ...roll, rows: null }, inline))).toBe('<span class="muted">LAIT1: 5, no matching row.</span>');
    const enc = String(encounterHtml({ dice: "4 + 5 = 9", value: 9, land: "FOREST", text: "A <b>bear</b>", rolls: [roll] }, inline));
    expect(enc).toContain("<strong>2D6: 4 + 5 = 9</strong>");
    expect(enc).toContain("[A &lt;b&gt;bear&lt;/b&gt;]");
    expect(enc).toContain("Read from the book's FOREST entry.");
    expect(String(ownerNoteHtml({ value: 2, owned: true, roll }, inline))).toContain("Rolled 2: <strong>already owned</strong>.<br><strong>LAIT1</strong>");
  });

  it("an older saved markup note is shown as its plain text only", () => {
    const old = `<strong>2D6: 3</strong><p>Wolves ${XSS}</p>`;
    const h = String(encounterHtml(old, inline));
    expect(h).not.toContain("<");
    expect(String(ownerNoteHtml(`Rolled 1: <strong>already owned</strong>.${XSS}`, inline))).not.toContain("<");
  });
});
