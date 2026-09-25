import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias: { "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)) } },
  test: { environment: "node", include: ["tests/xgate-client.test.ts"] },
});
