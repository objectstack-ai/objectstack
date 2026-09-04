// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14180 — kernel/cluster.zod.ts `MetadataChangedEventPayloadSchema` /
// `MetadataChangedEventPayload`, retired whole (ADR-0049 enforce-or-remove;
// triage ruling 2026-09-02: remove via the ADR-0087 route, ⛔ not "make a
// consumer" — that is contract growth with no pull). The docblock declared a
// MUST-emit / MUST-subscribe contract for a `metadata:changed` event — `type`
// / `name` / `tenantId` / `version: z.bigint()` / `operation` /
// `correlationId`, readers comparing `version` before invalidating — that
// nothing in the tree ever produced or consumed: zero runtime emitters, zero
// subscribers, zero imports outside `packages/spec` (its own unit test, the
// isomorphic alias pin and the generated artifacts), measured at the
// retirement's base commit 2cc461030 with positive controls in objectstack
// and objectui (pinned sha). It was unenforceable by construction: the
// `bigint` version field cannot cross a JSON transport (the standard
// serializer throws on it) without a codec no pubsub driver ships, so no
// conforming emitter could ever have existed. The three cluster channels that
// DO run — `metadata.changed` (`ClusterMetadataChangedPayload`,
// `@objectstack/metadata`), `metadata.mutated`
// (`ClusterMetadataMutationPayload`, `@objectstack/metadata-protocol`) and
// `datasource.mutated` — all carry an address-only signal whose receiver
// re-reads its own store (ruled 2026-09-01 for the registry lane), the
// opposite of the declared version-compare receipt, so the one plausible
// future consumer was decided against. Never in `json-schema.manifest/` (the
// JSON Schema build skips `bigint`), so the manifest deletion gate has nothing
// to adjudicate for this def; the entry is the declaration the retirement
// route requires. Route 3: not an authorable surface — no metadata-type
// binding, stack collection or manifest embed ever carried it — so no
// tombstone and no D2 conversion; this table plus the D3 semantic entry
// `metadata-changed-event-payload-retired` ARE the declaration.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look.
export const entry = 'kernel/MetadataChangedEventPayload';
