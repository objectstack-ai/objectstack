---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/fields': patch
'@object-ui/plugin-calendar': patch
'@object-ui/plugin-charts': patch
'@object-ui/plugin-chatbot': patch
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-editor': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-gantt': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-map': patch
'@object-ui/plugin-markdown': patch
'@object-ui/plugin-timeline': patch
'@object-ui/plugin-tree': patch
'@object-ui/plugin-view': patch
'@object-ui/providers': patch
'@object-ui/react': patch
'@object-ui/react-runtime': patch
'@object-ui/sdui-parser': patch
'@object-ui/types': patch
---

chore(ui): every ui package whose `test` script calls `vitest` now declares `vitest` as a devDependency, so `pnpm --filter @object-ui/PKG test` runs from the repository root

Clause-②: no
Metadata-protocol: none

The package `test` scripts run `vitest run --root ../.. packages/PKG/`. A pnpm script resolves its binaries from the package's own `node_modules/.bin` and the workspace root's, and vitest was installed only under `ui/node_modules/.bin`, so 24 of the 41 ui packages with a `test` script failed with `vitest: not found` from both the repository root and `ui/`. Each of them now declares `vitest: ^4.1.10`, the range `ui/package.json` and the other 17 packages already declare; the lockfile resolves every new entry to the snapshot those packages already use, so no package gains a copy. Nothing a consumer installs changes: only the `devDependencies` field of the published `package.json` moves.
