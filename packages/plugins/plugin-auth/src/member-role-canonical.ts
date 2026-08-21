// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8317] `sys_member.role` has ONE spelling — canonical, lower-case, trimmed.
 *
 * ## The disagreement this abolishes
 *
 * Three readers answer "is this membership an owner", and until this module
 * two of them could disagree about the same row:
 *
 *  1. the #5942 grade ladder (`orgRoleGrade` / `isOrgAdminGrade`,
 *     `invitation-role-cap.ts`) — `split(',')` then `trim().toLowerCase()`;
 *  2. `mapMembershipRole` (`@objectstack/spec/identity`) — `trim().toLowerCase()`;
 *  3. **better-auth itself** — measured 2026-08-20 against the installed
 *     `better-auth@1.7.1`,
 *     `dist/plugins/organization/routes/crud-members.mjs`, a raw
 *     `role.split(",")` with NO trim and NO lower-casing, in three branches:
 *     `removeMember`'s "only an owner may remove an owner" (`:193`),
 *     `updateMemberRole`'s creator protection (`:288`), and
 *     `organization/leave`'s last-owner count (`:420`).
 *
 * For a row stored as `Owner` (or `' owner'`), (1) and (2) say owner and (3)
 * says plain member. The vendor therefore skips its owner branch entirely and
 * falls through to `hasPermission({ member: ['delete'] })`, **which an org
 * admin passes** — so an admin could remove an owner, an authorization
 * inversion, while every ObjectStack-side check treated that same row as an
 * owner.
 *
 * ## The remedy, as ruled (maintainer, 2026-08-13 — option A)
 *
 * Normalise at the WRITE, not at the read. Reading through a normalising seam
 * (option B) means intercepting every vendor read forever; documenting the
 * invariant (option C) leaves declared-not-enforced standing. Canonicalising
 * the stored value makes the disagreement **unrepresentable** instead of
 * adjudicated per-reader, and it needs exactly two pieces:
 *
 *  - {@link registerMemberRoleCanonicalization} — engine `beforeInsert` /
 *    `beforeUpdate` hooks on `sys_member`, so no ObjectQL write path can mint a
 *    divergent row again;
 *  - {@link canonicalizeStoredMemberRoles} — a one-off convergent pass over
 *    rows that already exist, run at boot, idempotent, safe to re-run.
 *
 * ⚠️ Deliberately NOT in scope: the #8289 remove-member envelope guard
 * (`remove-member-permission-guard.ts`), which reproduces the vendor's
 * predicate byte-for-byte **on purpose** — including the asymmetry where the
 * target's roles are split without `trim()` and the caller's with it. After
 * this module lands, that guard's refusal population and the vendor's agree by
 * construction, which is the point of leaving it alone; "cleaning it up" would
 * change who is refused under cover of a normalisation fix.
 *
 * ## What "canonical" means here, exactly — and why it is per TOKEN
 *
 * A `sys_member.role` value is a comma-separated list. Canonicalisation is
 * applied to each token independently:
 *
 *  - a token that IS a known membership role (ADR-0108's closed vocabulary,
 *    {@link BUILTIN_MEMBERSHIP_ROLES}) once trimmed and lower-cased becomes
 *    exactly that canonical spelling;
 *  - any other token is preserved VERBATIM apart from trimming;
 *  - tokens that are empty after trimming are dropped.
 *
 * The second clause is not timidity, it is a measured consumer fact.
 * `resolve-authz-context.ts` projects every token through `mapMembershipRole`,
 * whose `default:` arm returns `raw.trim()` — case preserved. So for a token
 * outside the vocabulary the CASE is meaningful: it becomes a position name
 * that a `sys_position_permission_set` row may be bound to. Lower-casing it
 * would silently re-point that binding. Trimming it cannot: every consumer in
 * the repo trims before it looks (`resolve-authz-context`, `mapMembershipRole`,
 * `parseOrgRoles`), and the vendor only ever asks `includes(creatorRole)` with
 * `creatorRole` defaulting to `'owner'` — which no foreign token can be.
 *
 * A value whose tokens are ALL foreign is therefore left completely untouched
 * and merely reported: it carries no known role, so no reader can read it as an
 * owner, so it cannot produce the inversion, so there is nothing to buy by
 * rewriting it.
 *
 * ## The security invariant this buys, stated so it can be tested
 *
 * For any canonicalised value `v` and any known membership role `R`:
 *
 * ```
 * v.split(',').includes(R)            // the vendor's raw read
 *   ===
 * parseOrgRoles(v).includes(R)        // the #5942 ladder's read
 * ```
 *
 * That is the whole defect, closed: the two readers can no longer disagree
 * about whether a row carries `owner`. `member-role-canonical.test.ts` pins it
 * against predicates EXTRACTED FROM THE INSTALLED VENDOR FILE, so a vendor
 * upgrade that moves the predicate reddens the pin instead of silently
 * un-verifying it.
 *
 * ## The one hole that stays, named rather than hidden
 *
 * A write that never reaches ObjectQL — raw SQL against the database, a driver
 * fixture loaded out of band — can still store a divergent row after boot. The
 * hooks cannot see it and the boot pass has already run. It converges at the
 * next restart. Closing that would mean a database-level constraint, which is
 * a different (and larger) decision than the one ruled here.
 */

