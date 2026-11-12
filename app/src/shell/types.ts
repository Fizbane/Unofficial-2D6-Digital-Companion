// Shared shell types (ResultStore itself lives in resultstore.ts).
export interface FollowOn { key: string; modifier: number; label: string }
export interface ResultCard {
  id: string; parent?: string; at: number;
  eyebrow: string;        // table code + title ("ENAT1 · Encounter"), or die label ("D66")
  title: string;          // first result cell, or the dice total
  text: string;           // remaining cells joined " — ", or "" ; "No row for N on this table." when no row
  dice: string;           // "2D6: 4 + 5 = 9", plus " +1 → 10" / " (clamped)" when modified
  sectionId?: string; context?: string; follow: FollowOn[];
}
