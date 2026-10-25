---
'@objectstack/console': patch
'@objectstack/cli': patch
---

build(console): `@objectstack/console` is built in this workspace from `ui/apps/console`, and the Console no longer arrives through a pinned objectui commit

Clause-②: no
Metadata-protocol: none

- **The package.** `@objectstack/console` ships the same `dist/` it shipped at 18.1.0: the built Console (`index.html`, `assets/`, the manifests it served). Two files leave the tarball: `dist/.objectui-sha`, which named the objectui commit the Console was built from, and `dist/.objectstack-injection.json`, which recorded the spec and client dists injected into that build. Both described a pin that no longer exists: the Console is built from the `ui/` tree of the same commit as the framework, so its version is the framework's version.
- **The CLI.** When a framework checkout has no built Console, `objectstack serve` / `objectstack dev` and the 503 at `/_console/` now name `pnpm console:build`, which builds `ui/apps/console` and copies its dist into `packages/console`. The remedy used to be `pnpm objectui:build`, which cloned objectui at the pinned commit.
- **One version.** The `@object-ui/*` packages join the `@objectstack/*` fixed group, so every public package of both scopes publishes at one version.

What to do: nothing as a consumer; install `@objectstack/console` as before. In a framework checkout, run `pnpm console:build` where you ran `pnpm objectui:build`.
