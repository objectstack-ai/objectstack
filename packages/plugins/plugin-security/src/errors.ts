// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Typed sentinel error thrown by `SecurityPlugin` when an operation is
 * denied. Caught by `@objectstack/runtime`'s HTTP dispatcher and translated
 * to HTTP 403.
 *
 * ## Two messages, two audiences (#7414)
 *
 * `message` is what an END USER reads: both transports ship it verbatim as the
 * body's human-readable string (`mapDataError`'s `error`, the dispatcher's
 * `error.message`) and Console renders it as-is in a toast. `developerMessage`
 * is the operator's half — English, API names, the authorization vocabulary
 * that explains WHY — and it is the throw site's job to route it somewhere a
 * developer reads.
 *
 * ⛔ `developerMessage` is a sibling of `details`, deliberately NOT a member of
 * it. `details` is SERIALISED to the client on the dispatcher transport
 * (`http-dispatcher.ts`: `this.error(e.message, 403, { code, ...e.details })`,
 * which `buildApiError` puts on the wire as `error.details`), so anything
 * placed inside it reaches the browser. A developer sentence that names
 * positions and permission sets must not travel that way — see the throw site
 * in `security-plugin.ts` and the measurement recorded in
 * `permission-denied-user-copy.test.ts`.
 */
export class PermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';
  readonly statusCode = 403;
  readonly details?: Record<string, unknown>;
  /**
   * The operator-facing half of a refusal whose `message` has been localized
   * for an end user. Optional: a denial that never localized its message has
   * exactly one audience and carries none.
   */
  readonly developerMessage?: string;
  constructor(message: string, details?: Record<string, unknown>, developerMessage?: string) {
    super(message);
    this.name = 'PermissionDeniedError';
    this.details = details;
    if (developerMessage !== undefined) this.developerMessage = developerMessage;
  }
}

/**
 * ## The three NON-VERDICT legs of `assertControlledByParentWrite` (#7474)
 *
 * That gate used to funnel SIX distinct conditions through one `deny()` helper,
 * so all six answered `403 PERMISSION_DENIED` with one sentence — "requires
 * edit access to its master record". Three of them are genuine authorization
 * verdicts (no object-level `update` on the master / the master row outside the
 * caller's write RLS / no `edit`-level share grant) and keep that answer
 * verbatim. The other three are not verdicts at all, and the sentence was a
 * false statement carrying a false remedy: "ask whoever owns the parent record"
 * cannot fix a null FK, a deleted row, or a broken `master_detail` declaration.
 *
 * Maintainer ruling of 2026-08-11 on #7474 split them by true semantics. The
 * classes below are that split; the codes come from ADR-0112's closed
 * vocabulary rather than new spellings of conditions the catalog already names.
 *
 * ### Why each carries BOTH `status` and `statusCode`
 *
 * The two transports read different property names, and this gate throws on the
 * DATA path, which reaches both: `@objectstack/rest`'s `mapDataError` passes a
 * domain error through on `.status` alone, while the runtime dispatcher's
 * `errorFromThrown` reads `.status` then falls back to `.statusCode`. Declaring
 * one spelling would leave the other transport deriving a status from nothing —
 * which is the defect this split exists to remove, reintroduced at the edge.
 *
 * ### Why none of them starts with `[Security] Access denied`
 *
 * That exact prefix is a MATCHER, not a house style: `isPermissionDeniedError`
 * below, `mapDataError`, and `rest-server`'s sanitiser all read it as "this is a
 * 403". A configuration defect or a missing row phrased with that opening would
 * be re-flattened to `403 PERMISSION_DENIED` at the transport and the split
 * would be invisible on the wire — so each class opens with a prefix of its
 * own, and that is load-bearing.
 *
 * ### Why the explanation lives in `message`, never in `details`
 *
 * `details` is not a reliable carrier (#7450 rules it off the dispatcher wire
 * entirely, and `mapDataError`'s 4xx passthrough keeps only `error`, `code` and
 * `object`), so every one of these messages has to stand on its own. Each is
 * written for the APP AUTHOR — the audience the false 403 was hiding the defect
 * from — and each names the object, the operation, and the remedy.
 */

/**
 * `sharingModel: 'controlled_by_parent'` on an object with no `master_detail`
 * relation to derive access from → `422 INVALID_METADATA`.
 *
 * This is a precisely detectable AUTHORING defect, not an access verdict: the
 * object declares that its access is derived from a master and then gives the
 * platform no master to derive it from. Disguised as a routine permission
 * denial it was the class of thing an author never sees, because 403s on a
 * detail object read as ordinary RBAC noise — which is exactly the "declared =
 * enforced, and say so loudly" principle inverted.
 *
 * `INVALID_METADATA` at 422 is the shape `@objectstack/metadata-protocol`
 * already uses for "your metadata is broken" (its publish/validate refusals),
 * reused here rather than spelled a second way. 422 also keeps the message on
 * the wire: the 5xx band drops a producer's prose unconditionally at both
 * transports, and prose is the entire remedy for this condition.
 */
