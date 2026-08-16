// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7823, widened by #7987] The internal-field READBACK seam — better-auth's
 * own routes get the `internal`-stripped credential columns back, through the
 * engine's privileged accessor, at the one layer we own.
 *
 * ## What this seam is for
 *
 * A column declared `internal: true` is omitted by the engine's generic read
 * path from every find/findOne result — that is the fix for the disclosures
 * #7823 and #7987 exist for, and it stays. But better-auth's storage adapter
 * is implemented OVER that same read path (`objectql-adapter.ts` →
 * `dataEngine.find`/`findOne`), and several of better-auth's own routes read
 * those columns back OFF the rows it returns. The strip alone starves them.
 *
 * This module re-attaches the stored values to the rows the adapter hands
 * better-auth, so every one of those readbacks sees the row whole while the
 * generic data API keeps returning rows without the column.
 *
 * ## The two objects, and why each is here (both MEASURED, not assumed)
 *
 * **`sys_session.token`** (#7823):
 *
 *  - `revoke-other-sessions` filters `listSessions(userId)` rows by
 *    `session.token !== ctx.context.session.session.token` and deletes by
 *    token. With every row's `token` undefined the filter yields nothing —
 *    measured: `POST /auth/revoke-other-sessions` answered
 *    `200 {"status":true}` while the user's other session KEPT AUTHENTICATING.
 *    A security control reporting success while doing nothing.
 *  - sliding-expiry refresh (`updateSession(session.session.token, …)`) and
 *    expired-session cleanup (`deleteSession(…)`) read the token off the
 *    context session, itself hydrated from an adapter read — same silent
 *    no-op shape.
 *
 * **`sys_account.access_token` / `.refresh_token` / `.id_token`** (#7987) —
 * the OAuth credentials for the user's linked providers. better-auth reads
 * these off adapter result rows on the token-exchange paths, traced in
 * `better-auth/dist/api/routes/account.mjs`:
 *
 *  - `internalAdapter.findAccounts(userId)` issues `findMany` with **no
 *    projection**, so the row set is exactly what the strip empties;
 *  - `resolveUserAccount()` picks a row out of it, and `getValidAccessToken()`
 *    (behind `/get-access-token` and `/account-info`) then reads
 *    `account.refreshToken` to decide whether to refresh, `account.accessToken`
 *    to answer with, and `account.idToken` to carry forward;
 *  - `POST /refresh-token` reads `account.refreshToken` and answers
 *    `REFRESH_TOKEN_NOT_FOUND` (400) when it is absent.
 *
 * So without this seam the strip would not merely hide the OAuth tokens, it
 * would make the refresh EXCHANGE fail and `/get-access-token` hand back an
 * empty string. That is the risk #7987 was parked on, and the reason the
 * mechanism is a readback rather than a bare flag.
 *
 * **`sys_account.password`** (#8676) — the credential hash. better-auth's
 * sign-in verifier reads it off an adapter result row
 * (`internalAdapter.findCredentialAccount(userId)`), so it belongs to this
 * seam for the same reason the OAuth columns do.
 *
 * ## TWO seams, not one — this module owns both (#8676)
 *
 * The table above serves better-auth's storage adapter, which is the only
 * importer of {@link reattachInternalFieldsOnRead}. plugin-auth also has
 * readers of its own that reach the RAW engine and never pass through the
 * adapter — the ADR-0069 D1 password-reuse ring and the dev seed-admin probe.
 * The strip has no `isSystem` carve-out, so those are starved by a flag just
 * the same, and the table cannot reach them.
 * {@link recoverInternalFieldsForSystemRead} is their seam; its own doc carries
 * the measurement and the reason a bare flag would have shipped a security
 * control that reports success while doing nothing.
 *
 * ## The shape (maintainer ruling 2026-08-13, Q2: compose)
 *
 * `Engine.resolveInternalField` — the purpose-built privileged batch accessor
 * #8118 landed — recovers the stored value for a batch of row ids. ⛔ NOT a
 * second accessor, ⛔ NOT an engine carve-out: the engine's read path stays
 * carve-out-free (#7728's design), and the privileged dereference happens
 * here, in the identity authority's own storage seam — the same placement as
 * `sso-client-secret.ts`'s `injectClientSecretOnRead` (#8009) and the same
 * raw-engine access rule: `withSystemContext` deliberately exposes CRUD verbs
 * only, so the privileged verb comes off the RAW engine.
 *
 * The accessor resolves ONE field per call by contract, so an object with
 * three flagged columns costs three id-batched driver reads per page. That is
 * consumed as-is, deliberately: widening the accessor to a field SET would
 * restructure a surface `@objectstack/service-messaging` and other consumers
 * share, to save two indexed point-reads on a path already dominated by the
 * provider round trip and the password KDF. The batching that matters —
 * one read per FIELD per page rather than one per ROW — is already there.
 *
 * ## Fail-closed, loudly
 *
 * A row that comes back missing a flagged column from an engine that offers no
 * `resolveInternalField` is exactly the state that turns `revoke-other-sessions`
 * into a silent no-op and an OAuth refresh into a 400 — so it throws
 * (composition error, named remedy) instead of degrading. Rows that still
 * carry the column (a fake engine in tests, an engine without the strip) are
 * left untouched and trigger no privileged read at all, so the seam is inert
 * everywhere the strip is.
 */

import { SystemObjectName } from '@objectstack/spec/system';

/**
 * Engine surface this seam needs. The verb is separately named and privileged
 * (#8118) precisely so it cannot be reached from a query string; it comes off
 * the RAW engine, never the `withSystemContext` wrapper.
 */
export interface InternalFieldResolvingEngine {
  resolveInternalField?(
    object: string,
    recordIds: readonly string[],
    field: string,
  ): Promise<Map<string, unknown>>;
}

interface ReadbackColumn {
  /** The flagged column, by its ObjectStack (snake_case) name. */
  readonly field: string;
  /**
   * Does the ABSENCE of this key from a result row prove the engine's strip
   * ran? Only when the column's own declaration forbids a row from lacking it.
   *
   * This is the seam's one non-obvious discriminator, and getting it wrong is
   * measurable in both directions. Absence has two possible causes — the strip
   * removed it, or the row never carried it — and the seam cannot tell them
   * apart by looking. What settles it is the DECLARATION:
   *
   *  - `sys_session.token` is `required: true`. A session row without a token
   *    does not exist, so absence can only be the strip ⇒ absence is a
   *    reliable signal and this seam fails closed on it.
   *  - `sys_account`'s three OAuth columns are `required: false`, and are
   *    genuinely empty on every credential (password) account — the ordinary
   *    case. Treating absence as proof of the strip there means an engine
   *    without the accessor throws on ordinary sign-in: measured, it broke 16
   *    session/impersonation tests against the in-memory fake engines, because
   *    better-auth's `findCredentialAccount` reads a password account on the
   *    sign-in path and those rows never had a token column to begin with.
   *
   * For a column marked `false`, the seam therefore falls back to the engine's
   * own capability: it recovers the value when the engine offers the accessor,
   * and stays inert when it does not (an engine with no `resolveInternalField`
   * does not implement the `internal` channel, so it never stripped anything).
   * The residual risk that buys — a version-skewed engine that strips but
   * predates #8118 — degrades LOUDLY for these columns, with the token routes
   * answering `REFRESH_TOKEN_NOT_FOUND` (400), where the session column would
   * have degraded into a security control silently reporting success.
   */
  readonly absenceProvesStrip: boolean;
}

/**
 * The columns this seam re-attaches, per object.
 *
 * Bounded on purpose — this is NOT "re-attach every `internal` field the
 * registry knows". The entries here are the ones whose consumer was traced
 * into better-auth's own route code (see the module header); a flagged column
 * nobody reads back must stay stripped everywhere, which is the whole point of
 * the flag. `sys_api_key.key` is deliberately absent: its mint route returns
 * the plaintext it generated itself and never reads the stored hash back
 * (#7728).
 */
const READBACK_FIELDS: Readonly<Record<string, readonly ReadbackColumn[]>> = {
  [SystemObjectName.SESSION]: [{ field: 'token', absenceProvesStrip: true }],
  // [#7987] All three OAuth credential columns, plus [#8676] `password`.
  //
  // `password` is here because better-auth's sign-in verifier reads it OFF an
  // adapter result row: `internalAdapter.findCredentialAccount(userId)` returns
  // the row whose `password` is then compared against the submitted one. Under
  // the #8676 flag that row comes back without the column, so without this row
  // password sign-in would fail for every user. `absenceProvesStrip: false`
  // because `sys_account.password` is `required: false` and genuinely empty on
  // OAuth-only accounts — see the field's own doc above for why that
  // discriminator is not a detail.
  //
  // ⛔ `previous_password_hashes` is deliberately NOT here, and adding it would
  // be dead code: better-auth has ZERO readers of that column. It is an
  // ObjectStack-only column read solely by `auth-manager.ts`'s ADR-0069 D1
  // reuse ring, which reaches the RAW engine and therefore never passes through
  // this adapter seam at all — it is recovered by
  // {@link recoverInternalFieldsForSystemRead} instead. A flagged column nobody
  // reads back through the adapter must stay stripped here, which is the whole
  // point of the bound. (`sys_api_key.key` is absent for the sibling reason:
  // its mint route returns the plaintext it generated and never reads the
  // stored hash back — #7728.)
  [SystemObjectName.ACCOUNT]: [
    { field: 'access_token', absenceProvesStrip: false },
    { field: 'refresh_token', absenceProvesStrip: false },
    { field: 'id_token', absenceProvesStrip: false },
    { field: 'password', absenceProvesStrip: false },
  ],
};

/** What breaks if a stripped row is handed to better-auth un-repaired. */
const FAIL_CLOSED_CONSEQUENCE: Readonly<Record<string, string>> = {
  [SystemObjectName.SESSION]:
    'better-auth session-lifecycle routes (revoke-other-sessions, sliding-expiry refresh, '
    + 'expired-session cleanup) would silently no-op on such rows',
  [SystemObjectName.ACCOUNT]:
    'better-auth OAuth token routes (/get-access-token, /account-info, /refresh-token) would '
    + 'fail to exchange the refresh token — answering REFRESH_TOKEN_NOT_FOUND, or handing back '
    + 'an empty access token — on such rows',
};

/**
 * Re-attach an object's `internal: true` columns to adapter read results, in
 * place.
 *
 * @param engine          The RAW data engine (privileged verb holder).
 * @param objectName      Protocol object name of the model just read.
 * @param rows            The row (findOne) or rows (findMany) about to be
 *                        handed to better-auth. Mutated in place.
 * @param requestedFields The caller's projection, if it named one — a read
 *                        that deliberately selected columns without a flagged
 *                        one keeps its projection (that column is not
 *                        attached). Applied per column, so a projection may
 *                        name one flagged column and not another.
 */
export async function reattachInternalFieldsOnRead(
  engine: InternalFieldResolvingEngine,
  objectName: string,
  rows: unknown,
  requestedFields?: readonly string[],
): Promise<void> {
  const fields = READBACK_FIELDS[objectName];
  if (!fields) return;
  await recoverColumns(engine, objectName, rows, fields, requestedFields);
}

/**
 * [#8676] Recover flagged columns for one of plugin-auth's OWN raw-engine
 * reads — the second seam, and the reason a bare flag was not enough.
 *
 * ## Why this exists beside {@link reattachInternalFieldsOnRead}
 *
 * That function is table-driven and lives on better-auth's storage-adapter
 * path: it is imported by exactly one file (`objectql-adapter.ts`), so it can
 * only repair rows that better-auth itself asked the adapter for. Several of
 * plugin-auth's own readers bypass the adapter entirely and call
 * `engine.findOne` / `ql.find` directly, and the engine's strip has **no
 * `isSystem` carve-out** (#7728's design — measured: a `findOne` with
 * `context: { isSystem: true }` AND an explicit projection naming the column
 * still comes back without it). Those readers are starved by the flag and the
 * adapter table cannot reach them.
 *
 * What that costs if it is skipped is not hypothetical. `assertPasswordNotReused`
 * — the ADR-0069 D1 reuse-prevention control — builds its comparison list as
 * `[currentHash, ...parseHashes(row.previous_password_hashes)].filter(Boolean)`.
 * With both keys stripped that list is `[]`, the comparison loop never runs,
 * `PASSWORD_REUSE` is never thrown, and the lookup's own `catch { return
 * undefined }` means nothing announces it: a security control reporting success
 * while doing nothing — the same shape #7823 fixed for `revoke-other-sessions`.
 * Worse, the unit tests around it use fake engines that never apply the strip,
 * so they stay GREEN while the control is dead.
 *
 * ## Posture: recover when the engine can, stay inert when it cannot
 *
 * Every column reached through here is treated as `absenceProvesStrip: false`,
 * and that is a requirement rather than a default. `previous_password_hashes`
 * is legitimately absent on a credential account that has never changed its
 * password — the ordinary case for a brand-new account — so "the key is missing
 * ⇒ the engine stripped it" is simply false for it, and a seam that threw on
 * absence would break the FIRST password change of every user. `password` is
 * `required: false` for the sibling reason (OAuth-only accounts carry none).
 * An engine offering no `resolveInternalField` does not implement the `internal`
 * channel at all — both halves ship together on the ObjectQL engine — so it
 * cannot have stripped anything and there is nothing to recover.
 *
 * @param engine      The RAW data engine (privileged verb holder).
 * @param objectName  Protocol object name of the rows just read.
 * @param rows        The row or rows to repair, mutated in place. A nullish
 *                    row is a no-op, so a caller may pass a `findOne` result
 *                    straight through without a null check.
 * @param fields      The flagged columns this caller actually reads. Keep it to
 *                    what the caller consumes: each entry costs one id-batched
 *                    driver read, and the accessor resolves ONE field per call.
 */
export async function recoverInternalFieldsForSystemRead(
  engine: InternalFieldResolvingEngine,
  objectName: string,
  rows: unknown,
  fields: readonly string[],
): Promise<void> {
  if (fields.length === 0) return;
  await recoverColumns(
    engine,
    objectName,
    rows,
    fields.map((field) => ({ field, absenceProvesStrip: false })),
  );
}

/** The shared recovery loop behind both seams above. */
async function recoverColumns(
  engine: InternalFieldResolvingEngine,
  objectName: string,
  rows: unknown,
  fields: readonly ReadbackColumn[],
  requestedFields?: readonly string[],
): Promise<void> {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(
    (r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object',
  );
  if (list.length === 0) return;
  const projected = Array.isArray(requestedFields) && requestedFields.length > 0
    ? requestedFields
    : null;

  for (const { field, absenceProvesStrip } of fields) {
    if (projected && !projected.includes(field)) continue;
    // Only rows the engine actually stripped need the privileged read; a row
    // still carrying the column (fake engines, a strip-less engine) is left
    // alone.
    const stripped = list.filter(
      (r) => !(field in r) && (typeof r.id === 'string' || typeof r.id === 'number'),
    );
    if (stripped.length === 0) continue;

    if (typeof engine.resolveInternalField !== 'function' && !absenceProvesStrip) {
      // The engine does not implement the `internal` channel at all — both
      // halves of it ship together on the ObjectQL engine — so it cannot have
      // stripped anything, and this column is one whose absence is ordinary
      // (see `absenceProvesStrip`). Nothing to recover; stay inert.
      continue;
    }

    if (typeof engine.resolveInternalField !== 'function') {
      // Refuse rather than degrade: handing better-auth rows without their
      // credential column is what turns a security control into a 200 that
      // does nothing (#7823) and a token refresh into a 400 (#7987). This
      // state is a composition error, so it must be loud.
      throw new Error(
        `${objectName} rows were read back without '${field}' (the engine's \`internal: true\` `
          + 'strip ran) but this engine offers no `resolveInternalField` accessor to recover it. '
          + `${FAIL_CLOSED_CONSEQUENCE[objectName] ?? 'better-auth would observe an incomplete row'}. `
          + 'Wire the ObjectQL engine (which provides the accessor, #8118), or remove the '
          + `\`internal\` flag from ${objectName}.${field}.`,
      );
    }

    const ids = stripped.map((r) => String(r.id));
    const values = await engine.resolveInternalField(objectName, ids, field);
    for (const row of stripped) {
      const id = String(row.id);
      // An id missing from the map is a row deleted between the read and the
      // dereference — leave it stripped; the consuming route treats it as the
      // already-gone record it is.
      if (values.has(id)) row[field] = values.get(id);
    }
  }
}
