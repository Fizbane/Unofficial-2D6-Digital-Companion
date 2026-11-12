import { describe, expect, it } from "vitest";
import { compareVersions, isNewer } from "../src/shell/version";
import { AUTO_EVERY_MS, autoCheckDue, getUpdatePrefs, setUpdatePrefs, statusFromGit, UPDATES_KEY } from "../src/shell/updates";
import { allowed, gitCheck, gitUpdate, type Git } from "../scripts/vite-update";

describe("compareVersions", () => {
  it("compares part by part, numerically", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
    expect(compareVersions("v1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBe(0);
    expect(isNewer("2", "1.99.99")).toBe(true);
  });
});

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("update prefs", () => {
  it("default to checking automatically, never checked", () => {
    expect(getUpdatePrefs(mem())).toEqual({ auto: true, last: 0 });
    expect(getUpdatePrefs(mem({ [UPDATES_KEY]: "not json" }))).toEqual({ auto: true, last: 0 });
  });
  it("save a patch and keep the rest", () => {
    const kv = mem();
    setUpdatePrefs({ last: 5 }, kv);
    setUpdatePrefs({ auto: false }, kv);
    expect(getUpdatePrefs(kv)).toEqual({ auto: false, last: 5 });
  });
  it("an automatic check is due once a day, and never when turned off", () => {
    const now = 10 * AUTO_EVERY_MS;
    expect(autoCheckDue({ auto: true, last: 0 }, now)).toBe(true);
    expect(autoCheckDue({ auto: true, last: now - 1000 }, now)).toBe(false);
    expect(autoCheckDue({ auto: true, last: now - AUTO_EVERY_MS }, now)).toBe(true);
    expect(autoCheckDue({ auto: false, last: 0 }, now)).toBe(false);
  });
});

describe("statusFromGit", () => {
  it("maps the endpoint's answer", () => {
    expect(statusFromGit({ how: "git", current: "0.1.0", latest: "0.2.0", available: true, canUpdate: true })).toEqual({ s: "available", latest: "0.2.0", canUpdate: true, reason: undefined });
    expect(statusFromGit({ how: "git", current: "0.2.0", latest: "0.2.0", available: false, canUpdate: false })).toEqual({ s: "current" });
    expect(statusFromGit({ how: "git", current: "0.2.0", available: false, canUpdate: false, reason: "offline" })).toEqual({ s: "error", message: "offline" });
  });
});

/** A fake git: answers by the first argument(s); a function value can throw. */
function fakeGit(o: { top?: string | null; upstream?: string | null; fetchFails?: boolean; remoteVersion?: string; dirty?: boolean; ahead?: number; changed?: string[] } = {}) {
  const calls: string[][] = [];
  const git: Git = async (args) => {
    calls.push(args);
    const [a, b] = args;
    if (a === "rev-parse" && b === "--show-toplevel") { if (o.top === null) throw new Error("not a repo"); return o.top ?? "C:/Projects/2D6"; }
    if (a === "rev-parse" && b === "--abbrev-ref") { if (o.upstream === null) throw new Error("no upstream"); return o.upstream ?? "origin/master"; }
    if (a === "rev-parse" && b === "HEAD") return "abc";
    if (a === "fetch") { if (o.fetchFails) throw new Error("offline"); return ""; }
    if (a === "show") return JSON.stringify({ version: o.remoteVersion ?? "0.2.0" });
    if (a === "status") return o.dirty ? " M app/src/main.ts" : "";
    if (a === "rev-list") return String(o.ahead ?? 0);
    if (a === "pull") return "";
    if (a === "diff") return (o.changed ?? []).join("\n");
    throw new Error("unexpected git " + args.join(" "));
  };
  return { git, calls };
}
const APP = "C:/Projects/2D6/app";

describe("gitCheck", () => {
  it("finds a newer version on the upstream branch, reading app/package.json there", async () => {
    const { git, calls } = fakeGit();
    expect(await gitCheck(git, APP, "0.1.0")).toEqual({ how: "git", current: "0.1.0", latest: "0.2.0", available: true, canUpdate: true, reason: undefined });
    expect(calls).toContainEqual(["show", "origin/master:app/package.json"]);
    expect(calls).toContainEqual(["fetch", "--quiet"]);
  });
  it("says current when the versions match", async () => {
    const { git } = fakeGit({ remoteVersion: "0.1.0" });
    const r = await gitCheck(git, APP, "0.1.0");
    expect(r).toMatchObject({ available: false, canUpdate: false });
    expect(r.reason).toBeUndefined();
  });
  it("won't update over local edits or local commits", async () => {
    expect(await gitCheck(fakeGit({ dirty: true }).git, APP, "0.1.0")).toMatchObject({ available: true, canUpdate: false, reason: expect.stringMatching(/changes of its own/) });
    expect(await gitCheck(fakeGit({ ahead: 2 }).git, APP, "0.1.0")).toMatchObject({ available: true, canUpdate: false, reason: expect.stringMatching(/commits/) });
  });
  it("explains a copy that isn't a clone, has no upstream, or is offline", async () => {
    expect((await gitCheck(fakeGit({ top: null }).git, APP, "0.1.0")).reason).toMatch(/wasn't cloned/);
    expect((await gitCheck(fakeGit({ upstream: null }).git, APP, "0.1.0")).reason).toMatch(/isn't following/);
    expect((await gitCheck(fakeGit({ fetchFails: true }).git, APP, "0.1.0")).reason).toMatch(/Couldn't reach GitHub/);
  });
});

describe("gitUpdate", () => {
  it("pulls fast-forward only, and says when npm install is needed", async () => {
    const { git, calls } = fakeGit({ changed: ["app/src/main.ts", "app/package-lock.json"] });
    expect(await gitUpdate(git, APP, "0.1.0")).toEqual({ updated: "0.2.0", needsInstall: true });
    expect(calls).toContainEqual(["pull", "--ff-only", "--quiet"]);
  });
  it("refuses when it isn't safe, without pulling", async () => {
    const { git, calls } = fakeGit({ dirty: true });
    await expect(gitUpdate(git, APP, "0.1.0")).rejects.toThrow(/changes of its own/);
    expect(calls.some((c) => c[0] === "pull")).toBe(false);
  });
});

describe("update endpoint guard", () => {
  const host = "localhost:5173";
  it("needs the header", () => {
    expect(allowed({ host })).toBe(false);
    expect(allowed({ host, "x-2d6-update": "1" })).toBe(true);
  });
  it("refuses other sites", () => {
    expect(allowed({ host, "x-2d6-update": "1", origin: "http://localhost:5173", "sec-fetch-site": "same-origin" })).toBe(true);
    expect(allowed({ host, "x-2d6-update": "1", origin: "http://localhost:3000" })).toBe(false);
    expect(allowed({ host, "x-2d6-update": "1", "sec-fetch-site": "cross-site" })).toBe(false);
  });
});
