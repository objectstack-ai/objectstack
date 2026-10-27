---
'@objectstack/cli': patch
'@objectstack/hono': patch
'@objectstack/plugin-dev': patch
---

`@objectstack/cli`, `@objectstack/hono` and `@objectstack/plugin-dev` now depend on the other `@objectstack/*` packages at exactly their own release version, not at a caret range. Twenty-one dependencies were published as `^<version>`: eight of the CLI's (`core`, `driver-memory`, `driver-mongodb`, `driver-sql`, `driver-sqlite-wasm`, `objectql`, `observability`, `runtime`), the Hono adapter's `runtime`, and twelve of `plugin-dev`'s (`account`, `driver-memory`, `objectql`, `plugin-auth`, `plugin-hono-server`, `plugin-security`, `rest`, `runtime`, `service-i18n`, `service-realtime`, `service-storage`, `setup`).

Clause-②: no
Metadata-protocol: none

Every `@objectstack/*` package is released together on one version, so the range bought nothing. What it did was let an app that pins exact `@objectstack/*` versions still install a newer release of these packages, and of everything they depend on, through the CLI, which mixes two releases in one tree. They are now published exact, like the other `@objectstack/*` dependencies of these three packages.

If you pinned exact versions and added `overrides` to hold these packages at your version, you can remove those overrides once you are on this release. Peer dependencies keep their caret ranges.
