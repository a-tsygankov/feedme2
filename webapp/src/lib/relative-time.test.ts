import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time.ts";

describe("relativeTime", () => {
  const now = 10_000_000_000;
  it("formats seconds, minutes, hours+minutes, days", () => {
    expect(relativeTime(now, now - 20_000)).toBe("just now");
    expect(relativeTime(now, now - 5 * 60_000)).toBe("5 m ago");
    expect(relativeTime(now, now - (2 * 60 + 10) * 60_000)).toBe("2 h 10 m ago");
    expect(relativeTime(now, now - 26 * 3_600_000)).toBe("1 d 2 h ago");
  });
  it("a future timestamp (phone clock ahead) reads as just now", () => {
    expect(relativeTime(now, now + 600_000)).toBe("just now");
  });
  it("null means never", () => {
    expect(relativeTime(now, null)).toBe("never");
  });
  it("switches unit exactly at the boundaries", () => {
    expect(relativeTime(now, now - 59_000)).toBe("just now");
    expect(relativeTime(now, now - 60_000)).toBe("1 m ago");
    expect(relativeTime(now, now - 59 * 60_000)).toBe("59 m ago");
    expect(relativeTime(now, now - 60 * 60_000)).toBe("1 h ago");
    expect(relativeTime(now, now - (23 * 60 + 59) * 60_000)).toBe("23 h 59 m ago");
    expect(relativeTime(now, now - 24 * 3_600_000)).toBe("1 d ago");
  });
  it("a non-finite input reads as unknown rather than 'NaN m ago'", () => {
    expect(relativeTime(now, NaN)).toBe("unknown");
    expect(relativeTime(NaN, now)).toBe("unknown");
    expect(relativeTime(now, Infinity)).toBe("unknown");
  });
});
