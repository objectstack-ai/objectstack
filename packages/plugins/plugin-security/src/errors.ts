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

export function isPermissionDeniedError(e: unknown): e is PermissionDeniedError {
  if (!e || typeof e !== 'object') return false;
  const anyE = e as any;
  return (
    anyE.name === 'PermissionDeniedError' ||
    anyE.code === 'PERMISSION_DENIED' ||
    (typeof anyE.message === 'string' && anyE.message.startsWith('[Security] Access denied'))
  );
}
