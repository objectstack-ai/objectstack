# @objectstack/console

**Prebuilt Console SPA, version-locked to the framework release that ships it.**

This package contains nothing but a prebuilt `dist/` directory: the static
assets of the ObjectStack runtime Console, baked at the commit of
[`objectstack-ai/objectui`](https://github.com/objectstack-ai/objectui)
recorded in [`.objectui-sha`](../../.objectui-sha) of this framework release.

You never install it directly. `@objectstack/cli` declares it as a
dependency, and both ship at the same version from the Changesets `fixed`
group (see [`.changeset/config.json`](../../.changeset/config.json)), so
scaffolding an app

```sh
npx create-objectstack
```

— or adding `@objectstack/cli` to an existing one — always pulls in a Console
build matched to the framework version, with no second npm dependency to keep
in sync.

## Relationship to `@object-ui/console`

| | `@object-ui/console` | `@objectstack/console` |
|---|---|---|
| Repo | [`objectstack-ai/objectui`](https://github.com/objectstack-ai/objectui) | [`objectstack-ai/objectstack`](https://github.com/objectstack-ai/objectstack) |
| Role | Standalone Console SPA on its own release cadence | Prebuilt SPA frozen at the SHA this framework release was tested against |
| Use | Cloud overlays, advanced users, anyone consuming Console directly | What every `@objectstack/cli` install gets by default |

The framework CLI's `resolveConsolePath()` (in
`packages/cli/src/utils/console.ts`) prefers `@objectstack/console` and
falls back to `@object-ui/console` when present — so cloud's Docker
overlay (which `cp -r`s its build over `node_modules/@object-ui/console`)
keeps working.

## Updating

1. Run `scripts/bump-objectui.sh` (or `scripts/bump-objectui.sh <sha>`) at
   the repo root to update `.objectui-sha`. Prefer `pnpm objectui:refresh`,
   which bumps *and* rebuilds in one step.
2. Opening the PR runs CI's **Console Pin Gate**, which clones objectui at
   the new SHA, builds `@object-ui/console` against this tree's
   `@objectstack/client`, and runs `pnpm check:console-sha`. A pin that
   cannot build fails the PR rather than the release.
3. CI runs `scripts/build-console.sh` again before publish, which clones
   objectui at the pinned SHA, builds `@object-ui/console`, and copies
   `dist/` into this package.
4. `pnpm publish` ships it at the same version as every other package in
   the Changesets `fixed` group.

The `dist/` directory is **not** committed — it's a CI publish artifact
only.

## License

Apache-2.0
