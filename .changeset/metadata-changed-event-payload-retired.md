---
"@objectstack/spec": minor
---

feat(spec): retire `MetadataChangedEventPayloadSchema` — the `metadata:changed` payload nothing ever emitted or consumed (#14180, ADR-0049)

<!-- adr-0087: registered metadata-changed-event-payload-retired -->

**BREAKING** export removal, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the prescription is registered
under protocol major 18 — `RETIRED_DEFS_BY_MAJOR[18]` + the D3 semantic entry
`metadata-changed-event-payload-retired` — where `os migrate meta` users will
look).

`kernel/cluster.zod.ts` declared a "canonical payload for the
`metadata:changed` event" and said every metadata persistence layer MUST emit
it after any successful write and every reader MUST subscribe and compare its
`version` before invalidating. Nothing ever did either: zero runtime emitters,
zero subscribers, zero imports outside `packages/spec` (its own unit test, the
isomorphic alias pin and the generated artifacts), in objectstack and in
objectui at the pinned sha. It could not have been honoured as declared — the
`version` field is `z.bigint()`, which the standard JSON serializer refuses, so
the payload could not cross any pubsub transport without a codec no driver
ships. The three cluster channels that do run (`metadata.changed`,
`metadata.mutated`, `datasource.mutated`) all carry an address-only signal
whose receiver re-reads its own store — the opposite of the declared
version-compare receipt — so the one plausible future consumer was decided
against (2026-09-01 ruling), and the triage ruling (2026-09-02) chose removal
over "make a consumer".

FROM → TO:

- `MetadataChangedEventPayloadSchema` / `MetadataChangedEventPayload` →
  *(removed)* — no replacement type is declared. Subscribe to one of the lanes
  documented in `content/docs/kernel/cluster.mdx` §6.2 instead:
  `metadata.changed` (`ClusterMetadataChangedPayload`, `@objectstack/metadata`),
  `metadata.mutated` (`ClusterMetadataMutationPayload`,
  `@objectstack/metadata-protocol`) or `datasource.mutated`
  (`ClusterDatasourceMutationPayload`, `@objectstack/service-datasource`).
- `MetadataChangeOperationSchema` / `MetadataChangeOperation` → *(removed)* —
  the orphan value schema of the payload's `operation` field; it had no other
  consumer.

One-line fix: delete the import — every one of the four names is TS2305 after
upgrade, and no runtime path ever produced or read a value of these types. A
host that used the retired type for a transport of its own keeps a local type.

The retirement kit:

- **whole-def deletion** (route 3 — not an authorable surface: no metadata-type
  binding, stack collection or manifest embed ever carried it, and nothing
  parsed it outside its own unit test, so there is no authored document to
  rewrite and nobody who could receive a parse-time tombstone):
  `kernel/MetadataChangedEventPayload` and `kernel/MetadataChangeOperation` in
  `RETIRED_DEFS_BY_MAJOR[18]` plus the D3 semantic entry. The payload def was
  never in `json-schema.manifest/` (the JSON Schema build skips `bigint`); the
  enum was, so the manifest deletion gate adjudicates it against the entry.
- **retirement pins** in `kernel/cluster.test.ts`: runtime namespace probes
  assert both names are absent from `kernel/cluster.zod` and from the
  `@objectstack/spec/kernel` entry, with `ClusterCapabilityConfigSchema` as
  the positive control; the two isomorphic alias pins left with the schemas.
- **docs**: `content/docs/kernel/cluster.mdx` no longer describes a planned
  version-stamped payload or a version-compare reader contract — the shipped
  address-only lanes and their re-read receipt are the contract; the
  `ClusterMetadataChangedPayload` doc-comment in `@objectstack/metadata` no
  longer claims to "align with" the retired schema (it never did).
- zero in-tree consumers, so no in-repo source changes ride along; runtime
  behaviour is unchanged.
