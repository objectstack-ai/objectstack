// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';

/** An ADR-0112-shaped refusal: an `Error` carrying `code` and `status`. */
export type PrintRefusal = Error & { code: StandardErrorCode | RegisteredErrorCode; status: number };

/**
 * Throw an ADR-0112-shaped refusal. Every code the print service answers is
 * from the standard catalog, plus the registered `FILES_DISABLED`: it adds no
 * wire vocabulary of its own.
 */
export function printRefusal(code: StandardErrorCode | RegisteredErrorCode, status: number, message: string): never {
  throw refusalError(code, status, message);
}

/** The refusal {@link printRefusal} throws, for a caller that throws it itself. */
export function refusalError(code: StandardErrorCode | RegisteredErrorCode, status: number, message: string): PrintRefusal {
  const err = new Error(message) as PrintRefusal;
  err.code = code;
  err.status = status;
  return err;
}