import { BUILTIN_MEMBERSHIP_ROLES } from '@objectstack/spec/identity';
import { SystemObjectName } from '@objectstack/spec/system';

/** The closed membership-role vocabulary (ADR-0108), indexed for lookup. */
const KNOWN_ROLES: ReadonlySet<string> = new Set<string>(BUILTIN_MEMBERSHIP_ROLES);

/** `sys_member` — the one object this module speaks about. */
export const MEMBER_OBJECT = SystemObjectName.MEMBER;

/**
 * Is this token, once trimmed and lower-cased, one of the framework's
 * membership roles?
 */
export function isKnownMembershipRole(token: string): boolean {
  return KNOWN_ROLES.has(token.trim().toLowerCase());
}

/**
 * Flatten a stored/incoming role value to its comma-separated string form.
 * Mirrors `parseOrgRoles`'s tolerance for the array spelling; anything that is
 * neither a string nor an array is not a role value at all.
 */
function flatten(raw: unknown): string | null {
  if (Array.isArray(raw)) return raw.join(',');
  return typeof raw === 'string' ? raw : null;
}

/**
 * The canonical form of a `sys_member.role` value, or `null` when there is
 * nothing to canonicalise.
 *
 * `null` is returned for three genuinely different situations, all of which
 * mean "leave the stored value exactly as it is":
 *
 *  - the value is not a role value (not a string, not an array);
 *  - the value carries NO known membership role, so it cannot produce the
 *    inversion and its case may be load-bearing elsewhere (see the module doc);
 *  - the value is already canonical.
 *
 * Collapsing the three into one `null` is deliberate: every caller's next move
 * is the same — do not write. The census in
 * {@link canonicalizeStoredMemberRoles} is where they are told apart, because
 * that is the one place a human reads them.
 */
export function canonicalMemberRole(raw: unknown): string | null {
  const flat = flatten(raw);
  if (flat === null) return null;

  const tokens = flat.split(',');
  let carriesKnownRole = false;
  const canonicalTokens: string[] = [];
  for (const token of tokens) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    const lowered = trimmed.toLowerCase();
    if (KNOWN_ROLES.has(lowered)) {
      carriesKnownRole = true;
      canonicalTokens.push(lowered);
    } else {
      // Foreign token: trimmed only, case preserved — it is a position name to
      // `mapMembershipRole`, and lower-casing it would re-point a binding.
      canonicalTokens.push(trimmed);
    }
  }

  // No known role anywhere in the value: no reader can grade it as an owner or
  // an admin, so there is no disagreement to abolish and nothing to gain from
  // touching it.
  if (!carriesKnownRole) return null;

  const canonical = canonicalTokens.join(',');
  return canonical === flat ? null : canonical;
}

