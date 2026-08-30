// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platform-admin.ts — the CONFIG half of the platform-admin derivation
 * (#11663 leg L2, design comment 5394453215 §2/§3/§4, maintainer acceptance
 * 2026-08-25 「接受你的建议，继续」, bundle 1A/2B/3A/4A/5A/6A/7A).
 *
 * ## What this module answers
 *
 * "Is the principal behind THIS `sys_user` row one of the platform
 * administrators the DEPLOYMENT declared?" — the deployment-config anchor for
 * `PLATFORM_ADMIN`, beside the stored-grant anchor (ADR-0068 D2) that
 * `resolve-authz-context.ts` §6b already reads. Both routes meet at the ONE
 * derivation site; there is deliberately no second one.
 *
 * ## The ruled shape, and why each half is not negotiable here
 *
 * - **Choice 1A — one variable.** `OS_PLATFORM_OWNER_EMAIL`
 *   ({@link PLATFORM_OWNER_EMAIL_ENV}), the name plugin-auth's walled boot
 *   refusal and plugin-security's elevation refusal already quote. A second
 *   spelling is a second door: generated configs and docs would carry both and
 *   one of them would silently do nothing.
 * - **Choice 2B — a comma-separated LIST**, because a single configured address
 *   is a single point of human failure and losing that mailbox leaves a
 *   deployment with no administrator and no in-product recovery. One separator,
 *   one normalization (`trim().toLowerCase()`), duplicates collapsed, blank
 *   entries dropped — and **any UNPARSEABLE entry fails the WHOLE variable
 *   closed** ({@link parsePlatformAdminEmails}). ⛔ Never skip-and-continue: a
 *   dropped malformed entry turns a config typo into either a silent lockout or,
 *   worse, a silently NARROWER administrator set nobody notices.
 * - **Choice 3A — live read per derivation**, with a per-process memo keyed on
 *   the RAW string ({@link resolvePlatformAdminEmails}), so a rolled process
 *   picks up a revocation with no special path and the hot authorization path
 *   still re-parses only when the operator's value actually changes. ⛔ There is
 *   no runtime mutation endpoint and none may be added: an endpoint whose only
 *   job is to change who is a superuser is the highest-value target on the
 *   platform and precisely the surface an agent could be talked into calling.
 * - **Verified-email match ONLY.** An unverified account holding a configured
 *   address confers nothing ({@link matchesConfiguredPlatformAdmin} consults
 *   `isEmailVerifiedUserRow`, whose allow-list reads an ABSENT column as
 *   unverified).
 * - **Empty/unset = ZERO platform admins, fail closed.** The derivation answers
 *   `false` on an empty list before it looks at any row.
 *
 * ## ⚠️ The single most important mechanical pin
 *
 * The address compared here is the one on the caller's **own stored `sys_user`
 * row**, never `grants.email`. `resolveUserAuthzGrants` seeds `grants.email`
 * from `opts.seedEmail` — a CALLER/SESSION-supplied string that wins over the
 * stored read — so deriving superuser standing from it would open a new
 * escalation channel inside the very change meant to close one. That is why
 * {@link matchesConfiguredPlatformAdmin} takes a ROW and reads `row.email`
 * itself, and why `resolve-authz-context.ts` hands it `getUserRow()`.
 */

import { isEmailVerifiedUserRow, PLATFORM_OWNER_EMAIL_ENV, resolvePlatformOwnerEmail } from '@objectstack/types';

/**
 * The one separator {@link parsePlatformAdminEmails} splits on (Choice 2B).
 * Same shape as `OS_CORS_ORIGIN`, the existing comma-separated precedent.
 */
export const PLATFORM_ADMIN_EMAIL_SEPARATOR = ',';

/**
 * The ONE normalization, applied to both sides of every comparison: trim, then
 * lowercase. Email domains are case-insensitive and every mailbox this platform
 * issues is too, so an operator who types `Ada@Example.com` and a row storing
 * `ada@example.com` must be one administrator, not two half-matches.
 */
