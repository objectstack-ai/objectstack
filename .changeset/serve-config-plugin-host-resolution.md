---
"@objectstack/cli": patch
---

`os serve` now resolves a `plugins: [...]` entry the served app **declares** from
that app, instead of from the CLI (#10908).

`plugins: [...]` in the app's own `objectstack.config.ts` is the documented way
to extend a deployment, but its string entries were loaded with a bare
`import()`, which Node ESM resolves against the CLI's realpath. An app that
wrote `plugins: ['@acme/my-plugin']` and declared `@acme/my-plugin` in its own
`package.json` could therefore only be served where that package happened to be
hoisted somewhere the CLI could see it — true in a dev checkout, absent on a
real distribution layout. Same mechanism as the cluster and organizations loads
fixed earlier.

Only the **declared** case moves. A specifier the app does not declare still
resolves from the CLI exactly as before, and a path or `file://` URL keeps the
base it always had, so no deployment loses a plugin it is loading today. Which
plugins are *accepted* is unchanged — the declaration gate is untouched.

One user-facing message changes: when a declared plugin cannot be loaded, the
`Failed to import plugin '<name>'` error now carries the declaration remedy
("declare it in that app's `package.json`", or the install-problem text when the
app declares it but it is not installed) instead of a bare `Cannot find package`.
