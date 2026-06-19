import { describe, it, expect } from "vitest";
import { parseWatchlist, parseMultibaggers, parseMutualFunds } from "@/lib/parsers";

describe("parseWatchlist — active section", () => {
  it("parses a clean ticker entry", () => {
    const md = `
## Active Watchlist

### DEMOENG — Demo Engineering
- **Added:** 2026-04-30
- **Thesis:** triple-engine compounder
- **Confidence:** HIGH — demo monopoly
`;
    const r = parseWatchlist(md);
    expect(r.find((e) => e.ticker === "DEMOENG")).toBeDefined();
    expect(r[0].company).toBe("Demo Engineering");
    expect(r[0].confidence).toContain("HIGH");
    expect(r[0].status).toBe("active");
  });

  it("strips numbering prefix from heading", () => {
    const md = `
## Active Watchlist

### 1. DEMOENG — Demo Engineering
- **Thesis:** foo
`;
    const r = parseWatchlist(md);
    expect(r[0].ticker).toBe("DEMOENG");
  });

  it("strips trailing italic metadata from heading", () => {
    const md = `
## Active Watchlist

### DEMOMFG — Demo Manufacturing  *(rank 3, score 8.0)*
- **Thesis:** foo
`;
    const r = parseWatchlist(md);
    expect(r[0].ticker).toBe("DEMOMFG");
    expect(r[0].company).toBe("Demo Manufacturing");
  });

  it("strips trailing bracket metadata from heading", () => {
    const md = `
## Active Watchlist

### DEMOPHARMA — Demo Lifesciences [HIGH · 7.5]
- **Thesis:** foo
`;
    const r = parseWatchlist(md);
    expect(r[0].ticker).toBe("DEMOPHARMA");
    expect(r[0].company).toBe("Demo Lifesciences");
  });

  it("ignores non-ticker sub-headings inside active section", () => {
    const md = `
## Active Watchlist

### DEMOENG — Demo Engineering
- **Thesis:** foo

### Demoted in this consolidation
- DEMOCYCL — graphite
`;
    const r = parseWatchlist(md);
    expect(r.filter((e) => e.status === "active").length).toBe(1);
    expect(r[0].ticker).toBe("DEMOENG");
  });

  it("does not crash when ## Active Watchlist section is missing", () => {
    const md = `
## Format

### Foo — Bar

## Passed

### DEMOCYCL — Demo Cyclicals Ltd
- Reason: cyclical
`;
    expect(() => parseWatchlist(md)).not.toThrow();
    const r = parseWatchlist(md);
    expect(r.find((e) => e.ticker === "DEMOCYCL")).toBeDefined();
  });
});

describe("parseWatchlist — passed section", () => {
  it("recognizes ## Passed header", () => {
    const md = `
## Active Watchlist

## Passed

### DEMOCYCL — Demo Cyclicals Ltd
- Reason: graphite cyclical
`;
    const r = parseWatchlist(md);
    const entry = r.find((e) => e.ticker === "DEMOCYCL");
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("passed");
    expect(entry?.passedReason).toContain("graphite");
  });

  it("recognizes ## Demoted header variant", () => {
    const md = `
## Active Watchlist

## Demoted

### DEMOLOGI — Demo Logistics
- Reason: needs Q4
`;
    const r = parseWatchlist(md);
    const entry = r.find((e) => e.ticker === "DEMOLOGI");
    expect(entry?.status).toBe("passed");
  });

  it("recognizes ## Pruned header variant", () => {
    const md = `
## Active Watchlist

## Pruned

### DEMOCON — Demo Construction
- Reason: transition
`;
    const r = parseWatchlist(md);
    expect(r.find((e) => e.ticker === "DEMOCON")?.status).toBe("passed");
  });
});

describe("parseMultibaggers", () => {
  it("parses a numbered ticker entry", () => {
    const md = `
## Top 10 Candidates

1. DEMOENG — Demo Engineering
- CMP: ₹800
- Confidence: HIGH
- Framework fit: CCP
`;
    const r = parseMultibaggers(md);
    expect(r.entries[0]?.ticker).toBe("DEMOENG");
    expect(r.entries[0]?.company).toBe("Demo Engineering");
    expect(r.entries[0]?.confidence).toBe("HIGH");
  });

  it("ignores non-ticker first lines (no crash)", () => {
    const md = `
## Top 10 Candidates

1. Some long sentence that isn't a ticker — see footnote 3
- CMP: ₹800

2. DEMOENG — Demo Engineering
- CMP: ₹800
`;
    const r = parseMultibaggers(md);
    // Should skip the sentence one, keep DEMOENG
    expect(r.entries.some((e) => e.ticker === "DEMOENG")).toBe(true);
  });
});

describe("parseMutualFunds", () => {
  it("parses an MF holding block", () => {
    const md = `
## Snapshot (2026-05-13)

## Holdings

### DEMOFLEXI — Demo Flexi Cap Fund
- AMC: Demo Asset
- Category: Flexi Cap
- Units: 4180
- NAV: ₹54.84
- Invested: ₹1,00,000
- Value: ₹1,20,000
`;
    const r = parseMutualFunds(md);
    expect(r.entries.length).toBe(1);
    expect(r.entries[0].scheme).toBe("Demo Flexi Cap Fund");
    expect(r.entries[0].units).toBe(4180);
  });

  it("ignores non-ticker sub-headers in Holdings", () => {
    const md = `
## Holdings

### Section Header That Is Not A Ticker
- Not a fund

### DEMOELSS — Demo ELSS Tax Saver Fund
- AMC: Demo AMC
- Category: ELSS
- Units: 552
- NAV: ₹91
- Invested: ₹50000
- Value: ₹60000
`;
    const r = parseMutualFunds(md);
    expect(r.entries.length).toBe(1);
    expect(r.entries[0].scheme).toBe("Demo ELSS Tax Saver Fund");
  });
});
