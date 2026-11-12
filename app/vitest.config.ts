import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node", css: { include: [/tokens\.css/] } }, // tokens.css?raw is read by themes.test.ts
});
