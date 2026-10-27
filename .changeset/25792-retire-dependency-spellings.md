---
'@objectstack/spec': minor
---

**BREAKING** — the two unread dependency spellings leave the authoring surface: `PackageDependency.optional` (an entry of the marketplace snapshot's `manifestJson.dependencies[]`) and `AppManifest.dependencies` (the bare-id list on the app install manifest) are `retiredKey()` tombstones (#25792, ADR-0141 D8 items 2 and 3).

A `major`-class change, recorded as `minor` under the launch-window convention. ADR-0141 D8 left both fates to "a measured reader count"; the count was zero for both, so both retire at once, with no retirement stage (ADR-0049 enforce-or-remove).

Clause-②: no (narrowing)
Metadata-protocol: narrowed

**Why.** A dependency is declared in one place, the package's `manifest.dependencies` record (`{ [packageId]: versionRange }`), and the ADR-0141 D2 pre-install check reads that record alone and treats every entry as required. Two more spellings stayed declared beside it and nothing read either. `optional: true` promised "missing dep is a warning, not an error", but the record has no optional arm, so no install path could honour it. `AppManifest.dependencies` restated the record without its range, and no install path consulted it. An author, often an AI, who wrote either got nothing enforced and no error. Measured at `origin/main` `6390fe52ce`: zero readers and zero writers of either key outside `packages/spec` (`packages/`, `ui/`, `examples/`, `apps/`), and none in HotCRM at `9464673`, whose three modules declare their dependency in the record.

### FROM → TO

| removed | from | what to write instead |
| --- | --- | --- |
| `optional` on a `PackageDependency` entry (`PackageManifestSchema.dependencies[]`) | `@objectstack/spec/marketplace` | delete the key. An entry carries `packageId` and `versionRange` only. Declare a dependency in `manifest.dependencies` only when the package cannot install without it. |
| `dependencies` on `AppManifest` | `@objectstack/spec/system` | delete the key. Declare each dependency with its range in the package's `manifest.dependencies`, for example `{ 'com.acme.core': '^1.0.0' }`. |

**The one-line fix: delete the key.** A TypeScript author fails `tsc` first (each key is typed as the retired mark), and a parse of `PackageDependencySchema`, `PackageManifestSchema` or `AppManifestSchema` refuses the key with its prescription, the old default (`false`, `[]`) included. The parsed output no longer carries either key, so `PackageDependencyParsed` loses `optional` and `AppManifestParsed` loses `dependencies`.

⚠️ Runtime behaviour is deliberately **unchanged**: nothing ever read either key, so every install answers exactly as before. The removal retracts a false claim, not a capability. **No deprecation window** (startup-stage posture: retirements take effect immediately).

⚠️ **The out-of-repo consumer population beyond HotCRM is NOT MEASURED.** `@objectstack/spec` is published, and the control plane's reading of `sys_package_version.manifest_json` is not readable from this repository.

The ADR-0087 D3 semantic entry `dependency-unread-spellings-retired` carries the judgement, and both keys are registered in `RETIRED_KEYS_BY_MAJOR[18]`. There is no D2 conversion: neither shape is a stack collection member, so a conversion would have no source to rewrite.

<!-- adr-0087: registered dependency-unread-spellings-retired -->
