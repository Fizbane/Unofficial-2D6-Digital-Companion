import type { Plugin } from "vite";
import { normalizePath } from "vite";
import { fileURLToPath } from "node:url";

const coreModule = normalizePath(fileURLToPath(new URL("../src/dice/celestial.ts", import.meta.url)));

/** Attach the core after dice-box creates the physical die's Babylon mesh. */
export function celestialDice(): Plugin {
  return {
    name: "2d6-celestial-dice",
    config: () => ({ optimizeDeps: { exclude: ["@3d-dice/dice-box"] } }),
    transform(code, id) {
      if (!normalizePath(id.split("?")[0]).endsWith("/@3d-dice/dice-box/dist/Dice.js")) return;
      const meshAssignment = /addShadowCaster\((\w+)\), this\.mesh = \1;/g;
      if ([...code.matchAll(meshAssignment)].length !== 1) {
        this.error("Dice-box changed how it creates dice meshes. Update the celestial dice hook.");
      }
      return {
        code: `import { mountCelestialCore } from "${coreModule}";\n${code.replace(meshAssignment, "$& mountCelestialCore(this);")}`,
        map: null,
      };
    },
  };
}
