// The dialog itself needs a DOM (checked in the app); what a typed answer means as a number is pure.
import { describe, expect, it } from "vitest";
import { parseWhole } from "../src/ui/ask";

describe("parseWhole", () => {
  it("reads whole numbers, signs included", () => {
    expect(parseWhole("-2")).toBe(-2);
    expect(parseWhole(" +3 ")).toBe(3);
    expect(parseWhole("−1")).toBe(-1); // the minus sign as the books print it
    expect(parseWhole("0")).toBe(0);
  });
  it("is null for a cancelled dialog and for anything that isn't a whole number", () => {
    expect(parseWhole(null)).toBeNull();
    expect(parseWhole("")).toBeNull();
    expect(parseWhole("2.5")).toBeNull();
    expect(parseWhole("abc")).toBeNull();
  });
});
