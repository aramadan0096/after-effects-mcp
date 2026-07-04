# Task 3 Report: aeRunner — the -r transport

## Status: COMPLETE

**Commit:** `67c8245`
**Message:** `feat: aeRunner — direct AfterFX -r transport with correlation ids and timeout`

## Test Summary

```
Test Files  3 passed (3)
     Tests  10 passed (10)
  Duration  1000ms
```

All pre-existing tests (aePath: 3, es3: 3) plus the 4 new aeRunner tests pass.

## Files Created

- `src/aeRunner.ts` — exports `buildWrapper` and `runInAe`
- `test/aeRunner.test.ts` — 4 tests covering wrapper generation and the polling loop

## Handshake Adjustment

The brief's original fake-spawn comment used `String(argv)` to regex the result path out of the serialized argv array — that would have worked but required the result path to appear verbatim in the argv string (which it doesn't; the wrapper *path* is in argv, not the result path). The brief's own note (paragraph after the code block) already described the correct fix: "adjust fake to `readFileSync(argv[argv.indexOf("-r") + 1], "utf8")` and regex the marker from the source."

The test I wrote follows that corrected contract: the fake spawn reads the wrapper file from `argv[argv.indexOf("-r") + 1]` and extracts the result path via `/RESULT:(.+?):END/`. The implementation's `buildWrapper` emits the marker comment `// RESULT:<resultPath>:END` on line 2 of every wrapper. Both sides are consistent.

## Build

`npm run build` passes cleanly (esbuild 27.1kb, copyfiles copies all jsx scripts).

## Concerns

None. The `_fixedId` option is typed via `(opts as any)._fixedId` to avoid polluting the public signature — this is consistent with the brief's `as any` cast in the test call site.

## Fix round 1

### Fixes applied

**Finding 1 — CRITICAL: polling loop catch swallowing real errors**

Restructured `runInAe`'s polling loop so only `readFileSync` + `JSON.parse` of the result
file lives inside the `try/catch`. The `if (parsed.id !== id) continue` guard, cleanup
(`rmSync`), status-error throw, and the result double-parse all moved outside (after the
try/catch). A `SyntaxError` from a partial write still causes `continue`; any other error
(including a bad `JSON.parse` on `parsed.result`) now propagates immediately instead of
spinning to timeout.

Key diff in `src/aeRunner.ts`:
- `let parsed: any = null;` declared before try
- `try { parsed = JSON.parse(readFileSync(...)) } catch { continue; }` — only partial-write guard
- `if (parsed.id !== id) continue;` — outside catch
- `rmSync`, status check, result return — all outside catch

**Finding 2 — IMPORTANT: rawScript backslash escaping**

`buildWrapper` gains an optional `scriptPath` param. When `runInAe` receives `rawScript`,
it writes it verbatim to `script-<id>.jsx` (no escaping whatsoever) and passes `scriptPath`
to `buildWrapper`. The wrapper body then does:

```js
var __r = $.evalFile(new File("<escaped script path>"));
__payload = "{\"value\":" + __jsonStr(String(__r)) + "}";
```

The inline `eval("(function(){…})()")` path is retained as a private fallback but is no
longer exercised by `runInAe`. `script-<id>.jsx` is cleaned up alongside the wrapper and
result file (both on success and on timeout).

### Regression tests added (`test/aeRunner.test.ts`)

| Test | What it proves |
|---|---|
| `resolves to plain string when result is not JSON-shaped` | `result: "not json"` resolves to the string `"not json"` (not a SyntaxError spin) |
| `rejects immediately (not at timeout) when status is error` | status:"error" rejects in <2 s against a 10 s timeout |
| `rawScript mode … uses $.evalFile referencing the script path` | `buildWrapper({ scriptPath })` emits `$.evalFile` referencing the path, not inline text |
| `rawScript: file containing Windows paths and quotes is written byte-identical` | `runInAe` with `rawScript` writes a `script-<id>.jsx`; wrapper contains `$.evalFile` path |

Updated existing test: `rawScript mode evals the script instead of dispatching a command` now asserts the wrapper references the `scriptPath` via `$.evalFile` and does NOT contain inline script text.

### Test run output

```
 RUN  v4.1.9

 Test Files  3 passed (3)
       Tests  13 passed (13)
    Duration  1.77s
```

### Build output

```
> esbuild src/index.ts --bundle ...
  build/index.js  27.1kb
Done in 3ms
```
