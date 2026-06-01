// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';
import type { Audience, AudienceSpec } from './messaging-service.js';

/** Cheap RFC-ish heuristic — "looks like an email" so we attempt id resolution. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The user identity object an email-shaped recipient is resolved against. */
export const USER_OBJECT = 'sys_user';
/** Tenant-membership object backing `role:` expansion (`sys_member.role`). */
export const MEMBER_OBJECT = 'sys_member';
/** Team-membership object backing `team:` expansion (`sys_team_member.team_id`). */
export const TEAM_MEMBER_OBJECT = 'sys_team_member';

/**
 * Conventional owner/assignee field names tried, in order, for `owner_of:`
 * audience resolution. Mirrors the audit writer's `OWNER_FIELDS`.
 */
const DEFAULT_OWNER_FIELDS = ['owner_id', 'assigned_to', 'assignee_id', 'owner', 'assignee'];

export interface RecipientResolverLogger {
    warn(...args: unknown[]): void;
    info?(...args: unknown[]): void;
}

export interface RecipientResolverOptions {
    /** Resolve the runtime data engine. `undefined` on a minimal/test stack. */
    getData(): IDataEngine | undefined;
    logger: RecipientResolverLogger;
    /** Identity object for email→id resolution (default {@link USER_OBJECT}). */
    userObject?: string;
    /** Membership object for `role:` (default {@link MEMBER_OBJECT}). */
    memberObject?: string;
    /** Membership object for `team:` (default {@link TEAM_MEMBER_OBJECT}). */
    teamMemberObject?: string;
    /** Owner field candidates for `owner_of:` (default {@link DEFAULT_OWNER_FIELDS}). */
    ownerFields?: string[];
}

export interface ResolveContext {
    /** Tenant scope applied to `role:` expansion. */
    organizationId?: string;
}

/**
 * RecipientResolver (ADR-0030 P1) — expands an {@link Audience} into a flat,
 * de-duplicated list of recipient **user ids**.
 *
 * Reuses the platform's existing identity/membership object model (the same
 * `sys_member.role` / `sys_team_member.team_id` graph `plugin-sharing`'s
 * `TeamGraphService` reads) by querying it directly through the data engine —
 * so `service-messaging` gains no backward dependency on a plugin. This is the
 * single home for recipient resolution: the inbox channel no longer does its
 * own email→id fallback (that moved here per ADR-0030 P1).
 *
 * Supported audience specs:
 *   - `'<userId>'`            → the id verbatim
 *   - `'user:<id>'`           → the id (prefix stripped)
 *   - `'<email>'`             → `sys_user` lookup by email → id (verbatim on miss)
 *   - `'role:<name>'`         → `sys_member` where `role = name` (tenant-scoped)
 *   - `'team:<id>'`           → `sys_team_member` where `team_id = id`
 *   - `'owner_of:<obj>:<id>'` → the owner field of that record
 *   - `{ ownerOf: { object, id } }` → same, structured form
 *
 * Every lookup is best-effort: a failed query resolves to no recipients for
 * that spec (logged) rather than throwing — emit() must never fail because a
 * directory lookup hiccupped.
 */
export class RecipientResolver {
    private readonly userObject: string;
    private readonly memberObject: string;
    private readonly teamMemberObject: string;
    private readonly ownerFields: string[];

    constructor(private readonly opts: RecipientResolverOptions) {
        this.userObject = opts.userObject ?? USER_OBJECT;
        this.memberObject = opts.memberObject ?? MEMBER_OBJECT;
        this.teamMemberObject = opts.teamMemberObject ?? TEAM_MEMBER_OBJECT;
        this.ownerFields = opts.ownerFields ?? DEFAULT_OWNER_FIELDS;
    }

    /** Expand an audience to a de-duplicated list of recipient user ids. */
    async resolve(audience: Audience, ctx: ResolveContext = {}): Promise<string[]> {
        const specs = Array.isArray(audience) ? audience : [audience as AudienceSpec];
        const data = this.opts.getData();
        const out: string[] = [];

        for (const spec of specs) {
            for (const id of await this.resolveOne(spec, data, ctx)) {
                if (id) out.push(id);
            }
        }
        // De-dup while preserving order.
        return [...new Set(out)];
    }

