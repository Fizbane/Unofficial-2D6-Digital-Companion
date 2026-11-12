// The generated Void library (pipeline/build.py --game void) names sections by opaque ids (void/p<page>-<n>), as the
// Void tools do. These tests also name sections by title slug; this registers each section under both ids, using
// the private pipeline/work/id-map-void.json that the same build writes (absent: slugs stay unresolved).
import type { Section } from "../../src/types";

const files = import.meta.glob("../../../pipeline/work/id-map-void.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const text = Object.values(files)[0];
const slugToOpaque: Record<string, string> = text ? JSON.parse(text) : {};

export const opaqueId = (slug: string): string => slugToOpaque[slug] ?? slug;

export function registerBoth(byId: Map<string, Section>, sections: Section[]): void {
  byId.clear();
  for (const s of sections) byId.set(s.id, s);
  for (const [slug, id] of Object.entries(slugToOpaque)) {
    const s = byId.get(id);
    if (s) byId.set(slug, s);
  }
}