/**
 * Is this value already in canonical form — i.e. would
 * {@link canonicalMemberRole} leave it alone?
 *
 * ⚠️ `true` therefore also covers "not a role value" and "carries no known
 * role". It answers "is there a rewrite to do here", not "is this a valid
 * membership role" — that second question is the `sys_member.role` select's,
 * and the record validator already answers it on every ObjectQL write.
 */
export function isCanonicalMemberRole(raw: unknown): boolean {
  return canonicalMemberRole(raw) === null;
}

// ---------------------------------------------------------------------------
// Write path — the hooks
// ---------------------------------------------------------------------------

/**
 * The kernel `Logger` surface this module uses, structurally — including
 * `error`'s three-parameter shape (`message, error?, meta?`), which is what the
 * kernel's own contract declares. Spelling it any other way makes `ctx.logger`
 * unassignable at the call site.
 */
type LoggerLike = {
  info?(msg: string, meta?: Record<string, any>): void;
  /**
   * The GUARANTEED fallback channel (#9754). `error` stays optional — hosts do
   * inject reduced sinks — so `warn` is where a durability report lands when
   * `error` is absent, and a fallback that may itself be missing is not a
   * fallback. Call sites keep the `logger?.warn?.(…)` spelling as the backstop
   * for hosts the TYPE cannot reach; `SweepLogger` in plugin-email's
   * `outbox-sweep.ts` carries the full reasoning and the measurement.
   */
  warn(msg: string, meta?: Record<string, any>): void;
  error?(msg: string, error?: Error, meta?: Record<string, any>): void;
  debug?(msg: string, meta?: Record<string, any>): void;
};

export interface MemberRoleCanonicalizationOptions {
  packageId: string;
  logger?: LoggerLike;
}

/**
 * Register the write-path canonicalisation on an ObjectQL engine.
 *
 * **Priority 5 — ahead of every other `sys_member` before-hook**, and that
 * placement is the contract rather than a detail. The ADR-0092 identity write
 * guard sits at 10 and the ADR-0024 D5.2 break-glass guard at 20; both JUDGE
 * the payload, and a judgement should be made on the value's normal form, not
 * on whichever spelling the caller happened to send. Canonicalisation decides
 * nothing and performs no I/O, so running it first costs a string compare on
 * writes that need no rewrite.
 *
 * Covers both dispatch shapes of each event by construction: `beforeInsert`
 * fires per row for a batch insert, and `beforeUpdate`'s predicate path
 * dispatches per matched row over THE shared payload (ADR-0058 D3), so a
 * payload rewritten here binds the whole batch.
 *
 * ⚠️ It fires for EVERY context, `isSystem` included — better-auth's own
 * adapter writes, SCIM group remaps and import scripts are precisely the write
 * paths this exists for, and every one of them is a system context.
 */
export function registerMemberRoleCanonicalization(
  engine: any,
  opts: MemberRoleCanonicalizationOptions,
): void {
  const { packageId, logger } = opts;

  const canonicalize = (event: 'insert' | 'update') => async (ctx: any): Promise<void> => {
    const data = ctx?.input?.data;
    if (!data || typeof data !== 'object') return;
    if (!Object.prototype.hasOwnProperty.call(data, 'role')) return;
    const canonical = canonicalMemberRole((data as Record<string, unknown>).role);
    if (canonical === null) return;
    const before = (data as Record<string, unknown>).role;
    (data as Record<string, unknown>).role = canonical;
    // Not a degradation — the write proceeds, and it proceeds with the value
    // every reader agrees about. `debug` because it is per-write and a bulk
    // import can produce a great many of them; the boot pass's summary is
    // where an operator is told the population exists.
    logger?.debug?.(
      `[MemberRoleCanonical] normalised sys_member.role on ${event}: ` +
        `${JSON.stringify(before)} -> ${JSON.stringify(canonical)} (#8317)`,
    );
  };

  engine.registerHook('beforeInsert', canonicalize('insert'), {
    object: MEMBER_OBJECT,
    priority: 5,
    packageId,
  });
  engine.registerHook('beforeUpdate', canonicalize('update'), {
    object: MEMBER_OBJECT,
    priority: 5,
    packageId,
  });
}

// ---------------------------------------------------------------------------
// The one-off migration
// ---------------------------------------------------------------------------

