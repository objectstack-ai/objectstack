// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { DroppedFieldsEvent } from '@objectstack/spec/data';

/**
 * Thrown by `engine.update` — and, since #5503, by `engine.insert` — when the
 * caller passed `options.strictReadonlyWrites: true`
 * (`WriteObservabilityOptions`, #5126) and
 * the payload contained caller-supplied fields the engine would have STRIPPED.
 *
 * The write did NOT happen — nothing was sent to the driver, so neither the
 * rejected fields nor the fields that would have survived the strip landed.
 * That total refusal is the point of the flag: the default strip commits a
 * payload the caller never wrote, and a caller that opts out of that does not
 * want a smaller version of it.
 *
 * `fields` is the union across every strip pass the operation runs — on UPDATE
 * static `readonly` (#2948), a TRUE `readonlyWhen` predicate (#3042), the
 * implicitly-readonly runtime-owned types (#5503), and the `primary_key` strip
 * of a payload `id` the update dispatch ruled is not an identifier (#6437); on
 * INSERT only the runtime-owned ones, because a create is deliberately exempt
 * from the author-declared strips (#3413). One error names everything wrong
 * with the payload instead of forcing a round-trip per field. `drops`
 * keeps the per-reason breakdown (the same `DroppedFieldsEvent` shape
 * `onFieldsDropped` would have received, had the write been allowed to
 * complete), so a caller can tell a schema-level lock from a state-dependent
 * one without parsing the message.
 *
 * ## The message is composed from `drops`, not from the error's name (#6437)
 *
 * Until `primary_key` existed every reason was a read-only lock, so the message
 * could say "are read-only" of the whole union and be true. It no longer can:
 * an `id` refused by the primary-key strip is not read-only — a truthy scalar
 * `id` writes fine — and `{ context: { isSystem: true } }`, the remedy the
 * read-only wording offers, does not exempt it either. Asserting either would
 * relocate the exact harm PR #6433 refused to commit (a `reason` that lies)
 * from the event into the error.
 *
 * So the wording branches on the reasons actually present, and adding a strip
 * CLASS leaves the read-only-only message untouched — only a payload carrying
 * the new class sees new prose. The error `code` does NOT branch:
 * `ERR_READONLY_FIELD_REJECTED` is what callers catch, and `drops` is what they
 * read to tell the classes apart.
 *
 * [#9107] The `readonlyWhen` REMEDY clause did move once, and not because a
 * class was added — because the behaviour it described changed. The conditional
 * strip now judges only API-boundary callers, so "those stay locked for every
 * caller" had become false in the one direction a server author acts on: a
 * `beforeUpdate` hook's derived value is not a caller write and is never
 * stripped. A remedy sentence that has gone false is worse than a reworded one
 * — it sends the reader to `isSystem`, which does NOT exempt this strip and is
 * a strictly worse posture adopted for nothing (the same trap #8141 names one
 * log line over). The byte-exact pin in
 * `engine-dropped-fields-primary-key.test.ts` moved with it.
 *
 * Identified by `code` rather than `instanceof` so it survives crossing package
 * boundaries — the convention `SummaryRecomputeError` / `DriverConnectError`
 * already follow here. The code is registered in the spec's `ERROR_CODE_LEDGER`
 * under `@objectstack/objectql`.
 */
/**
 * The reason arms whose shared wording ("are read-only", remedied by
 * `isSystem`) is TRUE. A drop outside this set makes the read-only sentence a
 * lie, so the message switches to the per-reason form below.
 */
const READONLY_CLASS_REASONS: ReadonlySet<DroppedFieldsEvent['reason']> = new Set([
  'readonly',
  'readonly_when',
]);

/** How each reason is named to a human, in the per-reason message form. */
const REASON_PHRASE: Record<DroppedFieldsEvent['reason'], string> = {
  readonly: "read-only (`readonly: true`)",
  readonly_when: "read-only in the target record's current state (a TRUE `readonlyWhen` predicate)",
  primary_key:
    'the primary key, carrying a value the engine has already ruled is not an identifier — ' +
    "writing it would have overwritten the targeted row(s)' primary-key column",
};

/**
 * The per-reason breakdown sentence, e.g.
 * `id — the primary key, …; amount — read-only in the target record's …`.
 * Fields keep the order they were dropped in, de-duplicated per reason.
 */
