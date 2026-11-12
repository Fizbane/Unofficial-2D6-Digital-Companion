// 2D6 Void's portrait gallery: survivors in four art styles, served from
// public/portraits/void/<style>/<id>.webp (256×256, centre-cropped). To add one, drop a square
// picture in the style's folder and list it here; replace a file of the same name to change it.

export type VoidArtStyle = "anime" | "cyberpunk" | "realistic" | "steampunk";

export const VOID_ART_STYLES: { id: VoidArtStyle; name: string }[] = [
  { id: "anime", name: "Anime" },
  { id: "cyberpunk", name: "Cyberpunk" },
  { id: "realistic", name: "Realistic" },
  { id: "steampunk", name: "Steampunk" },
];

export interface VoidPortrait { id: string; name: string; style: VoidArtStyle }

export const VOID_PORTRAITS: readonly VoidPortrait[] = [
  { style: "anime", id: "goblin-mystic", name: "Goblin mystic" },
  { style: "anime", id: "goblin-tinker", name: "Goblin tinker" },
  { style: "anime", id: "masked-elf", name: "Masked elf" },
  { style: "anime", id: "orc-brawler", name: "Orc brawler" },
  { style: "anime", id: "masked-operative", name: "Masked operative" },
  { style: "cyberpunk", id: "neon-runner", name: "Neon runner" },
  { style: "cyberpunk", id: "goblin-netrunner", name: "Goblin netrunner" },
  { style: "cyberpunk", id: "goblin-engineer", name: "Goblin engineer" },
  { style: "cyberpunk", id: "insectoid-scout", name: "Insectoid scout" },
  { style: "realistic", id: "orc-trooper", name: "Orc trooper" },
  { style: "realistic", id: "orc-sellsword", name: "Orc sellsword" }, // "sellsword" avoids a locked Dungeon title (check-dist)
  { style: "realistic", id: "masked-hunter", name: "Masked bounty hunter" },
  { style: "realistic", id: "alien-pirate", name: "Alien pirate captain" },
  { style: "realistic", id: "aquatic-alien", name: "Aquatic alien" },
  { style: "realistic", id: "avian-ranger", name: "Avian ranger" },
  { style: "realistic", id: "lizard-navigator", name: "Lizardfolk navigator" },
  { style: "realistic", id: "dragonborn-guard", name: "Dragonborn guard" },
  { style: "steampunk", id: "goblin-scavenger", name: "Goblin scavenger" },
  { style: "steampunk", id: "goblin-pilot", name: "Goblin pilot" },
  { style: "steampunk", id: "lizard-corsair", name: "Lizardfolk corsair" },
];

/** The portraits drawn in one style. */
export const portraitsIn = (style: VoidArtStyle) => VOID_PORTRAITS.filter((p) => p.style === style);

/** The picture's URL, relative to the app (works under any base path). */
export const voidPortraitUrl = (style: VoidArtStyle, id: string) => `portraits/void/${style}/${id}.webp`;