export function normalizePlatformAdminEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Is one already-normalized entry a usable address?
 *
 * Deliberately a SHAPE check, not RFC-5322 and not zod's `.email()`. Measured
 * before choosing (zod 4.4.3, the version this package resolves):
 * `z.string().email()` rejects `a@b.c` (its domain pattern demands a
 * two-character-or-longer final label) and `admin@localhost`. Both are
 * addresses a deployment can legitimately declare — `a@b.c` is this leg's own
 * acceptance-criterion value — and refusing one fails the WHOLE variable
 * closed under Choice 2B, i.e. it LOCKS THE DEPLOYMENT OUT of its own
 * administration. The hazard this predicate exists to catch is an operator
 * typo (a forgotten separator, a pasted sentence, a bare name), not a
 * standards deviation, so it asks only what a `sys_user.email` must minimally
 * be to ever match: one `@`, something either side of it, and no whitespace.
 *
 * ⛔ Do not tighten this into a "real" email validator. Over-strictness here is
 * not a stricter contract, it is an unrecoverable lockout on a value nobody can
 * fix from inside the product.
 */
function isParseableAddress(entry: string): boolean {
  if (/\s/.test(entry)) return false;
  const at = entry.indexOf('@');
  if (at <= 0) return false; // absent, or an empty local part
  if (entry.indexOf('@', at + 1) !== -1) return false; // more than one `@`
  return at < entry.length - 1; // a non-empty domain part
}

/** The parsed state of `OS_PLATFORM_OWNER_EMAIL` for one raw value. */
export interface PlatformAdminEmailConfig {
  /**
   * Normalized, de-duplicated administrator addresses in the order the operator
   * declared them. EMPTY when the variable is unset, blank, or refused — those
   * three are one outcome by design (zero config-derived administrators), and
   * they are told apart by {@link refusal} rather than by a second empty value.
   */
  readonly emails: readonly string[];
  /**
   * The SAME administrators as {@link emails} and index-aligned with it, each
   * spelled as the operator typed it — trimmed only, never lowercased (exactly
   * what `resolvePlatformOwnerEmail()` used to hand a single-value reader).
   *
   * It exists so that no consumer ever has a reason to split {@link raw} a
   * second time. Two readers need the as-typed form and neither may re-parse
   * to get it: the elevation gate's by-email `sys_user` lookup queries the
   * verbatim spelling alongside the normalized one (an imported/legacy row may
   * not be stored lowercased, and a driver `where` is an exact match), and the
   * walled boot diagnostic quotes the addresses back to the operator, who
   * should see what they wrote.
   */
  readonly declaredSpellings: readonly string[];
  /** What the operator actually typed, when the variable was set to anything. */
  readonly raw?: string;
  /**
   * Set when the variable was DECLARED but refused, naming the offending entry.
   * `emails` is empty in that case: the whole variable fails closed, never the
   * one entry (Choice 2B).
   */
  readonly refusal?: string;
}

const EMPTY_CONFIG: PlatformAdminEmailConfig = Object.freeze({
  emails: Object.freeze([]) as readonly string[],
  declaredSpellings: Object.freeze([]) as readonly string[],
});

/**
 * Parse one raw `OS_PLATFORM_OWNER_EMAIL` value into the administrator list.
 *
 * Pure — no env read, no logging — so the whole parse is testable as a
 * function of its input. {@link resolvePlatformAdminEmails} is the env-reading,
 * memoizing, once-per-value-loud wrapper around it.
 */
export function parsePlatformAdminEmails(raw: string | undefined): PlatformAdminEmailConfig {
  if (raw == null) return EMPTY_CONFIG;
  const text = String(raw);
  if (text.trim() === '') return EMPTY_CONFIG;

  const emails: string[] = [];
  const declaredSpellings: string[] = [];
  for (const piece of text.split(PLATFORM_ADMIN_EMAIL_SEPARATOR)) {
    const entry = normalizePlatformAdminEmail(piece);
    // Blanks are DROPPED, not refused: a trailing separator or a line wrapped
    // for readability is a formatting habit, not a typo that changes who
    // administers the deployment.
    if (entry === '') continue;
    if (!isParseableAddress(entry)) {
      return {
        emails: Object.freeze([]) as readonly string[],
        declaredSpellings: Object.freeze([]) as readonly string[],
        raw: text,
        refusal:
          `${PLATFORM_OWNER_EMAIL_ENV} entry ${JSON.stringify(piece)} is not an email address, so the `
          + 'WHOLE variable is refused and this deployment has ZERO config-derived platform '
          + 'administrators. The entry is not skipped on purpose: silently dropping it would leave '
          + 'a narrower administrator set than the operator declared, with nothing to notice. Fix '
          + `the entry, or remove it — ${PLATFORM_OWNER_EMAIL_ENV} takes one address or a `
          + 'comma-separated list of them.',
      };
    }
    // Duplicates collapse; first declaration wins the position — and the
    // spelling that wins it is the one kept, so the two arrays stay aligned.
    if (!emails.includes(entry)) {
      emails.push(entry);
      declaredSpellings.push(piece.trim());
    }
  }

  return {
    emails: Object.freeze(emails) as readonly string[],
    declaredSpellings: Object.freeze(declaredSpellings) as readonly string[],
    raw: text,
  };
}

