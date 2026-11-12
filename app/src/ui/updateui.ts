// The update screens: the Updates card in Settings, and the "a new version is out" prompt shown after the
// automatic check on start-up. The work is in shell/updates.ts.
import {
  autoCheckDue, checkForUpdates, getUpdatePrefs, initUpdates, installUpdate, onUpdateStatus, RELEASES_URL, setUpdatePrefs,
  appVersion, updateHow, updateStatus, type UpdateHow, type UpdateStatus,
} from "../shell/updates";
import { button } from "./components";
import { html, setHTML, type Raw } from "./html";
import { icon } from "./icon";
import { openModal, type Modal } from "./modal";

const HOW: Record<UpdateHow, string> = {
  installed: "Desktop app",
  portable: "Portable desktop app",
  dev: "Desktop app (development run)",
  git: "Running from a git clone",
  web: "",
  none: "",
};

const whatsNew = () =>
  html`<a class="btn btn-ghost" href="${RELEASES_URL}" target="_blank" rel="noopener noreferrer">${icon("external-link", { size: 17 })}<span>What's new</span></a>`;

/** The button that takes the next step, or "" when there is none. */
function primary(s: UpdateStatus, how: UpdateHow, autofocus = false): Raw | "" {
  const af = autofocus ? html` data-autofocus` : "";
  if (s.s === "ready") return button("Restart and install", { icon: "download", variant: "primary", attrs: html`data-update="install"${af}` });
  if (s.s !== "available") return "";
  if (how === "portable") return button("Download from GitHub", { icon: "external-link", variant: "primary", attrs: html`data-update="install"${af}` });
  if (how === "git") return s.canUpdate ? button("Update now", { icon: "download", variant: "primary", attrs: html`data-update="install"${af}` }) : "";
  return button("Download and install", { icon: "download", variant: "primary", attrs: html`data-update="install"${af}` });
}

/** One or two lines saying where things stand. */
function statusText(s: UpdateStatus, how: UpdateHow, inPrompt = false): Raw | "" {
  switch (s.s) {
    case "idle": return "";
    case "checking": return html`<p role="status">Checking for updates…</p>`;
    case "current": return html`<p role="status">You have the newest version.</p>`;
    case "available":
      return html`${inPrompt ? "" : html`<p role="status"><strong>Version ${s.latest} is available.</strong></p>`}
        ${s.reason ? html`<p class="muted">${s.reason}</p>` : ""}
        ${how === "portable" ? html`<p class="muted">Download the new portable file and use it in place of this one. Your saves stay where they are.</p>` : ""}`;
    case "downloading":
      return how === "git"
        ? html`<p role="status">Updating…</p>`
        : html`<p role="status">Downloading version ${s.latest}… ${s.percent}%</p><progress max="100" value="${s.percent}" aria-label="Download progress"></progress>`;
    case "ready": return html`<p role="status">Version ${s.latest} is ready. Restart the app to install it, or it installs the next time you close the app.</p>`;
    case "updated":
      return html`<p role="status"><strong>Updated to version ${s.latest}.</strong></p>
        <p>To finish, stop the app (press Ctrl+C where <code>npm run dev</code> is running)${s.needsInstall ? html`, run <code>npm install</code>` : ""}, then start it again with <code>npm run dev</code>.</p>`;
    case "error":
      return html`<p class="warn" role="alert">${s.message}</p>`;
  }
}

const busy = (s: UpdateStatus) => s.s === "checking" || s.s === "downloading";

function cardBody(): Raw {
  const s = updateStatus();
  const how = updateHow();
  const auto = getUpdatePrefs().auto;
  return html`<p class="muted set-note">Version <strong>${appVersion()}</strong>${HOW[how] ? html` · ${HOW[how]}` : ""}</p>
    <div class="update-status">${statusText(s, how)}</div>
    <div class="step-actions">
      ${primary(s, how)}
      ${busy(s) || s.s === "ready" || s.s === "updated" ? "" : button("Check for updates", { icon: "rotate-ccw", variant: s.s === "available" ? "ghost" : undefined, attrs: html`data-update="check"` })}
      ${whatsNew()}
    </div>
    <label class="switch-row"><input type="checkbox" role="switch" data-update-auto ${auto ? "checked" : ""}>
      <span class="switch-track" aria-hidden="true"></span>
      <span class="switch-text"><span class="switch-label">Check when the app opens</span><span class="muted">At most once a day. You are always asked before anything is downloaded.</span></span></label>`;
}

/** Wire the step buttons inside `host` (the Settings card or the prompt). */
function onAct(host: HTMLElement): () => void {
  const click = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-update]");
    if (!b) return;
    if (b.dataset.update === "check") void checkForUpdates();
    else if (b.dataset.update === "install") void installUpdate();
  };
  host.addEventListener("click", click);
  return () => host.removeEventListener("click", click);
}

/** The Updates card in Settings. Returns its clean-up. */
export function renderUpdateCard(host: HTMLElement): () => void {
  const draw = () => setHTML(host, cardBody());
  const offClick = onAct(host);
  const change = (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-update-auto]")) setUpdatePrefs({ auto: t.checked });
  };
  host.addEventListener("change", change);
  const off = onUpdateStatus(draw);
  draw();
  void initUpdates().then(draw);
  return () => {
    offClick();
    host.removeEventListener("change", change);
    off();
  };
}

function promptBody(): Raw {
  const s = updateStatus();
  const how = updateHow();
  const later = s.s === "updated" || s.s === "error" || s.s === "current" ? "Close" : "Later";
  return html`<p class="eyebrow">Update</p>
    <h2 id="update-title">${s.s === "available" || s.s === "downloading" || s.s === "ready" ? `Version ${s.latest} is available` : "Updates"}</h2>
    <p class="muted">You have version ${appVersion()}.</p>
    ${statusText(s, how, true)}
    <div class="step-actions">${primary(s, how, true)}${whatsNew()}${busy(s) ? "" : button(later, { variant: "ghost", attrs: html`data-update-close` })}</div>`;
}

let prompt: Modal | null = null;
/** The prompt after an automatic check found an update. It follows the download through to "restart". */
export function showUpdatePrompt(): void {
  if (prompt) return;
  const m = (prompt = openModal({
    body: promptBody(),
    labelledBy: "update-title",
    onClose: () => {
      prompt = null;
      off();
      offClick();
    },
  }));
  const offClick = onAct(m.card);
  m.card.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-update-close]")) m.close();
  });
  const off = onUpdateStatus(() => m.update(promptBody()));
}

/** Wait until no other dialog (the tour, the backup set-up, the Void introduction) is open, then run `f`. */
function whenFree(f: () => void, tries = 200): void {
  if (!document.querySelector(".modal-backdrop")) return f();
  if (tries > 0) setTimeout(() => whenFree(f, tries - 1), 3000);
}

/** On start-up: check once a day (if the player hasn't turned it off) and offer an update when there is one. */
export function startUpdateCheck(delayMs = 8000): void {
  void initUpdates().then(() => {
    if (updateHow() === "dev" || updateHow() === "none" || !autoCheckDue(getUpdatePrefs())) return;
    setTimeout(async () => {
      const s = await checkForUpdates();
      if (s.s === "available") whenFree(showUpdatePrompt);
    }, delayMs);
  });
}
