# Quick Reference

A one-page cheat-sheet for working in the `objectui` monorepo.

## Common Commands

### Install & Build

```bash
pnpm run setup            # Build @objectstack/* at .objectstack-sha, then install (clean checkout)
pnpm install              # Install all workspace dependencies (once the pinned build exists)
pnpm build                # Build every package (turbo, parallel & cached)
pnpm type-check           # Run tsc --noEmit across the workspace (turbo)
pnpm lint                 # Run eslint across the workspace
```

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

### Run Examples

```bash
pnpm --filter @object-ui/example-console-starter dev     # Fork-ready ObjectStack console
pnpm --filter @object-ui/example-byo-backend-console dev # ObjectUI on your own backend
```

Those are the only two dev servers under `examples/`: `hello-world` is a snippet to paste
into your own app and `schema-catalog` is a data package, so neither declares a `dev`
script. [`examples/README.md`](./examples/README.md) is the index — which one to pick,
what to build first, and the port each one serves on.

### Release (via changesets)

```bash
pnpm changeset                 # Author a changeset for your PR
pnpm changeset version         # Apply changesets & bump versions
pnpm changeset publish         # Publish to npm (CI only)
```

## Repository Layout

| Path | Purpose |
| --- | --- |
| `packages/*` | 38 published packages (`@object-ui/*`), plus the private `vscode-extension` and `test-support` (test-only, never released) |
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

Every value below is pinned to the manifest that owns it by
`scripts/__tests__/quick-reference-current-release-4143.test.ts` — edit the anchor and
that test tells you to edit this block. The one exception is called out on its row.

You rarely have to edit it by hand. `pnpm quick-reference:sync` rewrites these rows from
the manifests, and `pnpm quick-reference:check` reports drift without writing. The
release path runs the sync itself: `changeset:version` bumps every manifest and updates
this block in the same commit, so a release can no longer leave the block a version
behind (objectui#5394 — that had happened once per release, three times).

- **Version:** 18.1.0 (the version every `@object-ui/*` manifest carries — they are one
  `fixed` group in `.changeset/config.json`, so a release moves all of them together)
- **Spec:** `@objectstack/spec` ^18.0.0-next.1 (declared by the root `package.json` and by
  `apps/console/package.json`)
- **Client:** `@objectstack/client` ^18.0.0-next.1 (declared by `apps/console/package.json`
  and `packages/data-objectstack/package.json`)
- **Node.js:** ≥ 22.13 (see root `engines.node`)
- **pnpm:** ≥ 10 (the workspace pins `pnpm@10.31.0` via `packageManager`)
- **React:** 19.x (the `peerDependencies.react` range the packages declare)
- **TypeScript:** ≥ 5.0 (strict mode) — the stack floor stated in AGENTS.md §2, not a
  manifest fact: nothing in this tree declares a `typescript` range to check it against,
  so this is the one row above that no test can hold to account.

> Pending unreleased work is queued in `.changeset/` — list that directory to see what is
> staged for the next release.
