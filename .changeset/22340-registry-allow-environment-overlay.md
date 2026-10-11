---
'@objectstack/spec': major
'@objectstack/metadata-protocol': major
---

feat(spec,metadata-protocol)!: the metadata type registry's `allowOrgOverride` is renamed to `allowEnvironmentOverlay`, on the registry and on `GET /meta/types`

Clause-②: yes (narrowing)

<!-- adr-0087: registered metadata-type-registry-allow-org-override-renamed -->

**BREAKING**: a renamed authorable key and a renamed response field, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** ADR-0131 D6 retired the per-organization overlay axis: every metadata write and read is environment-wide. The registry flag kept the name that said "per-org" while it decided one environment-scope question at every door — whether an environment may overlay an item of the type that a managed package ships: the metadata protocol's save door, the managed-content seal on write and on the served read, the repository's put gate, and Studio's write gate through `GET /meta/types`. It is renamed to say that. One key, not two, and not the old name with a new meaning; no window in which both spellings are accepted or served.

## FROM → TO

| where | you wrote / read | write / read instead |
|:--|:--|:--|
| a `DEFAULT_METADATA_TYPE_REGISTRY` entry (`MetadataTypeRegistryEntry`, `@objectstack/spec/kernel`) | `allowOrgOverride: true` | `allowEnvironmentOverlay: true` |
| a reader of a registry entry | `entry.allowOrgOverride` | `entry.allowEnvironmentOverlay` |
| each `entries[]` item of `GET /api/v1/meta/types` (`GetMetaTypesResponse`) | `allowOrgOverride` | `allowEnvironmentOverlay` |

**The one-line fix: rename the key, and every read of it; the value is unchanged.**

Every value is unchanged: `true` on `view`, `dashboard`, `report`, `translation` and `email_template`, `false` on every other built-in type. On the wire the value is still the registry's grant OR the `OS_METADATA_WRITABLE` hatch naming the type (`overrideSource: 'env'`), and the hatch still opens only items no managed package ships, never a managed one. `overrideSource` keeps its `registry` / `env` values; its describe now names the new field.

⚠️ **Read the old key nowhere.** Writing `allowOrgOverride` fails to compile (its input type is `never`) and fails to parse with the rename prescription (issue code `invalid_type` at path `allowOrgOverride`). A READER does not fail: `if (!entry.allowOrgOverride)`, a filter on it or a partial-match assertion still compiles against the tombstone and reads `undefined`, which treats every type as closed to environment overlays. A client that declares its own type for the `/meta/types` response, instead of importing `GetMetaTypesResponse`, sees no compile error at all and reads every type as locked. Search for the old name, do not wait for `tsc`.

**`supportsOverlay` keeps its name; its describes now say what it gates.** It decides one thing: a stored overlay row of an item a managed package ships may be removed through the ordinary delete door without the type's environment-overlay permission: the removal removes no managed definition, and changes what is served for `permission` alone. It opens no save and it decides no read. The registry's describe, the `GET /meta/types` describe and `MetadataTypeInfoResponse`'s describe used to promise that "the loader can merge overlays", in the retired per-organization wording.

**Who is affected, measured.** No manifest, stack, plugin configuration or stored row can carry a registry entry (`contributes.kinds` is closed, `config.additionalTypes` is a tombstone, the registry is a TypeScript literal), so no authored metadata changes. The readers are code: every reader in this repository moved in this change, and a reader of the `/meta/types` field outside it moves with it — the Studio console reads the field and moves in its own repository's paired change, which the console pin carries.

### The kit

- **The tombstone.** `MetadataTypeRegistryEntry.allowOrgOverride` is a `retiredKey()` naming `allowEnvironmentOverlay` (`kernel/metadata-plugin.zod.ts`); the 28 built-in rows spell the new key.
- **The ledger.** The retired-keys entry `kernel/MetadataTypeRegistryEntry:allowOrgOverride` and the D3 semantic entry `metadata-type-registry-allow-org-override-renamed` (protocol 18), which records the registry key and the wire field together. No D2 conversion: there is no authored or stored source a conversion could rewrite.
- **The wire.** `getMetaTypes` writes the hatch elevation onto `allowEnvironmentOverlay` on both of its arms — a registry type and a runtime-registered type with no registry row — and no entry carries `allowOrgOverride`.
- **The refusal sentences** that named the flag name the new key: `… takes no environment overlay (allowEnvironmentOverlay=false) …`, `… has neither allowEnvironmentOverlay nor allowRuntimeCreate …`, `… allowRuntimeCreate=false and allowEnvironmentOverlay=false …`. Codes and statuses are unchanged.
