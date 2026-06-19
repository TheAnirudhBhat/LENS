import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultProfile, loadProfile, resolveRoleTargets } from "../lib/profile";

describe("profile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lens-profile-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaultProfile carries no personal data and validates", () => {
    const p = defaultProfile();
    expect(p.version).toBe(1);
    expect(p.goals.ladder).toEqual([]);
    expect(p.allocation.roleTargets?.length).toBeGreaterThan(0);
  });

  it("loads + validates a real profile and merges over defaults", async () => {
    writeFileSync(
      join(dir, "profile.json"),
      JSON.stringify({
        version: 1,
        goals: { ladder: [{ label: "Base", value: 5 }] },
        allocation: { buckets: [], roleTargets: [{ role: "compounders", targetPct: 40 }] },
      }),
    );
    const { profile, isDemo } = await loadProfile(dir);
    expect(isDemo).toBe(false);
    expect(profile).not.toBeNull();
    expect(profile!.goals.ladder[0].value).toBe(5);
    expect(profile!.limits?.singleNameCapPct).toBe(15);
  });

  it("returns null profile with isDemo:false when no profile.json", async () => {
    const { profile, isDemo } = await loadProfile(dir);
    expect(profile).toBeNull();
    expect(isDemo).toBe(false);
  });

  it("throws on invalid profile.json", async () => {
    writeFileSync(join(dir, "profile.json"), JSON.stringify({ version: 9 }));
    await expect(loadProfile(dir)).rejects.toThrow();
  });

  it("throws on syntactically broken profile.json", async () => {
    writeFileSync(join(dir, "profile.json"), '{"version":');
    await expect(loadProfile(dir)).rejects.toThrow();
  });

  it("resolveRoleTargets overrides only the named role", () => {
    const p = defaultProfile();
    p.allocation.roleTargets = [{ role: "compounders", targetPct: 40 }];
    const t = resolveRoleTargets(p);
    expect(t.compounders.target).toBe(40);
    expect(t.growth.target).toBe(25);
  });
});
