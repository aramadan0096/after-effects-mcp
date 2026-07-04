import { existsSync } from "fs";

const YEARS = [2026, 2025, 2024, 2023, 2022, 2021];

export function findAfterFx(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string {
  if (env.AE_PATH && exists(env.AE_PATH)) return env.AE_PATH;
  for (const y of YEARS) {
    const p = `C:\\Program Files\\Adobe\\Adobe After Effects ${y}\\Support Files\\AfterFX.exe`;
    if (exists(p)) return p;
  }
  throw new Error("After Effects not found — set AE_PATH to your AfterFX.exe");
}