/**
 * Sink for the refusal notice. `console` by default so the loudness does not
 * depend on any host wiring it up — a deployment that declared administrators
 * and got none must never find that out silently. Swappable for tests.
 */
export interface PlatformAdminConfigSink {
  error(message: string): void;
  warn(message: string): void;
}

const defaultSink: PlatformAdminConfigSink = {
  error: (m) => console.error(m),
  warn: (m) => console.warn(m),
};
let sink: PlatformAdminConfigSink = defaultSink;

/** Redirect this module's notices (tests). Returns the previous sink. */
export function setPlatformAdminConfigSink(next: PlatformAdminConfigSink | undefined): PlatformAdminConfigSink {
  const prev = sink;
  sink = next ?? defaultSink;
  return prev;
}

/**
 * The per-process memo (Choice 3A). Keyed on the RAW string, so a value the
 * operator has not changed is parsed once and a value they HAVE changed is
 * re-read on the very next derivation — 3A's semantics at 3B's cost, with no
 * cached second copy of the answer to drift from `process.env`.
 *
 * `NOT_MEMOIZED` is a sentinel rather than `undefined` because `undefined` is
 * itself a legal memo key (the variable unset).
 */
const NOT_MEMOIZED = Symbol('platform-admin-config-not-memoized');
let memoKey: string | undefined | typeof NOT_MEMOIZED = NOT_MEMOIZED;
let memoValue: PlatformAdminEmailConfig = EMPTY_CONFIG;

/**
 * Resolve the deployment's declared platform administrators — live from the
 * environment, memoized on the raw string, and LOUD exactly once per distinct
 * refused value.
 *
 * Silence for an UNSET variable is deliberate and is not the same decision:
 * every `single`-posture deployment runs that way by design (Choice 4A leaves
 * first-user promotion in place there), and warning on the shipped default is
 * how a log people read becomes a log people skim. A walled posture with the
 * variable unset already REFUSES BOOT one layer up, in plugin-auth.
 */
export function resolvePlatformAdminEmails(): PlatformAdminEmailConfig {
  const raw = resolvePlatformOwnerEmail();
  if (memoKey !== NOT_MEMOIZED && memoKey === raw) return memoValue;

  const parsed = parsePlatformAdminEmails(raw);
  memoKey = raw;
  memoValue = parsed;
  // Once per distinct raw value, which for a real deployment is once per
  // process: the memo boundary IS the "have we said this already" boundary, so
  // this can never become a per-request line.
  if (parsed.refusal) sink.error(`[authz] ${parsed.refusal}`);
  return parsed;
}

/** Drop the memo — for tests that drive several values through one process. */
export function resetPlatformAdminEmailMemo(): void {
  memoKey = NOT_MEMOIZED;
  memoValue = EMPTY_CONFIG;
}

/**
 * Does this stored `sys_user` row belong to a declared platform administrator?
 *
 * Fail-closed on every axis: an empty/refused config answers `false` without
 * looking at the row at all, an address that is not on the list answers
 * `false`, and an address that IS on the list but whose `email_verified`
 * column does not read verified answers `false` too. The last one is the point
 * of the whole leg — an unverified account holding a configured address confers
 * nothing, so an attacker who registers the operator's address before the
 * operator does gains no standing by it.
 *
 * ⚠️ `row` MUST be the caller's own stored `sys_user` row. See this module's
 * header: `grants.email` is caller-seedable and reading it here would be an
 * escalation channel.
 */
