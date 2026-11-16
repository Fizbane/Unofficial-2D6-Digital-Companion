import { describe, it, expect } from "vitest";
import { button, card, chip, statBlock, tabsBar, resultCard, splitResultTitle } from "../src/ui/components";
import type { ResultCard } from "../src/shell/types";
import { html } from "../src/ui/html";

describe("ui components", () => {
  it("escape plain-text inputs and pass attrs raw", () => {
    const b = String(button("<b>", { variant: "primary", size: "sm", attrs: html`data-x="1"` }));
    expect(b).toContain('class="btn btn-primary btn-sm"');
    expect(b).toContain('data-x="1"');
    expect(b).toContain("&lt;b&gt;");
    expect(String(card(html`<p>x</p>`, { title: "A&B", tone: "accent" }))).toContain('<h3 class="card-title">A&amp;B</h3>');
    expect(String(chip("Feint", { value: "2", active: true }))).toContain('aria-pressed="true"');
    expect(String(statBlock([["HP", "<3"]]))).toBe('<dl class="stat-block"><div><dt>HP</dt><dd>&lt;3</dd></div></dl>');
  });

  it("tabsBar marks the active tab", () => {
    const t = String(tabsBar([{ id: "a", label: "A" }, { id: "b", label: "B" }], "b"));
    expect(t).toContain('data-tab="a" aria-selected="false"');
    expect(t).toContain('data-tab="b" aria-selected="true"');
  });

  it("resultCard renders anatomy, follow-ons and children", () => {
    const at = new Date(2026, 10, 10, 9, 5).getTime();
    const c: ResultCard = {
      id: "r1", at, eyebrow: "ENAT1 · <Enc>", title: "Goblin", text: "", dice: "2D6: 4 + 5 = 9",
      follow: [{ key: "HST1", modifier: -1, label: "Roll on HST1 −1" }],
    };
    const h = String(resultCard(c, (s) => html`[${s}]`, html`<i>child</i>`));
    expect(h).toContain("ENAT1 · &lt;Enc&gt;");
    expect(h).toContain('<div class="rc-title">[Goblin]</div>');
    expect(h).not.toContain("rc-text");
    expect(h).toContain(">09:05</time>");
    expect(h).toContain('data-follow="HST1|-1"');
    expect(h).toContain('data-to-notes="r1"');
    expect(h).toContain('<div class="rc-children"><i>child</i></div>');
  });

  it("resultCard shows the context line and links the table's section", () => {
    const c: ResultCard = {
      id: "r2", at: 0, eyebrow: "L1R · Rooms", title: "Hall", text: "", dice: "", follow: [],
      sectionId: "codex/l1r", context: "Level 3 · room <2>",
    };
    const h = String(resultCard(c, (s) => html`${s}`));
    expect(h).toContain('<div class="rc-context">Level 3 · room &lt;2&gt;</div>');
    expect(h).toContain('href="#/s/codex%2Fl1r"');
    expect(h).toContain('data-open-section="codex/l1r"');
    const bare = String(resultCard({ ...c, sectionId: undefined, context: undefined }, (s) => html`${s}`));
    expect(bare).not.toContain("rc-context");
    expect(bare).not.toContain("data-open-section");
  });
});

describe("splitResultTitle (render-time split of long result titles)", () => {
  it("splits a caps label off before a dash", () => {
    const r = splitResultTitle("ARCHAEOLOGY – Over the season a farmer keeps digging up odd green coins in one field. Nobody claims them.");
    expect(r).toEqual({ title: "ARCHAEOLOGY", rest: "Over the season a farmer keeps digging up odd green coins in one field. Nobody claims them.", long: false });
  });
  it("splits a caps label before a spaced hyphen", () => {
    const r = splitResultTitle("ROVING TINKER - A tinker with a squeaky cart turns up at the gate wanting odd jobs.");
    expect(r.title).toBe("ROVING TINKER");
    expect(r.rest).toBe("A tinker with a squeaky cart turns up at the gate wanting odd jobs.");
    expect(r.long).toBe(false);
  });
  it("flags a long sentence with no label as long and keeps it whole", () => {
    const t = "The clerk squints at the letter, turns it over twice, then folds it into a tiny square. He says nothing at all.";
    expect(splitResultTitle(t)).toEqual({ title: t, long: true });
  });
  it("leaves a short title untouched", () => {
    expect(splitResultTitle("OVERGROWN CHASM")).toEqual({ title: "OVERGROWN CHASM", long: false });
    expect(splitResultTitle("Locked! – roll again")).toEqual({ title: "Locked! – roll again", long: false });
  });
  it("resultCard renders the split label, the rest as text, and is-long", () => {
    const base = { id: "r1", at: 0, eyebrow: "E", text: "", dice: "", follow: [] } as unknown as ResultCard;
    const a = String(resultCard({ ...base, title: "ROVING TINKER - A tinker with a squeaky cart turns up at the gate wanting odd jobs." }, (s) => html`${s}`));
    expect(a).toContain('<div class="rc-title">ROVING TINKER</div><div class="rc-text">A tinker with a squeaky');
    const b = String(resultCard({ ...base, title: "The clerk squints at the letter, turns it over twice, then folds it into a tiny square." }, (s) => html`${s}`));
    expect(b).toContain('class="rc-title is-long"');
  });
});
