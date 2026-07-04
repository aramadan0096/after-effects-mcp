# after-effects-mcp OpticXI Fork Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken file-polling ScriptUI bridge with a direct `AfterFX.exe -r` transport (correlation IDs, structured errors, temp-dir protocol), add a `run-extendscript` tool, and ship it as the registered MCP server.

**Architecture:** Command implementations move out of the 1773-line bridge panel into a pure ES3 library (`ae-commands.jsx`). The Node server generates a tiny wrapper jsx per call (embeds a UUID + absolute result path in `os.tmpdir()/ae-mcp/`), launches `AfterFX.exe -r wrapper.jsx` against the running AE instance, and polls for the matching result file. The ScriptUI bridge panel remains as an optional legacy shim that `$.evalFile`s the same library. No more Documents-folder protocol, no more manual "Check for Commands Now".

**Tech Stack:** TypeScript + esbuild (existing), @modelcontextprotocol/sdk (existing), vitest (new devDep), ExtendScript ES3 (`.jsx`).

## Global Constraints

- **ES3 only** in every `.jsx`: `var`, `function(){}`, string concat — no `let/const/=>/template literals/JSON.parse` assumptions (bundle-safe `JSON` shim already exists in the bridge; the library must not require it — build JSON strings by hand or vendor `json2`-style encode only if already present).
- All host mutations in `.jsx` wrapped in `app.beginUndoGroup`/`app.endUndoGroup` with `try/finally`.
- Result protocol (exact shape, both sides):
  `{"id":"<uuid>","status":"success"|"error","command":"<name>","result":<json>|null,"error":"<message>"|null}`
- Temp protocol dir: `path.join(os.tmpdir(), "ae-mcp")` — Node `os.tmpdir()` and ExtendScript `Folder.temp.fsName` resolve to the same directory on Windows; never use `Documents`.
- `AfterFX.exe` resolution order: `AE_PATH` env var → newest existing under `C:\Program Files\Adobe\Adobe After Effects <2026..2021>\Support Files\AfterFX.exe`.
- Green bar per task: `npm run build` succeeds AND `npx vitest run` passes.
- Repo: `e:/Scripts/OpticXI/after-effects-mcp`, branch `feat/opticxi-improvements` off `main`.
- Existing MCP registration points at `build/index.js` — do NOT change tool names users already know (`get-project-info`, `list-compositions`, `get-layer-info`, `create-*`, `set-layer-*`, `apply-effect*`); they keep working, just faster.

---

### Task 1: Vitest scaffold + `findAfterFx()`

**Files:**
- Modify: `package.json` (devDeps + test script)
- Create: `src/aePath.ts`, `test/aePath.test.ts`

**Interfaces:**
- Produces: `findAfterFx(env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean): string` — returns absolute path to AfterFX.exe or throws `Error("After Effects not found — set AE_PATH")`.

- [ ] **Step 1: Add vitest**

```bash
cd /e/Scripts/OpticXI/after-effects-mcp && git checkout -b feat/opticxi-improvements
npm install -D vitest
```

Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing test**

`test/aePath.test.ts`:
```ts
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/aePath.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/aePath.ts`**

```ts
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
```

- [ ] **Step 5: Verify green + commit**

Run: `npx vitest run && npm run build` — Expected: PASS / build ok.
```bash
git add -A && git commit -m "feat: findAfterFx with AE_PATH override + vitest scaffold"
```

---

### Task 2: Extract `ae-commands.jsx` command library from the bridge

**Files:**
- Create: `src/scripts/ae-commands.jsx`
- Modify: `src/scripts/mcp-bridge-auto.jsx` (delete the inlined implementations; `$.evalFile` the library instead)
- Create: `test/es3.test.ts`

**Interfaces:**
- Produces: global ES3 function `aeExecuteCommand(command, args)` → returns a JSON **string** (same payloads the bridge returned today). Commands preserved verbatim from the bridge dispatch: `getProjectInfo`, `listCompositions`, `getLayerInfo`, `createComposition`, `createTextLayer`, `createShapeLayer`, `createSolidLayer`, `setLayerProperties`, `setLayerKeyframe`, `setLayerExpression`, `applyEffect`, `applyEffectTemplate`, `createCamera`, `batchSetLayerProperties`, `setCompositionProperties`, `duplicateLayer`, `deleteLayer`, `setLayerMask`, `bridgeTestEffects`.

