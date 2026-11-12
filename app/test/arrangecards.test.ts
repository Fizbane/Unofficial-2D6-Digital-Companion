import { describe, it, expect } from "vitest";
import { moveTo, nudge, orderIds } from "../src/shell/arrangecards";

describe("card arrangement", () => {
  it("keeps the saved order and appends new cards", () => {
    expect(orderIds(["a", "b", "c"], ["c", "x", "a"])).toEqual(["c", "a", "b"]);
    expect(orderIds(["a", "b"], undefined)).toEqual(["a", "b"]);
  });
  it("nudges and drags", () => {
    expect(nudge(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(nudge(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveTo(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveTo(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });
});
