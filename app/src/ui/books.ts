// Settings → Books: each book's status, "Unlock a book…" (the owner's PDF, read on this device by the import
// Worker), progress with Cancel, the report, and Lock / forget my books.
import { LockedDuringImport, addUnlocked, bookInfo, getContent, lockAll, lockGeneration, manifest, onContentChange, storeAvailable } from "../content";
import type { ImportProgress, ImportReport } from "../lock/importer";
import { remapLegacy } from "../lock/legacy";
import type { FromWorker, ImportPaths, ToWorker } from "../lock/import.worker";
import { rowCounts } from "../lock/rebuild";
import { StoreError, getBooks, getProgress, getSections, persist } from "../lock/store";
import { applyPack, makeTodo, validatePack, type PackItem, type TodoScope } from "../lock/todo";
import { ValidationError } from "../lock/validate";
import { gameId } from "../games";
import { bus } from "../shell/events";
import { button } from "./components";
import { html, type Raw, setHTML } from "./html";
import { here, isDesktop } from "../shell/platform";

/** The part of a Worker the Books UI uses (a fake one in tests). */
export interface WorkerLike {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror?: ((e: MessageEvent) => void) | null;
  postMessage(m: ToWorker): void;
  terminate(): void;
}

interface Job {
  worker: WorkerLike;
  progress: ImportProgress | null;
  /** Lock was pressed: nothing more of this run may reach the store or the gateway. */
  locking: boolean;
  /** The report being finished on the main thread (remap, addUnlocked), once one has arrived. */
  finishing: Promise<void> | null;
  settled: Promise<void>;
  /** lockGeneration() when the run started: its sections are refused if a Lock happened since. */
  since: number;
  /** Stops the stall watchdog (and its visibility listener). */
  quiet(): void;
}

let job: Job | null = null;
/** The last outcome. */
let report: Raw | string = ""; // markup, or plain text (escaped where it is shown)
/** The book an Unlock… button asked for, until an import starts. */
let hint: string | null = null;
/** Edition per finished book (from its BookRecord), for the verified-row figures. */
let editions = new Map<string, string>();
/** Books with a stored resume point but no BookRecord: a run stopped part-way. */
let partial = new Set<string>();
const redraws = new Set<() => void>();
const redraw = () => { for (const fn of [...redraws]) fn(); };

/** Reloads what the status lines need from the device store (BookRecords and resume points). */
export async function refreshBookState(): Promise<void> {
  try {
    const recs = await getBooks();
    editions = new Map(recs.map((b) => [b.slug, b.edition]));
    const next = new Set<string>();
    for (const b of manifest().books) {
      if (b.free || editions.has(b.slug)) continue;
      if (((await getProgress(b.slug))?.page ?? 0) > 0) next.add(b.slug);
    }
    partial = next;
  } catch {
    /* store unavailable: the statuses fall back to what the gateway knows */
  }
  redraw();
}

/** Called by the locked cards' Unlock… button: open Books with this book noted. */
export function noteUnlock(book: string | undefined): void {
  hint = book ?? null;
  redraw();
  // Settings may still be opening: try for a few frames. The visible Settings page's card wins.
  let tries = 20;
  const scroll = () => {
    const el = [...document.querySelectorAll<HTMLElement>("#books")].find((x) => x.offsetParent !== null);
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    else if (--tries > 0) requestAnimationFrame(scroll);
  };
  requestAnimationFrame(scroll);
}

