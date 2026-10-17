// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  ANONYMOUS_DENY_STATUS,
  apiKeyLifecyclePolicySourceOf,
  assembleExecutionContext,
  evaluateAuthGate,
  isApiKeyLifecycleRefusalError,
  isAuthzStoreUnavailableError,
  resolveAuthzContext,
  shouldDenyAnonymous,
  userAuthGateSourceOf,
} from '@objectstack/core';
import type { ErrorCode } from '@objectstack/spec/api';
import type { IAuthService, IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { TenancyPosture } from '@objectstack/spec/security';
import {
  declaredRefusalMessage,
  demotedDeclaredCode,
  inProcessSessionReadInput,
  resolveThrownHttpError,
  sendError,
  sendOk,
  sendServerFault,
} from '@objectstack/types';
import type { IPrintService, PrintedRecordFile, PrintRecordRequest } from './print-service.js';

/**
 * The print door: `POST /api/v1/print/records`, the one HTTP route of
 * `@objectstack/service-print`. A user prints a record from the console (a
 * declared `type: 'api'` action whose `target` is this path) and the record's
 * print page is rendered and archived on the record, as that user, by the
 * in-process `print` service (`IPrintService.printRecordToFile`).
 *
 * The door adds no print rule of its own beyond who may ask. It resolves the
 * caller, refuses the callers it must, and hands the service the request and
 * the caller's execution context. The service decides everything about the
 * page, the record and the file, and it is the one writer of the attachment:
 * the door never attaches anything, so a print stores exactly one file.
 *
 * ## The request
 *
 * A JSON body with exactly the fields of {@link PrintRecordRequest}: `app`,
 * `object`, `recordId`, `page`, and an optional `filename`. A body field
 * outside that set, or any query parameter, is refused (`VALIDATION_ERROR` /
 * `400`) and never ignored: a misspelled `fileName` would otherwise print under
 * the default name and answer success. The fields' values are judged by the
 * service, which refuses a malformed one the same way.
 *
 * ## The order — every door refusal before the service is asked
 *
 *  1. **The caller**, resolved by the platform's one authorization resolver
 *     (`resolveAuthzContext`) from the request's session, bearer or API key,
 *     and assembled into an `ExecutionContext` the way the REST face assembles
 *     one (`assembleExecutionContext`). A permission store that cannot be read
 *     answers its own `SERVICE_UNAVAILABLE` / `503`, and an API key its
 *     lifecycle refuses answers its own `403` and code: both are relayed as
 *     they are declared, never folded into a denial.
 *  2. **Anonymous** — the platform's one anonymous floor (ADR-0056 D2):
 *     `UNAUTHENTICATED` / `401`.
 *  3. **A held sign-in** (ADR-0069: an expired password, enforced MFA not yet
 *     enrolled): `403` with the authentication policy's own code, the answer
 *     every other door gives it.
 *  4. **An impersonation session** — an administrator signed in as the user
 *     through the auth service's impersonation: `PERMISSION_DENIED` / `403`,
 *     saying so. A print is rendered and archived as the session's user, so
 *     printing under an impersonation would put a file on the record in that
 *     user's name for something they never asked for. The session the request
 *     resolved through is the one read, and the mark is the one the auth
 *     service writes on it (`session.impersonatedBy`, stored as
 *     `sys_session.impersonated_by`). Only a session credential can carry it:
 *     a request admitted by an API key is judged by the key alone.
 *  5. **The request**: no query parameter, and a body with the closed field
 *     set above.
 *
 * Nothing is minted and no browser is started before all five have passed, and
 * the service then applies its own refusals, in its own order, before it mints
 * anything either (`print-service.ts`).
 *
 * ## What the door answers
 *
 *  - **Success:** `201` with `{ fileId, attachmentId, size, filename }`, the
 *    file the service stored. The attachment is the service's, written as the
 *    caller, so `sys_file.owner_id` and `sys_attachment.uploaded_by` name them.
 *  - **A refusal the service declares** (`code` and `status` on the thrown
 *    error, ADR-0112) is relayed with that `code` and `status` unchanged. A
 *    4xx carries the service's own message. A 5xx carries this door's own
 *    sentence for its status instead, unless the producer declared the text
 *    for its caller (`refusal: true`, `declaredRefusalMessage`), and the
 *    service's text goes to the server fault log with the error: the same rule
 *    every door applies to a declared 5xx, since a 5xx text can carry what
 *    the engine said about the host.
 *  - **Anything else** is a fault: `500` / `INTERNAL_ERROR`, the door's generic
 *    sentence, and the error in the fault log.
 *
 * ## What is not recorded
 *
 * The door writes no audit row of its own. A print signs a session in and out
 * for the caller, which the auth service records as it records any sign-in,
 * and the archive names the caller on both rows it writes. That is the whole
 * attribution a print gets.
 */

/** The route the door is mounted at. Not configurable: the console's declared actions name it. */
export const PRINT_RECORDS_ROUTE = '/api/v1/print/records';

/** The body fields the door reads: exactly {@link PrintRecordRequest}'s. */
const REQUEST_FIELDS = ['app', 'object', 'recordId', 'page', 'filename'] as const satisfies readonly (keyof PrintRecordRequest)[];

/** What the door is composed over — every service read when a request arrives. */
export interface PrintRoutesDeps {
  /** The print service the door relays to. */
  print: IPrintService;
  /** The data engine the caller's grants are read through; `undefined` when none is registered. */
  getEngine(): unknown;
  /** The auth service the caller's session is read through; `undefined` when none is registered. */
  getAuth(): IAuthService | undefined;
  /**
   * The tenancy posture in force, for the resolver's posture-conditional API-key
   * refusals; `undefined` on a kernel that enforces no organization wall. A
   * posture that cannot be read rejects, and the door answers that outage.
   */
  resolveTenancyPosture(): Promise<TenancyPosture | undefined>;
}

/** Mount the print door on `http`. Nothing on `deps` is called until a request arrives. */
export function registerPrintRoutes(http: IHttpServer, deps: PrintRoutesDeps): void {
  http.post(PRINT_RECORDS_ROUTE, (req, res) => handlePrintRecord(req, res, deps));
}

/** The caller, as the door resolved it: the context, and the session read that admitted it. */
interface ResolvedCaller {
  context: ExecutionContext | undefined;
  /** The session payload the auth service returned, when a session (not an API key) admitted the caller. */
  session: unknown;
  authGate: ReturnType<typeof evaluateAuthGate>;
}

async function handlePrintRecord(req: IHttpRequest, res: IHttpResponse, deps: PrintRoutesDeps): Promise<void> {
  // ① The caller.
  let caller: ResolvedCaller;
  try {
    caller = await resolveCaller(req, deps);
  } catch (err) {
    if (isAuthzStoreUnavailableError(err) || isApiKeyLifecycleRefusalError(err)) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    sendServerFault(res, 500, 'INTERNAL_ERROR', 'The caller of this print could not be resolved.', err, {
      method: 'POST',
      path: PRINT_RECORDS_ROUTE,
    });
    return;
  }
  const { context } = caller;

  // ② Anonymous.
  if (!context || shouldDenyAnonymous({ userId: context.userId, method: req.method })) {
    sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
    return;
  }

  // ③ A held sign-in.
  if (caller.authGate) {
    sendError(res, 403, caller.authGate.code as ErrorCode, caller.authGate.message);
    return;
  }

  // ④ An impersonation session.
  if (impersonatorOf(caller.session) !== undefined) {
    sendError(
      res,
      403,
      'PERMISSION_DENIED',
      'This print was refused because the session is an impersonation: a printed PDF is rendered and archived as ' +
        'the signed-in user, and in an impersonation session that user is not the one asking. Stop impersonating, ' +
        'or ask the user to print the record themselves.',
    );
    return;
  }

  // ⑤ The request. The body is read here, never guarded: a body the transport
  // cannot parse is refused by the transport itself, and the door must not
  // carry on after it.
  const query = Object.keys(req.query ?? {});
  if (query.length > 0) {
    sendError(
      res,
      400,
      'VALIDATION_ERROR',
      `The print door takes no query parameter, and this request carries ${query.map((q) => `'${q}'`).join(', ')}. ` +
        `Send the print request as the JSON body: ${REQUEST_FIELDS.join(', ')}.`,
    );
    return;
  }
  const request = printRequestOf(req.body);
  if (typeof request === 'string') {
    sendError(res, 400, 'VALIDATION_ERROR', request);
    return;
  }

  let printed: PrintedRecordFile;
  try {
    printed = await deps.print.printRecordToFile(request, context);
  } catch (err) {
    relayPrintFailure(res, err);
    return;
  }
  sendOk(res, printed, 201);
}

/**
 * Resolve the caller through the platform's one resolver, keeping the session
 * read that admitted them. The read is the auth service's own in-process
 * session read (`inProcessSessionReadInput`, so a cookie-carrying request is
 * read without renewing the session behind a cookie nobody re-issues), made
 * once, by the resolver.
 */
async function resolveCaller(req: IHttpRequest, deps: PrintRoutesDeps): Promise<ResolvedCaller> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    if (value == null) continue;
    headers.set(name, Array.isArray(value) ? value.join(',') : String(value));
  }
  const auth = deps.getAuth();
  let sessionRead: unknown;
  const getSession = auth
    ? async (h: Headers): Promise<unknown> => {
        const api = auth.api ?? (await auth.getApi?.());
        sessionRead = await api?.getSession?.(inProcessSessionReadInput(h));
        return sessionRead;
      }
    : undefined;
  const authz = await resolveAuthzContext({
    ql: deps.getEngine(),
    headers,
    getSession,
    tenancyPosture: await deps.resolveTenancyPosture(),
    userAuthGates: userAuthGateSourceOf(auth),
    apiKeyLifecycle: apiKeyLifecyclePolicySourceOf(auth),
  });
  const context = assembleExecutionContext({
    authz,
    // No OAuth access token is accepted here: those are honoured at the MCP door alone.
    oauth: undefined,
    // The print renders in the console under the user's own minted session,
    // which resolves the user's language there; the door's context carries none.
    localization: undefined,
    requestLocale: undefined,
    // The REST face's choice: the session bearer is not carried onto the envelope.
    accessToken: undefined,
    authGate: authz.authGate,
  });
  return {
    context,
    session: authz.credential === 'session' ? sessionRead : undefined,
    authGate: evaluateAuthGate(context, ''),
  };
}

