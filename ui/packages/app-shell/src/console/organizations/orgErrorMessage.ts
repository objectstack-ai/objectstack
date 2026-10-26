/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ONE `code` -> message mapping for every server-echoed organization error
 * (objectui#4474).
 *
 * ## The stable half of the pair
 *
 * better-auth answers a refused organization call with BOTH an English sentence
 * and a machine `code` (`ORGANIZATION_ALREADY_EXISTS`,
 * `YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION`, …). Only the code is stable:
 * the sentence is a third party's copy, free to be reworded in any release. So
 * this maps the code and never reads the text. Translating by matching the
 * English would go silently English again the day upstream rewrites a string,
 * with no test able to see it — which is the failure mode the ruling forbids by
 * name.
 *
 * ## The code has to survive the client boundary to be readable here
 *
 * It did not, before this change. `packages/auth/src/createAuthClient.ts` had a
 * `toAuthError` helper that preserves `code` — used by sign-in and sign-up only —
 * while every `organization.*` method threw `new Error(error.message ?? '…')` and
 * dropped it. The three sites in the card therefore held an English sentence and
 * nothing else, so no consumer-side cleverness short of string matching could
 * have localized them. That producer now routes through `toAuthError` too; this
 * module is the consumer half, and the two are useless apart.
 *
 * ## Prefer mapped, degrade to verbatim
 *
 * The shape mirrors what `LoginForm`/`RegisterForm` already do —
 * `(code && map[code]) || error.message`. An unmapped code still shows the
 * server's own sentence: English is worse than Chinese and far better than a
 * blank box or a generic "something went wrong", both of which delete the only
 * diagnostic the user has. Never swallow an error.
 *
 * ## Why these codes and not better-auth's sixty
 *
 * Every row is a rejection the five console files under
 * `console/organizations/` can actually provoke — the three the card measured,
 * plus siblings on the same three call paths (the role-cap refusal that
 * `invitableOrgRoles` narrows for but the server re-checks; a duplicate invite;
 * the slug collision that is the create dialog's other outcome; the
 * multi-org-disabled refusal `CreateWorkspaceDialog` already comments about; and
 * the expired link `AcceptInvitationPage` already has a hand-written fallback
 * for), and one objectstack registered code (ADR-0112) on the create path:
 * `ORGANIZATION_CREATION_DISABLED`, the server's refusal for the same
 * deployment posture `CreateWorkspaceDialog`'s own guard reads from
 * `/auth/config` (objectui#12977). The rest are teams, dynamic roles and org
 * surfaces this console has no screen for. Each row costs ten pack
 * translations (that one reuses an existing key), and an unlisted code
 * already degrades correctly, so the cost of omitting one is bounded and the
 * cost of speculating is not.
 */

/**
 * The translate function shape this module needs — structurally what
 * `useObjectTranslation().t` and `createSafeTranslation()` both provide.
 */
export type OrgTranslate = (key: string, options?: Record<string, unknown>) => string;

export interface OrgErrorEntry {
  /**
   * i18n key — normally in the `organization.errors` namespace; a row reuses a
   * sentence the console already shows for the same condition elsewhere.
   */
  key: string;
  /** English fallback, for a pack that does not (yet) define the key. */
  defaultValue: string;
}

/**
 * Organization error code (better-auth's, or an objectstack registered code)
 * -> the console's own i18n key.
 *
 * Keyed by the code, valued by a key of OUR naming rather than a transliteration
 * of theirs: the pack vocabulary stays camelCase like every other namespace, and
 * an upstream constant rename becomes a one-line edit here instead of a rename
 * across ten packs.
 */
export const ORG_ERROR_MESSAGE_KEYS: Record<string, OrgErrorEntry> = {
  // --- invite path (InviteMemberDialog) ---
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: {
    key: 'organization.errors.notAllowedToInvite',
    defaultValue: 'You are not allowed to invite users to this organization',
  },
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: {
    key: 'organization.errors.notAllowedToInviteWithRole',
    defaultValue: 'You are not allowed to invite a user with this role',
  },
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: {
    key: 'organization.errors.alreadyInvited',
    defaultValue: 'This user has already been invited to this organization',
  },

  // --- create-workspace path (CreateWorkspaceDialog) ---
  ORGANIZATION_ALREADY_EXISTS: {
    key: 'organization.errors.organizationExists',
    defaultValue: 'Organization already exists',
  },
  ORGANIZATION_SLUG_ALREADY_TAKEN: {
    key: 'organization.errors.slugTaken',
    defaultValue: 'That URL slug is already taken',
  },
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION: {
    key: 'organization.errors.notAllowedToCreate',
    defaultValue: 'You are not allowed to create a new organization',
  },
  // objectstack's registered code (ADR-0112) for a deployment whose tenancy
  // posture refuses organization creation for every caller — a deployment
  // setting, not a missing grant, so it reuses the sentence the dialog's own
  // `multiOrgEnabled === false` guard shows rather than `notAllowedToCreate`.
  ORGANIZATION_CREATION_DISABLED: {
    key: 'workspace.multiOrgDisabled',
    defaultValue: 'Creating new organizations is disabled on this instance.',
  },

  // --- accept path (AcceptInvitationPage) ---
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: {
    key: 'organization.errors.notTheRecipient',
    defaultValue: 'You are not the recipient of the invitation',
  },
  INVITATION_NOT_FOUND: {
    key: 'organization.errors.invitationNotFound',
    defaultValue: 'This invitation no longer exists or has expired',
  },
};

/** Last-resort text when the rejection carries neither a known code nor a message. */
const UNKNOWN_ERROR = {
  key: 'organization.errors.unknown',
  defaultValue: 'Something went wrong. Please try again.',
};

/** Read the machine code off a thrown value, if it carries one. */
function errorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : undefined;
}

/**
 * Resolve a rejected organization call into the message to show the user.
 *
 * Order — mapped code, then the server's own sentence, then the site's own
 * fallback, then a translated last resort:
 *
 *   1. a code this console maps  -> the localized message
 *   2. any other `Error` message -> verbatim, whatever language it is in
 *   3. `fallback`, when given    -> the caller's own localized sentence
 *   4. none of the above         -> `organization.errors.unknown`
 *
 * Step 3 exists so adopting this helper cannot *lose* information: several call
 * sites already carried a specific translated fallback ("Failed to update role")
 * for the non-`Error` branch, and collapsing those into one generic sentence
 * would have been a regression bought with the fix.
 *
 * @param err      - the value a rejected auth-client promise threw
 * @param t        - the active translator
 * @param fallback - the caller's own message for a rejection carrying no text
 */
export function resolveOrgErrorMessage(
  err: unknown,
  t: OrgTranslate,
  fallback?: OrgErrorEntry,
): string {
  const code = errorCode(err);
  if (code) {
    const entry = ORG_ERROR_MESSAGE_KEYS[code];
    if (entry) return t(entry.key, { defaultValue: entry.defaultValue });
  }
  const message = err instanceof Error ? err.message : undefined;
  if (typeof message === 'string' && message.trim()) return message;
  if (fallback) return t(fallback.key, { defaultValue: fallback.defaultValue });
  return t(UNKNOWN_ERROR.key, { defaultValue: UNKNOWN_ERROR.defaultValue });
}
