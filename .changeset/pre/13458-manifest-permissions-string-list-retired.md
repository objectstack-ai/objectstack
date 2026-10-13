---
'@objectstack/spec': minor
'@objectstack/runtime': patch
'@objectstack/plugin-security': patch
---

feat(spec)!: a package manifest's `permissions` no longer takes a flat list of permission strings — the structured `{ services, hooks, network, fs }` block is the only form (#13458)

Clause-②: no (narrowing)

<!-- adr-0087: registered manifest-permissions-string-list-removed, manifest-permissions-string-list-retired -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings (Changesets pre mode is not yet in on `main`).

`ManifestPermissionsSchema` was a union of a flat `string[]` and the structured ADR-0025 §3.2 block. Nothing ever acted on the list: the loader registers the consented `grantedPermissions` set from the environment artifact with the permission enforcer, never the manifest's request, and the only code that met a list on a manifest was two reports saying it had been skipped. The marketplace install disclosure reads only the four lists, so a list was shown to an installer as "Requests no special permissions." (ADR-0049 enforce-or-remove). `ManifestPermissionsSchema` is now the structured block itself.

### FROM → TO

| before | what to write instead |
| --- | --- |
| `permissions: ['system.user.read', 'system.data.write']` | `permissions: { services: [...], hooks: [...], network: [...], fs: [...] }`, naming the platform services the plugin resolves, the lifecycle hooks it registers, the network hosts it reaches and the filesystem paths it touches. |
| `permissions: []` | delete `permissions`: absence is the spelling for "requests nothing". |
| a list on an app manifest that ships no code | delete `permissions`. An app's record access is its permission SETS, in the stack's own top-level `permissions` collection. |

**The one-line fix: replace every manifest `permissions` list with the structured block, or delete it.** A permission string has no mechanical mapping onto the four lists, so the translation is done by hand. `os migrate meta --from 17` lists the mechanical edits for existing sources; apply them by hand.

**What an author now sees.** Writing a list fails `tsc` (the key's type is the block), and `os validate`, `os build`, `os plugin build` and `defineStack` refuse it at `manifest.permissions` with the block's own answer: `Expected the plugin permission block { services?, hooks?, network?, fs? }, received a flat list.`, followed by the prescription. Every structured block that parsed before still parses, unchanged.

### The retirement kit

- **Schema.** `ManifestPermissionsSchema` is `PluginPermissionsSchema`, by identity, and both export names stay. The block answers a list with its prescription on its own error map, the bare-array pattern `ListViewExportOptionsSchema` uses. The block also carries `EnvironmentArtifactSchema.grantedPermissions` values, so the answer is worded true there too, where a list was never legal.
- **D2 conversion `manifest-permissions-string-list-removed`** (step 18, retired from the load path): a lossless delete of an all-string list from the stack's `manifest` and every `packages[].manifest`. The notice carries the dropped strings. A built artifact replays it at the artifact door, so an artifact built while the list was legal still boots. It never touches the structured block, an array of objects, or the top-level ADR-0090 permission-set collection.
- **D3 entry `manifest-permissions-string-list-retired`** carries the judgement the delete cannot make: what each dropped string meant in services, hooks, hosts and paths.
- **Liveness.** `manifest.permissions` stays `live` on corrected evidence. Its consumer is the marketplace install disclosure, and it refuses nothing at load. The four keys are now drilled.
- **The two skip reports reworded.** `AppPlugin`'s security registrar and `@objectstack/plugin-security`'s audience-binding reconciler both report a manifest-stage `permissions` they cannot read as permission sets. They now name the flat list as the retired legacy form. They behave as before.

**Measured producers: none outside tests.** On origin/main e67ba80049, no manifest in `examples/`, `apps/`, `packages/`, `skills/` or `content/docs/` writes a list. The exceptions are five `@objectstack/spec` `manifest.test.ts` fixtures, re-triaged here, and the skip-report tests of `@objectstack/runtime` and `@objectstack/plugin-security`, which hand a list to an unparsed bundle on purpose and still pass. The same instrument finds those five fixtures, which is its control. At the objectui pin `a58626c88dc8`, nothing reads `manifest.permissions` (control: 91 `manifest.(id|name|version)` reads), and the install disclosure reads the structured block alone. Deployed and cloud-held manifests NOT MEASURED.