/**
 * The administrator an impersonation session was started by, or `undefined`
 * for any other session. The mark is the auth service's: better-auth's admin
 * plugin writes `impersonatedBy` on the session it mints for an impersonation,
 * and `@objectstack/plugin-auth` stores it as `sys_session.impersonated_by`.
 */
function impersonatorOf(sessionRead: unknown): string | undefined {
  const session = (sessionRead as { session?: { impersonatedBy?: unknown } } | null | undefined)?.session;
  const by = session?.impersonatedBy;
  return typeof by === 'string' && by.trim() !== '' ? by : undefined;
}

/** The body as a print request, or the reason it is not one. */
function printRequestOf(body: unknown): PrintRecordRequest | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return `A print request is a JSON object with the fields ${REQUEST_FIELDS.join(', ')}.`;
  }
  const known = new Set<string>(REQUEST_FIELDS);
  const unknown = Object.keys(body).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    return (
      `${unknown.map((k) => `'${k}'`).join(', ')} ${unknown.length === 1 ? 'is not a field' : 'are not fields'} of a ` +
      `print request. Its fields are ${REQUEST_FIELDS.join(', ')}.`
    );
  }
  const fields = body as Record<string, unknown>;
  const request: Record<string, unknown> = {};
  for (const key of REQUEST_FIELDS) {
    if (key in fields) request[key] = fields[key];
  }
  // The values are judged by the service (`VALIDATION_ERROR` / `400` for a
  // missing or malformed one), never coerced here.
  return request as unknown as PrintRecordRequest;
}

