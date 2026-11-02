// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29163 — the uncoded refusals on the account self-service doors,
 * `POST /change-email` and `POST /update-user`, answered with a code.
 *
 * ## The defect, at the seam
 *
 * better-auth (`dist/api/routes/update-user.mjs`, measured against the
 * installed `1.7.12`) refuses three conditions on these two doors with
 * `APIError.fromStatus("BAD_REQUEST", { message })` — a message and no `code`:
 *
 *     POST /change-email  {"newEmail": <the caller's own address>}
 *       -> 400 {"message":"Email is the same"}
 *     POST /change-email  (no email transport on the deployment)
 *       -> 400 {"message":"Verification email isn't enabled"}
 *     POST /update-user   {} (or only keys the user schema does not declare)
 *       -> 400 {"message":"No fields to update"}
 *
 * Every other refusal on the same doors carries one: a malformed `newEmail`
 * answers `{"message":…,"code":"VALIDATION_ERROR"}`, an `email` key on
 * `/update-user` answers `EMAIL_CAN_NOT_BE_UPDATED`, an anonymous caller
 * `UNAUTHORIZED`. An ADR-0112 client branches on `code`, never on prose, so
 * these three could only be told apart by string-matching the vendor's English.
 *
 * ## What this does
 *
 * Runs in the `after` hook, where better-auth hands the thrown `APIError` over
 * on `ctx.context.returned`, and re-throws exactly these refusals as
 * `APIError('BAD_REQUEST', { code, message })` with the vendor's own message.
 * better-auth's hook runner replaces the returned value with an `APIError` an
 * after hook throws, so the status, the message and the moment of the refusal
 * (before anything is written or mailed) stay the vendor's; only the missing
 * `code` is added. The body keeps the door's own flat `{ message, code }` shape,
 * the shape its coded siblings already answer in.
 *
 * Each code is one the ledger already holds (ADR-0112), none new:
 *
 *  - `VALIDATION_ERROR` (standard catalog) for the two request-content
 *    refusals — the code this door already answers for a malformed address;
 *  - `EMAIL_SERVICE_REQUIRED` (`@objectstack/plugin-auth`) for the missing
 *    transport — the code plugin-auth's own invite import answers for the same
 *    deployment condition (`admin-import-users.ts`).
 *
 * Recognition is deliberately narrow: one of the two paths, a 400 `APIError`,
 * no `code` of its own, and a message that IS one of the vendor's sentences
 * listed for that path. Every other answer — including a future vendor release
 * that codes these itself — passes through untouched, and the vendored library
 * is not patched.
 */

import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';

/** The standard-catalog code for the two request-content refusals. */
const VALIDATION_ERROR_CODE: StandardErrorCode = 'VALIDATION_ERROR';

/** plugin-auth's ledgered code for a deployment with no email transport. */
const EMAIL_SERVICE_REQUIRED_CODE: RegisteredErrorCode = 'EMAIL_SERVICE_REQUIRED';

/** The ledgered codes this module stamps (see the module header for each). */
type SelfServiceRefusalCode = StandardErrorCode | RegisteredErrorCode;

/**
 * Per door, the vendor's uncoded sentence and the code it answers with. Keyed
 * on better-auth's own `ctx.path` spelling.
 */
export const SELF_SERVICE_UNCODED_REFUSALS: Readonly<Record<string, Readonly<Record<string, SelfServiceRefusalCode>>>> = {
  '/change-email': {
    'Email is the same': VALIDATION_ERROR_CODE,
    "Verification email isn't enabled": EMAIL_SERVICE_REQUIRED_CODE,
  },
  '/update-user': {
    'No fields to update': VALIDATION_ERROR_CODE,
  },
};

/**
 * Re-throw a listed uncoded refusal on `/change-email` or `/update-user` with
 * its code. A no-op on every other path and every other answer. Call it LAST
 * in the hook section that handles the path: the throw ends the hook.
 */
export async function codeSelfServiceRefusal(ctx: any): Promise<void> {
  const path = ctx?.path;
  if (typeof path !== 'string' || !Object.prototype.hasOwnProperty.call(SELF_SERVICE_UNCODED_REFUSALS, path)) return;
  const sentences = SELF_SERVICE_UNCODED_REFUSALS[path];
  const returned = ctx?.context?.returned;
  const { APIError, isAPIError } = await import('better-auth/api');
  if (!isAPIError(returned)) return;
  if (returned.statusCode !== 400) return;
  const body = returned.body as { code?: unknown; message?: unknown } | undefined;
  if (body?.code !== undefined) return;
  const message = body?.message;
  if (typeof message !== 'string' || !Object.prototype.hasOwnProperty.call(sentences, message)) return;
  throw new APIError('BAD_REQUEST', { code: sentences[message], message });
}
