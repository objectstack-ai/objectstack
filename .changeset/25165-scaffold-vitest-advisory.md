---
'@objectstack/cli': patch
'create-objectstack': patch
---

fix(cli,create-objectstack): new projects declare vitest `~4.1.12`, outside GHSA-qxg6-89mg-rqv8, and still install on npm 10

Clause-②: no
Metadata-protocol: none

The vitest range every scaffold declares moves from `~4.0.0` to `~4.1.12`: the `create-objectstack` blank template, `os init -t plugin` and `os create plugin` (in `devDependencies`), and the npm `overrides` block that every standalone scaffold emits, `os init -t app` and `-t empty` included. `~4.0.0` resolved to vitest and `@vitest/mocker` 4.0.18, inside GHSA-qxg6-89mg-rqv8 (`@vitest/mocker` from 2.1.0-beta.7 up to the fix in 4.1.12), which has no 4.0.x fix. A new project now resolves vitest and `@vitest/mocker` 4.1.12 or a later 4.1.x patch, and `npm audit` of a fresh scaffold lists no vitest or `@vitest/*` advisory.

npm 10, the npm Node 22 bundles, still installs every scaffold. The `overrides.vitest` entry, which equals `devDependencies.vitest`, is what makes that hold: it settles vitest 4.1.12's contradictory optional peer (`@vitest/browser-webdriverio`), which npm 10 otherwise crashes on with `Cannot read properties of null (reading 'edgesOut')`. Measured on npm 10.9.4, 10.9.9 and 11.21.1. pnpm ignores npm's `overrides` field.

**An existing project made by an earlier `create-objectstack`, `os init` or `os create plugin`** keeps its own `~4.0.0`. To move it, set `overrides.vitest` to `~4.1.12` in `package.json`, and `devDependencies.vitest` too where the project declares it, then run `npm install`. npm refuses an override that differs from the direct dependency (`EOVERRIDE`), so the two move together.
