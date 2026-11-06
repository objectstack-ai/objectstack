---
'@objectstack/spec': minor
'@objectstack/cli': minor
'create-objectstack': patch
---

feat(spec)!: retire five `objectstack.manifest.json` keys nothing read — `name`, `specVersion`, `skills`, `scaffold` and `visibility` (#31035)

Clause-②: no (narrowing) — five authorable keys of `TemplateManifestSchema` become tombstones, and `os package publish` refuses the file's `visibility` by name
Metadata-protocol: narrowed

<!-- adr-0087: registered marketplace-template-manifest-inert-keys-retired -->

**BREAKING** for an `objectstack.manifest.json` that still writes any of the five keys, and for `os package publish` run on a manifest that declares `visibility`.

- **Retired (ADR-0049 enforce-or-remove).** `TemplateManifest.name`, `.specVersion`, `.skills`, `.scaffold` and `.visibility` are `retiredKey()` tombstones: `tsc` refuses them and a parse of `TemplateManifestSchema` refuses each with its prescription. None ever had an effect: no reader of the file's `name`, `specVersion`, `skills` or `scaffold` existed, and `os package publish` read `visibility` only to warn that it ignores it. `RETIRED_KEYS_BY_MAJOR[18]` lists the five keys and the upgrade guide carries the semantic entry `marketplace-template-manifest-inert-keys-retired`. No ADR-0087 conversion: this file is not a stack collection member, so `os migrate meta` has nothing to rewrite; a runtime boot never reads it. The publish request's own `visibility` (`CreatePackageRequestSchema`) is unchanged.
- **Migration** — FROM → TO, in `objectstack.manifest.json`:
  - `name` → delete it. The project slug is `package.json` `name`; the published package id is `manifestId` (or the one `os package publish` derives from the compiled artifact).
  - `specVersion` → delete it. The protocol your package needs is `manifest.engines.protocol` in `objectstack.config.ts`; the spec release it builds against is its `@objectstack/spec` dependency.
  - `skills` → delete it. create-objectstack installs the whole skills catalog.
  - `scaffold` → delete it. Nothing prompted for `scaffold.variables` or ran `scaffold.postInstall`.
  - `visibility` → delete it and pass `os package publish --visibility <private|org|marketplace>`.
- **`@objectstack/cli`.** `os package publish` refuses a manifest declaring `visibility` before any network call, naming `--visibility`. It names the other four in a warning for deletion and still publishes, because every project scaffolded from the blank template before this release carries them.
- **`create-objectstack`.** The blank template's manifest drops the five keys it wrote (`name`, `specVersion`, `skills`, `scaffold`), and scaffolding strips every retired key (`category` and these five, one list pinned to the spec's registry rows) from the template's manifest instead of writing `name`, so a template authored before this release still scaffolds a manifest the schema accepts. The release version pass (`scripts/sync-template-versions.mjs`) no longer stamps `specVersion`.
- **Not retired here:** `publisher` and `isStarter`. A first-party publish script sends both to the hosted packages route, so their fate is a maintainer decision.