    private async resolveOne(
        spec: AudienceSpec,
        data: IDataEngine | undefined,
        ctx: ResolveContext,
    ): Promise<string[]> {
        if (typeof spec !== 'string') {
            // Structured `{ ownerOf: { object, id } }`.
            if (spec && typeof spec === 'object' && 'ownerOf' in spec) {
                return this.resolveOwnerOf(spec.ownerOf.object, spec.ownerOf.id, data);
            }
            this.opts.logger.warn(`[recipients] unrecognized audience spec ${JSON.stringify(spec)}; skipped`);
            return [];
        }

        const value = spec.trim();
        if (!value) return [];

        if (value.startsWith('user:')) return [value.slice(5)].filter(Boolean);
        if (value.startsWith('role:')) return this.resolveRole(value.slice(5), data, ctx);
        if (value.startsWith('team:')) return this.resolveTeam(value.slice(5), data);
        if (value.startsWith('owner_of:')) {
            // `owner_of:<object>:<id>` — id may itself contain ':' (rare), so
            // split only on the first two segments.
            const rest = value.slice('owner_of:'.length);
            const sep = rest.indexOf(':');
            if (sep > 0) return this.resolveOwnerOf(rest.slice(0, sep), rest.slice(sep + 1), data);
            this.opts.logger.warn(`[recipients] malformed owner_of spec '${value}'; skipped`);
            return [];
        }
        if (EMAIL_SHAPE.test(value)) return [await this.resolveEmail(value, data)];
        // Bare user id.
        return [value];
    }

    /** `role:` → `sys_member` rows with that role in the tenant. */
    private async resolveRole(role: string, data: IDataEngine | undefined, ctx: ResolveContext): Promise<string[]> {
        if (!role || !data) return [];
        const where: Record<string, unknown> = { role };
        if (ctx.organizationId) where.organization_id = ctx.organizationId;
        try {
            const rows = await data.find(this.memberObject, { where, fields: ['user_id'], limit: 10000 });
            return userIds(rows);
        } catch (err) {
            this.opts.logger.warn(`[recipients] role '${role}' lookup failed (${msg(err)}); 0 recipients`);
            return [];
        }
    }

    /** `team:` → `sys_team_member` rows for that team. */
    private async resolveTeam(teamId: string, data: IDataEngine | undefined): Promise<string[]> {
        if (!teamId || !data) return [];
        try {
            const rows = await data.find(this.teamMemberObject, {
                where: { team_id: teamId },
                fields: ['user_id'],
                limit: 10000,
            });
            return userIds(rows);
        } catch (err) {
            this.opts.logger.warn(`[recipients] team '${teamId}' lookup failed (${msg(err)}); 0 recipients`);
            return [];
        }
    }

    /** `owner_of:` → the owner/assignee field of the referenced record. */
    private async resolveOwnerOf(object: string, id: string, data: IDataEngine | undefined): Promise<string[]> {
        if (!object || !id || !data) return [];
        try {
            const rec = await data.findOne(object, { where: { id }, fields: ['id', ...this.ownerFields] });
            if (!rec) return [];
            for (const f of this.ownerFields) {
                const v = rec[f];
                if (typeof v === 'string' && v.length > 0) return [v];
            }
            return [];
        } catch (err) {
            this.opts.logger.warn(`[recipients] owner_of '${object}:${id}' lookup failed (${msg(err)}); 0 recipients`);
            return [];
        }
    }

    /**
     * Resolve an email-shaped recipient to its user id. Falls back to the email
     * verbatim on no match or lookup error (a downstream channel may still key
     * a row by it — never lose the recipient on a directory miss).
     */
    private async resolveEmail(email: string, data: IDataEngine | undefined): Promise<string> {
        if (!data) return email;
        try {
            const user = await data.findOne(this.userObject, { where: { email }, fields: ['id'] });
            const id = user?.id;
            if (id != null && String(id).length > 0) return String(id);
            this.opts.logger.warn(`[recipients] no '${this.userObject}' matched email '${email}'; keeping verbatim`);
            return email;
        } catch (err) {
            this.opts.logger.warn(`[recipients] email '${email}' lookup failed (${msg(err)}); keeping verbatim`);
            return email;
        }
    }
}

/** Pull distinct non-empty `user_id`s from a row set. */
function userIds(rows: unknown): string[] {
    if (!Array.isArray(rows)) return [];
    return [...new Set(rows.map((r: any) => String(r?.user_id ?? '')).filter(Boolean))];
}

function msg(err: unknown): string {
    return (err as Error)?.message ?? String(err);
}
