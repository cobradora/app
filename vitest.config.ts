import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias: { "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)) } },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    // Run via `npm run test:xgate` (vitest.xgate.config.ts): dedicated DB-less suite for the client.
    exclude: [...configDefaults.exclude, "tests/xgate-client.test.ts"],
  },
});
