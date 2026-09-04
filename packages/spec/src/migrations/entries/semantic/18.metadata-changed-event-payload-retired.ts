// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'metadata-changed-event-payload-retired',
  surface:
    'kernel.cluster metadata change event payload (`MetadataChangedEventPayloadSchema` '
    + 'in kernel/cluster.zod.ts — 2 defs, 4 exported names: '
    + '`MetadataChangedEventPayloadSchema`, `MetadataChangedEventPayload`, '
    + '`MetadataChangeOperationSchema`, `MetadataChangeOperation`)',
  replacement:
    'Nothing to migrate to, because nothing ever emitted or consumed it. The '
    + 'cluster invalidation channels that actually run are the three lanes '
    + 'documented in content/docs/kernel/cluster.mdx §6.2: `metadata.changed` '
    + '(`ClusterMetadataChangedPayload` in `@objectstack/metadata` — the origin '
    + 'node, the metadata type and the replayed watch event), `metadata.mutated` '
    + '(`ClusterMetadataMutationPayload` in `@objectstack/metadata-protocol`) and '
    + '`datasource.mutated` (`ClusterDatasourceMutationPayload` in '
    + '`@objectstack/service-datasource`). A host that needs cross-node cache '
    + 'invalidation subscribes to one of those; a host that held the retired type '
    + 'for a transport of its own keeps a local type — the spec no longer declares '
    + 'one.',
  reason:
    'ADR-0049 enforce-or-remove (triage ruling 2026-09-02 on the spec seat: '
    + 'remove via the ADR-0087 route, not "make a consumer" — that is contract '
    + 'growth with no pull). The docblock declared that all metadata persistence '
    + 'layers MUST emit a `metadata:changed` event with this payload and that '
    + 'every reader MUST subscribe and compare `version` before invalidating. '
    + "Measured at the retirement's base commit with positive controls: zero "
    + 'runtime producers, zero subscribers, zero imports outside packages/spec '
    + '(its own unit test, the isomorphic alias pin and the generated artifacts) '
    + 'in objectstack, and nothing in objectui at the pinned sha. It was '
    + 'unenforceable by construction — the `version` field is `z.bigint()`, '
    + 'which the standard JSON serializer refuses, so the payload as declared '
    + 'could not cross any pubsub transport without a codec no driver ships: a '
    + 'MUST-emit contract no conforming emitter could satisfy. The shipped '
    + 'channels all carry an address-only signal whose receiver re-reads its own '
    + 'store (the 2026-09-01 ruling for the registry lane), the opposite of the '
    + 'declared version-compare receipt, so the one plausible future consumer was '
    + 'decided against; the 2026-08-27 ruling on transitions removes a staged '
    + "window. `MetadataChangeOperationSchema` existed only to type the payload's "
    + '`operation` field and leaves with it as its orphan value schema (the '
    + '`DistributedStateConfig` precedent). Route 3: not an authorable surface — '
    + 'no metadata-type binding, stack collection or manifest embed ever carried '
    + 'it, and nothing parsed it outside its own unit test — so no tombstone and '
    + 'no D2 conversion; `RETIRED_DEFS_BY_MAJOR[18]` '
    + '(`kernel/MetadataChangedEventPayload`, `kernel/MetadataChangeOperation`) '
    + 'plus this entry ARE the declaration.',
  acceptanceCriteria:
    'No code imports `MetadataChangedEventPayloadSchema`, '
    + '`MetadataChangedEventPayload`, `MetadataChangeOperationSchema` or '
    + '`MetadataChangeOperation` from `@objectstack/spec` or '
    + '`@objectstack/spec/kernel` — every one is TS2305 after upgrade (pinned by '
    + 'runtime namespace probes in kernel/cluster.test.ts, with '
    + '`ClusterCapabilityConfigSchema` as the positive control). No metadata '
    + 'document needs editing: the schema was reachable from no metadata-type '
    + 'binding, stack collection or /meta door. ⚠️ Runtime behaviour is '
    + 'deliberately UNCHANGED: no emitter or subscriber ever existed, and the '
    + 'three shipped cluster lanes publish the same bytes before and after — the '
    + 'retirement removes a false declaration, not behaviour.',
};
