// Version numbers ("1.2.10", "v1.3.0") compared part by part, so 1.10 is newer than 1.9.
// Shared by the in-page update check and the dev server's update endpoint (scripts/vite-update.ts).

/** <0 if a is older than b, 0 if the same, >0 if a is newer. Anything after "-" or "+" is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^v/i, "").split(/[-+]/)[0].split(".").map((n) => parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** True when `latest` is a newer version than `current`. */
export const isNewer = (latest: string, current: string): boolean => compareVersions(latest, current) > 0;
