import { describe, expect, it } from "vitest";
import { SUPPORT_GAP_MS, supportDue } from "../src/ui/supportnote";

describe("the support popup's timing", () => {
  const t = 1_800_000_000_000;
  it("shows the first time", () => {
    expect(supportDue(null, t)).toBe(true);
  });
  it("waits 5 hours after it shows", () => {
    expect(supportDue(t, t + 60_000)).toBe(false);
    expect(supportDue(t, t + SUPPORT_GAP_MS - 1)).toBe(false);
    expect(supportDue(t, t + SUPPORT_GAP_MS)).toBe(true);
  });
  it("shows again if the saved time is unreadable or in the future", () => {
    expect(supportDue(Number.NaN, t)).toBe(true);
    expect(supportDue(t + 1000, t)).toBe(true);
  });
});
