---
---

Tooling-only change (objectstack#25723): the scripts, gate tests and e2e specs that read `pnpm-workspace.yaml`, `pnpm-lock.yaml`, the root manifest's `pnpm` block or `turbo.json` resolve the file through `scripts/workspace-root.mjs`, which answers the same path in this repository and one level up when the tree is the objectstack monorepo's `ui/`. The two package test files touched (`@object-ui/cli`, `@object-ui/i18n`) read this repository's own workspace manifest; no published behaviour changes.
