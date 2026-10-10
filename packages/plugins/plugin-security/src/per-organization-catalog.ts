// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Does a stored row already carry every field a pass would write?
 *
 * The boot sweep is O(CHANGED DECLARATIONS), not O(organizations x rows) of
 * blind writes: a pass reads what the organization already has (one bounded
 * read), compares it against the declaration, and issues an update only where
 * something actually differs. On the overwhelmingly common boot — nothing
 * declared changed since the last one — every organization costs its reads and
 * ZERO writes. Steady state does not ride this sweep at all; it rides the
 * organization-creation hook, which seeds exactly the one new organization.
 *
 * Compared loosely on purpose: a column absent from a legacy row and a
 * declaration that names it as `null`/`undefined` are the same state, and
 * treating them as different would make every boot re-write every row, which is
 * the cost this predicate exists to avoid.
 */
export function rowMatchesDeclaration(row: any, fields: Record<string, unknown>): boolean {
  if (!row) return false;
  for (const [key, want] of Object.entries(fields)) {
    const has = row[key];
    if ((has ?? null) === (want ?? null)) continue;
    if (typeof want === 'boolean' && Boolean(has) === want) continue;
    return false;
  }
  return true;
}
