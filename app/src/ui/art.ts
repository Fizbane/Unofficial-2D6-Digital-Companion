// Card art: the pictures in books/Art are named after the creature, plant or NPC they show ("Huge Rat.png").
// In development the dev server lists them (art/index.json, see vite.config.ts); a build ships none, so
// everywhere else the index is empty and nothing here does anything. Wherever a creature card or a bold
// creature/plant/NPC name appears on a page, it gets a thumbnail or turns into a button that opens the picture.
// Combat draws its own thumbnails on the cards of the foes in a fight (artThumb).
import { html, type Raw } from "./html";
import { openModal } from "./modal";

const files = new Map<string, string>(); // normalised name -> file name

/** "A Giant Horned Anaconda" / "GIANT HORNED ANACONDA" / "giant horned anaconda!" all key the same. */
const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(a|an|the) /, "");

/** The art file for a name, or undefined. Also tries a trailing "s" off (plural headings). */
export function artFor(name: string): string | undefined {
  const k = norm(name);
  return files.get(k) ?? (k.endsWith("s") ? files.get(k.slice(0, -1)) : undefined);
}

/** Set the list of art files (the dev server's art/index.json; none in a build). */
export function setArtFiles(list: readonly unknown[]): void {
  files.clear();
  for (const f of list) if (typeof f === "string") files.set(norm(f.replace(/\.[a-z]+$/i, "")), f);
}

const url = (file: string) => {
  const path = `art/${encodeURIComponent(file)}`;
  return typeof document === "undefined" ? path : new URL(path, document.baseURI).href;
};
/** The URL of the picture for a name (dev only: a build ships no art), or undefined. */
export const artSrc = (name: string): string | undefined => { const f = artFor(name); return f ? url(f) : undefined; };
const titleOf = (file: string) => file.replace(/\.[a-z]+$/i, "");

export function showArt(file: string): void {
  const id = "art-title";
  openModal({
    labelledBy: id,
    cls: "modal-art",
    body: html`<figure class="art-full"><img src="${url(file)}" alt="${titleOf(file)}"><figcaption id="${id}">${titleOf(file)}</figcaption></figure>`,
  });
}

/**
 * A thumbnail of the creature, plant or NPC called `name`, as a button that opens the full picture; nothing when
 * it has none. For pages that draw their own cards (Combat's foes). `cls`: an extra class for its size or place.
 */
export function artThumb(name: string, cls = ""): Raw | "" {
  const file = artFor(name);
  if (!file) return "";
  const label = `Show the picture of ${titleOf(file)}`;
  return html`<button type="button" class="art-thumb${cls ? ` ${cls}` : ""}" data-art="${file}" title="${label}" aria-label="${label}"><img src="${url(file)}" alt=""></button>`;
}

const NAME_ROW = /^NAME$/i;

/** Where to centre a square crop of a wide picture: the window of columns with the most detail (the subject, not empty sky or floor). */
function centreOn(img: HTMLImageElement): void {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || w / h < 1.05) return;
  const H = 48, W = Math.round((w / h) * H);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return;
  try {
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const lum = (x: number, y: number) => { const i = (y * W + x) * 4; return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; };
    const col = new Array<number>(W).fill(0);
    for (let x = 1; x < W; x++) for (let y = 1; y < H; y++) col[x] += Math.abs(lum(x, y) - lum(x - 1, y)) + Math.abs(lum(x, y) - lum(x, y - 1));
    let best = 0, bestScore = -1;
    for (let x0 = 0; x0 + H <= W; x0++) {
      let sum = 0;
      for (let x = x0; x < x0 + H; x++) sum += col[x];
      const centreBias = 1 - Math.abs(x0 + H / 2 - W / 2) / W * 0.3; // a mild preference for the middle
      if (sum * centreBias > bestScore) { bestScore = sum * centreBias; best = x0; }
    }
    img.style.objectPosition = `${W > H ? (best / (W - H)) * 100 : 50}% 30%`;
  } catch { /* unreadable: stay centred */ }
}

