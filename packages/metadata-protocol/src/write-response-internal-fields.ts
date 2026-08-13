// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7823] The write-response half of the `internal: true` guarantee — applied
 * at the generic-data-path INGRESS, by maintainer ruling (2026-08-13, A-prime).
 *
 * ## The contract
 *
 * A field declared `internal: true` is *never returned on the generic data
 * path* (#7728). The READ half lives in the engine (`omitInternalFields` runs
 * on every find/findOne result). The WRITE-RESPONSE half lives HERE: every
 * protocol `*Data` face that hands an engine write result back to its caller
 * passes the record(s) through {@link omitInternalFieldsFromWriteResponse}
 * before building its response.
 *
 * ## Why the ingress and not the engine (the measured history)
 *
 * The first shape stripped `internal` fields inside the engine's insert and
 * by-id-update paths. That conflated two different guarantees:
 *
 *  - "never returned on the generic data path" — the flag's sentence, about
 *    what an EXTERNAL caller receives; and
 *  - "never returned to the engine-level caller that performed the write" —
 *    which no ruling ever asked for, and which is FALSE for credential mint:
 *    better-auth's `createWithHooks` reads the minted `sys_session` row back
 *    off the insert result, so the engine-side strip broke `signIn`/`signUp`
 *    outright (measured: `verify signIn: no token in response`).
 *
 * Plain removal of the engine limbs was ALSO measured wrong: the by-id-update
 * strip was the sole closure of #7728's fourth surface — with it neutralised,
 * `PATCH /data/sys_api_key/{id}` answered 200 with the stored 64-hex `key`
 * hash in the body. Both measurements are satisfiable at exactly one boundary:
 * the ingress that builds the external 201/200 bodies. Engine write results
 * keep the stored row whole (mint works); every external write response is
 * stripped here (the hash never leaves); the read path is untouched.
 *
 * ## The residual risk, and what gates it
 *
 * Response-body policy at the ingress means a FUTURE generic write face that
 * forgets this helper leaks silently. The ruling does not accept that as a
 * future problem: `protocol.write-response-internal-fields.tripwire.test.ts`
 * enumerates every `*Data` method on the protocol class (by name convention,
 * walking the prototype), drives each against a fixture engine whose write
 * results carry a flagged sentinel, and fails on any response the sentinel
 * reaches — AND fails when a `*Data` method exists that the tripwire has no
 * recipe for, so a new ingress cannot ship unexamined. Adding a `*Data` face?
 * Route its response records through this helper and give the tripwire a
 * recipe.
 *
 * ## Semantics
 *
 * Mirrors the engine's `collectInternalReadFields` rule exactly — a field
 * participates iff its declaration carries `internal === true` (strict
 * boolean; truthy strings and numbers do not count, same as the engine).
 * `@objectstack/metadata-protocol` cannot import that collector
 * (`@objectstack/objectql` depends on this package), so the rule is restated
 * here in full; `internal-fields.test.ts` in objectql and the tripwire here
 * pin the same spelling from both sides. OMIT, not mask, for the #7728
 * reasons: the flag's columns are `required`, so a mask carries zero bits
 * while still shipping a value under a field whose description promises none.
 *
 * Deletion is IN PLACE and idempotent: records that already lack the field
 * (a re-stripped read result, a fake engine that never returned it) pass
 * through unchanged, and non-record values (`null`, an affected-row count, a
 * driver's boolean delete verdict) are skipped rather than judged.
 */

/** Minimal view of an object schema this module reads — the field map only. */
interface SchemaWithFields {
  fields?: Record<string, { internal?: unknown } | undefined> | undefined;
}

/**
 * Collect the names of fields declared `internal: true` on `schema`.
 *
 * Same verdicts as objectql's `collectInternalReadFields` (see the module
 * header for why it is restated rather than imported): strict `=== true`,
 * empty result for a missing/field-less schema.
 */
export function collectInternalWriteResponseFields(schema: unknown): string[] {
  const fields = (schema as SchemaWithFields | null | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return [];
  const out: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (def && def.internal === true) out.push(name);
  }
  return out;
}

/**
 * Drop every `internal: true` field from a write response's record(s), in
 * place. THE single helper every generic write ingress goes through — see the
 * module header; the tripwire test enforces the "every".
 *
 * @param schema  The registered object schema (`engine.registry.getObject(...)`
 *                / the protocol's own registry view). An unknown object (no
 *                schema) strips nothing — the write itself would have been
 *                refused upstream by the object-existence gate.
 * @param records A single record, an array of records, or anything a write
 *                face hands back where a record could sit (`null`, a count, a
 *                boolean): non-objects are skipped, arrays are walked.
 */
export function omitInternalFieldsFromWriteResponse(schema: unknown, records: unknown): void {
  if (!records) return;
  const internalFields = collectInternalWriteResponseFields(schema);
  if (internalFields.length === 0) return;
  const list = Array.isArray(records) ? records : [records];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    for (const field of internalFields) delete (row as Record<string, unknown>)[field];
  }
}