export class MasterDetailRelationMissingError extends Error {
  readonly code = 'INVALID_METADATA';
  readonly status = 422;
  readonly statusCode = 422;
  constructor(object: string, operation: string) {
    super(
      `[Security] Configuration defect: ${operation} on '${object}' cannot be authorized because the object `
      + `declares sharingModel 'controlled_by_parent' but has no master_detail relation to derive access from. `
      + `Declare a required master_detail field pointing at the master object, or change sharingModel.`,
    );
    this.name = 'MasterDetailRelationMissingError';
  }
}

/**
 * The by-id write names a detail row that does not exist → `404
 * RECORD_NOT_FOUND`.
 *
 * A concurrent delete answered `403 "requires edit access to its master"`
 * before this: an answer that leaks less but says something untrue, and one an
 * SDK cannot retry or reconcile against.
 *
 * The 404 does NOT widen what a caller can learn. The row is read under a
 * SYSTEM context (`readRowById(…, { isSystem: true })`), so a row hidden from
 * the caller by read RLS is still FOUND here and falls to the authorization
 * legs; and the object-level CRUD gate (middleware step 2) plus the row-level
 * write pre-image check (step 2.7) both run BEFORE this gate — so a caller who
 * reaches it already holds `update` on the detail. Absence here is real
 * absence.
 */
export class DetailRecordNotFoundError extends Error {
  readonly code = 'RECORD_NOT_FOUND';
  readonly status = 404;
  readonly statusCode = 404;
  readonly recordId: unknown;
  constructor(object: string, operation: string, recordId: unknown) {
    super(
      `[Security] Record not found: ${operation} on '${object}' targets record '${String(recordId)}', `
      + `which does not exist.`,
    );
    this.name = 'DetailRecordNotFoundError';
    this.recordId = recordId;
  }
}

/**
 * The detail carries no value in its master reference, so there is no master to
 * derive access from → `422 MISSING_REQUIRED_FIELD`.
 *
 * Two shapes of one condition, and the wording says which (#5240 — one
 * condition, one wording): on `insert` the REQUEST omitted the master FK, which
 * the caller fixes by sending it; on any other by-id write the STORED row's FK
 * is null, which is a data-integrity defect the caller cannot fix by asking for
 * permissions. `MISSING_REQUIRED_FIELD` is the standard catalog's name for both
 * — a controlled_by_parent detail without its master reference is precisely a
 * required value that is absent.
 *
 * ## [#8688] …and that reasoning is why the INSERT shape mostly no longer
 * reaches this class
 *
 * The maintainer ruling of 2026-08-15 took the sentence above to its
 * conclusion: if the condition is "a required value that is absent", then the
 * platform's contract for it is the one every adjacent missing-required-field
 * case already gets — `400 VALIDATION_FAILED` carrying `fields[]`, which is
 * what lets a form highlight the input — not a `[Security]`-prefixed 422 with
 * no `fields[]`. So `assertControlledByParentWrite` now stands down on an
 * insert whose master FK is absent and lets `validateRecord` answer, wherever
 * validation provably covers that omission.
 *
 * This class keeps BOTH shapes, and both are live:
 *
 *   • the STORED-ROW shape, unconditionally — no reordering of insert-path
 *     validation can reach a persisted null FK, and `fields[]` would name a
 *     field that was never in the request;
 *   • the INSERT shape for the three declarations validation does NOT cover
 *     (a `master_detail` with no `required`; `required` + `readonly`;
 *     `required` + `system`) — there this gate is the only refusal there is,
 *     and its 422 is what stops an unreadable orphan detail row being minted.
 *     #8772 *proposes* a publish-time lint that would refuse those shapes, but
 *     it is open and unruled — nothing refuses them at publish today, so an app
 *     can newly declare one and land here (#8959). This is the answer those
 *     shapes get for as long as they stay declarable, not merely until some
 *     legacy app is republished.
 *
 * The wording is unchanged in both, so a surface that pins either sentence sees
 * the same string it always did — what moved is WHICH inserts arrive here.
 */
export class MasterReferenceMissingError extends Error {
  readonly code = 'MISSING_REQUIRED_FIELD';
  readonly status = 422;
  readonly statusCode = 422;
  readonly field: string;
  readonly recordId: unknown;
  constructor(object: string, operation: string, field: string, recordId?: unknown) {
    super(
      recordId == null
        ? `[Security] Missing master reference: ${operation} on '${object}' did not supply '${field}'. `
          + `A controlled_by_parent detail derives its access from its master, so '${field}' must carry a `
          + `master record id on every write.`
        : `[Security] Missing master reference: ${operation} on '${object}' cannot be authorized because `
          + `record '${String(recordId)}' has no value in '${field}'. A controlled_by_parent detail derives `
          + `its access from its master, so that reference must be populated.`,
    );
    this.name = 'MasterReferenceMissingError';
    this.field = field;
    this.recordId = recordId;
  }
}

export function isPermissionDeniedError(e: unknown): e is PermissionDeniedError {
  if (!e || typeof e !== 'object') return false;
  const anyE = e as any;
  return (
    anyE.name === 'PermissionDeniedError' ||
    anyE.code === 'PERMISSION_DENIED' ||
    (typeof anyE.message === 'string' && anyE.message.startsWith('[Security] Access denied'))
  );
}
