// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which field types are masked on read (ADR-0100) — declared ONCE, here.
 *
 * # The fact
 *
 * On the engine's generic read path (`find` / `findOne` / `$expand`), a
 * credential-typed field is served as {@link SECRET_MASK} (or `null` when
 * unset), never as its stored value:
 *
 *   - `secret` — always. The column holds an opaque `sys_secret` ref; the
 *     plaintext is recoverable only through the engine's privileged
 *     dereference.
 *   - `password` — unless the object is `managedBy: 'better-auth'`. A generic
 *     `password` is plaintext at rest and masked on read; the auth subsystem
 *     reads its own identity rows through the same `find` / `findOne`, so
 *     masking there would break login. The exemption is part of the fact, not
 *     a consumer's special case, which is why it is declared beside the type
 *     it exempts.
 *
 * # Why it lives in `spec`
 *
 * Until #20141 the protocol stated this only in prose (the `FieldType`
 * comments), and two consumers each carried a hand-written copy:
 * `collectMaskedReadFields` in `@objectstack/objectql` (the read mask and the
 * echoed-mask write guard) and objectui's `MASKED_FIELD_TYPES` (the renderer,
 * which must not draw a masked value in clear or offer to copy it). A type
 * added to one copy and not the other is masked by the server and drawn in
 * clear by the client, or the reverse. `spec` is the contract both already
 * depend on, so the fact is declared here and both derive from it.
 *
 * # Shape — a per-type rule, read through one predicate
 *
 * Each masked type carries its OWN exemption list, keyed by the declared
 * `managedBy` bucket. Three properties follow from that shape, and each one
 * closes a way a consumer (human or AI) could get the answer wrong:
 *
 *   - **An exemption cannot be separated from its type.** A bare type set
 *     plus a separate exemption table would let a reader take the set and
 *     drop the table, which masks `password` on better-auth objects and
 *     breaks login. Here there is nothing to forget: the exemption is a
 *     field of the rule.
 *   - **Exemptions fail closed.** The list names the buckets that are NOT
 *     masked. A `managedBy` value this table has never heard of — a future
 *     bucket, a typo in unvalidated metadata, `undefined` — exempts nothing,
 *     so the field stays masked. An allow-list ("masked when managedBy is
 *     …") would unmask on exactly those inputs.
 *   - **Nothing can be invented.** Keys are checked against `FieldType` and
 *     exemption values against `ObjectSchema.managedBy`'s own enum, at
 *     compile time; `masked-field-types.test.ts` holds the same two
 *     memberships at run time against the live schemas.
 *
 * Consumers ask {@link isMaskedOnReadFieldType}, which takes `managedBy` as a
 * REQUIRED argument so a call site cannot leave the exemption out by omission.
 * The table is exported for consumers that must enumerate the masked types
 * (a renderer building its own lookup); ⛔ never re-derive the exemption from
 * it by hand — ask the predicate.
 *
 * Changing this table changes which stored values leave the engine in clear.
 * That is a security decision, not a refactor: the objectql table test pins
 * the full `FieldType × managedBy` answer, and it goes red on any edit here.
 */

import type { FieldType } from './field.zod';
import type { ServiceObject } from './object.zod';
import type { SECRET_MASK } from './secret-mask';

/**
 * The read-mask rule for ONE masked field type.
 */
export interface FieldTypeReadMask {
  /**
   * The `managedBy` buckets whose objects are EXEMPT from this type's read
   * mask. Empty ⇒ masked on every object. Each entry is a value
   * `ObjectSchema.managedBy` declares; an object whose `managedBy` is absent,
   * or is any value not listed here, is masked.
   */
  readonly exemptManagedBy: readonly NonNullable<ServiceObject['managedBy']>[];
}

/**
 * The field types masked on read (ADR-0100), each with the `managedBy`
 * buckets exempt from its mask. Deep-frozen: a consumer that mutated it would
 * change what every other consumer masks.
 *
 * Read it through {@link isMaskedOnReadFieldType}; see the module header for
 * why the exemption is carried per type.
 */
export const MASKED_ON_READ_FIELD_TYPES: Readonly<Partial<Record<FieldType, FieldTypeReadMask>>> =
  Object.freeze({
    // Reversible, encrypted-at-rest credential: the row holds a `sys_secret`
    // ref, and neither the ref nor the plaintext leaves the generic read path.
    secret: Object.freeze({ exemptManagedBy: Object.freeze([]) }),
    // Plaintext at rest on a generic object, masked on read. better-auth's
    // identity tables are exempt: the auth subsystem reads them through the
    // same generic path, and a masked credential there breaks login.
    password: Object.freeze({ exemptManagedBy: Object.freeze(['better-auth'] as const) }),
  } satisfies Partial<Record<FieldType, FieldTypeReadMask>>);

/**
 * Whether a field of type `fieldType`, on an object declaring `managedBy`, is
 * masked on read — served as {@link SECRET_MASK} (or `null` when unset)
 * instead of its stored value.
 *
 * Total over its inputs, because consumers call it on stored, unvalidated
 * metadata: a non-string or unknown `fieldType` is not masked (it is not a
 * masked type), and a `managedBy` that is absent or not a listed exemption
 * leaves a masked type masked (exemptions fail closed). Both parameters are
 * required — pass `undefined` for an object with no `managedBy` — so a call
 * site cannot drop the exemption by omission.
 */
export function isMaskedOnReadFieldType(fieldType: unknown, managedBy: unknown): boolean {
  if (typeof fieldType !== 'string') return false;
  // Own keys only: `'constructor'` / `'toString'` are properties of every
  // object literal and name no field type.
  if (!Object.prototype.hasOwnProperty.call(MASKED_ON_READ_FIELD_TYPES, fieldType)) return false;
  const rule = MASKED_ON_READ_FIELD_TYPES[fieldType as FieldType] as FieldTypeReadMask;
  return !(rule.exemptManagedBy as readonly unknown[]).includes(managedBy);
}
