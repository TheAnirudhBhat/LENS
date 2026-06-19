import { describe, it, expect } from "vitest";
import { SnapshotSchema, USStocksDataSchema, TasksFileSchema, parseOrThrow, ProfileSchema, USCandidateSchema, MFCandidateSchema } from "@/lib/schemas";

describe("SnapshotSchema", () => {
  it("accepts a minimal valid snapshot", () => {
    const data = {
      asOf: "2026-05-13",
      totalValue: 100000,
      holdings: [
        { ticker: "TCS", qty: 10, value: 32000 },
      ],
    };
    const r = SnapshotSchema.safeParse(data);
    expect(r.success).toBe(true);
  });

  it("rejects a snapshot without holdings", () => {
    const data = { asOf: "2026-05-13", totalValue: 100000 };
    const r = SnapshotSchema.safeParse(data);
    expect(r.success).toBe(false);
  });

  it("normalizes urgent.level 'critical' → 'crit'", () => {
    const data = {
      asOf: "2026-05-13",
      totalValue: 100,
      holdings: [],
      urgent: [{ level: "critical", headline: "DEMODEMO cut" }],
    };
    const r = SnapshotSchema.safeParse(data);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.urgent?.[0].level).toBe("crit");
    }
  });
});

describe("USStocksDataSchema", () => {
  it("accepts a valid US stocks payload", () => {
    const data = {
      totals: {
        investedINR: 100,
        currentINR: 110,
        pnlINR: 10,
        pnlPct: 10,
      },
      positions: [
        {
          ticker: "AMZN",
          name: "Amazon",
          quantity: 5,
          avgPriceUSD: 200,
          currentPriceUSD: 250,
          investedINR: 100,
          currentINR: 110,
          pnlINR: 10,
          pnlPct: 10,
        },
      ],
    };
    expect(USStocksDataSchema.safeParse(data).success).toBe(true);
  });

  it("rejects negative quantity", () => {
    const data = {
      totals: { investedINR: 100, currentINR: 110, pnlINR: 10, pnlPct: 10 },
      positions: [
        {
          ticker: "AMZN",
          name: "Amazon",
          quantity: -1,
          avgPriceUSD: 200,
          currentPriceUSD: 250,
          investedINR: 100,
          currentINR: 110,
          pnlINR: 10,
          pnlPct: 10,
        },
      ],
    };
    expect(USStocksDataSchema.safeParse(data).success).toBe(false);
  });
});

describe("TasksFileSchema", () => {
  it("accepts a tasks file with done flag", () => {
    const data = { tasks: [{ id: "t1", done: false, heading: "do thing" }] };
    expect(TasksFileSchema.safeParse(data).success).toBe(true);
  });

  it("rejects task without done", () => {
    const data = { tasks: [{ id: "t1", heading: "do thing" }] };
    expect(TasksFileSchema.safeParse(data).success).toBe(false);
  });
});

describe("parseOrThrow", () => {
  it("returns parsed data on success", () => {
    const data = { asOf: "x", totalValue: 1, holdings: [] };
    const r = parseOrThrow(SnapshotSchema, data, "test");
    expect(r.totalValue).toBe(1);
  });

  it("throws with context and path on failure", () => {
    expect(() =>
      parseOrThrow(SnapshotSchema, { asOf: "x" }, "test")
    ).toThrow(/\[test\] schema mismatch at/);
  });
});

describe("ProfileSchema", () => {
  const valid = {
    version: 1,
    goals: { ladder: [{ label: "Base", value: 1000000 }] },
    allocation: {
      buckets: [{ key: "equity", label: "Equity", targetPct: 80 }],
      roleTargets: [{ role: "compounders", targetPct: 30 }],
    },
    limits: { singleNameCapPct: 12 },
    strategy: {
      convictionLevel: "medium",
      sectorViews: [{ sector: "IT", stance: "bullish", confidence: 0.7 }],
    },
  };

  it("accepts a valid profile", () => {
    expect(ProfileSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a wrong version", () => {
    expect(ProfileSchema.safeParse({ ...valid, version: 2 }).success).toBe(false);
  });

  it("rejects sectorView confidence outside 0..1", () => {
    const bad = {
      ...valid,
      strategy: { sectorViews: [{ sector: "IT", stance: "bullish", confidence: 5 }] },
    };
    expect(ProfileSchema.safeParse(bad).success).toBe(false);
  });

  it("applies defaults for optional sections", () => {
    const minimal = { version: 1, goals: { ladder: [] }, allocation: { buckets: [] } };
    const parsed = ProfileSchema.parse(minimal);
    expect(parsed.strategy).toEqual({});
  });
});

describe("research schemas", () => {
  const validCouncilSeat = {
    score: 7,
    confidence: 0.8,
    reason: "Strong fundamentals",
    source: "10-K filing",
  };

  const validUSCandidate = {
    ticker: "NVDA",
    name: "NVIDIA Corporation",
    sector: "Technology",
    thesis: "AI infrastructure buildout drives sustained GPU demand.",
    whyNow: "Data center revenue inflecting; margin expansion underway.",
    score: 85,
    confidence: "HIGH" as const,
    verdict: "Buy" as const,
    tags: ["Early Opportunity", "Hype Risk"] as const,
    council: {
      fundamental: validCouncilSeat,
      macro: { score: 6, confidence: 0.7, reason: "Rate environment improving" },
      risk: { score: 5, confidence: 0.6, reason: "Concentration risk in hyperscalers", source: "analyst note" },
      technical: { score: 8, confidence: 0.85 },
      sentiment: { score: 9, confidence: 0.9, reason: "Momentum strong" },
    },
  };

  it("accepts a fully-populated valid US candidate", () => {
    expect(USCandidateSchema.safeParse(validUSCandidate).success).toBe(true);
  });

  it("accepts a US candidate without optional council", () => {
    const { council: _council, ...withoutCouncil } = validUSCandidate;
    expect(USCandidateSchema.safeParse(withoutCouncil).success).toBe(true);
  });

  it("rejects a US candidate missing ticker", () => {
    const { ticker: _ticker, ...noTicker } = validUSCandidate;
    expect(USCandidateSchema.safeParse(noTicker).success).toBe(false);
  });

  it("rejects a US candidate with invalid confidence", () => {
    const bad = { ...validUSCandidate, confidence: "MAYBE" };
    expect(USCandidateSchema.safeParse(bad).success).toBe(false);
  });

  const validMFCandidate = {
    scheme: "Parag Parikh Flexi Cap Fund",
    amc: "PPFAS Mutual Fund",
    category: "Flexi Cap",
    fiveYCagr: "21.4%",
    thesis: "Global diversification with disciplined value approach.",
    score: 78,
    confidence: "MEDIUM-HIGH" as const,
  };

  it("accepts a valid MF candidate", () => {
    expect(MFCandidateSchema.safeParse(validMFCandidate).success).toBe(true);
  });

  it("rejects a MF candidate missing scheme", () => {
    const { scheme: _scheme, ...noScheme } = validMFCandidate;
    expect(MFCandidateSchema.safeParse(noScheme).success).toBe(false);
  });
});
