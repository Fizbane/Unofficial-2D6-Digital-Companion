// How one located field is read, by Loc kind: pdf.js text in the box, OCR of the padded crop, or pips counted
// in the die squares. Shared by the browser importer and the locator's simulation, so both read alike.
import { textInBox, type TextItem } from "./extract";
import type { Box, Loc } from "./manifest";
import { CROP_PAD } from "./ocr";
import { crop, type RGBAImage } from "./pdf";
import { countPips, toGray } from "./pips";
import { PIP_THRESHOLDS, type CellSource } from "./verify";
import { unrotate } from "./rebuild";

/** One page of one edition, as the readers need it. */
export interface PageReader {
  /** The page's extra rotation (pageRotation); text boxes are mapped back with unrotate. */
  rot: number;
  textItems(): Promise<TextItem[]>;
  /** The page rendered at RENDER_SCALE with `rot`, or undefined when it was not rendered. */
  image(): RGBAImage | undefined;
  /** OCR of a Loc box of this page (crop it with ocrCrop). */
  read(box: Box): Promise<string>;
}

/** The crop an "ocr" Loc box is read from. */
export const ocrCrop = (img: RGBAImage, box: Box): RGBAImage => crop(img, box, CROP_PAD.ocr);

/**
 * A field's source for verifyCell. Call `raw()` first and await it: it does the read, and the text and OCR
 * sources then give that same reading. Null when the page has no render for an OCR or dice field.
 */
export function cellSource(loc: Loc, page: PageReader): { cell: CellSource; raw: () => Promise<string> } | null {
  if (loc.kind === "text") {
    const once = page.textItems().then((its) => textInBox(its, unrotate(loc.box, page.rot)).text);
    let txt = "";
    return { raw: async () => (txt = await once), cell: { text: () => txt } };
  }
  const im = page.image();
  if (!im) return null;
  if (loc.kind === "dice") {
    const g = toGray(crop(im, loc.box, CROP_PAD.dice));
    return { raw: async () => countPips(g, PIP_THRESHOLDS[0]), cell: { pips: (th) => countPips(g, th) } };
  }
  const q = page.read(loc.box);
  let txt = "";
  return { raw: async () => (txt = await q), cell: { ocr: async () => txt } };
}
