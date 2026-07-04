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
}): string {
  const body = opts.rawScript
    ? 'var __r = eval("(function(){" + "' + esc(`return (${opts.rawScript});`) + '" + "})()");\n' +
      '        __payload = "{\\"value\\":" + __jsonStr(String(__r)) + "}";'
    : '$.evalFile(new File("' + esc(opts.libPath) + '"));\n' +
      '        __payload = aeExecuteCommand("' + esc(opts.command) + '", ' +
      '(typeof JSON !== "undefined" && JSON.parse) ? JSON.parse("' + esc(opts.argsJson) + '") : eval("(" + "' + esc(opts.argsJson) + '" + ")"));';

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
  const libPath = join(__dirname, "scripts", "ae-commands.jsx");

  writeFileSync(wrapperPath, buildWrapper({
    id,
    command,
    argsJson: JSON.stringify(args ?? {}),
    libPath,
    resultPath,
    rawScript: opts.rawScript,
  }));

  const aePath = opts.aePath ?? findAfterFx();
  const doSpawn = opts.spawnFn ?? spawn;
  doSpawn(aePath, ["-r", wrapperPath], { stdio: "ignore", detached: true }).unref?.();

  const timeoutMs = opts.timeoutMs ?? 30_000;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 250));
    if (!existsSync(resultPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(resultPath, "utf8"));
      if (parsed.id !== id) continue; // stale file from another run
      rmSync(resultPath, { force: true });
      rmSync(wrapperPath, { force: true });
      if (parsed.status === "error") throw new Error(`AE error in ${command}: ${parsed.error}`);
      return typeof parsed.result === "string" ? JSON.parse(parsed.result) : parsed.result;
    } catch (e) {
      if (e instanceof SyntaxError) continue; // partially written — retry
      throw e;
    }
  }
  rmSync(wrapperPath, { force: true });
  throw new Error(`AE command '${command}' timed out after ${timeoutMs}ms — is After Effects running?`);
}