/** This door's own sentence for a 5xx whose producer declared no text for its caller. */
function serverAnswerFor(status: number): string {
  if (status === 503) return 'Records cannot be printed to a file right now: the print engine is not ready. The server log records why.';
  if (status === 504) return 'The record could not be printed to a file in the time a print is allowed.';
  return 'The record could not be printed to a file because of an error on the server.';
}

/** Relay a failed print: a declared refusal with its own `code` and `status`, anything else as a fault. */
function relayPrintFailure(res: IHttpResponse, err: unknown): void {
  const thrown = resolveThrownHttpError(err, 500);
  if (thrown.status < 500) {
    const declaredCode = demotedDeclaredCode(thrown);
    sendError(res, thrown.status, thrown.code, thrown.message, {
      ...(thrown.details ? { details: thrown.details } : {}),
      ...(declaredCode !== undefined ? { declaredCode } : {}),
      ...(thrown.userMessage !== undefined ? { userMessage: thrown.userMessage } : {}),
    });
    return;
  }
  const refusal = declaredRefusalMessage(err);
  if (refusal !== undefined) {
    sendError(res, thrown.status, thrown.code, refusal);
    return;
  }
  sendServerFault(res, thrown.status, thrown.code, serverAnswerFor(thrown.status), err, {
    method: 'POST',
    path: PRINT_RECORDS_ROUTE,
  });
}