function tagTable(fig: HTMLElement): void {
  if (fig.querySelector(".art-thumb")) return;
  const row = [...fig.querySelectorAll<HTMLTableRowElement>("tbody tr")].find((r) => NAME_ROW.test(r.cells[0]?.textContent?.trim() ?? ""));
  const name = fig.dataset.name ?? row?.cells[1]?.textContent ?? ""; // a creature card carries its name; a plain table has a NAME row
  const file = name ? artFor(name) : undefined;
  if (!file) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "art-thumb";
  b.dataset.art = file;
  b.title = `Show the picture of ${titleOf(file)}`;
  b.setAttribute("aria-label", `Show the picture of ${titleOf(file)}`);
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = "";
  img.addEventListener("load", () => centreOn(img));
  img.src = url(file);
  b.append(img);
  const slot = fig.querySelector(".crc-art");
  if (slot) return void slot.append(b); // a creature card has a place for its picture
  const first = fig.querySelector("tbody > tr");
  if (fig.classList.contains("creature-card") && first) {
    // on a card the picture sits in the grid beside HP and TREASURE, like the printed card
    const tr = document.createElement("tr");
    tr.className = "cc-art";
    tr.append(document.createElement("td"));
    tr.firstElementChild!.append(b);
    first.after(tr);
    // the picture stands beside every row up to the description, so the left side fills its height
    const fit = () => {
      let n = 0;
      for (let r = tr.nextElementSibling; r && /cc-(stats|treasure|interrupt|man|desc|other)/.test(r.className); r = r.nextElementSibling) n++;
      tr.style.gridRow = `2 / span ${Math.max(n, 1)}`;
    };
    fit();
    const body = first.parentElement!;
    const mo = new MutationObserver(() => (tr.isConnected ? fit() : mo.disconnect())); // rows are added after the first pass
    mo.observe(body, { childList: true });
  } else fig.prepend(b);
}

function tagNames(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("strong, .foe-name b, th").forEach((el) => {
    if (el.dataset.art || el.closest("button, a, .art-thumb")) return;
    const file = artFor(el.textContent ?? "");
    if (!file) return;
    el.dataset.art = file;
    el.classList.add("art-name");
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.title = `Show the picture of ${titleOf(file)}`;
  });
}

/** Thumbnails a page drew itself (artThumb): centre each on its subject once it has loaded. */
function centreThumbs(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>(".art-thumb > img:not([data-centred])").forEach((img) => {
    img.dataset.centred = "";
    if (img.complete && img.naturalWidth) centreOn(img);
    else img.addEventListener("load", () => centreOn(img), { once: true });
  });
}

function scan(root: ParentNode): void {
  centreThumbs(root);
  if (root instanceof Element && root.matches("figure.table-wrap")) tagTable(root as HTMLElement);
  root.querySelectorAll<HTMLElement>("figure.table-wrap").forEach(tagTable);
  tagNames(root);
}

/** Load the art list and start tagging the page. Quiet when there is no art. */
export async function initArt(): Promise<void> {
  try {
    const r = await fetch(new URL("art/index.json", document.baseURI), { headers: { Accept: "application/json" } });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return; // a build: the SPA fallback is not a list
    const list: unknown = await r.json();
    if (!Array.isArray(list)) return;
    setArtFiles(list);
  } catch {
    return;
  }
  if (!files.size) return;
  const body = document.body;
  scan(body);
  let queued: Node[] = [];
  const flush = () => {
    const nodes = queued;
    queued = [];
    for (const n of nodes) if (n.isConnected && n instanceof Element) scan(n);
  };
  new MutationObserver((muts) => {
    const first = queued.length === 0;
    for (const m of muts) m.addedNodes.forEach((n) => n instanceof Element && !n.closest(".art-thumb") && queued.push(n));
    if (first && queued.length) requestAnimationFrame(flush);
  }).observe(body, { childList: true, subtree: true });
  const open = (e: Event) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-art]");
    if (el?.dataset.art) {
      e.preventDefault();
      showArt(el.dataset.art);
    }
  };
  document.addEventListener("click", open);
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).classList?.contains("art-name")) open(e);
  });
}
