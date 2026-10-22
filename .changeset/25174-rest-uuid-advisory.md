---
'@objectstack/cli': patch
'create-objectstack': patch
---

fix(cli,create-objectstack): new projects override `uuid` below 12.0.0 to `^11.1.1`, so `npm audit` lists no GHSA-w5hq-g745-h8pq entry

Clause-②: no
Metadata-protocol: none

`@objectstack/rest` depends on `exceljs ^4.4.0`, and exceljs 4.4.0, its newest release, depends on `uuid ^8.3.0`. GHSA-w5hq-g745-h8pq affects `uuid` below 11.1.1, so `npm audit` in a fresh npm-installed scaffold reported 9 moderate entries, all from that one advisory. The npm `overrides` block every standalone scaffold emits now carries `"uuid@<12.0.0": "^11.1.1"`: the `create-objectstack` blank template, `os init` (`-t app`, `-t plugin`, `-t empty`) and `os create plugin`. A new project resolves `uuid` 11.1.1 and `npm audit` lists no `uuid` entry, measured on npm 10.9.9 and 11.21.1. exceljs calls only `uuid`'s `v4()`, which `uuid` 11 keeps; the xlsx export and import paths were run on the installed tree. pnpm ignores npm's `overrides` field.

The selector stops at `<12.0.0`, so a project's own later `npm install uuid` (a newer major) is not refused as conflicting with the override.

**An existing project made by an earlier `create-objectstack`, `os init` or `os create plugin`**, or any other npm project that installs `@objectstack/rest`, `@objectstack/runtime` or `@objectstack/cli`: add `"uuid@<12.0.0": "^11.1.1"` to the `overrides` block of its root `package.json` and run `npm install`. npm reads `overrides` only from the root manifest, so no `@objectstack/*` release can apply it for you.