const pagePaths = (): ImportPaths => {
  const u = (p: string) => new URL(p, document.baseURI).href;
  return { pdfWorker: u("pdfjs/pdf.worker.min.mjs"), standardFonts: u("pdfjs/standard_fonts/"), ocrWorker: u("ocr/worker.min.js"), ocrCore: u("ocr/"), ocrLang: u("ocr/lang") };
};
const moduleWorker = (): WorkerLike =>
  new Worker(new URL("../lock/import.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;

const n = (x: number) => x.toLocaleString("en-GB");
const nameOf = (slug: string) => manifest().books.find((b) => b.slug === slug)?.name ?? slug;

function reportHtml(r: ImportReport): Raw {
  if (r.kind === "free") return html`That's the free version of the book. Its tables are already included, so there is nothing to unlock.`;
  if (r.kind === "unknown") return html`That PDF isn't a supported edition. Nothing was read from it.`;
  const need = r.unverified ? `${n(r.unverified)} need checking` : "all of them verified";
  return html`<strong><em>${nameOf(r.book)}</em> unlocked:</strong> ${n(r.verified)} of ${n(r.rows)} rows verified; ${need}.`;
}

export function errorHtml(m: Extract<FromWorker, { type: "error" }>): Raw {
  if (m.cancelled) return html`Cancelled. Choose the same PDF again to carry on where it stopped.`;
  const text = m.kind === "quota" ? "This device is out of storage space for the book."
    : m.kind === "unavailable" ? `${isDesktop() ? "This app" : "This browser"} can't save books (storage unavailable).`
    : m.name === "PdfWorkerError" ? `The PDF reader could not start in ${here()}.`
    : "The PDF could not be read.";
  const name = m.name ?? "";
  return name ? html`${text} <small class="muted">(${name})</small>` : html`${text}`;
}

/**
 * The main thread's part of a finished run: remap legacy ids (the only call site: the Worker has no
 * localStorage), then hand the book's sections to the gateway. `j.locking` is checked after every await,
 * so a Lock pressed meanwhile stops it before anything more is shown or written.
 */
async function finish(r: ImportReport, j: Job): Promise<void> {
  if (r.kind !== "done" || j.locking) return;
  const rec = (await getBooks()).find((b) => b.slug === r.book);
  if (j.locking || !rec) return;
  // Before addUnlocked, so it applies the remapped fixes.
  const moved = await remapLegacy(rec.key, rec.edition, manifest());
  if (j.locking) return;
  if (moved) {
    bus.emit("bookmarks:changed", { source: "books" });
    bus.emit("journal:changed", { source: "books" });
  }
  const list = (await getSections()).filter((s) => s.section.book === r.book);
  if (j.locking) return;
  try {
    await addUnlocked(list, { since: j.since });
  } catch (e) {
    if (e instanceof LockedDuringImport) return;
    throw e;
  }
  await refreshBookState();
}

/** How long the import Worker may go without a progress, report or error message before the run is ended. */
export const STALL_MS = 120_000;
export const STALLED = "The import stopped responding.";

/** Starts an import of `file` in the module Worker. Resolves when the run has ended and its report is set. */
export function startImport(file: Blob, o: { worker?: () => WorkerLike; paths?: ImportPaths; stallMs?: number } = {}): Promise<void> {
  if (job) return job.settled;
  if (!manifest().books.some((b) => !b.free && bookInfo(b.slug).unlocked)) void persist(); // the first unlock
  hint = null;
  report = "";
  const worker = (o.worker ?? moduleWorker)();
  let settle = () => {};
  const settled = new Promise<void>((res) => (settle = res));
  // The watchdog: a Worker that hangs (or dies without an error event) must not leave the run open for ever.
  // Progress and "alive" messages feed it. It is paused while the page is hidden (a background tab's timers and
  // Worker may be throttled) and starts afresh when the page is shown again.
  let stall: ReturnType<typeof setTimeout> | undefined;
  let feeding = true;                                              // until the report arrives
  const doc = typeof document === "undefined" ? undefined : document;
  const clear = () => { clearTimeout(stall); stall = undefined; };
  const watch = () => {
    clear();
    if (feeding && !doc?.hidden) stall = setTimeout(() => end(STALLED), o.stallMs ?? STALL_MS);
  };
  const onVisibility = () => watch();
  doc?.addEventListener("visibilitychange", onVisibility);
  const quiet = () => {
    feeding = false;
    clear();
    doc?.removeEventListener("visibilitychange", onVisibility);
  };
  const j: Job = { worker, progress: null, locking: false, finishing: null, settled, since: lockGeneration(), quiet };
  job = j;
  let ended = false;
  const end = (h: Raw | string) => {
    if (ended) return;
    ended = true;
    quiet();
    if (!j.locking) report = h;
    worker.terminate();
    if (job === j) job = null;
    settle();
    redraw();
  };
  worker.onmessage = (e) => {
    // Only our own protocol counts. Anything else (pdf.js's "ready" handshake, should its code ever run in
    // this Worker's scope) is ignored and never ends the run.
    const m = e.data as FromWorker | null | undefined;
    if (!m || typeof m !== "object") return;
    if (m.type === "alive") watch();
    else if (m.type === "progress") {
      watch();
      j.progress = { phase: m.phase, done: m.done, total: m.total };
      redraw();
    } else if (m.type === "report") {
      quiet();                                                     // the Worker is done; the rest is ours
      j.finishing = finish(m.report, j).then(
        () => end(reportHtml(m.report)),
        (err) => end(err instanceof StoreError && err.kind === "quota" ? "This device is out of storage space for the book." : "The book could not be saved on this device."),
      );
    } else if (m.type === "error") {
      void refreshBookState();
      end(errorHtml(m));
    }
  };
  worker.onerror = () => end(`The import could not start in ${here()}.`);
  worker.onmessageerror = () => end(`The import stopped: ${here()} could not pass the reader's messages.`);
  watch();
  worker.postMessage({ type: "start", file, manifest: manifest(), paths: o.paths ?? pagePaths(), game: gameId() });
  redraw();
  return settled;
}

function cancel(): void {
  job?.worker.postMessage({ type: "cancel" });
}

export const LOCK_FAILED = "Couldn't lock your books: storage isn't available. Try again or clear this site's data.";

/**
 * Lock: confirm, stop a running import and any pack import, then forget. lockAll() bumps the lock generation
 * first, so nothing begun before the click can still be added. The Worker gets 5 s to stop after Cancel (then
 * it is ended). A report already being finished on the main thread, and a pack import in flight, are awaited
 * with no timeout: their addUnlocked is refused once the generation has moved. Never rejects: a store that
 * can't be cleared is reported to the user, and nothing claims the books were locked.
 */
export async function lockBooks(ask: (q: string) => boolean = (q) => confirm(q)): Promise<void> {
  if (!ask("Lock your books? This deletes the unlocked text and page images saved on this device. You can unlock them again from your PDFs.")) return;
  try {
    await lockAll(async () => {
      const j = job;
      if (j) {
        j.locking = true;
        cancel();
        if (!j.finishing) await Promise.race([j.settled, new Promise((r) => setTimeout(r, 5000))]);
        if (j.finishing) await j.finishing.catch(() => {});        // a report that arrived meanwhile, too
        j.quiet();
        j.worker.terminate();
        if (job === j) job = null;
      }
      while (packRuns.size) await Promise.allSettled([...packRuns]);
    });
  } catch {
    report = LOCK_FAILED;
    return;
  } finally {
    pending = null;
    leftAsIs = [];
    claudeNote = "";
    redraw();
  }
  report = "Books locked. Their saved text and page images were deleted from this device.";
  await refreshBookState();
}

/** A book's status line: Free, Locked, Partly read, or (Partly) Unlocked with its verified-row figures. */
export function bookStatus(slug: string): string {
  const b = manifest().books.find((x) => x.slug === slug);
  if (!b || b.free) return "Free · included";
  if (partial.has(slug)) return "Partly read: pick the PDF again to finish";
  const sections = manifest().sections.filter((s) => s.book === slug);
  const open = sections.filter((s) => getContent(s.id)?.ok).length;
  if (!open) return "🔒 Locked";
  const part = open < sections.length ? "Partly unlocked" : "Unlocked";
  const ed = editions.get(slug);
  if (!ed) return part;
  const { rows, verified } = rowCounts(sections, ed, (id) => {
    const c = getContent(id);
    return c?.ok ? c.unverified ?? new Set() : undefined;
  });
  return `${part} · ${n(verified)} of ${n(rows)} rows verified`;
}

function progressHtml(p: ImportProgress | null): Raw {
  if (!p) return html`<span>Starting…</span>`;
  const label = p.phase === "hash" ? "Checking the file" : `Reading page ${n(p.done)} of ${n(p.total)}`;
  return html`<progress max="${p.total || 1}" value="${p.done}"></progress><span>${label}</span>`;
}


// ------------------------------------------------------------------------------- Claude-assisted import

/** What the Claude import last did (plain text), and the rows still waiting for "Keep anyway". */
let claudeNote = ""; // plain text
const SAVE_FAILED = "Couldn't save the checked rows. Nothing was changed.";
/** Rows of the last import that were already verified and so left as they were (ids). */
let leftAsIs: string[] = [];
/** Scope choice per book, kept across redraws. */
const scopes = new Map<string, TodoScope>();
let pending: { book: string; edition: string; key: Uint8Array; items: PackItem[] } | null = null;
/** The book an "Import checked rows" click asked for, until its file arrives. */
let importFor: string | null = null;

const NEEDS_UNLOCK = "Unlock this book from its PDF first";
const MAX_PACK_BYTES = 40_000_000;

/** The to-do file's JSON for a book, or a note when the book has no key on this device yet. */
export async function exportTodo(slug: string, scope: TodoScope): Promise<{ json: string; count: number } | { note: string }> {
  const rec = (await getBooks()).find((b) => b.slug === slug);
  if (!rec) return { note: NEEDS_UNLOCK };
  const todo = makeTodo(slug, rec.edition, scope);
  return { json: JSON.stringify(todo), count: todo.items.length };
}

/** Pack imports and "Keep anyway" writes in flight: Lock waits for them. */
const packRuns = new Set<Promise<unknown>>();
function track<T>(p: Promise<T>): Promise<T> {
  packRuns.add(p);
  const done = () => void packRuns.delete(p);
  p.then(done, done);
  return p;
}

/** Reads a pack file for a book and applies it; sets the note and the rows to confirm. Returns the note. */
export function importPackFile(slug: string, file: Blob): Promise<string> {
  return track(importPack(slug, file, lockGeneration()));
}

async function importPack(slug: string, file: Blob, since: number): Promise<string> {
  pending = null;
  leftAsIs = [];
  const rec = (await getBooks()).find((b) => b.slug === slug);
  if (!rec) return (claudeNote = NEEDS_UNLOCK);
  let pack;
  try {
    if (file.size > MAX_PACK_BYTES) throw new ValidationError("size");
    pack = validatePack(JSON.parse(await file.text()));
  } catch {
    return (claudeNote = "That file isn't a valid pack for this app. Nothing was changed.");
  }
  if (pack.book !== slug || pack.edition !== rec.edition) {
    return (claudeNote = "That pack is for a different book or edition. Nothing was changed.");
  }
  let r;
  try {
    r = await applyPack(pack, rec.key, [], { since });
  } catch (e) {
    return (claudeNote = e instanceof LockedDuringImport ? "" : SAVE_FAILED);   // locked meanwhile: Lock clears the note
  }
  leftAsIs = r.alreadyVerified;
  if (r.mismatched.length) pending = { book: slug, edition: rec.edition, key: rec.key, items: r.mismatched };
  const bits = [`${n(r.accepted)} ${r.accepted === 1 ? "row" : "rows"} checked and verified`];
  if (r.mismatched.length) bits.push(`${n(r.mismatched.length)} did not match`);
  if (r.alreadyVerified.length) bits.push(`${n(r.alreadyVerified.length)} already checked, left as is`);
  if (r.unknown) bits.push(`${n(r.unknown)} named no row to check`);
  claudeNote = `${bits.join("; ")}.`;
  await refreshBookState();
  return claudeNote;
}

/** "Keep anyway": stores one mismatched row as it is, still flagged unverified. */
export function keepAnyway(id: string): Promise<void> {
  return track(keep(id, lockGeneration()));
}

async function keep(id: string, since: number): Promise<void> {
  const p = pending;
  const it = p?.items.find((x) => x.id === id);
  if (!p || !it) return;
  try {
    await applyPack({ book: p.book, edition: p.edition, items: [it] }, p.key, [id], { since });
  } catch (e) {
    if (!(e instanceof LockedDuringImport)) claudeNote = SAVE_FAILED;
    return;
  }
  p.items = p.items.filter((x) => x.id !== id);
  if (!p.items.length) pending = null;
  await refreshBookState();
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function claudeHtml(): Raw {
  const books = manifest().books.filter((b) => !b.free);
  const rows = html`${books.map((b) => {
    const slug = b.slug;
    return html`<div class="step-actions" data-claude-book="${slug}"><span><em>${b.name}</em></span><label class="muted">Rows <select data-claude="scope" aria-label="Rows to export for ${b.name}"><option value="unverified"${scopes.get(b.slug) !== "all" ? " selected" : ""}>Unverified</option><option value="all"${scopes.get(b.slug) === "all" ? " selected" : ""}>All</option></select></label>${button("Export rows to check", { icon: "download", variant: "ghost", size: "sm", attrs: html`data-claude="export" data-book="${slug}"` })}${button("Import checked rows", { icon: "upload", variant: "ghost", size: "sm", attrs: html`data-claude="import" data-book="${slug}"` })}</div>`;
  })}`;
  const list = pending?.items.length
    ? html`<ul class="claude-mismatch">${pending.items.map((it) =>
        html`<li><code>${it.id}</code> <span class="claude-text">${it.text}</span> ${button("Keep anyway", { variant: "ghost", size: "sm", attrs: html`data-claude="keep" data-id="${it.id}"` })}</li>`)}</ul>`
    : "";
  const left = leftAsIs.length
    ? html`<ul class="claude-left">${leftAsIs.map((id) => html`<li><code>${id}</code> <span class="muted">already checked, left as is</span></li>`)}</ul>`
    : "";
  return html`<h3>Check rows with Claude</h3><p class="muted set-note">Export a to-do file with no book text in it, let your own Claude Code fill it in from your PDF (see <code>claude-import/</code>), then import the result. Only rows that match are kept as verified.</p><input type="file" accept=".json,application/json" data-claude="file" hidden>${rows}${claudeNote ? html`<p class="books-report" role="status">${claudeNote}</p>` : ""}${list}${left}`;
}

async function claudeClick(host: HTMLElement, el: HTMLElement): Promise<void> {
  const act = el.dataset.claude;
  const slug = el.dataset.book ?? "";
  if (act === "export") {
    const scope = (el.closest("[data-claude-book]")?.querySelector<HTMLSelectElement>('[data-claude="scope"]')?.value === "all" ? "all" : "unverified") as TodoScope;
    scopes.set(slug, scope);
    const r = await exportTodo(slug, scope);
    if ("note" in r) claudeNote = r.note;
    else {
      download("book-todo.json", r.json);
      claudeNote = `Exported ${n(r.count)} ${r.count === 1 ? "row" : "rows"} to check as book-todo.json. It holds no book text.`;
    }
    redraw();
  } else if (act === "import") {
    if (!(await getBooks()).some((b) => b.slug === slug)) {
      claudeNote = NEEDS_UNLOCK;
      redraw();
      return;
    }
    importFor = slug;
    host.querySelector<HTMLInputElement>('[data-claude="file"]')?.click();
  } else if (act === "keep" && el.dataset.id) {
    await keepAnyway(el.dataset.id);
    redraw();
  }
}

/** Draws Settings → Books into `host` and keeps it current; returns its dispose function. */
export function renderBooks(host: HTMLElement): () => void {
  const draw = () => {
    const books = manifest().books;
    const canStore = storeAvailable();
    const asked = hint ? books.find((b) => b.slug === hint) : undefined;
    setHTML(host, html`<ul class="book-status">${books.map((b) =>
        html`<li data-book="${b.slug}"${asked?.slug === b.slug ? html` class="is-asked"` : ""}><strong>${b.name}</strong> <span class="muted">${bookStatus(b.slug)}</span></li>`)}</ul>${(asked ? html`<p class="books-hint">🔒 Open your <em>${asked.name}</em> PDF to unlock</p>` : "")}<input type="file" accept=".pdf,application/pdf" data-books="file" hidden><div class="step-actions">${button("Unlock a book…", { icon: "key-round", variant: "primary", attrs: html`data-books="pick"${job || !canStore ? " disabled" : ""}` })}${button("Lock / forget my books", { icon: "trash", variant: "danger", attrs: html`data-books="lock"` })}</div>${(job ? html`<div class="books-progress" role="status">${progressHtml(job.progress)}${button("Cancel", { icon: "x", variant: "ghost", size: "sm", attrs: html`data-books="cancel"` })}</div>` : "")}${(report ? html`<p class="books-report" role="status">${report}</p>` : "")}${(canStore ? "" : html`<p class="muted set-note">Saved books can't be read in this browser mode, so nothing can be unlocked here.</p>`)}${claudeHtml()}<p class="muted set-note">Your PDF is read on this device only: it is never uploaded. Once a book is unlocked the app keeps what it needs, so the PDF isn't needed again.</p>`);
  };
  const onClick = (e: Event) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>("[data-claude]");
    if (c && c.dataset.claude !== "scope" && c.dataset.claude !== "file") {
      void claudeClick(host, c).catch(() => { claudeNote = SAVE_FAILED; redraw(); });
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-books]");
    if (!b) return;
    const act = b.dataset.books;
    if (act === "pick") host.querySelector<HTMLInputElement>('[data-books="file"]')?.click();
    else if (act === "cancel") cancel();
    else if (act === "lock") void lockBooks();
  };
  const onChange = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.claude === "scope") {
      const slug = el.closest<HTMLElement>("[data-claude-book]")?.dataset.claudeBook;
      if (slug) scopes.set(slug, el.value === "all" ? "all" : "unverified");
      return;
    }
    if (el.dataset.claude === "file") {
      const f = el.files?.[0], slug = importFor;
      el.value = "";
      importFor = null;
      if (f && slug) void importPackFile(slug, f).catch(() => { claudeNote = SAVE_FAILED; }).then(redraw);
      return;
    }
    if (el.dataset.books !== "file") return;
    const f = el.files?.[0];
    el.value = "";
    if (f) void startImport(f);
  };
  host.addEventListener("click", onClick);
  host.addEventListener("change", onChange);
  redraws.add(draw);
  const off = onContentChange(draw);
  draw();
  void refreshBookState();
  return () => {
    redraws.delete(draw);
    off();
    host.removeEventListener("click", onClick);
    host.removeEventListener("change", onChange);
  };
}
