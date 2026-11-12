import { describe, it, expect } from "vitest";
import { isTypingTarget } from "../src/shell/overlays";

describe("isTypingTarget", () => {
  const t = (o: object): EventTarget => o as unknown as EventTarget;
  it("is true for form fields and contenteditable", () => {
    expect(isTypingTarget(t({ tagName: "DIV", isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(t({ tagName: "TEXTAREA" }))).toBe(true);
    expect(isTypingTarget(t({ tagName: "input" }))).toBe(true);
    expect(isTypingTarget(t({ tagName: "SELECT" }))).toBe(true);
  });
  it("is false otherwise", () => {
    expect(isTypingTarget(t({ tagName: "BUTTON" }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
