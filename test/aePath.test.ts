import { describe, it, expect } from "vitest";
import { findAfterFx } from "../src/aePath.js";

describe("findAfterFx", () => {
  it("prefers AE_PATH when set and existing", () => {
    const p = findAfterFx({ AE_PATH: "D:\\AE\\AfterFX.exe" } as any, (x) => x === "D:\\AE\\AfterFX.exe");
    expect(p).toBe("D:\\AE\\AfterFX.exe");
  });
  it("falls back to newest installed version", () => {
    const installed = "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe";
    expect(findAfterFx({} as any, (x) => x === installed)).toBe(installed);
  });
  it("throws when nothing exists", () => {
    expect(() => findAfterFx({} as any, () => false)).toThrow(/AE_PATH/);
  });
});
