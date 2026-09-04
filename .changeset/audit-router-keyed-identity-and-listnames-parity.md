---
'@objectstack/metadata': minor
'@objectstack/objectql': minor
---

feat(metadata,objectql): a keyed plural read on `MetadataManager`, `listNames` fault parity, and an action audit that answers from the same identity and sources as the router

Two plural reads of one metadata plane could disagree with a by-name read of
that same plane, and the ADR-0110 D5 action-governance audit stood on the
disagreement — reporting `registered handler with NO declaration … REFUSED at
dispatch` about a route the router was resolving and dispatching in the same
boot.

**`MetadataManager.listNames` gains the per-loader `try`/`catch` that
`loadMany` and `list()` have carried since #5108.** One loader fault used to
produce two different facts depending only on which plural read a caller
reached for: `loadMany` swallowed it and answered short, `listNames` threw. It
now degrades the same way, through the same `reportLoaderReadFailure` /
`reportLoaderReadRecovered` helpers — one outage, one line, one vocabulary.
Callers that relied on `listNames` throwing to detect an outage should read
`listDiagnosed()`, which reports `degraded` explicitly.

**New: `MetadataManager.loadManyKeyed(type, options?)`** — `loadMany` read under
the identity the STORE holds each item by, returning `{ name, data }` pairs. It
delegates to a loader's own `loadManyKeyed` where one is offered (on
`DatabaseLoader` that shares `loadMany`'s single query, so it costs nothing
extra) and otherwise falls back to that loader's `list()` + per-name `load()`.
⛔ **`loadMany`'s published return shape does not change**, and no existing
consumer is touched: the key travels *beside* the body, never inside it, so a
body that deliberately carries no `name` stays byte-identical to what was
stored (#14205).

**The action-governance audit now mirrors the router on both halves of the D5
bijection.** The declaration half enumerates the plane keyed
(`loadStandaloneActionsKeyed`), so a row whose body does not name itself — a
`sys_metadata` row keyed by its `name` column, or a `FilesystemLoader` file
whose identity is its path — is a declaration to the audit exactly as it is to
the router; the handler half also probes the plane BY NAME
(`lookupMetadataAction`, `loadDiagnosed`/`load`, injected like the existing
registry rung), so a loader fault a plural read swallows can no longer turn a
dispatchable handler into an accusation. Both probes stay conservative in one
direction only: a source that throws leaves the handler on the list.

Additive on every published signature. `runActionGovernanceInventory` and
`collectEngineActionDeclarations` gain optional parameters and keep their old
ones working unchanged; declaration rows gain an optional `storeKey` (the new
exported `ActionDeclarationRow`).

**Population change, reported:** `unboundDeclarations` now sees declarations
whose identity is the store key. Its BEFORE was **0, structurally rather than
by sampling** — a nameless row was dropped before reconciliation ran, so it
could never be reported however many a plane held. Its one deliberate
subtraction: a row with neither an own `name` nor a store key is no longer
reported as `actionName: undefined`, which read as a parse failure in the
warning rather than as a finding.

Known boundary, stated in the audit's docblock rather than left to be
rediscovered: a boot-time audit runs outside any request scope, so if a
composition ever registered `metadata` as `SCOPED` the audit could not reach
that instance at all — before any read method runs. No shipped composition does
(`packages/metadata/src/plugin.ts` registers a static instance), and reaching a
request-scoped service from a boot-time audit is a separate change.
