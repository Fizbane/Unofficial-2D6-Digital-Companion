// The Creature Type Symbols table: a creature's type is the circled letter on its card.
export const CREATURE_TYPES: Record<string, string> = { A: "Animal", F: "Fungi", H: "Humanoid", I: "Insect/Arachnid", M: "Monster", P: "Plant", U: "Undead" };
/** "H" → "Humanoid" (an unknown letter stays as it is). */
export const typeName = (letter: string): string => CREATURE_TYPES[letter] ?? letter;
