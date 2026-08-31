// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ensureDefaultOrganization — default-org bootstrap helper (ADR-0081 D1).
 *
 * The platform admin needs at least one `sys_organization` so their sessions
 * can carry an `activeOrganizationId`. Without it:
 *   - multi-org: the default `tenant_isolation` RLS policy filters everything
 *     to zero rows and the admin sees an empty console;
 *   - single-org: better-auth `organization/invite-member` has no active org
 *     to resolve, so there is NO way to add a user at all — the gap ADR-0081
 *     closes.
 *
 * This helper HOME is plugin-auth (the open member-management basics). The
 * enterprise organizations package reuses it for the multi-org bootstrap and
 * injects its seed-ownership step via `claimSeedOwnership` (that machinery is
 * part of the per-org seed pipeline, not of the basics).
 *
 * ## Who "the platform admin" is (#11973 / #11663 L3, design §2 step 5)
 *
 * The POPULATION question this helper asks — "which user is the platform
 * admin?" — has TWO anchors since the #11663 re-anchor, read in this order:
 *
 *   1. **Config anchor** (preferred, mirroring the derivation's own
 *      preference): the first `OS_PLATFORM_OWNER_EMAIL` entry, in the order
 *      the operator declared them, that a stored `sys_user` row holds with
 *      `email_verified` reading VERIFIED. The membership + verified predicate
 *      is `matchesConfiguredPlatformAdmin` from `@objectstack/core` — the
 *      derivation site's own (`resolve-authz-context.ts` §6b-config) — so
 *      this file re-implements NOTHING of the parse, the normalization or the
 *      fail-closed verified read (⛔ no second derivation site). The lookup
 *      shape — both spellings queried, matches re-checked through the shared
 *      predicate, oldest verified row wins — is the same one
 *      `plugin-security`'s `resolvePlatformAdminStanding` serves the audit
 *      surface with, so the account this helper binds is the account the
 *      audit surface reports as holding standing.
 *   2. **Legacy grant anchor** (Choice 4A + P5): the oldest unscoped
 *      `sys_user_permission_set` row on `admin_full_access`, exactly as
 *      before. This is what still anchors `single`-posture deployments
 *      (first-user promotion keeps writing the grant row there, by ruling)
 *      and pre-migration walled deployments inside P5's honoured window. It
 *      is removed with the legacy-grant removal leg (design §5 step 6), not
 *      here — nothing in this leg is subtractive.
 *
 * Strategy (idempotent, run on `kernel:ready` and after every write matched
 * by {@link isDefaultOrganizationBootstrapTrigger}):
 *
 *   1. Find the platform admin (two anchors, above). If none, no-op.
 *   2. If that user already has any `sys_member` row, no-op (they either
 *      created their own org or were invited into one — we respect that and
 *      never auto-create a "Default Organization" behind their back).
 *   3. Re-use a pre-existing `slug='default'` org if present; otherwise
 *      create one. Stable slug keeps human-readable URLs predictable across
 *      cold-boots.
 *   4. Insert a `sys_member { role: 'owner' }` linking the admin to the
 *      default org.
 *   5. (optional, injected) hand the org's seeded rows to the admin.
 */

import { matchesConfiguredPlatformAdmin, resolvePlatformAdminEmails } from '@objectstack/core';

interface BootstrapLogger {
  info: (message: string, meta?: Record<string, any>) => void;
  /**
   * The GUARANTEED channel. Required, which is what makes the `error` fallback
   * below real rather than aspirational — see {@link logDurabilityFailure}.
   */
  warn: (message: string, meta?: Record<string, any>) => void;
  /**
   * Durability-degradation channel (AGENTS.md "Degradation log levels", #4632).
   * A bootstrap write that was supposed to land and did not is an `error`, not a
   * `warn`: nothing looks broken afterwards, which is exactly why it has to be
   * loud.
   *
   * OPTIONAL, deliberately (#9754): hosts do inject reduced sinks, and forcing
   * this member would foreclose them. The fallback to the REQUIRED `warn` is
   * therefore mandatory at every call site and lives in
   * {@link logDurabilityFailure} so no site can forget it. That pairing —
   * optional `error` beside a required `warn` — is the shape
   * `check:optional-error-sink-contract` is satisfied by; an optional `error`
   * beside an optional `warn` is the shape it exists to refuse.
   *
   * Signature matches `Logger.error` in `@objectstack/spec/contracts` (the CAUSE
   * is its own second argument, meta is third), so the kernel logger satisfies
   * this as-is. Getting the arity wrong would put the meta object in the error
   * slot, where a `Logger` neither reads nor serializes it.
   */
  error?: (message: string, error?: Error, meta?: Record<string, any>) => void;
}

