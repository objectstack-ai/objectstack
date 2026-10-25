---
---

Tooling-only change (objectstack#25733): three tests no longer assume this tree is the pnpm workspace root. `check-doc-snippet-types` finds installed copies in the workspace root's `node_modules/.pnpm` (`virtualStorePath()` in `scripts/workspace-root.mjs`), the Console vendor-chunk tests read their standalone and merged arms off fixture layouts, and the CLI generator test runs its in-workspace case from a fixture workspace. `@object-ui/cli`'s `currentContext()` now asks `isWorkspaceRoot(cwd)`, the predicate `dev`, `serve` and `build` already use: the same expression, so no published behaviour changes.
