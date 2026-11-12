// Turn a chosen image file, or a gallery picture, into a portrait: the centred square, scaled to
// 256×256, as JPEG.
import { squareCrop } from "../shell/charmodel";

export const PORTRAIT_SIZE = 256;

/** Draw the image at `src` into a 256×256 JPEG data: URL. `pixel` keeps hard pixel edges (no smoothing). */
async function toPortrait(src: string, pixel = false): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  if (!img.naturalWidth || !img.naturalHeight) throw new Error("empty image");
  const { sx, sy, size } = squareCrop(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PORTRAIT_SIZE;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff"; // transparent PNGs get a white backdrop rather than JPEG black
  g.fillRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
  if (pixel) g.imageSmoothingEnabled = false;
  else g.imageSmoothingQuality = "high";
  g.drawImage(img, sx, sy, size, size, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
  return canvas.toDataURL("image/jpeg", pixel ? 0.92 : 0.85);
}

/** A JPEG data: URL of the file's centred square at 256×256; rejects anything that isn't a decodable image. */
export async function portraitFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("not an image");
  const url = URL.createObjectURL(file);
  try {
    return await toPortrait(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The same for a pixel-art gallery picture served by the app (scaled up with hard edges). */
export async function portraitFromUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't load ${url}`);
  const blob = URL.createObjectURL(await res.blob());
  try {
    return await toPortrait(blob, true);
  } finally {
    URL.revokeObjectURL(blob);
  }
}
