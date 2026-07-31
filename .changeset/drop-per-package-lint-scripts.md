---
---

fix(dx): remove the per-package `lint` scripts (`eslint src`) from `@objectstack/verify`, `@objectstack/cli` and `@objectstack/lint` (#4276). A standalone run resolves the root flat config but honors the inline directives the root gate's `--no-inline-config` exists to ignore, so it fails on rules the config never registers — verify was red on a clean HEAD. Lint only from the root; the scoped recipe is documented in `eslint.config.mjs`. Dev scripts only; releases nothing.
