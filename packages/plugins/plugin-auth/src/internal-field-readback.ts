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
  // [#7987] All three OAuth credential columns. `password` /
  // `previous_password_hashes` are NOT here and must not be: they are
  // better-auth one-way hashes (ADR-0100's third channel), they are not
  // flagged `internal`, and the accessor refuses any field that is not.
  [SystemObjectName.ACCOUNT]: [
    { field: 'access_token', absenceProvesStrip: false },
    { field: 'refresh_token', absenceProvesStrip: false },
    { field: 'id_token', absenceProvesStrip: false },
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
