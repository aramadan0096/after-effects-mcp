# Live Smoke Test — after-effects-mcp

**Date:** 2026-07-04  
**Branch:** feat/opticxi-improvements  
**AE process PID:** 57976  
**AE version:** 26.2.1x2 (After Effects 2026)  
**Build:** `build/index.js` + `build/aeRunner.js` rebuilt immediately before test (`npm run build` now emits both bundles)

## Procedure

With After Effects running (project `test2.aep` open), ran from repo root:

```bash
node -e "
import('./build/aeRunner.js').then(async ({ runInAe }) => {
  console.log('project:', JSON.stringify(await runInAe('getProjectInfo', {})).slice(0, 120));
  console.log('script :', JSON.stringify(await runInAe('runScript', {}, { rawScript: 'app.version' })));
}).catch((e) => { console.error(e.message); process.exit(1); });
"
```

Both commands completed within ~5 s (read-only; no changes to the open project).

## Recorded Output

### getProjectInfo

```json
{"projectName":"test2.aep","path":"E:\\Scripts\\OpticXI\\AE_plugin\\extras\\test2.aep","numItems":9,"bitsPerChannel":8,"timeMode":"Timecode","items":[{"id":14,"name":"DefaultPlayer.png","type":"Footage"},{"id":20,"name":"Gemini_Generated_Image_alpha_logoCrop2.png","type":"Footage"},{"id":576,"name":"ramadan-sobhi-19.png","type":"Footage"},{"id":577,"name":"taher-mohamed-4.png","type":"Footage"},{"id":1,"name":"Comp1","type":"Composition"},{"id":129,"name":"Comp2","type":"Composition"},{"id":562,"name":"Compare","type":"Composition"},{"id":157,"name":"shapes","type":"Composition"},{"id":380,"name":"side","type":"Composition"}],"itemCounts":{"compositions":5,"footage":4,"folders":0,"solids":0},"activeComp":{"id":562,"name":"Compare","width":1920,"height":1080,"duration":2.32,"frameRate":25,"numLayers":8}}
```

### runScript (app.version)

```json
{"value":"26.2.1x2"}
```

## Result

PASS — `getProjectInfo` returned 9-item project with 5 compositions; `app.version` returned `"26.2.1x2"`. No AE script-security prompt was raised. Read-only: zero modifications to the open project.
