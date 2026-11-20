// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The host's ordered organization candidates at session creation
 * (ADR-0069 TL;DR 6, D5 · ADR-0093 D9).
 *
 * A host's `session.create.before` hook (`AuthManagerOptions.databaseHooks`)
 * chooses the organization a new session is scoped to, and its choice wins
 * over the framework's own default. The framework then judges that
 * organization's own allowed IP ranges against the address the server
 * established for the request, and refuses the sign-in when they do not admit
 * it (`SESSION_SCOPING_REFUSAL`). That judgement runs after the host's hook, so
 * a host cannot catch it, and a host that prefers one organization (the one the
 * person used last) but would accept another (the one they own) had no way to
 * say so: the person outside the preferred organization's list could not sign
 * in at all.
 *
 * So the host may return its preference as an ORDERED LIST, beside `data`:
 *
 * ```ts
 * databaseHooks: {
 *   session: {
 *     create: {
 *       before: async (session): Promise<SessionCreateBeforeResult> => ({
 *         data: { ...session, activeOrganizationId: lastUsedOrgId },
 *         activeOrganizationCandidates: [ownedOrgId, oldestOrgId],
 *       }),
 *     },
 *   },
 * },
 * ```
 *
 * The framework scopes the session to the FIRST candidate that the
 * organization's scoping admits, judged exactly as the single choice is: the
 * same established client address, the same organization policy, the same
 * tenant-level-administrator break-glass. The order is: the host's
 * `data.activeOrganizationId` when it set one, then the list in order; an
 * organization named twice is judged once. The judgement stays inside the
 * framework; the host only states its order of preference.
 *
 * What does NOT change:
 *
 *  - no list (the key absent, or an empty array) is today's single choice,
 *    judged and refused exactly as before;
 *  - the refusal is never weakened: when no candidate is admitted the sign-in
 *    is refused with `SESSION_SCOPING_REFUSAL`, and its `login_failed` audit
 *    row names the FIRST candidate, the organization the host preferred;
 *  - a session created without a request through the HTTP auth door (a
 *    programmatic `auth.api.*` call) is not judged, as before, and takes the
 *    first candidate;
 *  - the candidates are the host's word, trusted as its single choice is:
 *    nothing here checks that the user is a member of them.
 *
 * The list key is read by the framework and never reaches better-auth: the
 * framework returns only `{ data }`, with `activeOrganizationId` set to the
 * organization it chose.
 */

/**
 * What a host's `session.create.before` hook may return to plugin-auth's
 * composed hooks (`AuthManagerOptions.databaseHooks`): better-auth's own
 * `{ data }` result, plus an optional ordered list of fallback organizations.
 *
 * - `data` — the session draft, as better-auth's hook contract has it. Its
 *   `activeOrganizationId`, when set, is the host's first choice.
 * - `activeOrganizationCandidates` — organization ids, most preferred first,
 *   tried after `data.activeOrganizationId`. The session is scoped to the first
 *   one whose own access policy (allowed IP ranges) admits the request; none
 *   admitted ⇒ the sign-in is refused (`SESSION_SCOPING_REFUSAL`), exactly as
 *   a refused single choice is. Each entry must be a non-empty string; any
 *   other value is a host programming error and fails the session creation
 *   loudly with a `TypeError`.
 */
export interface SessionCreateBeforeResult<TSession extends Record<string, unknown> = Record<string, unknown>> {
  data?: TSession;
  activeOrganizationCandidates?: readonly string[];
}

/** The result key the host's ordered list rides under. */
const CANDIDATES_KEY = 'activeOrganizationCandidates';

/**
 * The host's candidate list from a `session.create.before` result, validated,
 * or `undefined` when it gave none (no result, the key absent or `undefined`,
 * or an empty array). A present value that is not an array of non-empty
 * strings throws: one strict contract, never a lenient reading of a host bug.
 */
export function readActiveOrganizationCandidates(result: unknown): readonly string[] | undefined {
  if (!result || typeof result !== 'object' || !(CANDIDATES_KEY in result)) return undefined;
  const raw = (result as Record<string, unknown>)[CANDIDATES_KEY];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new TypeError(
      '[auth] session.create.before returned `activeOrganizationCandidates` that is not an array of organization '
        + 'ids (non-empty strings). Return the organization ids in order of preference, or leave the key out.',
    );
  }
  return raw.length > 0 ? (raw as string[]) : undefined;
}

/**
 * The ordered, de-duplicated organizations to judge: the host's first choice
 * (`first`, the draft's `activeOrganizationId`) when it set one, then the
 * candidate list in order.
 */
export function orderActiveOrganizationCandidates(first: unknown, candidates: readonly string[]): string[] {
  const ordered: string[] = [];
  for (const id of [...(typeof first === 'string' && first ? [first] : []), ...candidates]) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}
