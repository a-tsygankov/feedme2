/** Opaque per-install id (spec Q4 default): lets the console and the
 * feeding history say "logged from this phone" with no person identity. */
const KEY = "feedme2:clientId";

export function getClientId(storage: Pick<Storage, "getItem" | "setItem"> = localStorage): string {
  try {
    const existing = storage.getItem(KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    storage.setItem(KEY, id);
    return id;
  } catch {
    return "ephemeral";
  }
}
