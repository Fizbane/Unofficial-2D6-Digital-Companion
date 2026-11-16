// Fit a map to the room its page really has. The CSS (dungeon.css) already scales a map to the width
// it is given and caps its height at a viewport guess; this measures the page's scroller instead, so
// a tall map (the 17 × 28 Hulk) fills what is left below the page head and no more, and re-measures
// whenever the window, a side panel or the drawer layout changes the space. It sets `--map-fit` (px)
// on the host; CSS reads it as `max-height: max(floor, var(--map-fit, fallback))`.
export function fitMapToSpace(host: HTMLElement, onDispose: (fn: () => void) => void, bottomGap = 16): void {
  const scroller = host.closest<HTMLElement>(".tab-page");
  if (!scroller) return;
  const measure = () => {
    const wrap = host.querySelector<HTMLElement>(".map-wrap");
    if (!wrap) return;
    // where the map starts inside the scrolled content, so the answer doesn't depend on scrollTop
    const top = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const room = Math.floor(scroller.clientHeight - top - bottomGap);
    if (room > 0) host.style.setProperty("--map-fit", `${room}px`);
  };
  const ro = new ResizeObserver(measure);
  ro.observe(scroller);
  ro.observe(host);
  const mo = new MutationObserver(measure); // the map redraws (a room card opens, the level changes)
  mo.observe(host, { childList: true, subtree: false });
  measure();
  onDispose(() => {
    ro.disconnect();
    mo.disconnect();
  });
}
