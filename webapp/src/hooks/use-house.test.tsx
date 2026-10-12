// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api-client.ts", () => ({ api: { patchHouse: vi.fn(), getHouse: vi.fn() } }));
vi.mock("../lib/auth-store.ts", () => ({ authStore: { updateHouse: vi.fn(), getSnapshot: () => ({ status: "signedOut" }) } }));

import { api } from "../lib/api-client.ts";
import { usePatchHouse } from "./use-house.ts";
import { mountHook } from "./mutation-harness.test-util.tsx";

let unmount: (() => void) | undefined;
beforeEach(() => vi.clearAllMocks());
afterEach(() => { unmount?.(); unmount = undefined; });

describe("usePatchHouse", () => {
  it("invalidates the cached reports: a unit or can-size change alters their totals", async () => {
    vi.mocked(api.patchHouse).mockResolvedValue({ id: "h", name: "Home", settings: {} } as never);
    const h = await mountHook(() => usePatchHouse());
    unmount = h.unmount;
    await act(async () => { await h.result.mutateAsync({ canSizeMg: 85_000 } as never); });
    expect(h.qc.getQueryState(h.reportKey)?.isInvalidated).toBe(true);
  });
});
