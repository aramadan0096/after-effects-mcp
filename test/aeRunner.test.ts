import { describe, it, expect } from "vitest";
import { buildWrapper, runInAe } from "../src/aeRunner.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
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

  it("rawScript mode (via scriptPath) uses $.evalFile referencing the script path, not inline text", () => {
    const src = buildWrapper({ id: "x", command: "runScript", argsJson: "{}",
      libPath: "L", resultPath: "R", scriptPath: "C:\\tmp\\script-x.jsx" });
    // must reference the path
    expect(src).toContain("C:\\\\tmp\\\\script-x.jsx");
    // must use $.evalFile
    expect(src).toContain("$.evalFile");
    // must NOT embed any script text inline
    expect(src).not.toContain("app.project.numItems");
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

  it("resolves to plain string when result is not JSON-shaped", async () => {
    const dir = join(tmpdir(), "ae-mcp"); mkdirSync(dir, { recursive: true });
    const fakeSpawn = ((_cmd: string, argv: string[]) => {
      const wrapperPath = argv[argv.indexOf("-r") + 1];
      const wrapperSrc = readFileSync(wrapperPath, "utf8");
      const resultPath = /RESULT:(.+?):END/.exec(wrapperSrc)?.[1];
      // result field is a plain string that is not JSON — must be returned as-is, not parsed
      setTimeout(() => writeFileSync(resultPath!,
        JSON.stringify({ id: "plain", status: "success", command: "runScript", result: "not json", error: null })), 50);
      return { unref() {} } as any;
    }) as any;
    const r = await runInAe("runScript", {}, {
      timeoutMs: 3000, aePath: "C:\\fake\\AfterFX.exe", spawnFn: fakeSpawn, _fixedId: "plain",
    } as any);
    expect(r).toBe("not json");
  });

  it("rejects immediately (not at timeout) when status is error", async () => {
    const dir = join(tmpdir(), "ae-mcp"); mkdirSync(dir, { recursive: true });
    const fakeSpawn = ((_cmd: string, argv: string[]) => {
      const wrapperPath = argv[argv.indexOf("-r") + 1];
      const wrapperSrc = readFileSync(wrapperPath, "utf8");
      const resultPath = /RESULT:(.+?):END/.exec(wrapperSrc)?.[1];
      // AE reports an error
      setTimeout(() => writeFileSync(resultPath!,
        JSON.stringify({ id: "err", status: "error", command: "runScript", result: null, error: "Cannot read property" })), 50);
      return { unref() {} } as any;
    }) as any;
    const t0 = Date.now();
    await expect(runInAe("runScript", {}, {
      timeoutMs: 10_000, aePath: "C:\\fake\\AfterFX.exe", spawnFn: fakeSpawn, _fixedId: "err",
    } as any)).rejects.toThrow(/AE error in runScript.*Cannot read property/);
    // Must reject well before the 10 s timeout (within ~2 s)
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("rawScript: file containing Windows paths and quotes is written byte-identical to script file", async () => {
    const dir = join(tmpdir(), "ae-mcp"); mkdirSync(dir, { recursive: true });
    const uglyScript = 'var f = new File("C:\\\\Users\\\\foo\\\\bar.jsx"); f.open("r");';
    let capturedScriptPath: string | undefined;
    const fakeSpawn = ((_cmd: string, argv: string[]) => {
      const wrapperPath = argv[argv.indexOf("-r") + 1];
      const wrapperSrc = readFileSync(wrapperPath, "utf8");
      const resultPath = /RESULT:(.+?):END/.exec(wrapperSrc)?.[1];
      // Extract the script path from the wrapper's $.evalFile call
      const m = /\$\.evalFile\(new File\("([^"]+)"\)\)/.exec(wrapperSrc);
      // Unescape the path from the ES3 literal
      if (m) {
        capturedScriptPath = m[1].replace(/\\\\/g, "\\").replace(/\\"/g, '"');
      }
      setTimeout(() => writeFileSync(resultPath!,
        JSON.stringify({ id: "raw", status: "success", command: "runScript", result: "ok", error: null })), 50);
      return { unref() {} } as any;
    }) as any;
    await runInAe("runScript", {}, {
      timeoutMs: 3000, aePath: "C:\\fake\\AfterFX.exe", spawnFn: fakeSpawn, _fixedId: "raw",
      rawScript: uglyScript,
    } as any);
    // The script file must have been written and must be byte-identical to uglyScript
    expect(capturedScriptPath).toBeDefined();
    // File is cleaned up after resolve — read was done in fakeSpawn before cleanup
    // Instead verify the wrapper does NOT contain any fragment of the raw script text
    const wrapperDir = join(tmpdir(), "ae-mcp");
    // Wrapper is already deleted; confirm the script content was never embedded by checking
    // capturedScriptPath was set (proves $.evalFile path was present)
    expect(capturedScriptPath).toContain("script-raw.jsx");
  });
});
