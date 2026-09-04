// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14180 — kernel/cluster.zod.ts `MetadataChangeOperationSchema` /
// `MetadataChangeOperation` (the `create` / `update` / `delete` / `publish`
// enum), the orphan value schema of the retired
// `kernel/MetadataChangedEventPayload` def registered beside it: it existed
// only to type that payload's `operation` field and had no other consumer
// anywhere — measured at the retirement's base commit 2cc461030, every hit
// was the payload itself, its own isomorphic alias pin and the generated
// artifacts; nothing in objectui at the pinned sha. An exported value schema
// with no consumer reads as a capability to whoever finds it (#3950), so it
// leaves with the payload (the playbook's orphan-value-schema rule, the
// `kernel/DistributedStateConfig` precedent). Unlike the payload this enum
// serializes, so it WAS in `json-schema.manifest/kernel.json` and the
// manifest deletion gate adjudicates its removal against this entry. Route 3,
// same declaration: this table plus the D3 semantic entry
// `metadata-changed-event-payload-retired`.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look.
export const entry = 'kernel/MetadataChangeOperation';