/**
 * Emit one durability-degradation line, falling back to `warn` when the host
 * injected a sink with no `error`.
 *
 * The spelling is `logSeedDurabilityFailure` in `plugin-security`'s
 * `per-organization-catalog.ts`, re-derived here rather than imported: that
 * helper is deliberately absent from `plugin-security`'s `index.ts` (an
 * intra-package helper, not public API), and `plugin-auth` does not depend on
 * `plugin-security` at runtime. Its two prohibitions are the measured part and
 * they carry across unchanged:
 *
 * ⛔ NOT `logger?.error?.(...)` — that prints NOTHING against a reduced sink,
 * silently dropping the loudest line in this module in order to look tidy,
 * which is the exact failure the rule exists to prevent.
 *
 * ⛔ NOT `(logger.error ?? logger.warn)(...)` — that evaluates to a bare
 * FUNCTION and calls it with `this === undefined`; `@objectstack/core`'s
 * `ObjectLogger` is a class whose `error` reaches for `this.writeErrorLike`, so
 * a detached call throws. Plain-closure sinks — every double in this package's
 * tests — survive it perfectly, which is why no suite would catch it. The
 * property-access call form below keeps the receiver.
 */
function logDurabilityFailure(
  logger: BootstrapLogger | undefined,
  message: string,
  meta?: Record<string, any>,
): void {
  // No single cause is in scope here: `tryInsert` answers `null`, not the
  // thrown error, so the cause slot is `undefined` and the detail travels in
  // meta — the same shape the sibling reporter in `plugin-security` uses.
  if (logger?.error) logger.error(message, undefined, meta);
  else logger?.warn?.(message, meta);
}

export interface EnsureDefaultOrganizationOptions {
  logger?: BootstrapLogger;
  /**
   * Optional seed-ownership handoff, run after the owner bind (best-effort).
   * The enterprise organizations package injects `claimOrgSeedOwnership`
   * here; the open single-org path has no per-org seed pipeline and omits it.
   */
  claimSeedOwnership?: (
    ql: any,
    organizationId: string,
    userId: string,
    options: { logger?: BootstrapLogger },
  ) => Promise<Array<{ count: number }>>;
}

const SYSTEM_CTX = { isSystem: true };

async function tryFind(ql: any, object: string, where: any, limit = 100): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : Array.isArray(rows?.records) ? rows.records : [];
  } catch {
    return [];
  }
}

async function tryInsert(ql: any, object: string, data: any): Promise<any | null> {
  try {
    return await ql.insert(object, data, { context: SYSTEM_CTX });
  } catch {
    return null;
  }
}

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

/** Oldest `created_at` first; rows with no timestamp sort first (epoch 0). */
function oldestFirst(a: any, b: any): number {
  const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
  const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
  return ta - tb;
}

/**
 * [#11973 / #11663 L3, design H4] Which writes can change this helper's
 * answer — the trigger predicate for the default-org bootstrap re-run
 * middleware. Exported so every wiring (plugin-auth's single-posture
 * middleware, and the enterprise organizations package's walled bootstrap
 * wiring) consumes the SAME predicate instead of re-deriving it — the
 * `shouldReplayBootstrapFor` pattern next door in `plugin-security`.
 *
 * Three arms, one per way the POPULATION answer can move:
 *
 *  - **`sys_user` insert/create** — the config anchor: an
 *    operator-provisioned account (`walled-owner-operator-stamp.ts`) or a
 *    trusted-IdP insert arrives ALREADY VERIFIED, so the row that confers
 *    standing can exist the moment it is created.
 *  - **`sys_user` update touching `email` / `email_verified`** — the #11343
 *    trigger set (design §2 step 5): the declared owner's verifying update is
 *    exactly the moment `matchesConfiguredPlatformAdmin` starts answering
 *    `true`, and on a fresh walled rig it is the ONLY write that ever will —
 *    post-L4 no grant row is minted there, so a grant-insert trigger never
 *    fires again (the interim window this leg closes).
 *  - **`sys_user_permission_set` insert/create** — the LEGACY anchor's
 *    trigger, kept verbatim: `single`-posture first-user promotion still
 *    lands standing as a grant insert (Choice 4A), and P5's honoured window
 *    still admits legacy walled grants. This arm is retired with the
 *    legacy-grant removal leg (design §5 step 6), together with the grant
 *    read it serves — ⛔ not as a side effect of this re-point.
 *
 * A `sys_user` DELETE never grows the population (the simulation direction
 * `last-admin-guard.ts` documents), and an update touching neither standing
 * column provably cannot move the answer — both cost no re-run.
 */
