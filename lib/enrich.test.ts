import { describe, it, expect } from "vitest";
import { lastCompletedNavDay } from "./enrich";

// Instants labelled in IST so the tests pass on any machine timezone.
// Calendar anchor: 2026-08-28 = Friday, 08-29 Sat, 08-30 Sun, 08-31 Monday.
const ist = (s: string) => new Date(`${s}+05:30`);

describe("lastCompletedNavDay", () => {
  it("Monday morning → previous Friday (the weekend false-alarm case)", () => {
    expect(lastCompletedNavDay(ist("2026-08-31T09:00:00"))).toBe("2026-08-28");
  });

  it("Monday late evening → Monday itself (NAV published by then)", () => {
    expect(lastCompletedNavDay(ist("2026-08-31T21:00:00"))).toBe("2026-08-31");
  });

  it("Saturday and Sunday → previous Friday, any hour", () => {
    expect(lastCompletedNavDay(ist("2026-08-29T12:00:00"))).toBe("2026-08-28");
    expect(lastCompletedNavDay(ist("2026-08-30T23:30:00"))).toBe("2026-08-28");
  });

  it("mid-week morning → previous weekday", () => {
    expect(lastCompletedNavDay(ist("2026-08-26T10:00:00"))).toBe("2026-08-25");
  });

  it("8 PM IST is the publish cutoff: 19:59 → yesterday, 20:00 → today", () => {
    expect(lastCompletedNavDay(ist("2026-08-26T19:59:00"))).toBe("2026-08-25");
    expect(lastCompletedNavDay(ist("2026-08-26T20:00:00"))).toBe("2026-08-26");
  });

  it("IST date rollover: Tuesday 00:30 IST (Monday UTC) → Monday", () => {
    // 2026-09-01T00:30+05:30 is still 2026-08-31T19:00Z — the IST calendar
    // day must win over the server's UTC/local day.
    expect(lastCompletedNavDay(ist("2026-09-01T00:30:00"))).toBe("2026-08-31");
  });
});
