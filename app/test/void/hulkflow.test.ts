import { describe, it, expect } from "vitest";
import { voidCurStep, voidFinishBlock, type VoidFlowDraft } from "../../src/tools/void/hulkmodel";

const d = (o: Partial<VoidFlowDraft> = {}): VoidFlowDraft => ({ kind: "regular", chain: false, hasRoom: true, exits: 2, encDone: true, ...o });

describe("voidFinishBlock", () => {
  it("names the first unfinished step, exits before room type as the book rolls them", () => {
    expect(voidFinishBlock(d({ exits: undefined, hasRoom: false, encDone: false }))).toBe("Roll the exits first");
    expect(voidFinishBlock(d({ hasRoom: false, encDone: false }))).toBe("Roll the room type first");
    expect(voidFinishBlock(d({ encDone: false }))).toBe("Deal with the encounter first");
    expect(voidFinishBlock(d())).toBeNull();
  });
  it("a corridor needs only its exits; the entrance needs nothing", () => {
    expect(voidFinishBlock(d({ kind: "corridor", hasRoom: false, encDone: false }))).toBeNull();
    expect(voidFinishBlock(d({ kind: "corridor", hasRoom: false, encDone: false, exits: undefined }))).toBe("Roll the exits first");
    expect(voidFinishBlock(d({ kind: "entrance", hasRoom: false, encDone: false, exits: undefined }))).toBeNull();
  });
  it("a Level 10 chain room has its one exit placed for it", () => {
    expect(voidFinishBlock(d({ chain: true, exits: undefined }))).toBeNull();
    expect(voidFinishBlock(d({ chain: true, exits: undefined, hasRoom: false }))).toBe("Roll the room type first");
  });
  it("a room type rolled in the printed book counts", () => {
    expect(voidFinishBlock(d({ hasRoom: false, byBook: { type: true } }))).toBeNull();
  });
});

describe("voidCurStep", () => {
  const c = (o: Partial<Parameters<typeof voidCurStep>[0]> = {}) => voidCurStep({ kind: "regular", chain: false, hasRoom: false, ...o });
  it("goes exits, room type, encounter, finish", () => {
    expect(c()).toBe("exits");
    expect(c({ exits: 2 })).toBe("type");
    expect(c({ exits: 2, hasRoom: true })).toBe("enc");
    expect(c({ exits: 2, hasRoom: true, encDone: true })).toBe("finish");
    expect(c({ exits: 2, byBook: { type: true } })).toBe("enc");
  });
  it("a level 9 small room rolls SSRT1 first: it resizes the room, so exits rolled before it would be thrown away", () => {
    expect(c({ kind: "small", ssrtPending: true })).toBe("type");
    expect(c({ kind: "small", ssrtPending: true, exits: 1 })).toBe("type");
    expect(c({ kind: "regular", ssrtPending: false })).toBe("exits");
  });
  it("the entrance, corridors and chain rooms", () => {
    expect(c({ kind: "entrance" })).toBe("finish");
    expect(c({ kind: "corridor" })).toBe("exits");
    expect(c({ kind: "corridor", exits: 1 })).toBe("finish");
    expect(c({ chain: true })).toBe("type");
  });
});
