import { describe, expect, it } from "vitest";
import type { Feeding } from "@feedme2/shared";
import { insertOptimistic } from "./optimistic-feedings.ts";

const f = (id: string, catId: string, fedAt: number) => ({ id, catId, fedAt }) as unknown as Feeding;

describe("insertOptimistic", () => {
  const old = [f("c", "cat1", 300), f("a", "cat1", 100)];

  it("inserts by fedAt, newest first, not on top", () => {
    expect(insertOptimistic(["feedings", { from: 0 }], old, [f("b", "cat1", 200)])!.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("skips a list filtered to another cat, takes an unfiltered one and its own cat's", () => {
    const added = [f("n", "cat2", 400)];
    expect(insertOptimistic(["feedings", { cat: "cat1" }], old, added)).toBeUndefined();
    expect(insertOptimistic(["feedings", { cat: "cat2" }], old, added)!.map((x) => x.id)).toEqual(["n", "c", "a"]);
    expect(insertOptimistic(["feedings", {}], old, added)!).toHaveLength(3);
    expect(insertOptimistic(["feedings"], old, added)!).toHaveLength(3);
  });

  it("respects the from/to window of the list", () => {
    expect(insertOptimistic(["feedings", { from: 500 }], old, [f("n", "cat1", 400)])).toBeUndefined();
    expect(insertOptimistic(["feedings", { to: 350 }], old, [f("n", "cat1", 400)])).toBeUndefined();
  });

  it("never seeds a query that has no data, or one that is not a list", () => {
    expect(insertOptimistic(["feedings", {}], undefined, [f("n", "cat1", 1)])).toBeUndefined();
    expect(insertOptimistic(["feedings", {}], { pages: [] }, [f("n", "cat1", 1)])).toBeUndefined();
  });

  it("does not add a feeding the list already has", () => {
    expect(insertOptimistic(["feedings", {}], old, [f("a", "cat1", 100)])).toBeUndefined();
  });
});