- [ ] **Step 1: Write the ES3 guard test (failing — file absent)**

`test/es3.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const SRC = ["src/scripts/ae-commands.jsx", "src/scripts/mcp-bridge-auto.jsx"];
const ES6_TOKENS = [/\blet\s/, /\bconst\s/, /=>/, /`/, /\.forEach\(/, /\.map\(/, /class\s+\w+/];

describe("ExtendScript stays ES3", () => {
  for (const f of SRC) {
    it(`${f} has no ES6 tokens`, () => {
      const text = readFileSync(f, "utf8");
      for (const re of ES6_TOKENS) expect(text).not.toMatch(re);
    });
  }
  it("ae-commands.jsx defines aeExecuteCommand", () => {
    expect(readFileSync("src/scripts/ae-commands.jsx", "utf8")).toMatch(/function aeExecuteCommand\s*\(/);
  });
});
```

Run: `npx vitest run test/es3.test.ts` — Expected: FAIL (ae-commands.jsx missing).

- [ ] **Step 2: Extract the library**

Move every `function <command>(args) {...}` implementation and its helpers (JSON polyfill block, logging-free versions) from `mcp-bridge-auto.jsx` into `src/scripts/ae-commands.jsx`, ending with:

```javascript
// Single entry point used by both the -r wrapper and the legacy bridge panel.
function aeExecuteCommand(command, args) {
    switch (command) {
        case "getProjectInfo": return getProjectInfo(args);
        case "listCompositions": return listCompositions(args);
        case "getLayerInfo": return getLayerInfo(args);
        case "createComposition": return createComposition(args);
        case "createTextLayer": return createTextLayer(args);
        case "createShapeLayer": return createShapeLayer(args);
        case "createSolidLayer": return createSolidLayer(args);
        case "setLayerProperties": return setLayerProperties(args);
        case "setLayerKeyframe": return setLayerKeyframe(args);
        case "setLayerExpression": return setLayerExpression(args);
        case "applyEffect": return applyEffect(args);
        case "applyEffectTemplate": return applyEffectTemplate(args);
        case "createCamera": return createCamera(args);
        case "batchSetLayerProperties": return batchSetLayerProperties(args);
        case "setCompositionProperties": return setCompositionProperties(args);
        case "duplicateLayer": return duplicateLayer(args);
        case "deleteLayer": return deleteLayer(args);
        case "setLayerMask": return setLayerMask(args);
        case "bridgeTestEffects": return bridgeTestEffects(args);
        default: throw new Error("Unknown command: " + command);
    }
}
```

No UI code (no `panel.add`, no `logToPanel`) may remain in the library — replace `logToPanel(...)` calls inside moved functions with nothing or comment removal. Functions keep their exact return payloads.

- [ ] **Step 3: Slim the bridge panel**

In `mcp-bridge-auto.jsx`: delete the moved implementations; at the top add

```javascript
// Command implementations live in ae-commands.jsx (shared with the -r transport).
$.evalFile(new File($.fileName).parent.fsName + "/ae-commands.jsx");
```

and change its `executeCommand(command, args)` dispatcher body to call `aeExecuteCommand(command, args)` inside its existing try/catch + result-file writing. Panel UI, manual button, and result writing stay as-is (legacy path).

- [ ] **Step 4: Verify green + commit**

Run: `npx vitest run && npm run build` (copyfiles ships both jsx to `build/scripts/`).
Expected: PASS; `build/scripts/ae-commands.jsx` exists.
```bash
git add -A && git commit -m "refactor: extract ae-commands.jsx library; bridge panel becomes thin shim"
```

---

### Task 3: `aeRunner.ts` — the -r transport (wrapper gen, spawn, correlation, timeout)

**Files:**
- Create: `src/aeRunner.ts`, `test/aeRunner.test.ts`

**Interfaces:**
- Consumes: `findAfterFx` (Task 1); `build/scripts/ae-commands.jsx` layout (Task 2).
- Produces:
  - `buildWrapper(opts: { id: string; command: string; argsJson: string; libPath: string; resultPath: string; rawScript?: string }): string` — returns wrapper jsx source.
  - `runInAe(command: string, args: object, opts?: { timeoutMs?: number; rawScript?: string; aePath?: string; spawnFn?: typeof spawn }): Promise<any>` — resolves the parsed `result`, throws on `status:"error"` or timeout.

- [ ] **Step 1: Write the failing tests**

`test/aeRunner.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildWrapper, runInAe } from "../src/aeRunner.js";
import { writeFileSync, mkdirSync } from "fs";
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
      // wrapper path is the last argv entry after "-r"
      const resultPath = /RESULT:(.+?):END/.exec(String(argv))?.[1];
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
```

Note: to make the fake spawn observable, `runInAe` writes the wrapper file whose CONTENT includes the marker `RESULT:<resultPath>:END` in a trailing comment — the test regexes it out of the wrapper path read. Simpler: `runInAe` passes the result path to spawn via argv is not possible (`-r` takes only the script), so the test's fake reads the wrapper file: adjust fake to `readFileSync(argv[argv.indexOf("-r") + 1], "utf8")` and regex the marker from the source. Implement the marker comment in `buildWrapper` (`// RESULT:<resultPath>:END`).

Run: `npx vitest run test/aeRunner.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `src/aeRunner.ts`**

```ts
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { findAfterFx } from "./aePath.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = join(tmpdir(), "ae-mcp");

/** Escape a string for embedding inside a double-quoted ES3 string literal. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
}

export function buildWrapper(opts: {
  id: string; command: string; argsJson: string;
  libPath: string; resultPath: string; rawScript?: string;
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
  opts: { timeoutMs?: number; rawScript?: string; aePath?: string; spawnFn?: typeof spawn; _fixedId?: string } = {},
): Promise<any> {
  mkdirSync(PROTO_DIR, { recursive: true });
  const id = opts._fixedId ?? randomUUID();
  const resultPath = join(PROTO_DIR, `result-${id}.json`);
  const wrapperPath = join(PROTO_DIR, `cmd-${id}.jsx`);
  const libPath = join(__dirname, "scripts", "ae-commands.jsx");
  writeFileSync(wrapperPath, buildWrapper({
    id, command, argsJson: JSON.stringify(args ?? {}), libPath, resultPath, rawScript: opts.rawScript,
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
      rmSync(resultPath, { force: true }); rmSync(wrapperPath, { force: true });
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
```

Note the result double-parse: `aeExecuteCommand` returns a JSON *string*, which the wrapper embeds verbatim as the `result` value (it is already JSON), so `parsed.result` is an object; the `typeof === "string"` branch covers commands that return plain strings.

- [ ] **Step 3: Run to verify green**

Run: `npx vitest run` — Expected: ALL PASS. Adjust the two test/impl marker details together if the fake-spawn handshake needs it — the contract that must hold: wrapper file contains `RESULT:<path>:END`, result file must echo `id`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: aeRunner — direct AfterFX -r transport with correlation ids and timeout"
```

---

### Task 4: Rewire the MCP tools onto the runner

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `runInAe(command, args)` (Task 3).
- Produces: every existing command tool returns its AE result directly (synchronous request/response). Legacy plumbing (`writeCommandFile`, `clearResultsFile`, `readResultsFromTempFile`, `getAETempDir`, the `get-results` polling tool and any "run this in AE manually" test-script tools) is deleted. `get-help` / resource endpoints stay.

- [ ] **Step 1: Rewire pattern (worked example)**

Every tool handler that today does `writeCommandFile("getProjectInfo", args)` + tells the user to fetch results later becomes:

```ts
server.tool("get-project-info", "Get info about the current After Effects project", {}, async () => {
  try {
    const result = await runInAe("getProjectInfo", {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: `ERROR: ${(e as Error).message}` }], isError: true };
  }
});
```

Apply the same transformation to every command tool (same names, same zod schemas, `runInAe("<bridgeCommand>", args)` with the bridge command names from Task 2's dispatch list). Delete `writeCommandFile`/`clearResultsFile`/`readResultsFromTempFile`/`getAETempDir` and the `get-results` tool; if `index.ts` has embedded "temp test script" generators (`ae_test_*.jsx` blocks), delete them too.

- [ ] **Step 2: Build + grep for dead code**

Run: `npm run build && npx vitest run`
Then: `grep -n "getAETempDir\|writeCommandFile\|get-results" src/index.ts` — Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor: all MCP tools run through the -r transport; delete file-poll plumbing"
```

---

### Task 5: `run-extendscript` tool + README

**Files:**
- Modify: `src/index.ts`, `README.md`

**Interfaces:**
- Produces: MCP tool `run-extendscript { script: string, timeoutMs?: number }` → evaluates the expression/IIFE in the running AE, returns `{ value: "<String(result)>" }`.

- [ ] **Step 1: Add the tool**

```ts
server.tool(
  "run-extendscript",
  "Run arbitrary ExtendScript in the running After Effects and return String(result). " +
  "Local automation tool — the script runs with full host access on this machine.",
  { script: z.string().describe("ExtendScript expression or IIFE, e.g. app.project.numItems"),
    timeoutMs: z.number().optional() },
  async ({ script, timeoutMs }) => {
    try {
      const result = await runInAe("runScript", {}, { rawScript: script, timeoutMs: timeoutMs ?? 30_000 });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `ERROR: ${(e as Error).message}` }], isError: true };
    }
  },
);
```

- [ ] **Step 2: README rewrite (fork banner)**

Replace the setup section content with: fork notice (OpticXI fork of Dakkshin/after-effects-mcp); the new transport ("no bridge panel needed — commands run through `AfterFX.exe -r` against your running After Effects; the ScriptUI bridge panel still works as a legacy fallback"); requirements (AE running, *Allow Scripts to Write Files and Access Network* enabled, optional `AE_PATH` env); the `run-extendscript` tool with its one-line security note ("arbitrary script execution on your machine — only wire this server into agents you trust"); the result protocol dir (`%TEMP%/ae-mcp`).

- [ ] **Step 3: Verify + commit**

Run: `npm run build && npx vitest run` — Expected: PASS.
```bash
git add -A && git commit -m "feat: run-extendscript tool + fork README"
```

---

### Task 6: Live smoke on running AE, merge, reinstall

**Files:**
- Create: `test/live-smoke.md` (procedure + recorded output — live test is not part of `vitest run`)

- [ ] **Step 1: Live smoke (AE must be running — read-only commands only)**

With After Effects open (any project), run from the repo root:

```bash
node -e "
import('./build/aeRunner.js').then(async ({ runInAe }) => {
  console.log('project:', JSON.stringify(await runInAe('getProjectInfo', {})).slice(0, 120));
  console.log('script :', JSON.stringify(await runInAe('runScript', {}, { rawScript: 'app.version' })));
}).catch((e) => { console.error(e.message); process.exit(1); });
"
```

Expected: project info JSON + AE version string, each within ~5 s. Record both outputs in `test/live-smoke.md` with the date. If AE shows a script-security prompt, enable *Allow Scripts to Write Files and Access Network* and rerun.

- [ ] **Step 2: Merge to main + tag**

```bash
git add -A && git commit -m "test: record live smoke run" 
git checkout main && git merge --ff-only feat/opticxi-improvements
git tag v0.2.0-opticxi && git push origin main --tags
```

- [ ] **Step 3: Reinstall check**

The Claude Code registration already points at `build/index.js` (rebuilt in Task 5), so replacement is the rebuild itself. Verify:

```bash
claude mcp list | grep -i after
```

Expected: `after-effects: node E:\Scripts\OpticXI\after-effects-mcp\build\index.js - ✔ Connected`. Note in the final report: new tools appear in sessions started after this point.
