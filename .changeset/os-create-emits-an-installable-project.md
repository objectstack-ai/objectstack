---
"@objectstack/cli": minor
---

`os create` now emits a project that installs outside this monorepo.

Every project the command scaffolded declared its `@objectstack/*` dependencies
with pnpm's `workspace:*` protocol, extended a `tsconfig.json` two directories
above itself, and was written into this repository's own `packages/plugins/` or
`examples/` by default — so a developer following the documented command got a
project `pnpm install` refuses. The default emission is now standalone:

- `@objectstack/*` dependencies are published semver ranges pinned to the
  version of the CLI that generated them;
- the emitted `tsconfig.json` is self-contained and extends nothing;
- the project is written to `./<name>` in the current directory (or `--dir`);
- a `pnpm-workspace.yaml` carries the build approvals a fresh `pnpm install`
  needs on pnpm 11.

The `plugin` template also emits `init` where it used to emit `initialize`.
`initialize` is not part of the `Plugin` contract, so the scaffold did not
type-check under its own `strict` config (TS7006 on the untyped `context`
parameter) and `kernel.use()` refused the plugin at load with
`Plugin init function is required` — a defect the kernel protocol docs
previously carried a warning about instead of a fix.

The previous monorepo-internal placement is still available for ObjectStack
platform work as the explicit `--in-repo` flag, which keeps the `workspace:*`
specs and writes into `packages/plugins/` or `examples/`.
