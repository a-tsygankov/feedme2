import type { Bindings } from "../src/env.ts";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Bindings {}
}

// vite/client isn't resolvable from backend's own node_modules (vite is
// only a transitive dep, pulled in by @cloudflare/vitest-pool-workers),
// so import.meta.glob — used in test/helpers/migrate.ts — has no ambient
// type. Declare just the shape we use rather than adding vite as a direct
// devDependency for one type.
declare global {
  interface ImportMeta {
    glob(pattern: string, options?: Record<string, unknown>): Record<string, unknown>;
  }
}
