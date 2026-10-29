// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27277] The refusals the engine's floor over a plugin driver raises
 * (`external-driver-floor.ts`, ADR-0015 Tier A, epic #27261 P1).
 *
 * All are 4xx: the caller can change the request and try again, and the
 * message is theirs to read. That is what keeps them apart from the third
 * outcome of the same floor, a remote that failed or did not answer, which is
 * `ERR_DATASOURCE_UNAVAILABLE` / 503 (`DatasourceUnavailableError`, reason
 * `remote`) and withholds the remote's text by the 5xx rule.
 *
 * Each declares its `status` on the thrown error (the convergent HTTP-exit
 * convention `driver-connect-errors.ts` and `concurrent-update-error.ts`
 * follow), so every door answers the same status and keeps the `code`.
 * ⛔ None is an ADR-0015 gate refusal: `EXTERNAL_WRITE_FORBIDDEN` (403) is
 * the platform's own write switch being off, fixed by turning it on; these are
 * fixed by changing the payload or the filter. They are registered under this
 * package in `ERROR_CODE_LEDGER`, beside the gate codes' own owner; the read
 * refusal carries the standard `INVALID_QUERY` and needs no row.
 */

import { StandardErrorCode } from '@objectstack/spec/api';

/** The `code` {@link ExternalWriteRefusedError} carries. */
export const EXTERNAL_WRITE_REFUSED_CODE = 'EXTERNAL_WRITE_REFUSED' as const;

/** The `code` {@link ExternalRowCapExceededError} carries. */
export const EXTERNAL_ROW_CAP_EXCEEDED_CODE = 'EXTERNAL_ROW_CAP_EXCEEDED' as const;

/**
 * The most rows the engine reads from a plugin driver for one request, and so
 * the most matching rows such a request can be answered over. Fixed in P1 —
 * not an authorable key (maintainer ruling 2 on #27261, comment 6472620372).
 */
export const EXTERNAL_ROW_CAP = 1000;

/**
 * The write a refusal names. `updateMany` / `deleteMany` are not among them:
 * the floor does not offer predicate writes (`external-driver-floor.ts`).
 */
export type ExternalWriteOperation =
  | 'create' | 'update' | 'upsert' | 'delete'
  | 'bulkCreate' | 'bulkUpdate' | 'bulkDelete';

/**
 * The remote statuses read as a refusal of THIS request — its payload, its
 * target, its precondition — and so answered {@link ExternalWriteRefusedError}
 * with the remote's message. Every other 4xx is a condition of the connection,
 * not of the request (401 / 403 / 407 an expired or refused credential, 429 a
 * rate limit), whose text may name the credential: it is answered as a remote
 * failure (`ERR_DATASOURCE_UNAVAILABLE`, 503), the cause in the server log only.
 */
export const EXTERNAL_WRITE_REFUSED_STATUSES: ReadonlySet<number> = new Set([400, 404, 409, 412, 422]);

/**
 * [#27471] The statuses a plugin driver's `find` throw is read as a refusal of
 * THIS read with: the remote (or the driver, before it asked — the guide's
 * `refuse()`) judged the filter, the column or the resource, and a changed
 * request may pass. Answered {@link ExternalReadRefusedError} with the driver's
 * message. Every other status, and a throw that declares none, is a remote
 * failure (`ERR_DATASOURCE_UNAVAILABLE`, 503, text withheld), for the reasons
 * {@link EXTERNAL_WRITE_REFUSED_STATUSES} gives.
 */
export const EXTERNAL_READ_REFUSED_STATUSES: ReadonlySet<number> = new Set([400, 404, 422]);

/**
 * [#27471] A plugin driver refused a read with a request-shaped 4xx
 * ({@link EXTERNAL_READ_REFUSED_STATUSES}): an operator, a combinator or a
 * column the remote cannot run, a resource it does not map. 400 with the
 * standard `INVALID_QUERY`: the caller's query is what has to change, so the
 * message is the driver's own and a retry of the same read never clears it.
 * `find`, `findOne` and `count` all read through `find`, so `operation` is
 * always `find`.
 */
export class ExternalReadRefusedError extends Error {
  readonly code = StandardErrorCode.enum.INVALID_QUERY;
  readonly status = 400;
  readonly httpStatus = 400;
  readonly details: {
    datasource: string;
    object: string;
    operation: 'find';
    /** The status the driver declared on its throw. */
    remoteStatus: number;
  };

  constructor(
    datasource: string,
    object: string,
    remoteStatus: number,
    remoteMessage: string,
    options?: { cause?: unknown },
  ) {
    const said = remoteMessage.trim() || `it answered ${remoteStatus} with no message`;
    super(`The plugin driver of datasource '${datasource}' refused this read on '${object}': ${said}`);
    this.name = 'ExternalReadRefusedError';
    if (options && 'cause' in options) (this as Error & { cause?: unknown }).cause = options.cause;
    this.details = { datasource, object, operation: 'find', remoteStatus };
  }
}

/**
 * The remote system behind a plugin driver refused a write with a request-shaped
 * 4xx ({@link EXTERNAL_WRITE_REFUSED_STATUSES}) — its validation failed, the
 * record is locked, it does not exist there. 422:
 * the request reached the remote and was judged, and a changed payload may
 * pass. The message is the remote's own, so the person who typed the value
 * reads why it was refused.
 */
export class ExternalWriteRefusedError extends Error {
  readonly code = EXTERNAL_WRITE_REFUSED_CODE;
  readonly status = 422;
  readonly httpStatus = 422;
  readonly details: {
    datasource: string;
    object: string;
    operation: ExternalWriteOperation;
    /** The status the remote answered with, as the driver reported it. */
    remoteStatus: number;
  };

  constructor(
    datasource: string,
    object: string,
    operation: ExternalWriteOperation,
    remoteStatus: number,
    remoteMessage: string,
    options?: { cause?: unknown },
  ) {
    const said = remoteMessage.trim() || `it answered ${remoteStatus} with no message`;
    super(`The system behind datasource '${datasource}' refused this ${operation} on '${object}': ${said}`);
    this.name = 'ExternalWriteRefusedError';
    if (options && 'cause' in options) (this as Error & { cause?: unknown }).cause = options.cause;
    this.details = { datasource, object, operation, remoteStatus };
  }
}

/**
 * A read on an object served by a plugin driver matched more rows than the
 * engine reads from such a driver ({@link EXTERNAL_ROW_CAP}). The engine
 * applies the query itself over the rows the driver returns, so it cannot
 * answer correctly over a set it only partly holds, and refuses instead of
 * returning a short or wrongly ordered list. 422 with the prescription: narrow
 * the filter, or mirror the data into a real object with DataSync.
 */
export class ExternalRowCapExceededError extends Error {
  readonly code = EXTERNAL_ROW_CAP_EXCEEDED_CODE;
  readonly status = 422;
  readonly httpStatus = 422;
  readonly details: { datasource: string; object: string; cap: number };

  constructor(datasource: string, object: string, cap: number = EXTERNAL_ROW_CAP) {
    super(
      `This read on '${object}' matched more than ${cap} rows from datasource '${datasource}', the most the `
      + `engine reads from a plugin driver for one request. Narrow the filter so fewer than ${cap + 1} rows `
      + `match, or mirror the data into a real object with DataSync and read that instead.`,
    );
    this.name = 'ExternalRowCapExceededError';
    this.details = { datasource, object, cap };
  }
}
