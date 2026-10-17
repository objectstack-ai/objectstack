---
'@objectstack/spec': minor
'@objectstack/platform-objects': patch
---

feat(spec)!: retire the permission set's authored `managedBy` — a provenance key nothing read (#23891)

**BREAKING** — an author can no longer write `managedBy` (`'package' | 'platform' | 'user'`) on a permission set (`PermissionSetSchema`, ADR-0086 D3): it is refused at parse. Nothing ever read the authored key. No seeder, package upgrade or lock consulted it, so `package` never made a set upgrade-owned, and `platform` or `user` never kept an upgrade off a set. Delete the key. A set's provenance is the package that ships it, decided from that package's artifact and recorded as `packageId`; a set created in this environment carries neither. The `sys_permission_set.managed_by` column is a different surface and is untouched, as is `ObjectSchema.managedBy`.

Clause-②: yes (narrowing)

Measured before removal, at `6d1660dc3b`: no shipped permission set authored the key (the example apps, `plugin-security`'s default sets, and HotCRM 4.0.1's seven sets at `1d7148bf2d`: zero, against seven `objects:` controls). Its one writer was Setup's Permission Sets form row, which wrote it into stored rows. The liveness ledger had ruled it `dead` on 2026-10-11.

## FROM → TO

| you wrote (17.7 and earlier) | write instead |
| --- | --- |
| `definePermissionSet({ …, managedBy: 'package' })` | nothing: delete the key; a package-shipped set is the package's because the package ships it (`packageId`) |
| `managedBy: 'platform'` or `managedBy: 'user'` | nothing: delete the key; a set created in this environment carries neither `managedBy` nor `packageId` |
| relying on `managedBy` to keep a package upgrade off a set | clone the packaged set and edit the clone (the packaged-set lock refuses in-place edits) |

**The one-line fix:** delete `managedBy` from every permission set.

**What an author who still writes it sees.** `tsc` fails at the authoring site (`PermissionSet` types the key as retired), and the parse (`definePermissionSet()`, `defineStack({ permissions })`, `PUT /api/v1/meta/permission/:name`) refuses it at its own path with the prescription:

> `permission.managedBy` was removed in @objectstack/spec 18 (ADR-0049 enforce-or-remove, ADR-0086 D3) — nothing ever read the authored key: no seeder, package upgrade or lock consulted it, so `package` never made a set upgrade-owned and `platform` or `user` never shielded one from an upgrade. Delete the key; a set's provenance is the package that ships it, decided from that package's artifact and recorded as `packageId`, and a set created in this environment carries neither. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.

**What does not stop on it.** A stored `permission` row that Setup's form wrote, and an installed package's built artifact, still load: the rehydration seams (`applyConversionsToStoredItem`, `applyArtifactForwardConversions`) replay the D2 conversion below and strip the key, with a notice naming the set. Only the authoring, save and publish doors refuse it.

## The retirement kit

- **A `retiredKey()` tombstone** on `PermissionSetSchema`, a `strictObject`, so the refusal carries its prescription and `tsc` fails first. `RETIRED_KEYS_BY_MAJOR[18]`: `security/PermissionSet:managedBy`.
- **The D2 conversion `permission-set-managed-by-removed`** (protocol 18, retired from the load path) deletes the key from every `permissions[]` item, whatever it holds, one notice per set.
- **The D3 entry `permission-set-managed-by-retired`** records the judgement the strip cannot make: any runbook that relied on the value to keep an upgrade off a set needs another path.
- **`@objectstack/platform-objects`:** the Permission Sets form's `managedBy` row, its help text and its three option labels (Package / Platform / User) leave Setup in all four locales.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED** beyond HotCRM 4.0.1. `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for. Studio's provenance badge reads the value as one of three inputs; it retires in an objectui follow-up.

<!-- adr-0087: registered permission-set-managed-by-removed, permission-set-managed-by-retired -->
