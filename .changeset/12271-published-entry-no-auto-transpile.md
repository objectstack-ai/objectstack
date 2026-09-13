---
"@objectstack/cli": patch
---

`bin/run.js` — the entry `os` / `objectstack` names — resolves its commands from `dist/` whatever an ambient `NODE_ENV` says, so an exported `NODE_ENV=development` no longer kills the CLI in a project whose tsconfig maps a package to TypeScript source (#12271).

`@oclif/core` skips its TypeScript path lookup only when `isProd()` — a negated `['development', 'test'].includes(NODE_ENV)`. Under either value it resolved the CLI's **own** command modules from `src/` and registered tsx on the way, and tsx honours the tsconfig of the **current working directory**. An application that maps a CommonJS workspace package to its TypeScript source for *type* resolution — `"@objectstack/formula": ["../../packages/formula/src/index.ts"]` — therefore steered this CLI's *runtime* module graph into `.ts` files, after which Node's CommonJS resolver walked their extensionless siblings and found nothing:

```
[MODULE_NOT_FOUND] import() failed to load …/packages/cli/src/commands/doctor.ts:
Cannot find module './registry'
```

Measured at two example apps with `NODE_ENV` as the only variable: `os compile`, `os dev --compile --fresh`, `os serve --dev` and `os start` each exited 1 on that signature under `development`, and each compiled or booted cleanly under `production`. The app with no `paths` block was the only one unaffected.

- **The fix is one declaration**: `settings.enableAutoTranspile = false`, checked by oclif ahead of `isProd()`. `bin/run.js` is the built entry and `bin/run-dev.js` is the source entry — a division `check:cli-test-child-env` already enforced on every test that spawns the CLI; the entry simply never asserted it about itself.
- ⛔ **Not a child-environment scrub.** `os serve --dev` and `os start` are top-level processes with no parent to scrub, and the casualty was the CLI's own command table rather than the user's config, so no per-spawn `NODE_ENV` handling could reach it.
- **`NODE_ENV=development objectstack start` works again** — the debugging mode `os start` has advertised in a comment all along, and did not deliver.
- ⚠️ **What it costs, measured**: the only thing oclif keeps its TypeScript lookup alive for in production is a **linked** plugin, so a `plugins link`ed TypeScript plugin would no longer be auto-transpiled through the published entry. That path is not reachable today — `@oclif/plugin-plugins` sits in `devDependencies` and oclif's core-plugin loader only matches names under `dependencies`, so `os plugins` is not a registered command (`os --help` lists 34 topics and none is `plugins`), which is what `content/docs/plugins/index.mdx` already documents. On an unbuilt checkout the entry now answers oclif's `command not found` under `development`/`test` exactly as it already did with `NODE_ENV` unset.
