import type { TokensResponse } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { ACCESS_TTL_SEC, signAccessToken } from "./tokens.ts";
import { type HousesRepo, toApiHouse } from "../repos/houses.ts";
import { RefreshTokensRepo } from "../repos/refresh-tokens.ts";

export type HouseRow = NonNullable<Awaited<ReturnType<HousesRepo["findById"]>>>;

/** A house session (access + refresh token). Shared by every sign-in path: PIN, refresh, QR login. */
export async function issueTokens(env: Bindings, house: HouseRow, nowMs: number, rotatedFrom?: string): Promise<TokensResponse> {
  // Sign first: a misconfigured secret throws here, before any refresh row
  // exists, so a failed login/refresh leaves no orphan token behind.
  const accessToken = await signAccessToken(house.id, env.AUTH_SECRET, nowMs);
  const { token } = await new RefreshTokensRepo(db(env.DB)).issue(house.id, nowMs, rotatedFrom);
  return {
    accessToken,
    expiresIn: ACCESS_TTL_SEC,
    refreshToken: token,
    house: toApiHouse(house),
  };
}
