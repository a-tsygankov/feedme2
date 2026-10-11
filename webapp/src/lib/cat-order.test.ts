import { describe, expect, it } from "vitest";
import { moveCat, orderChanges } from "./cat-order.ts";

const cats = [{ id: "a", sortOrder: 0 }, { id: "b", sortOrder: 1 }, { id: "c", sortOrder: 2 }];

describe("moveCat", () => {
  it("swaps a middle cat with its neighbour and returns the full renumbered list", () => {
    expect(moveCat(cats, "b", -1)).toEqual([{ id: "b", sortOrder: 0 }, { id: "a", sortOrder: 1 }, { id: "c", sortOrder: 2 }]);
    expect(moveCat(cats, "b", 1)).toEqual([{ id: "a", sortOrder: 0 }, { id: "c", sortOrder: 1 }, { id: "b", sortOrder: 2 }]);
  });
  it("leaves the order alone at the edges", () => {
    expect(moveCat(cats, "a", -1).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(moveCat(cats, "c", 1).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
  it("never leaves ties, even when the stored sort orders collide or have gaps", () => {
    // Incident shape: patching only the moved cat to `i - 1` left two cats on the same sortOrder.
    const tied = [{ id: "a", sortOrder: 0 }, { id: "b", sortOrder: 0 }, { id: "c", sortOrder: 7 }];
    const moved = moveCat(tied, "c", -1);
    expect(moved.map((c) => c.id)).toEqual(["a", "c", "b"]);
    expect(moved.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
  });
  it("ignores an unknown id", () => {
    expect(moveCat(cats, "zzz", 1)).toEqual(cats);
  });
  it("does not mutate its input", () => {
    const copy = structuredClone(cats);
    moveCat(cats, "b", 1);
    expect(cats).toEqual(copy);
  });
});

describe("orderChanges", () => {
  it("returns only the cats whose sortOrder changed (two for an adjacent swap)", () => {
    expect(orderChanges(cats, moveCat(cats, "b", 1))).toEqual([{ id: "c", sortOrder: 1 }, { id: "b", sortOrder: 2 }]);
  });
  it("is empty for a no-op", () => {
    expect(orderChanges(cats, moveCat(cats, "a", -1))).toEqual([]);
  });
});