function describeDropsByReason(drops: readonly DroppedFieldsEvent[]): string {
  const byReason = new Map<DroppedFieldsEvent['reason'], string[]>();
  for (const d of drops) {
    const seen = byReason.get(d.reason) ?? [];
    for (const f of d.fields) if (!seen.includes(f)) seen.push(f);
    byReason.set(d.reason, seen);
  }
  return [...byReason]
    .filter(([, fields]) => fields.length > 0)
    .map(([reason, fields]) => `${fields.join(', ')} — ${REASON_PHRASE[reason] ?? reason}`)
    .join('; ');
}

/**
 * Compose the refusal message.
 *
 * The read-only-only branch is #5126's / #5503's text, byte for byte — an
 * `expect(err.message)` written against it must not move because a *different*
 * payload can now be refused for a different reason.
 */
function buildRefusalMessage(
  object: string,
  fields: string[],
  drops: readonly DroppedFieldsEvent[],
  operation: 'insert' | 'update',
): string {
  const head = `${operation === 'insert' ? 'Insert' : 'Update'} on '${object}' was REFUSED: `;
  const tail =
    `To let the strip happen and merely observe it, drop ` +
    `strictReadonlyWrites and pass options.onFieldsDropped instead (#3407).`;

  // Empty `drops` cannot happen on either throw site, but `every` on it is
  // vacuously true, which lands on the historical wording — the safe default.
  if (drops.every((d) => READONLY_CLASS_REASONS.has(d.reason))) {
    return (
      head +
      `${fields.length} caller-supplied field(s) ` +
      `(${fields.join(', ')}) are read-only and would have been stripped, and this write ` +
      `passed options.strictReadonlyWrites — so NOTHING was written, including the fields ` +
      `that would have survived. Remove the read-only field(s) from the payload; or, for ` +
      `server-side code that legitimately writes read-only columns, pass ` +
      (operation === 'insert'
        ? `{ context: { isSystem: true } } — or, for a data migration reinstating legacy ` +
          `values for a runtime-owned field (a record number), the historical-import ` +
          `context { context: { preserveAudit: true } } (#3493). `
        : `{ context: { isSystem: true } } (this exempts statically 'readonly' fields, but NOT ` +
          `fields locked by a TRUE 'readonlyWhen' predicate — those stay locked for every ` +
          `API-boundary caller, isSystem included. A value DERIVED by a beforeUpdate hook is ` +
          `not a caller write and is never stripped — that is the sanctioned write path for a ` +
          `conditionally-locked derived field). `) +
      tail
    );
  }

  // At least one drop is NOT a read-only lock, so the union cannot be described
  // as read-only and `isSystem` is not a blanket remedy. Name each reason.
  return (
    head +
    `${fields.length} caller-supplied field(s) ` +
    `(${fields.join(', ')}) would have been stripped, and this write passed ` +
    `options.strictReadonlyWrites — so NOTHING was written, including the fields that ` +
    `would have survived. Per reason: ${describeDropsByReason(drops)}. The remedies differ ` +
    `per reason: for a read-only lock, remove the field from the payload, or pass ` +
    `{ context: { isSystem: true } } for server-side code that legitimately writes ` +
    `statically 'readonly' columns (that exempts NEITHER a TRUE 'readonlyWhen' predicate ` +
    `NOR the primary-key strip — both apply to every API-boundary caller, isSystem included; ` +
    `a 'readonlyWhen' value DERIVED by a beforeUpdate hook is not a caller write and is never ` +
    `stripped); for ` +
    `'primary_key', pass a SCALAR id to update ONE row (\`update(object, { id, ...fields })\` ` +
    `or \`{ where: { id } }\`), or put the id set in \`where\` to SELECT rows ` +
    `(\`{ where: { id: { $in: [...] } }, multi: true }\`). ` +
    tail
  );
}

export class ReadonlyFieldRejectedError extends Error {
  readonly code = 'ERR_READONLY_FIELD_REJECTED' as const;
  constructor(
    public readonly object: string,
    public readonly fields: string[],
    public readonly drops: readonly DroppedFieldsEvent[],
    /**
     * Which verb refused (#5503). Defaults to `'update'` so the UPDATE message
     * — and every caller written against it — is byte-identical to #5126's.
     * The remedies genuinely differ per operation, so they are not shared: an
     * INSERT refusal can only ever be about a runtime-owned value, whose exempt
     * writers are `isSystem` and the `preserveAudit` historical import, while
     * `readonlyWhen` cannot lock anything on a create at all.
     */
    public readonly operation: 'insert' | 'update' = 'update',
  ) {
    super(buildRefusalMessage(object, fields, drops, operation));
    this.name = 'ReadonlyFieldRejectedError';
  }
}
