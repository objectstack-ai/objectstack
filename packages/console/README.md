# @objectstack/console

**Prebuilt Console SPA, version-locked to the framework release that ships it.**

This package contains nothing but a prebuilt `dist/` directory: the static
assets of the ObjectStack runtime Console, built from
[`ui/apps/console`](../../ui/apps/console) (`@object-ui/console`) in the same
commit of this repository as the framework release that ships it.

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
| Source | `ui/apps/console` in this repository | a copy of that build's `dist/` |
| Role | The Console SPA, versioned with the framework in the one `fixed` group | Prebuilt SPA shipped with the framework release it was built with |
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

## Building

1. `pnpm console:build` at the repo root runs turbo's
   `@objectstack/console#build:dist`, which first builds `@object-ui/console`
   (and its closure) against this tree's `@objectstack/*` through
   `workspace:^`, then runs [`build-dist.sh`](./build-dist.sh): it copies
   `ui/apps/console/dist` here, puts the tracked repo-root
   `sdui.manifest.json` over `dist/sdui.manifest.json`, and fails unless the
   bundle carries exactly one zod instance.
2. `pnpm run release` runs it after the workspace build and before
   `changeset publish`, so the publish ships it at the same version as every
   other package in the Changesets `fixed` group.

There is no pin to bump: a Console change is an ordinary change under `ui/`.

The `dist/` directory is **not** committed — it's a CI publish artifact
only.

## License

Apache-2.0