export function isDefaultOrganizationBootstrapTrigger(opCtx: {
  object?: string;
  operation?: string;
  data?: unknown;
}): boolean {
  const op = opCtx?.operation;
  if (opCtx?.object === 'sys_user') {
    if (op === 'create' || op === 'insert') return true;
    if (op === 'update') {
      const data = opCtx?.data;
      if (!data || typeof data !== 'object') return false;
      return ['email_verified', 'email'].some((column) =>
        Object.prototype.hasOwnProperty.call(data, column),
      );
    }
    return false;
  }
  if (opCtx?.object === 'sys_user_permission_set') {
    return op === 'create' || op === 'insert';
  }
  return false;
}

/**
 * The CONFIG-anchored half of the population question: the first declared
 * `OS_PLATFORM_OWNER_EMAIL` entry (operator order) holding standing, resolved
 * to the oldest VERIFIED `sys_user` row that carries it. `undefined` when the
 * variable is unset/blank/refused or no declared address has a verified
 * account yet — the caller then falls back to the legacy grant anchor.
 *
 * Both spellings of each entry are queried (a driver `where` is an exact
 * match and an imported/legacy row may not be stored lowercased), and every
 * returned row is re-checked through `matchesConfiguredPlatformAdmin` — the
 * derivation site's own predicate — so a case-folding collation's extra rows
 * are dropped and the verified read stays the shared fail-closed one.
 */
async function findConfigAnchoredAdminUserId(ql: any): Promise<string | undefined> {
  const config = resolvePlatformAdminEmails();
  if (config.emails.length === 0) return undefined;
  for (let i = 0; i < config.emails.length; i++) {
    const email = config.emails[i]!;
    const declaredSpelling = config.declaredSpellings[i] ?? email;
    const byId = new Map<string, any>();
    for (const spelling of new Set([email, declaredSpelling])) {
      for (const u of await tryFind(ql, 'sys_user', { email: spelling }, 5)) {
        if (u && typeof u === 'object' && u.id) byId.set(String(u.id), u);
      }
    }
    const standing = [...byId.values()]
      .filter((u) => matchesConfiguredPlatformAdmin(u, config))
      .sort(oldestFirst);
    if (standing[0]?.id) return String(standing[0].id);
  }
  return undefined;
}

export interface EnsureDefaultOrganizationResult {
  /** Whether a brand-new org row was inserted (vs. re-using slug=default). */
  defaultOrgCreated: boolean;
  /** Resolved (or freshly minted) default-org id; undefined when no admin exists yet. */
  defaultOrgId?: string;
  /** Whether a sys_member row was inserted binding the admin to the default org. */
  memberCreated: boolean;
  /** Human-readable reason when the helper short-circuited. */
  reason?: 'no_admin' | 'admin_already_in_org' | 'org_insert_failed' | 'member_insert_failed';
  /** Count of the default org's seeded rows re-owned to the platform admin. */
  ownershipClaimed?: number;
}

/**
 * Ensure the platform admin has a Default Organization to operate in.
 * Safe to call multiple times — idempotent on stable slug `default`
 * and on the presence of any existing `sys_member` row for the admin.
 */
