/**
 * Tier versions for the hidden console. The client version is inlined
 * at build time from package.json (auto-bumped by the pre-commit
 * hook); the others come from GET /api/version and degrade to null
 * offline — the console must render without a network.
 */
import { VersionResponseSchema } from "@feedme2/shared";
import pkg from "../../package.json";

export const CLIENT_VERSION: string = pkg.version;

export interface TierVersions {
  client: string;
  worker: string | null;
  schema: string | null;
  firmware: string | null;
  env: string | null;
}

const OFFLINE: Omit<TierVersions, "client"> = { worker: null, schema: null, firmware: null, env: null };

export async function fetchTierVersions(fetchFn: typeof fetch = fetch): Promise<TierVersions> {
  try {
    const res = await fetchFn("/api/version");
    if (!res.ok) return { client: CLIENT_VERSION, ...OFFLINE };
    const parsed = VersionResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { client: CLIENT_VERSION, ...OFFLINE };
    const b = parsed.data;
    return {
      client: CLIENT_VERSION,
      worker: b.worker.version,
      schema: b.schema.version,
      firmware: b.firmware.latest,
      env: b.worker.env,
    };
  } catch {
    return { client: CLIENT_VERSION, ...OFFLINE };
  }
}
