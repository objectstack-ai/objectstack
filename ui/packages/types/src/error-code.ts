/**
 * Does an ObjectStack error carry this semantic code?
 *
 * Compare with this instead of `err.code === 'x'`. The console is versioned
 * separately from the server it talks to, so at any moment it may be pointed at
 * a build from either side of framework ADR-0112 — which renamed the whole
 * `error.code` vocabulary from lowercase `snake_case` to `SCREAMING_SNAKE`
 * (`destructive_change` → `DESTRUCTIVE_CHANGE`). A strict equality check against
 * one spelling silently stops matching against the other half of that split, and
 * silently is the bad part: the affordance the branch guards — a confirm dialog,
 * a targeted hint, a "create the package first" prompt — just disappears, and
 * the user gets the generic error toast instead. Nothing throws, so no test that
 * doesn't assert the affordance would notice.
 *
 * Pass the SCREAMING spelling (the catalog's, post-ADR-0112). Matching is
 * case-insensitive, so both spellings resolve, and this file is the one place to
 * delete when no supported server emits the old vocabulary.
 *
 * @param err   Anything caught — the shape is not trusted.
 * @param code  The catalog code, SCREAMING_SNAKE (e.g. `'DESTRUCTIVE_CHANGE'`).
 */
export function errorCodeIs(err: unknown, code: string): boolean {
  const raw = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof raw !== 'string' || raw.length === 0) return false;
  return raw.toUpperCase() === code.toUpperCase();
}

/** `errorCodeIs` for any of several codes. True if the error matches one. */
export function errorCodeIsAnyOf(err: unknown, codes: readonly string[]): boolean {
  return codes.some((c) => errorCodeIs(err, c));
}
