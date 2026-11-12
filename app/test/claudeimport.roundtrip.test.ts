// Round trip on the real files: to-do for unverified rows, a pack filled from the true text, import, verify.
// Skipped when the book files are absent (they are never committed). Prints counts only, never book text.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { initContent, getContent } from "../src/content";
import { digestFile } from "../src/lock/hash";
import { fieldsOf, rebuildSection } from "../src/lock/rebuild";
import { forgetAll, getSections } from "../src/lock/store";
import { addUnlocked, manifest } from "../src/content";
import { applyPack, makeTodo, validatePack } from "../src/lock/todo";

const nodeMod = (m: string) => import(/* @vite-ignore */ m);
const { existsSync, readFileSync } = await nodeMod("node:fs");
const { resolve, dirname } = await nodeMod("node:path");
const { fileURLToPath } = await nodeMod("node:url");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PDF = resolve(root, "books", "2D6_Dungeon_Tables_Codex_Backers_Version_for_Tablet.pdf");
const MAN = resolve(root, "app", "public", "data", "manifest.json");
const LIB = resolve(root, "pipeline", "work", "library-full.json");
const IDS = resolve(root, "pipeline", "work", "id-map.json");
const have = [PDF, MAN, LIB, IDS].every((p: string) => existsSync(p));

describe.skipIf(!have)("Claude-assisted import round trip (real files)", () => {
  it("verifies unverified rows filled from the true text", async () => {
    const { fp, key } = await digestFile(new Blob([readFileSync(PDF)]));
    const man = JSON.parse(readFileSync(MAN, "utf8"));
    const ed = man.books.find((b: { slug: string }) => b.slug === "codex").editions.find((e: { fp: string }) => e.fp === fp)?.id;
    expect(ed).toBeTruthy();
    await forgetAll();
    await initContent(async (p) => (p.endsWith("manifest.json") ? man : { books: [], sections: [] }));

    // Seeds EVERY hashed field of every codex section as unverified (nothing read), so any cell can be picked.
    const skels = manifest().sections.filter((s) => s.book === "codex");
    await addUnlocked(skels.map((s) => rebuildSection(s, ed, new Map())));

    const lib = JSON.parse(readFileSync(LIB, "utf8")) as { sections: { id: string; blocks: { type: string; table?: { rows: string[][] } }[] }[] };
    const idMap = JSON.parse(readFileSync(IDS, "utf8")) as Record<string, string>;
    const truth = new Map<string, Map<string, string>>();             // new section id -> field id -> true text
    for (const s of lib.sections) {
      const nid = idMap[s.id];
      const sk = nid && skels.find((k) => k.id === nid);
      if (!sk) continue;
      const m = new Map<string, string>();
      for (const f of fieldsOf(sk)) {
        const b = s.blocks[f.block];
        if (f.field === "cell" && b?.type === "table") m.set(`${sk.id}#cell:${f.block}:${f.row}:${f.col}`, b.table!.rows[f.row]?.[f.col] ?? "");
      }
      truth.set(sk.id, m);
    }

    const todo = makeTodo("codex", ed, "unverified");
    expect(JSON.stringify(todo)).not.toMatch(/"text":/);
    const pick = todo.items.filter((i) => i.id.includes("#cell:") && truth.get(i.id.split("#")[0])?.get(i.id)).slice(0, 3);
    expect(pick).toHaveLength(3);
    const pack = validatePack({ book: "codex", edition: ed, items: pick.map((i) => ({ id: i.id, text: truth.get(i.id.split("#")[0])!.get(i.id)! })) });

    const before = new Map((await getSections()).map((s) => [s.section.id, s.unverified.length]));
    const r = await applyPack(pack, key);
    console.log(`round trip (seeded with all hashed fields unverified): to-do ${todo.items.length} items, picked 3 (pages ${pick.map((i) => i.page)}, rotate ${pick.map((i) => i.rotate)}), accepted ${r.accepted}, mismatched ${r.mismatched.length}, unknown ${r.unknown}`);
    expect(r.accepted).toBe(3);
    for (const i of pick) {
      const sid = i.id.split("#")[0];
      const k = i.id.split("#")[1].replace("cell:", "");
      const un = (await getSections()).find((s) => s.section.id === sid)!.unverified;
      expect(un).not.toContain(k);
      expect(getContent(sid)?.ok && getContent(sid)).toBeTruthy();
    }
    for (const sid of new Set(pick.map((i) => i.id.split("#")[0]))) {
      expect((await getSections()).find((s) => s.section.id === sid)!.unverified.length).toBeLessThan(before.get(sid)!);
    }
  }, 120_000);
});
