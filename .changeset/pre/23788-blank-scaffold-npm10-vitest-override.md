---
'create-objectstack': patch
---

fix(create-objectstack): a blank scaffold installs on npm 10 again — its `package.json` overrides `vitest` to the range it already declares

Clause-②: no

A project from `npm create objectstack` (or `npx create-objectstack`) could not be installed with npm 10, the npm that Node 22 bundles and the one the scaffolder falls back to when pnpm is absent. `npm install` exited 1 with `Cannot read properties of null (reading 'edgesOut')`. The template's own dependencies were not the cause. Optional `vitest` peers deeper in the dependency tree led npm 10 to vitest 4.1.12, whose peer declarations contradict each other, and npm 10's resolver crashes on that. npm 11 installs the same project.

The blank template now ships:

```json
"overrides": {
  "vitest": "~4.0.0"
}
```

This routes every `vitest` in the npm dependency graph to the range the project declares in `devDependencies`. npm 11 already resolves the whole tree to that version, and with the override npm 10.9.x installs the identical tree. pnpm does not read npm's `overrides` field, so pnpm installs are unchanged.

If you change `devDependencies.vitest` in a scaffolded project, change `overrides.vitest` to the same value. npm refuses an override that differs from the direct dependency (`EOVERRIDE: Override for vitest@… conflicts with direct dependency`). An existing project that hits the `edgesOut` crash on npm 10 can install with npm 11 or later.
