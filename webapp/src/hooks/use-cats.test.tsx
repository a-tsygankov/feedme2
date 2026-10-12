// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api-client.ts", () => ({ api: { listCats: vi.fn(), createCat: vi.fn(), patchCat: vi.fn(), deleteCat: vi.fn() } }));

import { api } from "../lib/api-client.ts";
import { useCatMutations } from "./use-cats.ts";
import { mountHook } from "./mutation-harness.test-util.tsx";

const id = "123e4567-e89b-42d3-a456-426614174000";
let unmount: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.createCat).mockResolvedValue({ id } as never);
  vi.mocked(api.patchCat).mockResolvedValue({ id } as never);
  vi.mocked(api.deleteCat).mockResolvedValue(undefined as never);
});
afterEach(() => { unmount?.(); unmount = undefined; });

// Reports carry each cat's name and colour, and a removed cat is marked deleted, so every cat change makes them stale.
describe("useCatMutations", () => {
  const cases: [string, (m: ReturnType<typeof useCatMutations>) => Promise<unknown>][] = [
    ["create", (m) => m.create.mutateAsync({ id, name: "Mochi" } as never)],
    ["rename or recolour", (m) => m.patch.mutateAsync({ id, patch: { name: "Miso", color: "red" } as never })],
    ["delete", (m) => m.remove.mutateAsync(id)],
  ];
  for (const [name, run] of cases) {
    it(`${name} invalidates the cats and the cached reports`, async () => {
      const h = await mountHook(() => useCatMutations());
      unmount = h.unmount;
      h.qc.setQueryData(["cats"], []);
      await act(async () => { await run(h.result); });
      expect(h.qc.getQueryState(["cats"])?.isInvalidated).toBe(true);
      expect(h.qc.getQueryState(h.reportKey)?.isInvalidated).toBe(true);
    });
  }
});
