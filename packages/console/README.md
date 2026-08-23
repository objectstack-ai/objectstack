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
`packages/cli/src/utils/console.ts`) resolves `@objectstack/console` and
nothing else — `require.resolve('@objectstack/console/package.json')` from
the app and from the CLI itself, then a direct
`<cwd>/node_modules/@objectstack/console` check. Both require the resolved
`package.json` to be *named* `@objectstack/console`, so there is **no**
`node_modules` fallback to the `@object-ui/console` npm package; it is
never consulted.

`@object-ui/console` survives in the CLI in exactly one place: the
sibling-repo dev fallback, which accepts a checked-out **source** tree at
`../objectui/apps/console` whose `package.json` `name` is either spelling
(objectui still names that workspace package `@object-ui/console`). That is
a source-checkout probe for developing the framework against in-tree
objectui edits — not a package resolution. Cloud and objectos Docker images
overlay their own Console build into `@objectstack/console`'s `dist/` — not
into any `@object-ui/console` directory.

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
