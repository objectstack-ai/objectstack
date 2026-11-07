---
'@objectstack/spec': minor
'@objectstack/cli': minor
'create-objectstack': patch
---

feat(spec)!: retire `objectstack.manifest.json` `publisher` and `isStarter` — the platform decides both (#31035)

Clause-②: no (narrowing) — two authorable keys of `TemplateManifestSchema` become tombstones, and `os package publish` refuses the file's `publisher` by name
Metadata-protocol: narrowed

<!-- adr-0087: registered marketplace-template-manifest-platform-decided-keys-retired -->

**BREAKING** for an `objectstack.manifest.json` that still writes `publisher` or `isStarter`, and for `os package publish` run on a manifest that declares `publisher`.

- **Retired (ADR-0049 enforce-or-remove).** `TemplateManifest.publisher` and `TemplateManifest.isStarter` are `retiredKey()` tombstones: `tsc` refuses them and a parse of `TemplateManifestSchema` refuses each with its prescription. Neither ever had an effect from this file: `publisher` is the trust tier that gates listing privileges, which the platform assigns from the publisher's credentials, and the platform honours a starter flag only on a first-party seed, so `os package publish` never sent either. A trust claim does not belong in an author-editable file. `RETIRED_KEYS_BY_MAJOR[18]` lists both keys and the upgrade guide carries the semantic entry `marketplace-template-manifest-platform-decided-keys-retired`. No ADR-0087 conversion: this file is not a stack collection member, so `os migrate meta` has nothing to rewrite; a runtime boot never reads it. The publish request's own `publisher` and `isStarter` (`CreatePackageRequestSchema`) are unchanged.
- **Migration** — FROM → TO, in `objectstack.manifest.json`:
  - `publisher` → delete it. The platform assigns a package's trust tier from the credentials it is published with.
  - `isStarter` → delete it. The platform decides which packages are starters; a first-party script that seeds one in service mode carries the flag itself, not in the manifest.
- **`@objectstack/cli`.** `os package publish` refuses a manifest declaring `publisher` before any network call. It names `isStarter` in the deletion warning with `name`, `specVersion`, `skills` and `scaffold`, and still publishes, because every project scaffolded from the blank template before this release carries `isStarter: true`. Neither key is ever sent.
- **`create-objectstack`.** The blank template's manifest drops `isStarter`, and scaffolding strips both keys (with the other retired ones) from a template's manifest, so a template authored before this release still scaffolds a manifest the schema accepts.
