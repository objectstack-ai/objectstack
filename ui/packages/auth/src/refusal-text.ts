/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The text a refused auth request shows: the host's sentence for the refusal's
 * `CODE:cause` (`details.cause`, objectstack#32432), else for its `code`, else
 * the server's message. The server tells a client to branch on `code` and
 * `details.cause`, never on the message, so the message is only the fallback.
 *
 * Shared by `LoginForm` and `ForgotPasswordForm` (objectstack#34171), whose
 * `errorMessages` props are the same kind of map.
 */
export function refusalText(error: Error, errorMessages: Record<string, string> | undefined): string {
  const { code, details } = error as Error & { code?: string; details?: { cause?: unknown } };
  const cause = typeof details?.cause === 'string' && details.cause !== '' ? details.cause : undefined;
  return (
    (code && cause && errorMessages?.[`${code}:${cause}`]) ||
    (code && errorMessages?.[code]) ||
    error.message
  );
}
