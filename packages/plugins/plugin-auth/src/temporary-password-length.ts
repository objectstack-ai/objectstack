// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The length of a generated temporary password, for every admin door that
 * mints one: create-user / set-user-password with `generatePassword`
 * (#25824) and the identity import's `temporary` rows (#25932).
 *
 * The range is the deployment's, as better-auth resolved it
 * (`$context.password.config`: `emailAndPassword.minPasswordLength` /
 * `maxPasswordLength`, which ADR-0069 maps the `auth.password_min_length` /
 * `password_max_length` settings onto). Each door reads it from its own
 * `getAuthContext()` dep; this file holds only the sizing, so the doors
 * cannot size differently. Internal: not re-exported from the package index.
 */

/** 16, raised to the range's minimum and capped at its maximum. */
export function temporaryPasswordLength({
  minPasswordLength,
  maxPasswordLength,
}: {
  minPasswordLength: number;
  maxPasswordLength: number;
}): number {
  return Math.min(Math.max(16, minPasswordLength), maxPasswordLength);
}