export function matchesConfiguredPlatformAdmin(
  row: unknown,
  config: PlatformAdminEmailConfig,
): boolean {
  if (config.emails.length === 0) return false;
  if (!row || typeof row !== 'object') return false;
  if (!isConfiguredPlatformAdminEmail((row as { email?: unknown }).email, config)) return false;
  return isEmailVerifiedUserRow(row);
}

/**
 * [#13147] Is this bare ADDRESS one of the declared administrators?
 *
 * The membership half of {@link matchesConfiguredPlatformAdmin}, spelled once
 * and exported, because the row-and-verified predicate above is not the shape
 * every reader of `OS_PLATFORM_OWNER_EMAIL` needs:
 *
 *  - the elevation gate (`plugin-security/bootstrap-platform-admin.ts`) must
 *    keep the two halves SEPARATE — its `walled_owner_not_registered` and
 *    `walled_owner_not_verified` diagnostics are different answers;
 *  - the creation-time operator stamp (`plugin-auth`) is handed an email
 *    STRING by better-auth, before any row exists to read;
 *  - the Layer 0 wall bypass takes a fast negative on the session's
 *    server-resolved email before it spends a `sys_user` read.
 *
 * ⛔ Those readers must NOT hand-roll `config.emails.includes(x.toLowerCase())`
 * instead. That expression is where a seventh dialect gets born: it silently
 * drops the trim, and a stray space in one list entry then makes an
 * administrator vanish with nothing to notice. One membership expression, one
 * normalization ({@link normalizePlatformAdminEmail}), one place to fix.
 *
 * Fail-closed like everything else here: an empty or refused config answers
 * `false` without looking at the candidate, and a blank/non-string candidate
 * answers `false` against any config.
 *
 * ⚠️ This is a match against CONFIGURATION only — it says nothing about whether
 * the address is verified, or whether the caller actually holds it. Standing
 * still requires {@link matchesConfiguredPlatformAdmin} over the caller's own
 * stored row; see this module's header for why `grants.email` is never it.
 */
export function isConfiguredPlatformAdminEmail(
  email: unknown,
  config: PlatformAdminEmailConfig,
): boolean {
  if (config.emails.length === 0) return false;
  const candidate = normalizePlatformAdminEmail(email);
  return candidate !== '' && config.emails.includes(candidate);
}

/**
 * [#11663 P5] The migration pointer for the LEGACY anchor.
 *
 * Nothing is revoked in this leg: an unscoped, in-window `admin_full_access`
 * grant still confers `PLATFORM_ADMIN` exactly as it did (design §5 step 3 —
 * config-derived standing is ADDED, which is what makes this safe to land ahead
 * of every deployment setting the variable). What changes is that the row is now
 * the OLD anchor, so a holder whose standing rests on it alone is told, once,
 * which config line re-anchors them before the row route is removed.
 *
 * Once per process, naming ONE holder. Deliberately not once per holder: this
 * runs inside the authorization path, and an unbounded per-user ledger there is
 * a memory surface for something whose whole job is to say "go look at the
 * configuration". The population question (who ALL the administrators are) is
 * the audit surface's, filed as its own leg.
 */
let legacyGrantPointerSaid = false;

export function reportLegacyPlatformAdminGrant(input: {
  userId: string;
  email?: unknown;
}): void {
  if (legacyGrantPointerSaid) return;
  legacyGrantPointerSaid = true;
  const email = normalizePlatformAdminEmail(input.email);
  sink.warn(
    `[authz] user ${input.userId} holds PLATFORM_ADMIN through the legacy unscoped `
      + `'admin_full_access' grant row, not through ${PLATFORM_OWNER_EMAIL_ENV}. The grant row is `
      + 'the OLD anchor and is honoured for now; it is removed in a later release. Re-anchor this '
      + `deployment by declaring its administrators in configuration: ${PLATFORM_OWNER_EMAIL_ENV}=`
      + `${email || '<the administrator\'s verified email address>'}`
      + ' (comma-separated for several), and make sure each account\'s email is VERIFIED — an '
      + 'unverified account holding a configured address is not an administrator. Reported once '
      + 'per process; further holders are not listed.',
  );
}

/** Drop the once-per-process latch — for tests. */
export function resetLegacyPlatformAdminGrantReport(): void {
  legacyGrantPointerSaid = false;
}
