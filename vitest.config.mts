import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes unitários das regras puras (src/domain, src/lib). Os fluxos completos, com banco,
// automações e assistência, ficam em `npm run verify` (scripts/verify-flows.ts).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
