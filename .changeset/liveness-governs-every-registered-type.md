---
'@objectstack/spec': patch
'@objectstack/cli': patch
---

The liveness gate now governs every registered metadata type (#4487)

`GOVERNED` in `check-liveness.mts` was a hand-maintained list, and nothing ever
compared it against the registry it claims to cover. It governed **15 of 25**
registered metadata types while reporting itself complete. A type in the other
ten was authorable — served by `/api/v1/meta/types/:type`, editable in Studio —
and was never asked who reads its properties, so an inert key on it was
invisible to CI and its silence read as success.

`datasource` was in that state for its entire life. #4410, #4465 and #4481 found
six inert keys on it **by hand**, two of them security-shaped: `schemaMode` was
dropped between the record and the connection spec, so a database ObjectStack
must never run DDL against was constructed as `managed`; `ssl` stopped at the
record, so a TLS block with a CA certificate in it configured nothing while
looking identical to one that worked.

**The gate is now answerable to the registry.** Every registered type must be in
`GOVERNED` or in `PENDING_GOVERNANCE` with a reason and an issue. Registering a
type and forgetting the ledger fails CI with the entry to write. The reverse rots
too, so it also fails: a `PENDING_GOVERNANCE` row for a type that has since been
governed claims a debt that no longer exists.

**`datasource` is now governed** — `liveness/datasource.json`, all 43 properties
classified with evidence. The result is the highest dead ratio of any governed
type: **20 of 43 have no runtime consumer.**

| Dead cluster | Why |
| --- | --- |
| `capabilities.*` (11) | The engine gates pushdown on the runtime driver's own `supports.*` object — `autonumber`, `batchSchemaSync`, `queryDateGranularity` — a different mechanism whose vocabulary does not overlap this block at all. `having-filter.ts` says it outright: "SQL pushdown can come later behind a driver capability flag." |
| `healthCheck.*` (3) | Nothing schedules a datasource probe. Liveness is checked on demand through the driver handle's `ping()`. |
| `retryPolicy.*` (4) | No connect or query path retries. |
| `external.label`, `external.requirePermission` | No reader. |

**One correction ships with this**, and it is the reason the audit was worth
doing rather than a bookkeeping exercise. `capabilities.readOnly` reads as a
safety switch and gates nothing — and **two shipped prescriptions pointed
authors at it**: the `externalSettingsUnknownKeyError` guidance in
`datasource.zod.ts` ("or `capabilities.readOnly` to describe the driver") and
the #4465 changeset's relocation table. Both now name `external.allowWrites:
false`, which is the write gate the ObjectQL engine actually checks. An author
who followed the old advice believed they had marked a datasource non-writable
and had not. The v17 release notes carried a matching false claim — that an
unregistered `capabilities` key made the engine stop pushing work down to the
driver — corrected in the same change.

Two traps worth naming, because both nearly produced a wrong verdict here:

- **`healthCheck` and `retryPolicy` are name collisions.** A bare grep for
  either returns plenty of live readers — the plugin health monitor, `hook`,
  `job` — none of which is this type. `hook.retryPolicy` even spells its delay
  `backoffMs` where this declares `baseDelayMs`; the shape mismatch is the tell
  that nothing reads both.
- **objectui's `DatasourcePreview` renders `pool`, `ssl`, `retryPolicy` and
  `healthCheck` as panels**, and is cited as evidence for none of them. That is
  the standing rule in `liveness/README.md`, and #4481 is the fresh precedent:
  the only "consumer" of `readReplicas` in either repo was a preview pill.

The CLI advisory lint picks the ledger up automatically, so `os compile` now
warns an author who sets any of the 20. That needed one line beyond the ledger —
`datasource` had to be added to `TYPE_COLLECTIONS`. Coverage grows by marking
entries `authorWarn` only *within* a type the lint already walks; a newly
governed type needs its collection registered or its ledger warns nobody.

Nine types remain ungoverned and are now enumerated rather than implied:
`app`, `book`, `doc`, `email_template`, `job`, `mapping`, `seed`, `translation`,
`validation` (#4488).
