# Quick Reference

A one-page cheat-sheet for working in the `objectui` monorepo.

## Common Commands

### Install & Build

```bash
pnpm run setup            # Build @objectstack/* at .objectstack-sha, then install (clean checkout)
pnpm install              # Install all workspace dependencies (once the pinned build exists)
pnpm exec turbo run build --filter='./*/*' --filter='!@object-ui/site'  # Build every ui package (turbo, parallel & cached)
pnpm exec turbo run type-check --filter='./*/*'                          # Run tsc --noEmit across the ui packages (turbo)
pnpm exec turbo run lint --filter='./*/*'                                # Run eslint across the ui packages (turbo)
```

Run those three from this directory: turbo reads a `./` filter against the directory it is
launched from, so the filter above selects every package under `packages/`, `apps/` and
`examples/`. This tree has no `build`, `type-check` or `lint` script of its own, because it
is a member of the objectstack workspace and a `turbo run` in a member's script would nest
inside the root's.

### Run Docs

```bash
pnpm --filter @object-ui/site dev        # Docs site at http://localhost:3000
```

### Test

Always run vitest **from the repo root**, with paths written relative to it and **no
`--`** before them:

```bash
pnpm test                                              # Run every vitest project (CI runs this)
pnpm exec vitest run packages/core/                    # Run a single package's tests
pnpm exec vitest run packages/core/src/<file>.test.ts  # Run a single test file
pnpm exec vitest run apps/console/                     # Run just the console tests
pnpm test:e2e                                          # End-to-end tests (playwright)
```

`pnpm --filter <pkg> test` and `turbo run test` are fine — objectui#3240 rewrote every
package's `test` script to name the repo root (`vitest run --root ../.. packages/<pkg>/`),
so they run the same single config CI does. What is still wrong is `cd packages/x && pnpm
exec vitest`, and a path behind `--`. Each of those moves vitest's root into a package,
where the root `unit`/`dom`/`dom-heavy` projects match nothing and only `apps/console`
resolves: 22 foreign files passed, your package never ran, output green
(objectui#3378/#3288). A guard **exits non-zero** on them and prints the correct
invocation. Vitest loads the config in the directory it was launched from, so the guard is
wired into every file that can be picked up as one: `vitest.config.mts` (the repo's only
vitest config since objectui#3240), `apps/console/vitest.config.ts`, and each
`packages/<pkg>/vite.config.ts` — the build config Vitest falls back to now that no
package carries a vitest config of its own (objectui#5406 / #3240):

```
vitest 调用被拒绝:从包目录跑 vitest 会静默跑错测试集 (objectui#3378)
...
正确跑法 —— 一律在【仓库根目录】执行,路径前【不要】加 `--`:
  pnpm exec vitest run packages/<pkg>/src/<file>.test.ts   # 只跑一个文件
  pnpm exec vitest run packages/<pkg>/   # 只跑一个包
  pnpm test   # 全量(CI 跑的就是它)
```

Details in [AGENTS.md](./AGENTS.md) (“怎么跑测试”) and `scripts/vitest-invocation-guard.mjs`.

### Examples

No directory under `examples/` is a dev server: `hello-world` is a snippet to paste
into your own app and `schema-catalog` is a data package, so neither declares a `dev`
script. [`examples/README.md`](./examples/README.md) is the index. The console to run is
`apps/console` (`pnpm dev`).

### Release (via changesets)

```bash
pnpm changeset                 # Author a changeset for your PR
pnpm changeset version         # Apply changesets & bump versions
pnpm changeset publish         # Publish to npm (CI only)
```

## Repository Layout

| Path | Purpose |
| --- | --- |
| `packages/*` | 35 published packages (`@object-ui/*`), plus the private `vscode-extension`, `test-support` (test-only, never released), `runner` (workspace demo app, never released) and `app-shell` (the Console's shell and views, no longer published after 18.2.0) |
| `apps/console` | Full ObjectUI console app (Vite + React) |
| `apps/site` | Public docs site at <https://www.objectui.org> (fumadocs) |
| `examples/*` | Runnable examples and the schema catalog — see [`examples/README.md`](./examples/README.md) |
| `content/docs/` | MDX source for the docs site |
| `e2e/` | Playwright end-to-end tests |
| `.changeset/` | Pending release notes |

## Package Tiers

| Tier | Location | Role |
| --- | --- | --- |
| Protocol | `packages/types` | Pure TypeScript types (no runtime deps) |
| Engine | `packages/core` | Registry, expression engine, action runner |
| Atoms | `packages/components` | Shadcn primitives |
| Fields | `packages/fields` | Form field widgets |
| Layout | `packages/layout`, `packages/app-shell` | Page skeletons |
| Plugins | `packages/plugin-*` | Heavy view widgets (grid, kanban, charts, …) |
| Runtime | `packages/react`, `packages/runner` | React bindings & bootstrap |
| Adapters | `packages/data-objectstack`, `packages/providers` | Data source integration |
| Platform | `packages/auth`, `packages/permissions`, `packages/i18n`, `packages/mobile`, `packages/collaboration` | Cross-cutting concerns |
| Tooling | `packages/cli`, `packages/create-plugin`, `packages/vscode-extension` | Developer experience |

## Key Documents

- [README.md](./README.md) — project overview & quick start
- [CHANGELOG.md](./CHANGELOG.md) — hand-curated release summary; each package's own
  `CHANGELOG.md` (written by Changesets on every release) is the granular, current history
- [ROADMAP.md](./ROADMAP.md) — development plan
- [CONTRIBUTING.md](./CONTRIBUTING.md) — contribution workflow
- [`content/docs/`](./content/docs/) — full documentation source

## Current Release

The release version is the monorepo's. Every `@object-ui/*` package is in one Changesets
`fixed` group with every `@objectstack/*` package (`../.changeset/config.json`), so a
release moves all of them together and any package's `package.json` names the current
version. The toolchain floors are this tree's `package.json`: `engines` and
`packageManager`. This block deliberately holds no version literal: the rows that did,
and the script that rewrote them at `changeset:version`, were retired when objectui's own
release lane left (objectstack#25711, decision 17c).

> Pending unreleased work is queued in the monorepo's `../.changeset/` — list that
> directory to see what is staged for the next release.
