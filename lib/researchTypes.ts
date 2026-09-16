// Research candidate types — derived from the zod schemas in lib/schemas.ts so
// the shapes have a single source of truth (the schema validates them at the
// route boundary; these are the inferred TS views consumed by the UI).
import type { z } from "zod";
import type {
  USCandidateSchema,
  MFCandidateSchema,
  CouncilSeatSchema,
  CouncilBreakdownSchema,
} from "@/lib/schemas";

export type USCandidate = z.infer<typeof USCandidateSchema>;
export type MFCandidate = z.infer<typeof MFCandidateSchema>;
export type CouncilSeat = z.infer<typeof CouncilSeatSchema>;
export type CouncilBreakdown = z.infer<typeof CouncilBreakdownSchema>;
export type Verdict = USCandidate["verdict"];
export type CouncilTag = USCandidate["tags"][number];
