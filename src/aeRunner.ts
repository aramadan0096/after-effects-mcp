import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { findAfterFx } from "./aePath.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = join(tmpdir(), "ae-mcp");

/** Escape a string for embedding inside a double-quoted ES3 string literal. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
}

export function buildWrapper(opts: {
  id: string;
  command: string;
  argsJson: string;
  libPath: string;
  resultPath: string;
  rawScript?: string;
  scriptPath?: string;
}): string {
  let body: string;
  if (opts.scriptPath) {
    // rawScript mode: the raw script was written to scriptPath; use $.evalFile to avoid any escaping
    body =
      'var __r = $.evalFile(new File("' + esc(opts.scriptPath) + '"));\n' +
      '        __payload = "{\\"value\\":" + __jsonStr(String(__r)) + "}";';
  } else if (opts.rawScript !== undefined) {
    // legacy inline path (kept for internal use only — runInAe always uses scriptPath)
    body =
      'var __r = eval("(function(){" + "' + esc(`return (${opts.rawScript});`) + '" + "})()");\n' +
      '        __payload = "{\\"value\\":" + __jsonStr(String(__r)) + "}";';
  } else {
    body =
      '$.evalFile(new File("' + esc(opts.libPath) + '"));\n' +
      '        __payload = aeExecuteCommand("' + esc(opts.command) + '", ' +
      '(typeof JSON !== "undefined" && JSON.parse) ? JSON.parse("' + esc(opts.argsJson) + '") : eval("(" + "' + esc(opts.argsJson) + '" + ")"));';
  }

  return (
`// ae-mcp wrapper (auto-generated) — do not edit
// RESULT:${opts.resultPath}:END
(function () {
    function __jsonStr(s) {
        return '"' + String(s).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"').replace(/\\r?\\n/g, "\\\\n") + '"';
    }
    var __payload = null, __err = null;
    try {
        ${body}
    } catch (e) {
        __err = e.toString() + (e.line ? " (line " + e.line + ")" : "");
    }
    var out = '{"id":"${opts.id}","status":"' + (__err ? "error" : "success") + '",' +
        '"command":"${esc(opts.command)}",' +
        '"result":' + (__err ? "null" : __payload) + ',' +
        '"error":' + (__err ? __jsonStr(__err) : "null") + '}';
    var f = new File("${esc(opts.resultPath)}");
    f.encoding = "UTF-8"; f.open("w"); f.write(out); f.close();
})();`);
}

export async function runInAe(
  command: string,
  args: object,
  opts: {
    timeoutMs?: number;
    rawScript?: string;
    aePath?: string;
    spawnFn?: typeof spawn;
    _fixedId?: string;
  } = {},
): Promise<any> {
  mkdirSync(PROTO_DIR, { recursive: true });
  const id = (opts as any)._fixedId ?? randomUUID();
  const resultPath = join(PROTO_DIR, `result-${id}.json`);
  const wrapperPath = join(PROTO_DIR, `cmd-${id}.jsx`);
  const scriptPath = opts.rawScript !== undefined
    ? join(PROTO_DIR, `script-${id}.jsx`)
    : undefined;
  const libPath = join(__dirname, "scripts", "ae-commands.jsx");

  // If rawScript is provided, write it to a separate file so no escaping is needed
  if (opts.rawScript !== undefined && scriptPath !== undefined) {
    writeFileSync(scriptPath, opts.rawScript, "utf8");
  }

  writeFileSync(wrapperPath, buildWrapper({
    id,
    command,
    argsJson: JSON.stringify(args ?? {}),
    libPath,
    resultPath,
    rawScript: scriptPath !== undefined ? undefined : opts.rawScript,
    scriptPath,
  }));

  const aePath = opts.aePath ?? findAfterFx();
  const doSpawn = opts.spawnFn ?? spawn;
  doSpawn(aePath, ["-r", wrapperPath], { stdio: "ignore", detached: true }).unref?.();

  const timeoutMs = opts.timeoutMs ?? 30_000;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 250));
    if (!existsSync(resultPath)) continue;

    // Only file-read + JSON.parse stays inside the retry try/catch (guards partial writes)
    let parsed: any = null;
    try {
      parsed = JSON.parse(readFileSync(resultPath, "utf8"));
    } catch {
      continue; // partially written — retry
    }

    if (parsed.id !== id) continue; // stale file from another run

    // Cleanup and post-parse logic are OUTSIDE the catch so real errors propagate
    rmSync(resultPath, { force: true });
    rmSync(wrapperPath, { force: true });
    if (scriptPath !== undefined) rmSync(scriptPath, { force: true });

    if (parsed.status === "error") throw new Error(`AE error in ${command}: ${parsed.error}`);

    return typeof parsed.result === "string" && /^[\[{"]/.test(parsed.result.trim())
      ? JSON.parse(parsed.result)
      : parsed.result;
  }
  rmSync(wrapperPath, { force: true });
  if (scriptPath !== undefined) rmSync(scriptPath, { force: true });
  throw new Error(`AE command '${command}' timed out after ${timeoutMs}ms — is After Effects running?`);
}
