// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ensureUserHasOrganization — auto-create a personal org for new users.
 *
 * In multi-tenant mode, every record visible through the default
 * `tenant_isolation` RLS policy must have an `organization_id`, and
 * every authenticated user must have an `activeOrganizationId` on their
 * session for that policy to evaluate to anything other than "deny
 * all". A user with zero `sys_member` rows, however, can sign in
 * successfully and reach the dashboard — the dashboard's
 * `RequireOrganization` guard has a single-tenant carve-out that lets
 * users with empty organization lists through, so they land on a UI
 * that simply hides every record. The standard remedy ("invite users
 * via an admin") doesn't apply to self-service signup.
 *
 * This helper, run right after a `sys_user` insert, ensures the new
 * user has at least one organization by creating a personal workspace
 * (named "<User>'s Workspace", slug `<username>-workspace`) and an
 * owner-role `sys_member` row. The user's session will pick this up as
 * their `activeOrganizationId` on the next sign-in / org-list refresh
 * (better-auth's `setActiveOrganization` runs lazily when the picker
 * sees exactly one membership).
 *
 * Idempotent: bails out if the user already has any `sys_member` row.
 * Slug collisions retry with a numeric suffix; a cap of 5 attempts
 * means a pathological username will fail loudly rather than loop.
 */

interface EnsureOptions {
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
  };
  /**
   * Optional hook called after a personal org is successfully created.
   * Used by SecurityPlugin to wire in `cloneTenantSeedData` so each
   * new workspace gets its own copy of demo data. Pulled in via DI
   * to keep this helper free of a hard import on the cloner (which
   * keeps the tenant-claim and ensure-org test surfaces narrow).
   */
  cloneSeedData?: (
    ql: any,
    targetOrgId: string,
    opts: { logger?: EnsureOptions['logger'] },
  ) => Promise<{ object: string; count: number }[]>;
}

const SYSTEM_CTX = { isSystem: true };

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

function slugify(input: string, fallback = 'workspace'): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || fallback;
}

/**
 * Derive an ASCII-safe slug seed for a user whose display name doesn't
 * survive sanitisation (e.g. Chinese / Japanese / emoji-only names).
 * Prefers the email local-part, then a short id suffix — never the bare
 * literal "workspace" (which would produce ugly `workspace-workspace`
 * org slugs and matching `workspace-workspace-<env>.localhost` hostnames).
 */
function deriveSlugFallback(user: { id: string; email?: string }): string {
  if (user.email) {
    const local = user.email.split('@')[0] ?? '';
    const localSlug = local
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (localSlug) return localSlug;
  }
  const idTail = user.id.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
  return idTail ? `user-${idTail}` : 'user';
}

function deriveBaseName(user: { name?: string; email?: string; id: string }): string {
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.email) {
    const local = user.email.split('@')[0];
    if (local) return local;
  }
  return user.id;
}

async function tryFind(ql: any, object: string, where: any, limit = 1): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * Ensure `user` has at least one `sys_member` row. Creates a personal
 * organization owned by them if not.
 *
 * Returns `{ created: true, organizationId }` when a new org was made,
 * or `{ created: false, reason }` when the user already has memberships
 * or the operation was skipped.
 */
export async function ensureUserHasOrganization(
  ql: any,
  user: { id: string; name?: string; email?: string },
  options: EnsureOptions = {},
): Promise<{ created: boolean; organizationId?: string; reason?: string }> {
  const logger = options.logger;
  const cloneSeedData = options.cloneSeedData;
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { created: false, reason: 'objectql_unavailable' };
  }
  if (!user?.id) return { created: false, reason: 'invalid_user' };

  // Idempotency gate: any existing membership means we're done.
  const existing = await tryFind(ql, 'sys_member', { user_id: user.id }, 1);
  if (existing.length > 0) {
    return { created: false, reason: 'already_member' };
  }

  const base = deriveBaseName(user);
  const orgName = `${base}'s Workspace`;
  const slugFallback = deriveSlugFallback(user);
  const baseSlug = slugify(base, slugFallback);

  // Find a free slug. better-auth allows duplicates technically, but
  // the dashboard renders the slug as a stable identifier so we keep
  // them unique-per-platform for human-readable URLs.
  let slug = `${baseSlug}-workspace`;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const collision = await tryFind(ql, 'sys_organization', { slug }, 1);
    if (collision.length === 0) break;
    slug = `${baseSlug}-workspace-${attempt + 1}`;
    if (attempt === 5) {
      logger?.warn?.(
        `[security] could not find a free slug for personal org of ${user.email ?? user.id}`,
      );
      return { created: false, reason: 'slug_exhausted' };
    }
  }

  const orgId = genId('org');
  let orgRow: any = null;
  try {
    orgRow = await ql.insert(
      'sys_organization',
      { id: orgId, name: orgName, slug, logo: null, metadata: null },
      { context: SYSTEM_CTX },
    );
  } catch (e) {
    logger?.warn?.(`[security] failed to create personal org for ${user.email ?? user.id}`, {
      error: (e as Error).message,
    });
    return { created: false, reason: 'org_insert_failed' };
  }

  const finalOrgId = orgRow?.id ?? orgId;

  try {
    await ql.insert(
      'sys_member',
      {
        id: genId('mem'),
        organization_id: finalOrgId,
        user_id: user.id,
        role: 'owner',
      },
      { context: SYSTEM_CTX },
    );
  } catch (e) {
    logger?.warn?.(`[security] failed to create owner-member row for ${user.email ?? user.id}`, {
      error: (e as Error).message,
    });
    return { created: false, reason: 'member_insert_failed', organizationId: finalOrgId };
  }

  logger?.info?.(
    `[security] created personal organization "${orgName}" (${finalOrgId}) for ${user.email ?? user.id}`,
  );

  // Best-effort: clone the platform-first org's user-defined data into
  // the new personal workspace so demo apps (CRM, etc.) stay populated
  // for every signup. No-op when this IS the first org, when the donor
  // has no data, or when this op fails.
  //
  // ── Fire-and-forget ───────────────────────────────────────────────
  // The clone walks every user-defined object with `organization_id`
  // and re-inserts up to 10k rows per object. On hosted databases with
  // round-trip latency (Turso edge replicas, hosted Postgres), demo
  // tenants with multiple apps (CRM + Compliance + ContentOps + …)
  // routinely take 30s–minutes to clone. better-auth awaits the
  // `user.create.after` hook before returning the sign-up response, so
  // awaiting the clone here meant the HTTP response sat past upstream
  // proxy timeouts (Fly/Cloudflare ~30–60s) — the user was created
  // server-side but the browser saw an SSL connection drop and showed
  // a hung spinner.
  //
  // The org row + owner-member row above are already committed, so the
  // user has a functional workspace the moment the response returns.
  // Seed data trickles in shortly after; UI may briefly show empty
  // lists until the clone finishes.
  if (cloneSeedData) {
    void cloneSeedData(ql, finalOrgId, { logger }).then(
      (summary) => {
        if (summary.length > 0) {
          const total = summary.reduce((s, c) => s + c.count, 0);
          logger?.info?.(
            `[security] cloned ${total} seed row(s) into personal organization ${finalOrgId}`,
            { breakdown: summary },
          );
        }
      },
      (e) => {
        logger?.warn?.('[security] cloneTenantSeedData failed', {
          organizationId: finalOrgId,
          error: (e as Error).message,
        });
      },
    );
  }

  return { created: true, organizationId: finalOrgId };
}