/** One distinct stored spelling, as the census reports it. */
export interface MemberRoleSpellingCensusEntry {
  /** The spelling exactly as it is stored. */
  stored: string;
  /** What it would become, or `null` when it is left alone. */
  canonical: string | null;
  /** How many rows carry this spelling. */
  count: number;
  /** Does it carry at least one role from the closed vocabulary? */
  carriesKnownRole: boolean;
  /**
   * Would the ladder and the vendor disagree about this spelling as stored?
   * This is the inversion, counted rather than assumed.
   */
  divergent: boolean;
  /** Rows actually rewritten (0 when the spelling is left alone). */
  rewritten: number;
}

export interface CanonicalizeStoredMemberRolesResult {
  /** Rows examined. */
  scanned: number;
  /** Rows whose stored spelling is not canonical. */
  nonCanonical: number;
  /** Rows rewritten to the canonical spelling. */
  normalized: number;
  /**
   * Rows left alone although non-canonical — spellings carrying no known
   * membership role, where the case may be load-bearing as a position name.
   */
  declined: number;
  /** Rows whose rewrite threw. */
  failed: number;
  /** Every distinct non-canonical spelling found, with counts. */
  census: MemberRoleSpellingCensusEntry[];
}

export interface CanonicalizeStoredMemberRolesOptions {
  logger?: LoggerLike;
  /** Safety valve for very large tables; rows beyond it wait for the next boot. */
  limit?: number;
}

const SYSTEM_CTX = { isSystem: true };

/**
 * Does the vendor's raw read and the #5942 ladder's read disagree about any
 * known role in this value? Reported per spelling so the boot log states the
 * inversion it found rather than implying one from a rewrite count.
 *
 * The vendor's half is `split(',')` with no trim and no lower-case — the
 * predicate quoted in the module doc, applied here to every known role rather
 * than to `creatorRole` alone, because `admin` drives our own ladder.
 */
function spellingIsDivergent(stored: string): boolean {
  const vendorTokens = stored.split(',');
  const ladderTokens = stored
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  for (const role of KNOWN_ROLES) {
    if (vendorTokens.includes(role) !== ladderTokens.includes(role)) return true;
  }
  return false;
}

/**
 * The one-off convergent pass (maintainer ruling, 2026-08-13): rewrite every
 * existing `sys_member.role` that is not canonical.
 *
 * **Reports before it rewrites.** The census names every distinct non-canonical
 * spelling with its row count, so the operator sees exactly what the pass
 * touched (and what it declined) instead of a bare number — the ruling asked
 * for counts, not for a guess.
 *
 * Idempotent and convergent: a second run finds nothing, and a partial run
 * leaves the rest for the next boot. It writes through `ql.update` under a
 * system context, so it passes back through the ADR-0024 D5.2 break-glass guard
 * — which is correct and deliberate: `Owner` and `owner` are the same grade to
 * `isOrgAdminGrade`, so a canonicalisation can never be the write that revokes
 * the last administrator's standing, and if it somehow were, being refused is
 * the right outcome.
 */
