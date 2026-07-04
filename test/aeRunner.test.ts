import { describe, it, expect } from "vitest";
import { buildWrapper, runInAe } from "../src/aeRunner.js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("buildWrapper", () => {
  it("embeds id, command, args, lib and result path, and is ES3", () => {
    const src = buildWrapper({ id: "abc-123", command: "getProjectInfo", argsJson: "{}",
      libPath: "C:\\lib\\ae-commands.jsx", resultPath: "C:\\tmp\\r.json" });
    expect(src).toContain("abc-123");
    expect(src).toContain("getProjectInfo");
    expect(src).toContain("ae-commands.jsx");
    expect(src).toContain("r.json");
    expect(src).not.toMatch(/\blet\s|=>|`/);
  });
  it("rawScript mode evals the script instead of dispatching a command", () => {
    const src = buildWrapper({ id: "x", command: "runScript", argsJson: "{}",
      libPath: "L", resultPath: "R", rawScript: "app.project.numItems" });
    expect(src).toContain("app.project.numItems");
  });
});

describe("runInAe", () => {
  it("resolves when a matching result file appears", async () => {
    const dir = join(tmpdir(), "ae-mcp"); mkdirSync(dir, { recursive: true });
    const fakeSpawn = ((_cmd: string, argv: string[]) => {
      // wrapper path is the entry after "-r"
      const wrapperPath = argv[argv.indexOf("-r") + 1];
      const wrapperSrc = readFileSync(wrapperPath, "utf8");
      const resultPath = /RESULT:(.+?):END/.exec(wrapperSrc)?.[1];
      // The fake writes the result the wrapper would have written.
      setTimeout(() => writeFileSync(resultPath!,
        JSON.stringify({ id: "known", status: "success", command: "getProjectInfo", result: { ok: 1 }, error: null })), 50);
      return { unref() {} } as any;
    }) as any;
    const r = await runInAe("getProjectInfo", {}, {
      timeoutMs: 3000, aePath: "C:\\fake\\AfterFX.exe", spawnFn: fakeSpawn, _fixedId: "known",
    } as any);
    expect(r).toEqual({ ok: 1 });
  });
  it("rejects on timeout", async () => {
    await expect(runInAe("getProjectInfo", {}, {
      timeoutMs: 300, aePath: "C:\\fake\\AfterFX.exe", spawnFn: (() => ({ unref() {} })) as any,
    })).rejects.toThrow(/timed out/i);
  });
});
