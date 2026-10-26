---
'@objectstack/cli': patch
---

fix(cli): `os create plugin NAME --in-repo` scaffolds extend `tsconfig.base.json`, so `tsc` reaches the scaffold's own `src/`

Clause-②: no
Metadata-protocol: none

- **Before.** The in-repo plugin's `tsconfig.json` extended the monorepo root `tsconfig.json`. That file is the type-check program for `scripts/`, and its `exclude` (`packages`, `apps`, `examples`, `ui`) resolves against the root, so a scaffold under `packages/plugins/` inherited it and matched none of its own files: `tsc` stopped with TS18003, "No inputs were found".
- **After.** The emitted `tsconfig.json` extends `tsconfig.base.json`, the file every package in the monorepo extends, declares `types: ["node"]` and its own `exclude: ["dist", "node_modules"]`, the same shape as a sibling such as `plugin-email`. `tsc --showConfig` for the scaffold and for `plugin-email` differs only in each package's own file list.
- The default (standalone) placement is unchanged.

What to do: nothing for new scaffolds. An in-repo plugin scaffolded earlier: change its `tsconfig.json` `extends` from `../../../tsconfig.json` to `../../../tsconfig.base.json`, and add `"types": ["node"]` and `"exclude": ["dist", "node_modules"]`.
