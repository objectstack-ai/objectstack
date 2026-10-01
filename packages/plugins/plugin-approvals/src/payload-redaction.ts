// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-time redaction of the approval payload snapshot (#10749).
 *
 * ## The defect this closes
 *
 * `sys_approval_request.payload_json` stores the submitted record's raw row,
 * captured from the flow's `$record` variable — which the automation layer
 * hands over with **the record's own FLS never applying**. The column is a
 * `textarea` on `sys_approval_request`, so to every read door it is an opaque
 * string: the field-visibility machinery governs *columns of objects* and
 * cannot see inside a JSON column. Every field-level read control an app
 * author declared on the SUBJECT object — `requiredPermissions` (ADR-0066 D3),
 * a permission set marking a field non-readable, a `maskingRule` — is
 * therefore unenforceable on the approval path, for every app.
 *
 * ## The shape of the fix (maintainer ruling 2026-08-22, Option B)
 *
 * The full snapshot **stays at rest**: the approval record remains audit
 * evidence of what was actually submitted. Redaction is applied at SERVE time,
 * keyed on the reading caller, so the same row answers an admin with the whole
 * snapshot and a restricted approver with only the fields they may read.
 *
 * The readable set is not recomputed here. It comes from the security
 * service's `getReadableFields(object, context)` — documented as the same
 * field mask the read middleware applies, so this seam cannot drift from
 * data-plane FLS, and the CSV/XLSX export path already derives its columns
 * from it.
 *
 * ## A field the caller is served MASKED is dropped (#20964)
 *
 * The read projection counts a field whose `maskingRule` applies to the caller
 * as READABLE: the data plane serves that column, with its value replaced. So
 * narrowing by the read projection alone kept the key, and the snapshot handed
 * over the value as captured at submission, unmasked. The security contract's
 * query-side answer, `getQueryableFields` (#20935), is a subset of the read
 * projection that differs from it by exactly the fields this caller is served
 * masked. This seam reads it beside the read projection and serves only the
 * fields in BOTH — so a masked-for-this-caller field is dropped, together with
 * its derived label.
 *
 * Dropped, not masked, for two reasons. The contract publishes WHICH fields
 * are masked for a caller, not the masked value: reproducing the mask here
 * would be a second derivation of the masking rule beside the security
 * plugin's own, which is exactly what this seam must not hold. And dropping is
 * the fail-closed side of the data plane's answer: it discloses strictly less
 * than the masked value would (no kept characters, no length), and it is the
 * shape this seam already serves for a field the caller may not read at all.
 * Who the rule applies to is never decided here — that is the contract's
 * answer, asked as the caller.
 *
 * ## What this deliberately does NOT do
 *
 * - **It does not gate on OBJECT-level access.** An approver routinely has no
 *   read grant on the object under approval at all — that is the normal shape
 *   of an approval, and the snapshot is how they see what they are approving.
 *   `getReadableFields` answers with the full field set for a caller who has
 *   no field-permission entries for the object, which is exactly the behaviour
 *   this seam wants: FIELD-level declarations are enforced, object-level
 *   access is untouched, and every approval drawer shipping today keeps
 *   rendering.
 * - **It does not act on `hidden: true`.** `hidden` is a UI contract ("Hidden
 *   from default UI") and, in the spec's own words, "has never governed
 *   serialization" — measurably: no read path in the repo strips a value on
 *   it. Making it govern serialization here alone would make the approval path
 *   stricter than a direct read of the very same row (so it would close no
 *   leak — the approver can just read the record), while breaking every drawer
 *   that renders a `hidden` business column.
 *
 *   That `packages/spec` semantics question was left open here when this seam
 *   landed. **It has since been ruled** (maintainer, 2026-08-24, applying the
 *   2026-08-12 lineage rather than making a new rule): **`hidden: true` stays
 *   UI-only; `internal: true` is the serialization primitive.** `hidden`
 *   gains no serialization semantic — it says "Hidden from default UI" and
 *   nothing more. The read-side omission primitive is `internal: true`
 *   (#7728, ADR-0049): the engine OMITS the key from `find`/`findOne` results,
 *   the 201 create body and the by-id update body, on the default projection
 *   AND when a client names the field in `?select=`. `internal` exists
 *   PRECISELY BECAUSE `hidden` is not that, so an author who needs a field
 *   kept out of read results declares `internal: true`; declaring `hidden`
 *   and expecting omission is the mistake this paragraph exists to stop.
 *   Per-caller field visibility — what this seam applies — remains
 *   `requiredPermissions` / permission sets / `maskingRule`.
 */

/** The slice of the security service this seam consumes. */
export interface FieldVisibilitySource {
  /**
   * Fields of `object` this context may read — the same mask the ObjectQL read
   * middleware applies. `undefined` when the object schema cannot be resolved;
   * `[]` is the security plugin's own fail-closed tier (unresolvable posture,
   * dangling on-behalf-of delegator).
   */
  getReadableFields(object: string, context?: unknown): Promise<string[] | undefined>;
  /**
   * [#20964] The security contract's `getQueryableFields` (#20935): the subset
   * of {@link getReadableFields} this context may also query on, which the
   * contract defines as differing from the read projection by exactly the
   * fields this caller is served MASKED. Optional, as on the contract — and, as
   * the contract obliges, a source that cannot give this answer is NOT read as
   * "nothing is masked": {@link resolveReadableSnapshotFields} fails closed.
   */
  getQueryableFields?(object: string, context?: unknown): Promise<string[] | undefined>;
}

/** Outcome of one redaction pass, for logging and for tests to assert on. */
export interface RedactionOutcome {
  /** The snapshot to serve. Identical reference when nothing was removed. */
  payload: unknown;
  /** Keys removed, sorted. Empty when the snapshot passed through whole. */
  redactedKeys: string[];
}

/**
 * Drop every key of `payload` that is not in `readable`.
 *
 * ⛔ `readable === undefined` is NOT a denial (#3807). It is the security
 * plugin's "schema not resolvable" answer, and its documented contract is that
 * the caller falls back to its own projection — so the snapshot passes through
 * unchanged. Redacting on it would empty the drawer whenever object metadata
 * is briefly unavailable, which is an availability regression rather than a
 * security gain: the same caller can read the subject record directly through
 * a door that is likewise not narrowing during that window.
 *
 * `readable === []` IS a denial — it is what `getReadableFields` returns for an
 * unresolvable security posture or a dangling delegator, both of which the
 * platform already fails closed on (`canExport`, the export column projection).
 * Honouring it here keeps this seam consistent with those.
 *
 * A non-object snapshot (a JSON scalar, an array, `null`) has no keys to
 * govern and passes through: the field-visibility contract is about columns.
 */
export function redactSnapshot(payload: unknown, readable: string[] | undefined): RedactionOutcome {
  if (readable === undefined) return { payload, redactedKeys: [] };
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { payload, redactedKeys: [] };
  }
  const allowed = new Set(readable.map((f) => String(f)));
  const source = payload as Record<string, unknown>;
  const redactedKeys: string[] = [];
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (allowed.has(key)) kept[key] = source[key];
    else redactedKeys.push(key);
  }
  if (redactedKeys.length === 0) return { payload, redactedKeys: [] };
  return { payload: kept, redactedKeys: redactedKeys.sort() };
}

/**
 * Resolve the snapshot fields this caller may be SERVED for `object` — readable
 * and not masked for this caller — or `undefined` when this seam must not
 * narrow.
 *
 * `undefined` is returned — and the snapshot therefore served whole — in three
 * cases, each a deliberate fail-OPEN that preserves today's behaviour rather
 * than introducing a new way for an approval to render empty:
 *
 *  1. no security service is wired (a bare engine boot, most unit fixtures);
 *  2. no object name is known for the request;
 *  3. `getReadableFields` THREW, or answered `undefined` (schema unresolvable).
 *
 * Case 3 is the one worth naming out loud: the platform's stated posture for
 * consumers that turn this into an access decision is to fail closed, and this
 * seam does honour the fail-closed tier the security plugin itself computes
 * (`[]`). What it declines to do is treat a transient THROW as a denial, since
 * that would blank the snapshot on every approval drawer in the deployment for
 * the duration of a metadata hiccup. The trade is logged loudly so a persistent
 * outage is observable instead of silently non-narrowing.
 *
 * [#20964] Once the read projection is a list, the masked-for-this-caller
 * fields come off it: the answer is the read projection intersected with
 * `getQueryableFields`. That answer is NOT optional in the other direction.
 * The contract obliges a consumer that cannot get it — the method is absent,
 * or it answered `undefined` — not to read its absence as "nothing is masked",
 * because the read projection alone reports every masked field as readable.
 * This seam has no field declarations to fall back on and must not decide for
 * whom a rule is lifted, so it fails closed for the object: `[]`, no snapshot
 * field served. A THROW from it is treated the same way — unlike a throw from
 * the read projection, falling open here would serve exactly the values the
 * mask hides. With the security plugin wired, the member is always present and
 * answers a list whenever the read projection does, so this branch is reached
 * only by a source that predates the member; it is logged for that reason.
 */
export async function resolveReadableSnapshotFields(
  security: FieldVisibilitySource | undefined,
  objectName: string | undefined,
  context: unknown,
  logger?: { warn?: (msg: string, meta?: Record<string, any>) => void },
): Promise<string[] | undefined> {
  if (!security || typeof security.getReadableFields !== 'function') return undefined;
  const object = String(objectName ?? '').trim();
  if (!object) return undefined;
  let readable: string[] | undefined;
  try {
    readable = await security.getReadableFields(object, context);
  } catch (err: any) {
    logger?.warn?.('[approvals] payload redaction could not resolve readable fields — serving the snapshot unredacted', {
      object, error: err?.message ?? String(err),
    });
    return undefined;
  }
  if (readable === undefined) return undefined;

  let unmasked: string[] | undefined;
  let reason = 'the field-visibility source has no masked-for-this-caller answer (getQueryableFields)';
  if (typeof security.getQueryableFields === 'function') {
    try {
      unmasked = await security.getQueryableFields(object, context);
      if (unmasked === undefined) reason = 'getQueryableFields answered undefined';
    } catch (err: any) {
      reason = `getQueryableFields threw: ${err?.message ?? String(err)}`;
    }
  }
  if (unmasked === undefined) {
    logger?.warn?.('[approvals] payload redaction cannot tell which readable fields are masked for this caller — serving no snapshot field (fail closed)', {
      object, reason,
    });
    return [];
  }
  const keep = new Set(unmasked.map((f) => String(f)));
  return readable.filter((f) => keep.has(String(f)));
}
