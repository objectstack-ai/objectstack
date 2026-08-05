// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { DroppedFieldsEvent } from '@objectstack/spec/data';

/**
 * Thrown by `engine.update` when the caller passed
 * `options.strictReadonlyWrites: true` (`WriteObservabilityOptions`, #5126) and
 * the payload contained caller-supplied fields the engine would have STRIPPED.
 *
 * The write did NOT happen — nothing was sent to the driver, so neither the
 * rejected fields nor the fields that would have survived the strip landed.
 * That total refusal is the point of the flag: the default strip commits a
 * payload the caller never wrote, and a caller that opts out of that does not
 * want a smaller version of it.
 *
 * `fields` is the union across BOTH strip passes — static `readonly` (#2948)
 * and a TRUE `readonlyWhen` predicate (#3042) — so one error names everything
 * wrong with the payload instead of forcing a round-trip per field. `drops`
 * keeps the per-reason breakdown (the same `DroppedFieldsEvent` shape
 * `onFieldsDropped` would have received, had the write been allowed to
 * complete), so a caller can tell a schema-level lock from a state-dependent
 * one without parsing the message.
 *
 * Identified by `code` rather than `instanceof` so it survives crossing package
 * boundaries — the convention `SummaryRecomputeError` / `DriverConnectError`
 * already follow here. The code is registered in the spec's `ERROR_CODE_LEDGER`
 * under `@objectstack/objectql`.
 */
export class ReadonlyFieldRejectedError extends Error {
  readonly code = 'ERR_READONLY_FIELD_REJECTED' as const;
  constructor(
    public readonly object: string,
    public readonly fields: string[],
    public readonly drops: readonly DroppedFieldsEvent[],
  ) {
    super(
      `Update on '${object}' was REFUSED: ${fields.length} caller-supplied field(s) ` +
      `(${fields.join(', ')}) are read-only and would have been stripped, and this write ` +
      `passed options.strictReadonlyWrites — so NOTHING was written, including the fields ` +
      `that would have survived. Remove the read-only field(s) from the payload; or, for ` +
      `server-side code that legitimately writes read-only columns, pass ` +
      `{ context: { isSystem: true } } (this exempts statically 'readonly' fields, but NOT ` +
      `fields locked by a TRUE 'readonlyWhen' predicate — those stay locked for every ` +
      `caller). To let the strip happen and merely observe it, drop ` +
      `strictReadonlyWrites and pass options.onFieldsDropped instead (#3407).`,
    );
    this.name = 'ReadonlyFieldRejectedError';
  }
}
