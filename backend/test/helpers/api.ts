import { SELF } from "cloudflare:test";
import { TokensResponseSchema } from "@feedme2/shared";

let counter = 0;

/** Creates a fresh house via the real route and returns an authed fetch. */
export async function signup(name = `House ${++counter} ${Date.now()}`, pin = "1234") {
  const res = await SELF.fetch("http://feedme2/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ houseName: name, pin }),
  });
  if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${await res.text()}`);
  const tokens = TokensResponseSchema.parse(await res.json());
  const fetchAuthed = (path: string, init: RequestInit = {}) =>
    SELF.fetch(`http://feedme2${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.accessToken}`, ...(init.headers ?? {}) },
    });
  return { houseId: tokens.house.id, access: tokens.accessToken, refresh: tokens.refreshToken, house: tokens.house, fetchAuthed, name, pin };
}

export const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
