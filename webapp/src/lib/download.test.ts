// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "./download.ts";

describe("downloadBlob", () => {
  const create = vi.fn(() => "blob:feedme2/1");
  const revoke = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no object URLs.
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    create.mockClear();
    revoke.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("clicks a temporary download link and removes it", () => {
    const clicked: HTMLAnchorElement[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    downloadBlob(new Blob(["x"]), "r.csv");
    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.download).toBe("r.csv");
    expect(clicked[0]!.href).toBe("blob:feedme2/1");
    expect(clicked[0]!.isConnected).toBe(false);
    spy.mockRestore();
  });

  it("keeps the object URL alive for 10 s so a slow engine can start the download", () => {
    const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadBlob(new Blob(["x"]), "r.csv");
    vi.advanceTimersByTime(9_999);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith("blob:feedme2/1");
    spy.mockRestore();
  });
});
