// Updates for a copy cloned from GitHub and run with `npm run dev` (or `npm run preview`).
// The page can't reach GitHub itself (its CSP is connect-src 'self'), so the local server does it:
//   GET  /__2d6/update  runs `git fetch`, then compares app/package.json on the upstream branch with this copy's.
//   POST /__2d6/update  runs `git pull --ff-only`, only from this computer and only when that's safe
//                       (no local edits, no local commits). Anything else gets the steps to do it by hand.
// Both need the X-2D6-Update header and a same-origin request, so another site can't trigger them.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Connect, Plugin } from "vite";
import { isNewer } from "../src/shell/version";

export const UPDATE_PATH = "/__2d6/update";

/** Runs git with these arguments and resolves to its trimmed output (rejects if git fails). */
export type Git = (args: string[]) => Promise<string>;

export interface GitCheck {
  how: "git";
  current: string;
  latest?: string;
  available: boolean;
  /** True when "Update now" can run `git pull` safely. */
  canUpdate: boolean;
  /** Why it can't check or update, in the player's words. */
  reason?: string;
}

export interface GitUpdated {
  updated: string;
  /** package-lock.json changed: `npm install` is needed before restarting. */
  needsInstall: boolean;
}

export async function gitCheck(git: Git, appDir: string, current: string, fetch = true): Promise<GitCheck> {
  const no = (reason: string, latest?: string): GitCheck => ({ how: "git", current, latest, available: false, canUpdate: false, reason });
  let top: string;
  try {
    top = await git(["rev-parse", "--show-toplevel"]);
  } catch {
    return no("This copy wasn't cloned with git, so it can't check for updates. Download the newest version from GitHub.");
  }
  let upstream: string;
  try {
    upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  } catch {
    return no("This copy isn't following a branch on GitHub, so it can't check for updates.");
  }
  if (fetch) {
    try {
      await git(["fetch", "--quiet"]);
    } catch {
      return no("Couldn't reach GitHub. Check your internet connection and try again.");
    }
  }
  const appRel = relative(resolve(top), resolve(appDir)).split("\\").join("/");
  let latest: string;
  try {
    latest = String(JSON.parse(await git(["show", `${upstream}:${appRel ? appRel + "/" : ""}package.json`])).version ?? "");
  } catch {
    return no("Couldn't read the version on GitHub.");
  }
  if (!latest || !isNewer(latest, current)) return { how: "git", current, latest, available: false, canUpdate: false };
  const dirty = (await git(["status", "--porcelain", "--untracked-files=no"])) !== "";
  const ahead = Number(await git(["rev-list", "--count", `${upstream}..HEAD`])) || 0;
  const reason = dirty
    ? "This copy has changes of its own, so it can't update itself. Commit or stash them, then run git pull."
    : ahead
      ? "This copy has commits that aren't on GitHub, so it can't update itself. Run git pull yourself."
      : undefined;
  return { how: "git", current, latest, available: true, canUpdate: !reason, reason };
}

export async function gitUpdate(git: Git, appDir: string, current: string): Promise<GitUpdated> {
  const c = await gitCheck(git, appDir, current);
  if (!c.available || !c.canUpdate || !c.latest) throw new Error(c.reason ?? "There's no update to install.");
  const top = await git(["rev-parse", "--show-toplevel"]);
  const appRel = relative(resolve(top), resolve(appDir)).split("\\").join("/");
  const before = await git(["rev-parse", "HEAD"]);
  await git(["pull", "--ff-only", "--quiet"]);
  const changed = (await git(["diff", "--name-only", before, "HEAD"])).split("\n");
  const lock = `${appRel ? appRel + "/" : ""}package-lock.json`;
  return { updated: c.latest, needsInstall: changed.includes(lock) };
}

const runGit =
  (cwd: string): Git =>
  (args) =>
    new Promise((ok, fail) =>
      execFile(
        "git",
        args,
        { cwd, timeout: 60_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
        (err, stdout) => (err ? fail(err) : ok(String(stdout).trim())),
      ),
    );

const isLoopback = (a?: string) => !!a && (a === "::1" || a.startsWith("127.") || a === "::ffff:127.0.0.1");

/**
 * Whether a Host header names this machine directly: "localhost" (or a name under it) or an IP address, with
 * or without a port. The dev middlewares run before Vite's own host check, so a page on some other site that
 * re-points its domain at this machine (DNS rebinding) would otherwise reach them: its Host is a domain name.
 */
export function directHost(host: string | string[] | undefined): boolean {
  if (typeof host !== "string" || !host) return false;
  if (host.startsWith("[")) return /^\[[0-9a-f:.]+\](:\d+)?$/i.test(host); // an IPv6 address
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return name === "localhost" || name.endsWith(".localhost") || /^\d{1,3}(\.\d{1,3}){3}$/.test(name);
}

/** Whether a request may use the endpoint: our header, and (when the browser says) from the app's own page. */
export function allowed(h: Record<string, string | string[] | undefined>): boolean {
  if (h["x-2d6-update"] !== "1") return false;
  if (!directHost(h.host)) return false;
  const site = h["sec-fetch-site"];
  if (site && site !== "same-origin") return false;
  const origin = h.origin;
  if (origin && origin !== `http://${h.host}` && origin !== `https://${h.host}`) return false;
  return true;
}

export function updatePlugin(appDir: string): Plugin {
  const git = runGit(appDir);
  const version = () => String(JSON.parse(readFileSync(resolve(appDir, "package.json"), "utf8")).version);
  let busy: Promise<unknown> | null = null;
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if ((req.url ?? "").split("?")[0] !== UPDATE_PATH) return next();
    const send = (code: number, body: unknown) => {
      res.statusCode = code;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(body));
    };
    if (!allowed(req.headers)) return send(403, { error: "Not allowed." });
    if (busy) return send(409, { error: "Already checking. Try again in a moment." });
    if (req.method === "GET") {
      busy = gitCheck(git, appDir, version())
        .then((r) => send(200, r))
        .catch(() => send(500, { error: "Couldn't check for updates." }))
        .finally(() => (busy = null));
    } else if (req.method === "POST") {
      if (!isLoopback(req.socket.remoteAddress))
        return send(403, { error: "Updates can only be installed on the computer that runs the app." });
      busy = gitUpdate(git, appDir, version())
        .then((r) => send(200, r))
        .catch((e) => send(409, { error: e instanceof Error ? e.message : "Couldn't update." }))
        .finally(() => (busy = null));
    } else send(405, { error: "Method not allowed." });
  };
  return {
    name: "2d6-update",
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}
