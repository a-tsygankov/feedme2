import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema.ts";

export type Db = DrizzleD1Database<typeof schema>;

/** One drizzle instance per request; it is a thin wrapper, not a pool. */
export function db(d1: D1Database): Db {
  return drizzle(d1, { schema });
}
