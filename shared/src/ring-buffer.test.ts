import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ring-buffer.ts";

describe("RingBuffer", () => {
  it("keeps only the most recent `capacity` items, oldest first", () => {
    const b = new RingBuffer<number>(3);
    for (const n of [1, 2, 3, 4, 5]) b.push(n);
    expect(b.toArray()).toEqual([3, 4, 5]);
    expect(b.size).toBe(3);
  });

  it("rejects a non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow(/positive integer/);
    expect(() => new RingBuffer(1.5)).toThrow(/positive integer/);
  });

  it("toArray returns a copy", () => {
    const b = new RingBuffer<number>(2);
    b.push(1);
    const a = b.toArray();
    a.push(99);
    expect(b.toArray()).toEqual([1]);
  });
});
