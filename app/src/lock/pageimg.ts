// Saved page images of an unlocked book (IndexedDB, WebP at PAGE_SCALE): object URLs for "original page" and
// image blocks, and crops of one cell to check it against. Nothing here touches the network or the PDF.
import { bookInfo, manifest, onContentChange } from "../content";
import type { Box } from "./manifest";
import { fieldsOf, unlocated } from "./rebuild";
import { getPage } from "./store";

/** Padding (fraction of the page) around a cell in its crop, so the neighbouring text gives some context. */
export const CROP_CONTEXT = 0.008;

const urls = new Map<string, Promise<string | undefined>>();
let subscribed = false;
const stillUnlocked = (book: string): boolean => {
  try {
    return bookInfo(book).unlocked;
  } catch {
    return false;
  }
};

export const NO_PICTURE = "No picture for this cell";

/**
 * Every content change drops the cached URLs, so a re-import never serves stale images. A locked book's URLs are
 * revoked at once; an unlocked book's stay valid a while longer, because a shown page may still be using one.
 */
function watch(): void {
  if (subscribed) return;
  subscribed = true;
  onContentChange(() => {
    for (const [k, p] of [...urls]) {
      urls.delete(k);
      const keep = stillUnlocked(k.slice(0, k.indexOf("/")));
      void p.then((u) => {
        if (!u) return;
        if (keep) setTimeout(() => URL.revokeObjectURL(u), 60_000);
        else URL.revokeObjectURL(u);
      });
    }
  });
}

/** An object URL of the stored page image (cached), or undefined when the book is not unlocked or has no such page. */
export function pageUrl(book: string, page: number): Promise<string | undefined> {
  watch();
  const k = `${book}/${page}`;
  let p = urls.get(k);
  if (!p) {
    p = (async () => {
      if (!stillUnlocked(book)) return undefined;
      let blob: Blob | undefined;
      try {
        blob = await getPage(book, page);
      } catch {
        return undefined;
      }
      if (!blob) return undefined;
      if (!stillUnlocked(book)) return undefined;             // locked while it was being read
      return URL.createObjectURL(blob);
    })();
    urls.set(k, p);
    void p.then((u) => { if (!u && urls.get(k) === p) urls.delete(k); });
  }
  return p;
}

/**
 * The pixel rectangle of a manifest box in a saved page image, padded by `pad` (a fraction of the page) and
 * clamped to the image. The saved image is rendered with the edition's page rotation (importer.ts, pageRotation),
 * which is the frame every Loc box is in (the text reader maps boxes back with unrotate), so no further
 * rotation applies. Undefined for an unlocated box (all zeros) or an empty rectangle.
 */
export function cropRect(box: Box, w: number, h: number, pad = CROP_CONTEXT): { x: number; y: number; w: number; h: number } | undefined {
  if (box.every((v) => v === 0) || box.some((v) => !Number.isFinite(v))) return undefined;
  const eps = 1e-9;
  const cl = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const x0 = cl(Math.floor((box[0] - pad) * w + eps), w), x1 = cl(Math.ceil((box[2] + pad) * w - eps), w);
  const y0 = cl(Math.floor((box[1] - pad) * h + eps), h), y1 = cl(Math.ceil((box[3] + pad) * h - eps), h);
  if (x1 <= x0 || y1 <= y0) return undefined;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Where a section's field (by Section key) is: its page and box, from the manifest skeleton. */
export function cellBox(sectionId: string, key: string): { page: number; box: Box } | undefined {
  const sk = manifest().sections.find((s) => s.id === sectionId);
  const f = sk && fieldsOf(sk).find((x) => x.key === key);
  if (!f || !f.loc || unlocated(f.loc)) return undefined;
  return { page: f.page, box: f.loc.box };
}

/** The cell cut out of its saved page image, or undefined when there is no picture (unlocated, no image). */
export async function cropCanvas(book: string, page: number, box: Box): Promise<HTMLCanvasElement | undefined> {
  if (!stillUnlocked(book)) return undefined;
  let blob: Blob | undefined;
  try {
    blob = await getPage(book, page);
  } catch {
    return undefined;
  }
  if (!blob) return undefined;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return undefined;
  }
  try {
    const r = cropRect(box, bmp.width, bmp.height);
    if (!r) return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = r.w;
    canvas.height = r.h;
    canvas.getContext("2d")!.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return canvas;
  } finally {
    bmp.close();
  }
}

