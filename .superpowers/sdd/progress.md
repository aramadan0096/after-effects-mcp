# SDD progress — after-effects-mcp fork improvements (2026-07-04)
Task 1: complete (f951359..e28478a, review approved; minors: error-msg tail vs constraint [plan-internal, Step 4 code wins], missing trailing newline in test)
Task 2: complete (e28478a..476f83c incl. fix round, re-review approved; ledgered minors: unknown-command error payload shape changed [beneficial], bridge helper ordering readability)
Task 3: complete (476f83c..7698d6d incl. 2 fix rounds [fail-fast result loop, rawScript via evalFile temp file, byte-identical content test], re-review approved; ledgered: marker embeds raw path [low risk, tmpdir-only])
Task 4: complete (7698d6d..7a68d02 incl. fix round [dead constants/logs, stale allowlist], verified by grep+build+tests; ledgered minors: mcp_aftereffects_applyEffect schema drift [pre-existing], resource error shape [MCP-spec correct])
Task 5: complete (8e39a1e..13911d2 incl. README fix round, verified by grep; ledgered minors: upstream Glama badge links kept [fork unpublished], comment style)
Task 6: complete (live smoke recorded, merged to main b603b2e, tagged v0.2.0-opticxi, pushed)

## Fix-forward round (final review)

1. MEDIUM — install-bridge.js: now copies both `mcp-bridge-auto.jsx` AND `ae-commands.jsx` to the destination folder (Mac: two copyFile/sudo-cp calls; Windows: single elevated PowerShell with semicolon-chained Copy-Items). Manual-install error message updated to list both files.
2. LOW-MED — README.md: clone URL corrected from `github.com/opticxi-fork/after-effects-mcp.git` to `https://github.com/aramadan0096/after-effects-mcp.git`.
3. LOW-MED — src/scripts/ae-commands.jsx: `aeExecuteCommand` body wrapped in `app.beginUndoGroup("ae-mcp: " + command) / try { switch ... } finally { app.endUndoGroup(); }` (ES3; harmless empty undo group for read-only commands).
4. LOW — src/index.ts: get-help step reworded; "Run `node install-bridge.js`…" is now marked "Optional (legacy panel fallback)"; -r transport clarified as needing no panel.
5. LOW — src/aeRunner.ts: timeout path now removes the result stub (best-effort rmSync) but intentionally skips deleting the wrapper file (AE may still be reading it on Windows; left for OS temp cleaner, comment added). Also extended the emitted ES3 `__jsonStr` with `.replace(/\r/g, "\\r").replace(/\t/g, "\\t")` to escape lone CR and tab characters.
6. LOW — package.json build script: added `esbuild src/aeRunner.ts --bundle --platform=node --format=esm --outfile=build/aeRunner.js --packages=external` so `npm run build` emits both bundles. test/live-smoke.md updated to note this.

Verification:
- `npm run build`: build/index.js (21.9kb) + build/aeRunner.js (4.4kb) emitted — PASS
- `npx vitest run`: 13/13 tests passed (3 files) — PASS
- Live smoke (`node -e "import('./build/aeRunner.js')…runInAe('runScript',{},{rawScript:'app.version'})"` with AE 26.2.1x2 running): output `{"value":"26.2.1x2"}` — PASS
