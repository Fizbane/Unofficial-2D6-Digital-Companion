import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../src/shell/events";

interface TestEvents {
  ping: { n: number };
  other: string;
}

describe("EventBus", () => {
  it("delivers the payload to a listener", () => {
    const bus = new EventBus<TestEvents>();
    const got: number[] = [];
    bus.on("ping", (p) => got.push(p.n));
    bus.emit("ping", { n: 7 });
    expect(got).toEqual([7]);
  });

  it("stops delivery after unsubscribe", () => {
    const bus = new EventBus<TestEvents>();
    const got: number[] = [];
    const off = bus.on("ping", (p) => got.push(p.n));
    bus.emit("ping", { n: 1 });
    off();
    bus.emit("ping", { n: 2 });
    expect(got).toEqual([1]);
  });

  it("keeps running other listeners when one throws", () => {
    const bus = new EventBus<TestEvents>();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const got: string[] = [];
    bus.on("other", () => {
      throw new Error("boom");
    });
    bus.on("other", (p) => got.push(p));
    bus.emit("other", "hi");
    expect(got).toEqual(["hi"]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
