// What the service worker may cache. Classic script: loaded by sw.js via importScripts and by tests.
// App shell only: built assets, manifest.json, free.json, vendored libraries. Never book pages or library.json.
function shouldCache(url, origin) {
  const u = new URL(url);
  if (u.origin !== origin) return false;
  let p = u.pathname;
  try { p = decodeURIComponent(p); } catch { return false; } // %2F and friends must not hide a path from the rules below
  if (p.endsWith("/library.json")) return false;
  // the first /pages/ must be followed by core/<file> and there must be no second /pages/ (so /pages/x/pages/core/y fails)
  if (p.includes("/pages/") && !/^(?:(?!\/pages\/).)*\/pages\/core\/[^/\\]+$/.test(p)) return false;
  // likewise the only /data/ files are manifest.json and free.json directly under the one /data/
  if (p.includes("/data/") && !/^(?:(?!\/data\/).)*\/data\/(manifest|free)\.json$/.test(p)) return false;
  return true;
}
