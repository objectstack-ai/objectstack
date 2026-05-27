/**
 * Pre-seed the OWNING cloud organization into a freshly-provisioned
 * project DB.
 *
 * Why this exists
 * ---------------
 * Every project at the cloud control plane is owned by exactly one
 * `sys_organization` (cloud-side). Mirroring that org into the project
 * DB makes the project's primary org match the cloud team that owns
 * it, so the owner's session resolves an `activeOrganizationId` on
 * first sign-in instead of landing on the empty "create your first
 * organization" prompt.
 *
 * Subsequent JIT-provisioned members of the same cloud org get
 * attached to this same row (Phase 2 — claim-driven by the SSO
 * callback).
 *
 * Idempotency
 * -----------
 * Keyed by the cloud `organization_id`. Re-runs across cold-boots are
 * safe no-ops; a row with that id either already exists or gets
 * inserted on the first boot of the project worker.
 */

import type { ObjectKernel } from '@objectstack/core';

export interface ProjectOrgSeed {
    /** Cloud `sys_organization.id` of the project's owning org. Reused as the project-side `sys_organization.id` so cross-tier references stay consistent. */
    id: string;
    /** Display name copied from the cloud org. */
    name: string;
    /** URL slug copied from the cloud org. */
    slug?: string | null;
    /** Optional logo URL. */
    logo?: string | null;
}

const SYS_ORG = 'sys_organization';

/**
 * Insert the project's owning organization into the project's
 * `sys_organization` table.
 *
 * Returns:
 *   - `'inserted'` — the row was newly seeded
 *   - `'exists'`   — a row with this id already existed (no-op)
 *   - `'skipped'`  — payload missing required fields (no-op)
 *   - `'error'`    — an unexpected failure; details logged via `logger.warn`
 *                     (we never throw — org seed is best-effort)
 */
export async function seedProjectOrganization(
    kernel: ObjectKernel,
    seed: ProjectOrgSeed,
    logger?: { info?: (msg: string, ctx?: any) => void; warn?: (msg: string, ctx?: any) => void },
): Promise<'inserted' | 'exists' | 'skipped' | 'error'> {
    if (!seed?.id || !seed?.name) return 'skipped';

    try {
        const ql: any = kernel.getService('objectql');
        if (!ql?.insert || !ql?.find) {
            logger?.warn?.('[seedProjectOrganization] objectql service unavailable', { orgId: seed.id });
            return 'skipped';
        }

        try {
            const existing = await ql.find(SYS_ORG, { where: { id: seed.id } } as any);
            const rows = Array.isArray(existing) ? existing : (existing?.value ?? []);
            if (Array.isArray(rows) && rows.length > 0) return 'exists';
        } catch {
            // schema may not be fully synced on first cold-boot; fall
            // through to insert — the DB layer will enforce uniqueness.
        }

        const nowIso = new Date().toISOString();
        await ql.insert(SYS_ORG, {
            id: seed.id,
            name: seed.name,
            slug: seed.slug ?? null,
            logo: seed.logo ?? null,
            metadata: null,
            created_at: nowIso,
        });

        logger?.info?.('[seedProjectOrganization] org seeded', {
            orgId: seed.id,
            name: seed.name,
        });
        return 'inserted';
    } catch (err: any) {
        logger?.warn?.('[seedProjectOrganization] failed (non-fatal)', {
            orgId: seed.id,
            error: err?.message,
        });
        return 'error';
    }
}

/**
 * Insert a `sys_member` row linking a user to an organization with a
 * given role. Idempotent on (user_id, organization_id).
 *
 * Used in tandem with `seedProjectOrganization` to bind the project
 * owner to the mirrored cloud org so the owner's first sign-in
 * already resolves an `activeOrganizationId` instead of landing on
 * the empty "create your first organization" prompt.
 *
 * Returns the same status enum as the org/owner seed helpers.
 */
export async function seedProjectMember(
    kernel: ObjectKernel,
    args: {
        userId: string;
        organizationId: string;
        role?: 'owner' | 'admin' | 'member';
    },
    logger?: { info?: (msg: string, ctx?: any) => void; warn?: (msg: string, ctx?: any) => void },
): Promise<'inserted' | 'exists' | 'skipped' | 'error'> {
    const { userId, organizationId } = args;
    const role = args.role ?? 'member';
    if (!userId || !organizationId) return 'skipped';

    try {
        const ql: any = kernel.getService('objectql');
        if (!ql?.insert || !ql?.find) {
            logger?.warn?.('[seedProjectMember] objectql service unavailable', { userId, organizationId });
            return 'skipped';
        }

        try {
            const existing = await ql.find('sys_member', {
                where: { user_id: userId, organization_id: organizationId },
            } as any);
            const rows = Array.isArray(existing) ? existing : (existing?.value ?? []);
            if (Array.isArray(rows) && rows.length > 0) return 'exists';
        } catch {
            // see comment in seedProjectOrganization
        }

        const nowIso = new Date().toISOString();
        // sys_member's primary key is generated by the org plugin; we
        // pre-generate a stable id of the form `mem_<short>` to match
        // the existing convention used by the cloud control plane.
        const memId = `mem_${Math.random().toString(36).slice(2, 14)}`;
        await ql.insert('sys_member', {
            id: memId,
            organization_id: organizationId,
            user_id: userId,
            role,
            created_at: nowIso,
        });

        logger?.info?.('[seedProjectMember] member seeded', {
            userId,
            organizationId,
            role,
        });
        return 'inserted';
    } catch (err: any) {
        logger?.warn?.('[seedProjectMember] failed (non-fatal)', {
            userId,
            organizationId,
            error: err?.message,
        });
        return 'error';
    }
}
