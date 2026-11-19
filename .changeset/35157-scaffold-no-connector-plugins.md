---
'create-objectstack': minor
---

feat(create-objectstack): the blank scaffold lists no connector plugins until the app declares a connector

Clause-②: no
Metadata-protocol: none

A new project's `objectstack.config.ts` no longer lists `ConnectorRestPlugin`, `ConnectorOpenApiPlugin` and `ConnectorMcpPlugin`, and its `package.json` no longer depends on the three connector packages. A plugin is code, so an app that lists any plugin installs managed only. The scaffold's own plugin list therefore kept every AI-built app from installing as an unmanaged copy, such as a marketplace trial.

To use a connector, install its provider package and add it to `plugins:`, for example `plugins: [new ConnectorRestPlugin()]`. The template's README and the comment in `objectstack.config.ts` show how. The install contract is unchanged: a stack that lists plugins still validates for managed install only.
