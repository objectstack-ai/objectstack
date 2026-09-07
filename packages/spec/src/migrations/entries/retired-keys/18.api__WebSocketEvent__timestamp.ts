// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15676 — the epoch-instant half of #14478 ruling B. `WebSocketEvent.timestamp`
// is an epoch INSTANT, not a duration: it moved onto the shared `EpochMs` schema
// (which declares the millisecond unit) and was renamed `occurredAt`, because
// every `*Ms` key in this package is a duration and spelling an instant that way
// would put it in the family the rule exists to separate it from.
//
// Registered here but NOT in `src/conversions/registry.ts`, the
// `kernel/KernelContext:previewMode` reasoning: a WebSocket event is a RUNTIME
// wire payload emitted by the transport, never a stack collection member and
// never stored as a `sys_metadata` row, so a MetadataConversion would be a
// transform with no seam that ever runs. The prescription reaches consumers
// through the tombstone plus the D3 semantic entry `epoch-instant-keys-renamed`
// — which is exactly what ruling B prescribes for a runtime-emitted key.
//
// Registered under 18, not 17, for the reason the previewMode entry records:
// v17.0.0 was cut before this landed, so the change ships on the 17.x line and
// the prescription lives at the major boundary `migrate meta` users look at.
export const entry = 'api/WebSocketEvent:timestamp';
