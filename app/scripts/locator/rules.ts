// Pure rules of the locator build: the patch policy, table classes and row coverage.
// No Node or DOM APIs, so they are unit-tested with the app's tests.
import type { Box, Patch } from "../../src/lock/manifest";

// Box rotation lives in the app's lock core (the importer needs it too); re-exported for the locator and its tests.
export { rotateBox, unrotate } from "../../src/lock/rebuild";

/**
 * Build policy (not a runtime rule): a patch may repair a reading, not replace it. It is stored only when
 * it inserts at most half of the true text's characters (code points), so an empty or unrelated reading
 * (a misplaced box, an unreadable cell) is never "verified" by a patch that simply spells out the answer.
 */
export function honestPatch(p: Patch, truth: string): boolean {
  const inserted = p.reduce((t, op) => t + Array.from(op[2]).length, 0);
  return inserted <= Math.floor(Array.from(truth).length / 2);
}

/**
 * card: a creature card transcribed as Field | Value rows. text: a table from the PDF's text layer.
 * trans: any other transcribed (image) table.
 */
export type TableClass = "card" | "text" | "trans";

export function tableClass(columns: string[], src: string | undefined): TableClass {
  if (columns.map((c) => c.trim().toLowerCase()).join("|") === "field|value") return "card";
  return src === "text" ? "text" : "trans";
}

/** The gate: rows of ordinary (non-card) tables of the Codex Tablet edition, at least this share verified. */
export const GATE = { book: "codex", edition: "tablet", classes: ["text", "trans"] as TableClass[], minPct: 95 };

export interface RowCov { rows: number; verified: number; pct: number }

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);

/**
 * Row coverage per table class. A row is verified only if all its non-empty cells are; rows with no
 * non-empty cell are not counted. `cells` holds one entry per non-empty cell.
 */
export function rowCoverage(cells: { cls: TableClass; row: string; ok: boolean }[]): Record<TableClass | "all", RowCov> {
  const rows = new Map<string, { cls: TableClass; ok: boolean }>();
  for (const c of cells) {
    const r = rows.get(c.row);
    if (r) r.ok &&= c.ok; else rows.set(c.row, { cls: c.cls, ok: c.ok });
  }
  const out = {} as Record<TableClass | "all", RowCov>;
  for (const k of ["text", "trans", "card", "all"] as const) {
    const rs = [...rows.values()].filter((r) => k === "all" || r.cls === k);
    const v = rs.filter((r) => r.ok).length;
    out[k] = { rows: rs.length, verified: v, pct: pct(v, rs.length) };
  }
  return out;
}

/** The gate figure from per-class coverage: rows and verified rows summed over GATE.classes. */
export function gateFigure(byClass: Record<TableClass | "all", RowCov>): RowCov & { pass: boolean } {
  const rows = GATE.classes.reduce((t, k) => t + byClass[k].rows, 0);
  const verified = GATE.classes.reduce((t, k) => t + byClass[k].verified, 0);
  // Compared unrounded: 94.96 % must not round up to a pass.
  return { rows, verified, pct: pct(verified, rows), pass: rows > 0 && verified * 100 >= GATE.minPct * rows };
}
