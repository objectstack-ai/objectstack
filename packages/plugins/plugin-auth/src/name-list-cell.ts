// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One reader for a list-of-machine-names cell, shared by the two identity
 * import doors that take one: `admin/import-sso-users` (`positions`,
 * `permission_sets`) and `admin/import-users` (`positions`). One reader, so a
 * CSV that names positions reads the same through either door.
 *
 * Deliberately not re-exported from the package index: it is a parsing detail
 * of those doors, not a public helper.
 */

/**
 * A list cell: an array of names, or one `;`-separated string. Empty entries
 * and repeats are dropped. A string answer is the refusal sentence, naming
 * the cell by `label`.
 */
export function readNameList(raw: unknown, label: string): string[] | string {
  if (raw === undefined || raw === null || raw === '') return [];
  const parts = typeof raw === 'string' ? raw.split(';') : Array.isArray(raw) ? raw : undefined;
  if (!parts) return `${label} must be a list of machine names`;
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part !== 'string') return `${label} must be a list of machine names`;
    const name = part.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}
