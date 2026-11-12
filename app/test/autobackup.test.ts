import { describe, expect, it } from "vitest";
import { BACKUP_CONFIG_KEY, BACKUP_KEEP, backupFileName, backupJson, filesToDelete, isBackupFile, parseBackup, snapshotData, snapshotHash } from "../src/shell/autobackup";
import { ago } from "../src/ui/backupui";

const fakeLs = (o: Record<string, string>) => {
  const keys = Object.keys(o);
  return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => o[k] ?? null };
};

describe("backup files", () => {
  it("names files by local time so they sort oldest to newest", () => {
    const a = backupFileName(new Date(2026, 10, 12, 0, 15, 30));
    expect(a).toBe("2d6-companion-backup-2026-11-12-001530.json");
    expect(isBackupFile(a)).toBe(true);
    expect(isBackupFile("holiday-photos.json")).toBe(false);
    expect(backupFileName(new Date(2026, 10, 12, 9, 0, 0)) < backupFileName(new Date(2026, 10, 12, 10, 0, 0))).toBe(true);
  });

  it("keeps the newest 10 and never touches other files", () => {
    const names = Array.from({ length: 13 }, (_, i) => backupFileName(new Date(2026, 10, 12, 8, i, 0)));
    const gone = filesToDelete([...names, "notes.txt", "my-save.json"]);
    expect(gone).toEqual(names.slice(0, 3));
    expect(filesToDelete(names.slice(0, BACKUP_KEEP))).toEqual([]);
    expect(filesToDelete([])).toEqual([]);
  });
});

describe("what is backed up", () => {
  it("takes the 2d6 keys of both games, not content and not its own settings", () => {
    const ls = fakeLs({
      "2d6:play:character": "{}", "2d6v:play:vsheet": "{}", "2d6:fixes": "[]", "2d6:content:x": "secret",
      [BACKUP_CONFIG_KEY]: "{}", "other-site": "x",
    });
    expect(Object.keys(snapshotData(ls)).sort()).toEqual(["2d6:fixes", "2d6:play:character", "2d6v:play:vsheet"]);
  });

  it("changes the fingerprint when anything changes, and not otherwise", () => {
    const a = { "2d6:a": "1", "2d6:b": "2" };
    expect(snapshotHash(a)).toBe(snapshotHash({ "2d6:b": "2", "2d6:a": "1" }));
    expect(snapshotHash(a)).not.toBe(snapshotHash({ ...a, "2d6:b": "3" }));
    expect(snapshotHash(a)).not.toBe(snapshotHash({ ...a, "2d6:c": "" }));
  });

  it("writes a file the importer accepts, and refuses a foreign one", () => {
    const data = { "2d6:play:character": '{"name":"Aria"}' };
    expect(parseBackup(backupJson(data)).data).toEqual(data);
    expect(() => parseBackup(JSON.stringify({ app: "other", data: {} }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ app: "2d6-companion", data: { "evil:key": "x" } }))).toThrow();
  });
});

describe("plain-words time", () => {
  it("reads naturally", () => {
    const now = 1_700_000_000_000;
    expect(ago(0, now)).toBe("never");
    expect(ago(now - 10_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(ago(now - 60 * 60_000, now)).toBe("1 hour ago");
  });
});