export async function canonicalizeStoredMemberRoles(
  ql: any,
  options: CanonicalizeStoredMemberRolesOptions = {},
): Promise<CanonicalizeStoredMemberRolesResult> {
  const limit = options.limit ?? 5000;
  const logger = options.logger;
  const result: CanonicalizeStoredMemberRolesResult = {
    scanned: 0,
    nonCanonical: 0,
    normalized: 0,
    declined: 0,
    failed: 0,
    census: [],
  };
  if (!ql || typeof ql.find !== 'function' || typeof ql.update !== 'function') return result;

  let rows: any[] = [];
  try {
    const found = await ql.find(MEMBER_OBJECT, { limit }, { context: SYSTEM_CTX });
    rows = Array.isArray(found) ? found : Array.isArray(found?.records) ? found.records : [];
  } catch (e: any) {
    // No membership table yet (fresh boot, mock mode) — nothing to converge.
    logger?.debug?.('[MemberRoleCanonical] sys_member not readable — skipping the pass', {
      error: e?.message ?? String(e),
    });
    return result;
  }

  result.scanned = rows.length;

  // Census first, rewrite second. The two loops are separate so the counts
  // report the population as it was FOUND: a census accumulated while writing
  // describes a table half-way through its own migration.
  const census = new Map<string, MemberRoleSpellingCensusEntry>();
  const pending: Array<{ id: unknown; stored: string; canonical: string }> = [];
  for (const row of rows) {
    const stored = row?.role;
    if (typeof stored !== 'string') continue;
    const canonical = canonicalMemberRole(stored);
    // The value is already canonical (or carries nothing known) AND unchanged:
    // `canonicalMemberRole` folds both into `null`, so tell them apart here,
    // where the census needs the distinction.
    const carriesKnownRole = stored.split(',').some((t) => isKnownMembershipRole(t));
    const wouldChange =
      canonical !== null ||
      // A spelling that carries no known role can still be non-canonical
      // (stray whitespace) — it is simply left alone. Count it as found.
      stored !==
        stored
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .join(',');
    if (!wouldChange) continue;

    result.nonCanonical += 1;
    const entry = census.get(stored) ?? {
      stored,
      canonical,
      count: 0,
      carriesKnownRole,
      divergent: spellingIsDivergent(stored),
      rewritten: 0,
    };
    entry.count += 1;
    census.set(stored, entry);

    if (canonical === null) {
      result.declined += 1;
      continue;
    }
    if (row?.id === undefined || row?.id === null) {
      result.declined += 1;
      continue;
    }
    pending.push({ id: row.id, stored, canonical });
  }

  result.census = [...census.values()];

  for (const { id, stored, canonical } of pending) {
    try {
      await ql.update(MEMBER_OBJECT, { id, role: canonical }, { context: SYSTEM_CTX });
      result.normalized += 1;
      const entry = census.get(stored);
      if (entry) entry.rewritten += 1;
    } catch (e: any) {
      result.failed += 1;
      logger?.warn?.('[MemberRoleCanonical] could not canonicalise a sys_member.role row', {
        memberId: id,
        stored,
        canonical,
        error: e?.message ?? String(e),
      });
    }
  }

  if (result.normalized > 0) {
    logger?.info?.(
      `[MemberRoleCanonical] canonicalised sys_member.role on ${result.normalized} row(s) of ` +
        `${result.scanned} — better-auth reads this column with a raw split(','), so a ` +
        `non-canonical spelling read as an owner to ObjectStack and as a plain member to the ` +
        `vendor (#8317).`,
      { spellings: result.census.filter((c) => c.rewritten > 0).map((c) => ({ stored: c.stored, canonical: c.canonical, rows: c.rewritten })) },
    );
  }
  if (result.declined > 0) {
    logger?.warn?.(
      `[MemberRoleCanonical] left ${result.declined} non-canonical sys_member.role row(s) ` +
        `untouched: they carry no role from the closed membership vocabulary, so their case is ` +
        `a position name (mapMembershipRole passes unknown values through with their case) and ` +
        `rewriting it could re-point a sys_position_permission_set binding. They cannot produce ` +
        `the #8317 inversion; decide them by hand if they are not intended.`,
      { spellings: result.census.filter((c) => c.canonical === null).map((c) => ({ stored: c.stored, rows: c.count })) },
    );
  }
  if (result.failed > 0) {
    // Durability-class: the boot looks healthy, the row stays divergent, and
    // the divergence is an authorization inversion — an org admin can remove
    // that owner. Consequence and fix, both, in the first line.
    logger?.error?.(
      `[MemberRoleCanonical] ${result.failed} sys_member.role row(s) could NOT be canonicalised. ` +
        `Those memberships stay readable as an owner by ObjectStack and as a plain member by ` +
        `better-auth, so an org admin can remove or demote them (#8317). Fix: correct the row ` +
        `(lower-case and trim the role value) and restart, or re-run the boot pass — it is ` +
        `idempotent and converges.`,
      undefined,
      { spellings: result.census.filter((c) => c.rewritten < c.count && c.canonical !== null).map((c) => ({ stored: c.stored, rows: c.count - c.rewritten })) },
    );
  }

  return result;
}
