import { describe, it, expect } from "vitest";
import { gated, overrideOf, resetEncounter, undoTurnWarning } from "../src/tools/common";
import { button } from "../src/ui/components";
import { html } from "../src/ui/html";

const o = () => ({ variant: "primary" as const, attrs: html`data-act="finish"` });
const btn = () => button("Finish room 2", o());

describe("gated", () => {
  it("leaves an unblocked button as it is", () => {
    expect(String(gated("Finish room 2", o(), null, "finish"))).toBe(String(btn()));
  });

  it("disables a blocked button, says why and offers a one-shot override", () => {
    const h = String(gated("Finish room 2", o(), "Roll <the> exits first", "finish"));
    expect(h).toMatch(/<button [^>]*data-act="finish" disabled>/);
    expect(h).not.toContain("btn-primary"); // a blocked action is not the next thing to do
    expect(h).toContain('<span class="gated-why muted">Roll &lt;the&gt; exits first</span>');
    expect(h).toContain('<button type="button" class="gated-over" data-override="finish">Do it anyway</button>');
  });

  it("overrideOf names the overridden action only for the override control", () => {
    const over = { closest: (s: string) => (s === ".gated-over" ? { getAttribute: () => "finish" } : null) };
    const other = { closest: () => null };
    expect(overrideOf(over as unknown as EventTarget)).toBe("finish");
    expect(overrideOf(other as unknown as EventTarget)).toBeNull();
    expect(overrideOf(null)).toBeNull();
  });
});

describe("resetEncounter", () => {
  it("a re-rolled room starts its encounter over: not dealt with, not fought, no rolls", () => {
    const d = { n: 2, encDone: true, fought: true, results: [{ label: "x" }], byBook: { type: true } };
    resetEncounter(d);
    expect(d).toEqual({ n: 2, results: [], byBook: { type: true } });
  });
});

describe("undoTurnWarning", () => {
  it("names the room, says it isn't in the rules and is there for mistakes, and what it doesn't put back", () => {
    const w = undoTurnWarning(3);
    expect(w).toContain("room 3");
    expect(w).toMatch(/isn't in the rules/);
    expect(w).toMatch(/mistake/);
    expect(w).toMatch(/HP|rations/);
  });
});
