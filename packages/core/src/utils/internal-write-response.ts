// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7823 / #8497] The write-response half of the `internal: true` guarantee —
 * THE single helper every write mouth that returns a body to an external
 * caller passes its record(s) through.
 *
 * ## The contract
 *
 * A field declared `internal: true` is *never returned on the generic data
 * path* (#7728). The READ half lives in the engine (`omitInternalFields` runs
 * on every find/findOne result). The WRITE-RESPONSE half lives HERE.
 *
 * ## Why the ingress and not the engine (the measured history, #7823)
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
 * the mouth that builds the external 201/200 body. Engine write results keep
 * the stored row whole (mint works); every external write response is stripped
 * through this helper (the hash never leaves); the read path is untouched.
 *
 * ## Why this module sits in `@objectstack/core` (#8497)
 *
 * It shipped inside `@objectstack/metadata-protocol`, next to the protocol
 * class that was then its only caller. That placement encoded an assumption
 * the surface does not honour: **the generic write mouths are not all on the
 * protocol class.** Two transports reach the engine directly —
 *
 *  - `@objectstack/rest` (`rest-server.ts`, the cross-object `POST /batch`
 *    update arm's direct `ql.update`), and
 *  - `@objectstack/mcp` (`stdio-data-bridge.ts`, whose `create` handed the
 *    engine's insert result straight back to the MCP client — a MEASURED leak
 *    of the flagged column, found by widening this guard's scope in #8497),
 *
 * — and neither package depends on `@objectstack/metadata-protocol`. The old
 * home therefore forced each new mouth to choose between a duck-typed reach
 * through a protocol instance (what `rest` does) and a private restatement of
 * the rule (a third copy of a security-relevant predicate). `@objectstack/core`
 * is the floor all three already depend on, and it already hosts exactly this
 * class of shared write-path helper (`bulk-write.ts`, used by both
 * `metadata-protocol` and `rest` so neither reimplements batching). One helper,
 * reachable from every mouth, is the whole point of the flag being structural.
 *
 * `@objectstack/metadata-protocol` re-exports both functions unchanged, so its
 * public API is byte-identical across the move.
 *
 * ## The residual risk, and what gates it
 *
 * Response-body policy at the mouth means a FUTURE write mouth that forgets
 * this helper leaks silently. Three tripwires hold the property, each an
 * enumeration no author can dodge by adding code without touching it:
 *
 *  - `protocol.write-response-internal-fields.tripwire.test.ts`
 *    (`metadata-protocol`) walks the protocol class's prototype for `*Data`
 *    faces;
 *  - `rest-write-response-internal-fields.tripwire.test.ts` (`rest`) walks
 *    `RestServer.getRoutes()` for HTTP write routes;
 *  - `mcp-write-response-internal-fields.tripwire.test.ts` (`mcp`) walks the
 *    `McpDataBridge` write faces.
 *
 * Together they assert the PROPERTY — "no response body an external caller
 * receives from a write carries an `internal: true` value" — rather than the
 * shape of any one class. Adding a write mouth? Route its response records
 * through this helper and register it with the tripwire that enumerates its
 * surface.
 *
 * ## Semantics
 *
 * Mirrors the engine's `collectInternalReadFields` rule exactly — a field
 * participates iff its declaration carries `internal === true` (strict
 * boolean; truthy strings and numbers do not count, same as the engine).
 * `@objectstack/core` cannot import that collector (`@objectstack/objectql`
 * sits above this package), so the rule is restated here in full;
 * `internal-fields.test.ts` in objectql and the tripwires above pin the same
 * spelling from both sides. OMIT, not mask, for the #7728 reasons: the flag's
 * columns are `required`, so a mask carries zero bits while still shipping a
 * value under a field whose description promises none.
 *
 * ## The credential-class mask rides the same helper
 *
 * The engine masks credential-class fields (`secret`, and `password` outside
 * the exempt `managedBy` buckets — ADR-0100) on its READ path only, and keeps
 * its write results whole for the same reason it keeps `internal` columns:
 * a privileged server-side writer may read the stored value back off the
 * result. Every external write response therefore owes the credential mask
 * too, at the same mouths. It is applied by the same helper, ahead of the
 * omission, so no mouth can hold one guarantee and miss the other, and the
 * three tripwires named above hold both by one enumeration.
 *
 * Deletion is IN PLACE and idempotent: records that already lack the field
 * (a re-stripped read result, a fake engine that never returned it) pass
 * through unchanged, and non-record values (`null`, an affected-row count, a
 * driver's boolean delete verdict) are skipped rather than judged.
 */

import { SECRET_MASK, isMaskedOnReadFieldType } from '@objectstack/spec/data';

/** Minimal view of an object schema this module reads — the field map only. */
interface SchemaWithFields {
  fields?: Record<string, { internal?: unknown; type?: unknown } | undefined> | undefined;
  managedBy?: unknown;
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
 * Collect the names of the credential-class fields the engine masks on read
 * (ADR-0100: every `secret` field, every `password` field outside the exempt
 * `managedBy` buckets) — the write-response half of that mask reads the SAME
 * set, so a write answers what a read of the same row would.
 *
 * Not restated: the type set and its per-type `managedBy` exemptions are
 * declared once in `@objectstack/spec/data` and asked through
 * `isMaskedOnReadFieldType`, exactly as objectql's `collectMaskedReadFields`
 * asks it. ⛔ Do not add a `def.type === …` arm here; change the declaration.
 */
export function collectCredentialWriteResponseFields(schema: unknown): string[] {
  const s = schema as SchemaWithFields | null | undefined;
  const fields = s?.fields;
  if (!fields || typeof fields !== 'object') return [];
  const managedBy: unknown = s?.managedBy;
  const out: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (def && isMaskedOnReadFieldType(def.type, managedBy)) out.push(name);
  }
  return out;
}

/**
 * Replace every credential-class field in a write response's record(s) with
 * `SECRET_MASK`, in place — the write-response mirror of the engine's read
 * mask (`maskSecretFields`). A set value becomes the mask; an unset one
 * (`null` / `undefined`) becomes `null`, so "a credential is set" is the only
 * bit a response carries. A field the record does not carry (never written, or
 * already removed by field-level security upstream) stays absent: this mask
 * never ADDS a key, so it composes with the security plugin's field masking
 * instead of re-exposing what that removed.
 *
 * Idempotent; non-objects are skipped, arrays are walked.
 */
export function maskCredentialFieldsInWriteResponse(schema: unknown, records: unknown): void {
  if (!records) return;
  const credentialFields = collectCredentialWriteResponseFields(schema);
  if (credentialFields.length === 0) return;
  const list = Array.isArray(records) ? records : [records];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    for (const field of credentialFields) {
      if (!(field in r)) continue;
      r[field] = r[field] == null ? null : SECRET_MASK;
    }
  }
}

/**
 * Apply the generic-data-path non-exposure rules to a write response's
 * record(s), in place: credential-class fields are MASKED
 * ({@link maskCredentialFieldsInWriteResponse}), then `internal: true` fields
 * are OMITTED. THE single helper every external write mouth goes through —
 * see the module header; the three tripwires enforce the "every".
 *
 * Mask first, omit second — the engine read path's order, so a field that is
 * both credential-typed and `internal` ends up omitted (the stricter
 * disposition wins).
 *
 * @param schema  The registered object schema (`engine.registry.getObject(...)`
 *                / the protocol's own registry view / `metadataService
 *                .getObject(...)`). An unknown object (no schema) strips
 *                nothing — the write itself would have been refused upstream
 *                by the object-existence gate.
 * @param records A single record, an array of records, or anything a write
 *                mouth hands back where a record could sit (`null`, a count, a
 *                boolean): non-objects are skipped, arrays are walked.
 */
export function omitInternalFieldsFromWriteResponse(schema: unknown, records: unknown): void {
  if (!records) return;
  maskCredentialFieldsInWriteResponse(schema, records);
  const internalFields = collectInternalWriteResponseFields(schema);
  if (internalFields.length === 0) return;
  const list = Array.isArray(records) ? records : [records];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    for (const field of internalFields) delete (row as Record<string, unknown>)[field];
  }
}
