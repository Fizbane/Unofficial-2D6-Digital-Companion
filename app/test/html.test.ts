import { describe, expect, it } from "vitest";
import { esc, html, joinHtml, raw, Raw, setHTML } from "../src/ui/html";

describe("html``", () => {
  it("escapes interpolated text", () => {
    expect(String(html`<b>${"<i>"}</b>`)).toBe("<b>&lt;i&gt;</b>");
  });

  it("does not escape a nested Raw twice", () => {
    const inner = html`<i>${"a & b"}</i>`;
    expect(String(html`<b>${inner}</b>`)).toBe("<b><i>a &amp; b</i></b>");
    expect(String(html`${html`${html`${"<"}`}`}`)).toBe("&lt;");
  });

  it("escapes both quote kinds, for attribute contexts", () => {
    expect(String(html`<a title="${`"x" 'y'`}" data-v='${"'"}'>`)).toBe(
      `<a title="&quot;x&quot; &#39;y&#39;" data-v='&#39;'>`,
    );
  });

  it("joins arrays, escaping their strings and keeping their Raw", () => {
    expect(String(html`<ul>${["<a>", html`<li>x</li>`, 3]}</ul>`)).toBe("<ul>&lt;a&gt;<li>x</li>3</ul>");
    expect(String(html`${[[html`<p>`, ["&"]]]}`)).toBe("<p>&amp;");
  });

  it("renders numbers and drops null, undefined and false", () => {
    expect(String(html`${0}|${1.5}|${null}|${undefined}|${false}|${""}`)).toBe("0|1.5||||");
  });

  it("returns Raw, which stringifies to its markup", () => {
    const h = html`<p>${"x"}</p>`;
    expect(h).toBeInstanceOf(Raw);
    expect(`${h}`).toBe("<p>x</p>");
    expect(h.toString()).toBe("<p>x</p>");
  });
});

describe("raw, joinHtml, esc", () => {
  it("raw keeps a trusted string as markup", () => {
    expect(String(html`<div>${raw("<br>")}</div>`)).toBe("<div><br></div>");
  });

  it("joinHtml joins with an escaped separator", () => {
    expect(String(joinHtml([html`<b>1</b>`, "<2>"], html`<br>`))).toBe("<b>1</b><br>&lt;2&gt;");
    expect(String(joinHtml(["a", "b"], " & "))).toBe("a &amp; b");
  });

  it("esc escapes & < > \" ' and is null-safe", () => {
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(esc(undefined)).toBe("");
    expect(esc(7)).toBe("7");
  });
});

describe("setHTML", () => {
  it("assigns the markup", () => {
    const el = { innerHTML: "" } as unknown as Element;
    setHTML(el, html`<p>${"<x>"}</p>`);
    expect(el.innerHTML).toBe("<p>&lt;x&gt;</p>");
  });

  it("refuses a plain string", () => {
    const el = { innerHTML: "" } as unknown as Element;
    expect(() => setHTML(el, "<img src=x onerror=alert(1)>" as unknown as Raw)).toThrow(TypeError);
    expect(el.innerHTML).toBe("");
  });
});