export async function ensureDefaultOrganization(
  ql: any,
  options: EnsureDefaultOrganizationOptions = {},
): Promise<EnsureDefaultOrganizationResult> {
  const logger = options.logger;
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { defaultOrgCreated: false, memberCreated: false, reason: 'no_admin' };
  }

  // 1. Find the platform admin — CONFIG anchor first (#11973 / #11663 L3;
  //    the derivation prefers config, so the population read does too).
  //    With `OS_PLATFORM_OWNER_EMAIL` unset this costs no read at all, which
  //    is what keeps every `single`-posture deployment on the path below
  //    exactly as before (Choice 4A).
  let adminUserId: string | undefined = await findConfigAnchoredAdminUserId(ql);

  // 2. LEGACY grant anchor (oldest cross-tenant `admin_full_access` grant) —
  //    still what anchors `single` posture and P5's honoured migration
  //    window; removed with the legacy-grant removal leg (design §5 step 6).
  if (!adminUserId) {
    const adminPs = await tryFind(ql, 'sys_permission_set', { name: 'admin_full_access' }, 1);
    if (adminPs.length === 0 || !adminPs[0].id) {
      return { defaultOrgCreated: false, memberCreated: false, reason: 'no_admin' };
    }
    const adminPsId = adminPs[0].id;
    const adminGrants = await tryFind(
      ql,
      'sys_user_permission_set',
      { permission_set_id: adminPsId, organization_id: null },
      50,
    );
    if (adminGrants.length === 0) {
      return { defaultOrgCreated: false, memberCreated: false, reason: 'no_admin' };
    }
    const sortedGrants = [...adminGrants].sort(oldestFirst);
    adminUserId = sortedGrants[0]?.user_id ? String(sortedGrants[0].user_id) : undefined;
  }
  if (!adminUserId) {
    return { defaultOrgCreated: false, memberCreated: false, reason: 'no_admin' };
  }

  // 3. Respect existing membership — never auto-create a default org
  //    behind an admin who already belongs somewhere.
  const memberships = await tryFind(ql, 'sys_member', { user_id: adminUserId }, 1);
  if (memberships.length > 0) {
    return {
      defaultOrgCreated: false,
      memberCreated: false,
      reason: 'admin_already_in_org',
    };
  }

  // 4. Re-use or create the `default` org.
  let defaultOrgId: string | undefined;
  let defaultOrgCreated = false;
  const existingDefault = await tryFind(ql, 'sys_organization', { slug: 'default' }, 1);
  if (existingDefault.length > 0 && existingDefault[0].id) {
    defaultOrgId = String(existingDefault[0].id);
  } else {
    const newOrgId = genId('org');
    const orgRow = await tryInsert(ql, 'sys_organization', {
      id: newOrgId,
      name: 'Default Organization',
      slug: 'default',
      logo: null,
      metadata: null,
    });
    if (!orgRow) {
      // ⛔ `warn` was wrong here, and #12981 is why. `tryInsert` answers `null`
      // for a refused write, the boot continues, and nothing downstream fails —
      // which is the definition of the durability class in AGENTS.md, not the
      // functional one.
      logDurabilityFailure(
        logger,
        '[default-org] the Default Organization row was NOT created — the platform admin has no '
          + 'organization, so under multi-org the default tenant_isolation RLS policy filters their '
          + 'console to zero rows, and under single-org better-auth has no active org to resolve, so '
          + 'there is no way to add a user at all (ADR-0081 D1). NOTHING ELSE FAILS AND THE BOOT GOES '
          + 'ON LOOKING HEALTHY: this line is the only notice. Remedy: make the sys_organization '
          + 'insert land — check the write permission and driver connectivity, and whether a legacy '
          + 'unique index on `slug` is refusing `default`; the bootstrap re-runs on every '
          + 'kernel:ready and on every default-org bootstrap trigger (sys_user insert, an '
          + 'email/email_verified update, or a legacy sys_user_permission_set insert), so no '
          + 'manual repair is needed once the write can land.',
        { object: 'sys_organization', slug: 'default' },
      );
      return { defaultOrgCreated: false, memberCreated: false, reason: 'org_insert_failed' };
    }
    defaultOrgId = orgRow?.id ?? newOrgId;
    defaultOrgCreated = true;
  }

  // 5. Bind the admin as owner.
  const memRow = await tryInsert(ql, 'sys_member', {
    id: genId('mem'),
    organization_id: defaultOrgId,
    user_id: adminUserId,
    role: 'owner',
  });
  if (!memRow) {
    logDurabilityFailure(
      logger,
      '[default-org] the platform admin was NOT bound to the Default Organization — the sys_member '
        + 'row did not land, so their sessions carry no activeOrganizationId and the console stays '
        + 'empty exactly as if no organization existed. The organization row itself IS present, so '
        + 'the deployment looks healthier than it is and this line is the only notice. Remedy: make '
        + 'the sys_member insert land — check the write permission, driver connectivity, and any '
        + 'unique index over (organization_id, user_id); the bootstrap re-runs on every kernel:ready '
        + 'and on every default-org bootstrap trigger (sys_user insert, an email/email_verified '
        + 'update, or a legacy sys_user_permission_set insert), so the next pass binds it.',
      { object: 'sys_member', organization: defaultOrgId, user: adminUserId },
    );
    return {
      defaultOrgCreated,
      defaultOrgId,
      memberCreated: false,
      reason: 'member_insert_failed',
    };
  }
  logger?.info?.(
    `[default-org] bound platform admin to default organization (${defaultOrgId})`,
    { userId: adminUserId, defaultOrgId },
  );

  // 6. Optional injected seed-ownership handoff (owner-keyed UX works out of
  //    the box). Best-effort; never undoes the bind.
  let ownershipClaimed = 0;
  if (defaultOrgId && options.claimSeedOwnership) {
    try {
      const claims = await options.claimSeedOwnership(ql, defaultOrgId, adminUserId, { logger });
      ownershipClaimed = claims.reduce((s, c) => s + c.count, 0);
    } catch (e) {
      logger?.warn?.('[default-org] seed ownership handoff failed', {
        error: (e as Error).message,
      });
    }
  }

  return { defaultOrgCreated, defaultOrgId, memberCreated: true, ownershipClaimed };
}
