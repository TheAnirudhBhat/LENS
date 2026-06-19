export type Verdict = "Buy" | "Watch" | "Avoid";

export type CouncilTag =
  | "Hype Risk"
  | "Early Opportunity"
  | "Value Trap"
  | "Late Entry Risk";

export type CouncilSeat = {
  score: number;
  confidence: number;
  reason?: string;
  source?: string;
};

export type CouncilBreakdown = {
  fundamental: CouncilSeat;
  macro: CouncilSeat;
  risk: CouncilSeat;
  technical: CouncilSeat;
  sentiment: CouncilSeat;
};

export type USCandidate = {
  ticker: string;
  name: string;
  sector: string;
  thesis: string;
  whyNow: string;
  score: number;
  confidence: "HIGH" | "MEDIUM-HIGH" | "MEDIUM" | "LOW";
  verdict: Verdict;
  tags: CouncilTag[];
  council?: CouncilBreakdown;
};

export type MFCandidate = {
  scheme: string;
  amc: string;
  category: string;
  fiveYCagr: string;
  thesis: string;
  score: number;
  confidence: "HIGH" | "MEDIUM-HIGH" | "MEDIUM" | "LOW";
};
