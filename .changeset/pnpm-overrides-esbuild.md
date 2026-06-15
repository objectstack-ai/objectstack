---
---

fix(deps): pin esbuild ≥0.28.1 and migrate orphaned overrides to pnpm-workspace.yaml

pnpm v10 reads `overrides` from `pnpm-workspace.yaml`, not package.json's `pnpm`
field — so the existing minimatch/tar pins were silently ignored and nothing
pinned esbuild. `tsup`/`tsx`/`vite` pulled esbuild 0.27.7 / 0.28.0 (< 0.28.1),
tripping GHSA-gv7w-rqvm-qjhr (high) in `pnpm audit`. Moved all overrides to
`pnpm-workspace.yaml` and added `esbuild: '>=0.28.1'`. No published-package code
change (build/test tooling + lockfile only); empty changeset.
