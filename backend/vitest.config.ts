import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // One runtime for the whole suite: isolated runtimes spawn a
        // workerd per test file and exhaust loopback connections on
        // Windows (gigsy hit ConnectEx #1225 at ~70 files).
        singleWorker: true,
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          compatibilityDate: "2025-01-01",
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            ENVIRONMENT: "development",
            AUTH_SECRET: "integration-test-secret",
          },
        },
      },
    },
  },
});
