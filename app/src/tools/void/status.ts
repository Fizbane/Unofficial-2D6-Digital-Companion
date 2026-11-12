// 2D6 Void's top-bar status: the hulk level and room count while an expedition is under way.
import { hasSaved, load } from "../common";
import type { IconName } from "../../ui/icon";

interface HulkLike { level: number; rooms: unknown[] }

interface SheetLike { name?: string; profession?: string; level?: number; hp?: number }

/** Continue cards for the Void dashboard: the expedition and the survivor, when saved. */
export function voidContinue(): { href: string; icon: IconName; title: string; line: string }[] {
  const out: { href: string; icon: IconName; title: string; line: string }[] = [];
  if (hasSaved("vhulk")) {
    const h = load<HulkLike>("vhulk", { level: 1, rooms: [] });
    if (h.rooms.length) out.push({ href: "#/play/vhulk", icon: "door-closed", title: "Dark Hulk", line: `Level ${h.level} · ${h.rooms.length} room${h.rooms.length === 1 ? "" : "s"} explored` });
  }
  if (hasSaved("vsheet")) {
    const c = load<SheetLike>("vsheet", {});
    if (c.name || c.profession) out.push({ href: "#/play/vsheet", icon: "user", title: c.name || "Survivor", line: [c.profession, c.level ? `level ${c.level}` : "", c.hp !== undefined ? `${c.hp} HP` : ""].filter(Boolean).join(" · ") });
  }
  return out;
}

export function voidStatus(route: string | null): { text: string; target: string; title: string } | null {
  if (route === "#/play/vhulk" || !hasSaved("vhulk")) return null;
  const h = load<HulkLike>("vhulk", { level: 1, rooms: [] });
  if (!h.rooms.length) return null;
  return { text: `Dark Hulk L${h.level} · ${h.rooms.length} room${h.rooms.length === 1 ? "" : "s"}`, target: "#/play/vhulk", title: "Open the Hulk turn tab" };
}
