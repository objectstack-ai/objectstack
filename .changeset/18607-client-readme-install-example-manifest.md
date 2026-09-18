---
"@objectstack/client": patch
---

docs(client): the published README's `packages.install` example is a manifest `ManifestSchema` actually accepts (#18607)

The example shipped in the `@objectstack/client` npm tarball was refused on three
counts when parsed against the contract its own call site declares
(`PackageInstallRequestSchema`, whose `manifest` key is `ManifestSchema`):
`invalid_type` at `[manifest, id]`, `invalid_value` at `[manifest, type]` — both
required and absent — and `unrecognized_keys` at `[manifest]` for a `label` key
that `ManifestSchema`'s `strictObject` close refuses by name.

```diff
 await client.packages.install({
-  name: 'vendor_plugin',
-  label: 'Vendor Plugin',
+  id: 'com.vendor.plugin',
+  type: 'plugin',
+  name: 'Vendor Plugin',
   version: '1.0.0',
 });
```

`label` is not a root manifest key and never was: the root shape declares `name`
for the human-readable string (measured — `ManifestSchema` declares 25 root keys
and `label` is not among them), so the example's `label` value moves to `name`
and the machine identifier becomes the reverse-domain `id` the key documents.
`type: 'plugin'` is the enum member the example's own subject names — a
general-purpose functionality extension, not the consumer-installable `app`
bundle. Required root keys, read off the schema rather than the prose: `id`,
`name`, `type`, `version`.

Nothing parses that contract at the install door today, so the example "worked"
by being posted unvalidated — which is what made it a timed charge rather than a
live outage: closing the door turns a silently-wrong published example into a
loudly-broken one for every reader who copied it.

Pinned in `packages/client/src/readme-package-install-example.test.ts`, which
parses every `packages.install` manifest literal in this README against that
schema and fails if the corpus is ever empty.

Clause-②: no

No schema, export, type or runtime behaviour changes. It ships because the README
is listed in this package's `files[]` and is the first thing a new integrator
copies.
