---
'@objectstack/cli': patch
---

Clause-②: no

`os init` (every template: `app`, `plugin`, `empty`) and `os create plugin` now emit
`"overrides": { "vitest": "~4.0.0" }` in the scaffolded `package.json`, so the project installs on
npm 10, the npm Node 22 bundles. Since vitest 4.1.12 shipped a peer set that contradicts itself,
`npm install` of a fresh `os init` project crashed on npm 10.9.x with
`Cannot read properties of null (reading 'edgesOut')`. The override routes every `vitest` edge in
the npm graph to the range the scaffold declares; npm 11 installs the same tree, and pnpm ignores
the field.

The override equals `devDependencies.vitest` wherever the manifest declares vitest directly,
because npm refuses an override that differs from the direct dependency (`EOVERRIDE`). In an `app`
or `empty` project, add vitest at the same range (`npm install -D vitest@~4.0.0`); a bare
`npm install -D vitest` is refused with `EOVERRIDE` while the override is in place. Existing
projects can add the same `overrides` block by hand. `os create plugin --in-repo` is unchanged.
