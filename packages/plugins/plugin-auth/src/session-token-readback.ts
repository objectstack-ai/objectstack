// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7823] The session-token READBACK seam — better-auth's lifecycle routes get
 * the `internal`-stripped `sys_session.token` back, through the engine's
 * privileged accessor, at the one layer we own.
 *
 * ## The defect this closes (measured, not asserted)
 *
 * `sys_session.token` is declared `internal: true`, so the engine's generic
 * read path omits it from every find/findOne result — that is the fix for the
 * replay-proven admin-cross-user disclosure this card exists for, and it stays.
 * But better-auth's storage adapter is implemented OVER that same read path
 * (`objectql-adapter.ts` → `dataEngine.find`/`findOne`), and several of its
 * session-lifecycle routes read `session.token` back OFF the rows it returns:
 *
 *  - `revoke-other-sessions` filters `listSessions(userId)` rows by
 *    `session.token !== ctx.context.session.session.token` and deletes by
 *    token. With every row's `token` undefined the filter yields nothing —
 *    measured: `POST /auth/revoke-other-sessions` answered
 *    `200 {"status":true}` while the user's other session KEPT AUTHENTICATING.
 *    A security control reporting success while doing nothing.
 *  - sliding-expiry refresh (`updateSession(session.session.token, …)`) and
 *    expired-session cleanup (`deleteSession(…)`) read the token off the
 *    context session, which was itself hydrated from an adapter read — same
 *    silent no-op shape, by code trace on the same routes file.
 *
 * Plain bearer VALIDATION is not affected and is not touched here: the
 * verifier uses the token as a `where` FILTER (never a readback), and
 * `/auth/get-session` measured 200 throughout the breakage.
 *
 * ## The shape (maintainer ruling 2026-08-13, Q2: compose)
 *
 * `Engine.resolveInternalField` — the purpose-built privileged batch accessor
 * #8118 landed, whose consumption pattern that card established — recovers the
 * stored value for a batch of row ids. This module re-attaches it to session
 * rows the adapter hands better-auth, so every lifecycle readback sees the row
 * whole while the generic data API keeps returning rows without it. ⛔ NOT a
 * second accessor, ⛔ NOT an engine carve-out: the engine's read path stays
 * carve-out-free (#7728's design), and the privileged dereference happens
 * here, in the identity authority's own storage seam — the same placement as
 * `sso-client-secret.ts`'s `injectClientSecretOnRead` (#8009) and the same
 * raw-engine access rule: `withSystemContext` deliberately exposes CRUD verbs
 * only, so the privileged verb comes off the RAW engine.
 *
 * ## Fail-closed, loudly
 *
 * A session row that comes back WITHOUT `token` from an engine that offers no
 * `resolveInternalField` is exactly the state that turns `revoke-other-sessions`
 * into a silent no-op — so it throws (composition error, named remedy) instead
 * of degrading. Rows that still carry `token` (a fake engine in tests, an
 * engine without the strip) are left untouched and trigger no privileged read
 * at all, so the seam is inert everywhere the strip is.
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

/** The one column this seam re-attaches. Bounded on purpose: `sys_account`'s
 * OAuth token columns are #7987's call, not a widening here. */
const SESSION_TOKEN_FIELD = 'token';

/**
 * Re-attach `sys_session.token` to adapter read results, in place.
 *
 * @param engine          The RAW data engine (privileged verb holder).
 * @param objectName      Protocol object name of the model just read.
 * @param rows            The row (findOne) or rows (findMany) about to be
 *                        handed to better-auth. Mutated in place.
 * @param requestedFields The caller's projection, if it named one — a read
 *                        that deliberately selected columns without `token`
 *                        keeps its projection (nothing is attached).
 */
export async function reattachSessionTokenOnRead(
  engine: InternalFieldResolvingEngine,
  objectName: string,
  rows: unknown,
  requestedFields?: readonly string[],
): Promise<void> {
  if (objectName !== SystemObjectName.SESSION) return;
  if (
    Array.isArray(requestedFields)
    && requestedFields.length > 0
    && !requestedFields.includes(SESSION_TOKEN_FIELD)
  ) {
    return;
  }
  const list = (Array.isArray(rows) ? rows : [rows]).filter(
    (r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object',
  );
  // Only rows the engine actually stripped need the privileged read; a row
  // still carrying `token` (fake engines, a strip-less engine) is left alone.
  const stripped = list.filter(
    (r) => !(SESSION_TOKEN_FIELD in r)
      && (typeof r.id === 'string' || typeof r.id === 'number'),
  );
  if (stripped.length === 0) return;

  if (typeof engine.resolveInternalField !== 'function') {
    // Refuse rather than degrade: handing better-auth token-less session rows
    // is what turns revoke-other-sessions into a 200 that revokes nothing
    // (#7823). This state is a composition error, so it must be loud.
    throw new Error(
      `sys_session rows were read back without '${SESSION_TOKEN_FIELD}' (the engine's `
        + "`internal: true` strip ran) but this engine offers no `resolveInternalField` "
        + 'accessor to recover it. better-auth session-lifecycle routes '
        + '(revoke-other-sessions, sliding-expiry refresh, expired-session cleanup) would '
        + 'silently no-op on such rows. Wire the ObjectQL engine (which provides the '
        + 'accessor, #8118), or remove the `internal` flag from sys_session.token.',
    );
  }

  const ids = stripped.map((r) => String(r.id));
  const values = await engine.resolveInternalField(
    SystemObjectName.SESSION,
    ids,
    SESSION_TOKEN_FIELD,
  );
  for (const row of stripped) {
    const id = String(row.id);
    // An id missing from the map is a row deleted between the read and the
    // dereference — leave it token-less; the lifecycle routes treat it as the
    // already-gone session it is.
    if (values.has(id)) row[SESSION_TOKEN_FIELD] = values.get(id);
  }
}
