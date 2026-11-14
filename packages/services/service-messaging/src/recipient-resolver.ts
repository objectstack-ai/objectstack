// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';
import type { Audience, AudienceSpec } from './messaging-service.js';
import { FAN_OUT_SYSTEM_CONTEXT } from './fan-out-system-context.js';

/**
 * Cheap "looks like an email" heuristic so we attempt id resolution. Hand-rolled
 * (no regex) to stay strictly linear — the obvious `^[^\s@]+@[^\s@]+\.[^\s@]+$`
 * has overlapping quantifiers (the `.` is also in `[^\s@]`) and backtracks
 * polynomially on adversarial input (ReDoS). This is O(n).
 */
function looksLikeEmail(s: string): boolean {
    if (!s || /\s/.test(s)) return false; // single char-class test — linear
    const at = s.indexOf('@');
    if (at <= 0 || at !== s.lastIndexOf('@') || at === s.length - 1) return false;
    const domain = s.slice(at + 1);
    const dot = domain.indexOf('.');
    // a dot in the domain, not first or last char
    return dot > 0 && dot < domain.length - 1;
}

/** The user identity object an email-shaped recipient is resolved against. */
export const USER_OBJECT = 'sys_user';
/** Tenant-membership object backing `role:` expansion (`sys_member.role`). */
export const MEMBER_OBJECT = 'sys_member';
/** Team-membership object backing `team:` expansion (`sys_team_member.team_id`). */
export const TEAM_MEMBER_OBJECT = 'sys_team_member';

/**
 * [#32445, ruling 6810324463 letter A] The one organization-wide audience:
 * every member of the EMITTING organization — every `sys_member` row of
 * {@link ResolveContext.organizationId}, whatever its `role` (none, or one
 * outside the built-in four, included).
 *
 * A closed literal. The organization is the emit's own, exactly as `role:`
 * scopes to it; ⛔ it is never read from the audience string, so no spelling
 * of this selector names another organization. Every other value under the
 * `org:` prefix is refused — warned, 0 recipients — rather than read as a bare
 * user id: a misspelt organization-wide send must not look like a send.
 */
export const ORGANIZATION_MEMBERS_AUDIENCE = 'org:members';
/** The selector namespace {@link ORGANIZATION_MEMBERS_AUDIENCE} lives in; reserved whole. */
export const ORGANIZATION_AUDIENCE_PREFIX = 'org:';

/**
 * Rows read per page by a membership expansion (`org:members`, `role:`,
 * `team:`). Each expansion pages to the end — there is no cap, so a large
 * membership is never truncated without a word.
 */
export const MEMBERSHIP_PAGE_SIZE = 1000;

/**
 * Conventional owner/assignee field names tried, in order, for `owner_of:`
 * audience resolution. This is the sole home for the convention: the audit
 * writer's kernel-side assignment notifier (which mirrored this list) was
 * removed in framework#3403 — `owner_of:` is an explicit, caller-requested
 * audience, not a field-name heuristic applied to every write.
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
    /** Rows per page of a membership expansion (default {@link MEMBERSHIP_PAGE_SIZE}; tests shrink it). */
    membershipPageSize?: number;
}

export interface ResolveContext {
    /**
     * The emitting organization: the tenant scope applied to `role:`
     * expansion, and the organization whose members `org:members` names —
     * which resolves to nobody without it.
     */
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
 *   - `'org:members'`         → every `sys_member` of the emitting organization
 *   - `'team:<id>'`           → `sys_team_member` where `team_id = id`
 *   - `'owner_of:<obj>:<id>'` → the owner field of that record
 *   - `{ ownerOf: { object, id } }` → same, structured form
 *
 * Every lookup is best-effort: a failed query resolves to no recipients for
 * that spec (logged) rather than throwing — emit() must never fail because a
 * directory lookup hiccupped. A membership expansion reads every page
 * ({@link MEMBERSHIP_PAGE_SIZE}), never a capped first one.
 */
export class RecipientResolver {
    private readonly userObject: string;
    private readonly memberObject: string;
    private readonly teamMemberObject: string;
    private readonly ownerFields: string[];
    private readonly membershipPageSize: number;

    constructor(private readonly opts: RecipientResolverOptions) {
        this.userObject = opts.userObject ?? USER_OBJECT;
        this.memberObject = opts.memberObject ?? MEMBER_OBJECT;
        this.teamMemberObject = opts.teamMemberObject ?? TEAM_MEMBER_OBJECT;
        this.ownerFields = opts.ownerFields ?? DEFAULT_OWNER_FIELDS;
        const pageSize = opts.membershipPageSize;
        this.membershipPageSize = Number.isInteger(pageSize) && (pageSize as number) > 0
            ? (pageSize as number)
            : MEMBERSHIP_PAGE_SIZE;
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
        if (value.startsWith(ORGANIZATION_AUDIENCE_PREFIX)) {
            if (value === ORGANIZATION_MEMBERS_AUDIENCE) return this.resolveOrganizationMembers(data, ctx);
            this.opts.logger.warn(
                `[recipients] unrecognized organization audience '${value}': the one organization-wide audience is `
                + `'${ORGANIZATION_MEMBERS_AUDIENCE}', every member of the emitting organization; 0 recipients`,
            );
            return [];
        }
        if (value.startsWith('owner_of:')) {
            // `owner_of:<object>:<id>` — id may itself contain ':' (rare), so
            // split only on the first two segments.
            const rest = value.slice('owner_of:'.length);
            const sep = rest.indexOf(':');
            if (sep > 0) return this.resolveOwnerOf(rest.slice(0, sep), rest.slice(sep + 1), data);
            this.opts.logger.warn(`[recipients] malformed owner_of spec '${value}'; skipped`);
            return [];
        }
        if (looksLikeEmail(value)) return [await this.resolveEmail(value, data)];
        // Bare user id.
        return [value];
    }

    /** `role:` → `sys_member` rows with that role in the tenant. */
    private async resolveRole(role: string, data: IDataEngine | undefined, ctx: ResolveContext): Promise<string[]> {
        if (!role || !data) return [];
        const where: Record<string, unknown> = { role };
        if (ctx.organizationId) where.organization_id = ctx.organizationId;
        try {
            return await this.memberUserIds(data, this.memberObject, where);
        } catch (err) {
            this.opts.logger.warn(`[recipients] role '${role}' lookup failed (${msg(err)}); 0 recipients`);
            return [];
        }
    }

    /** `team:` → `sys_team_member` rows for that team. */
    private async resolveTeam(teamId: string, data: IDataEngine | undefined): Promise<string[]> {
        if (!teamId || !data) return [];
        try {
            return await this.memberUserIds(data, this.teamMemberObject, { team_id: teamId });
        } catch (err) {
            this.opts.logger.warn(`[recipients] team '${teamId}' lookup failed (${msg(err)}); 0 recipients`);
            return [];
        }
    }

    /**
     * `org:members` → every `sys_member` row of the emitting organization —
     * the member's `role` is not asked, so a member holding none, or one
     * outside the built-in four, is reached as surely as an owner.
     *
     * The posture `role:` carries (see FAN_OUT_SYSTEM_CONTEXT): a membership
     * read under the explicit system opt-in, projected to `user_id` alone,
     * whose result leaves this method only as recipient ids. The organization
     * filter is the read's ONLY tenant boundary — the opt-in lifts the
     * engine's own — so with no emitting organization there is no read at
     * all: ⛔ never an unfiltered `sys_member` scan, which would reach every
     * organization on the install. The resolved count is logged, so a send to
     * a large organization says how many it reached instead of stopping at a
     * cap.
     */
    private async resolveOrganizationMembers(data: IDataEngine | undefined, ctx: ResolveContext): Promise<string[]> {
        const organizationId = ctx.organizationId;
        if (!organizationId) {
            this.opts.logger.warn(
                `[recipients] '${ORGANIZATION_MEMBERS_AUDIENCE}' names the members of the emitting organization, and `
                + 'this emit names no organization; 0 recipients — pass organizationId to emit()',
            );
            return [];
        }
        if (!data) return [];
        try {
            const ids = await this.memberUserIds(data, this.memberObject, { organization_id: organizationId });
            this.opts.logger.info?.(
                `[recipients] '${ORGANIZATION_MEMBERS_AUDIENCE}' resolved ${ids.length} member(s) of organization `
                + `'${organizationId}'`,
            );
            return ids;
        } catch (err) {
            this.opts.logger.warn(
                `[recipients] '${ORGANIZATION_MEMBERS_AUDIENCE}' lookup for organization '${organizationId}' failed `
                + `(${msg(err)}); 0 recipients`,
            );
            return [];
        }
    }

    /**
     * Every distinct `user_id` of `object`'s rows matching `where`, read one
     * page of {@link membershipPageSize} rows at a time, ordered by `id` so the
     * pages partition the rows, until a short page — no cap. The explicit
     * system opt-in (see FAN_OUT_SYSTEM_CONTEXT): a membership read whose only
     * use is the recipient ids, so the projection is `user_id` and nothing
     * else. A failed page throws to the caller, which reports the expansion
     * as 0 recipients.
     */
    private async memberUserIds(
        data: IDataEngine,
        object: string,
        where: Record<string, unknown>,
    ): Promise<string[]> {
        const ids = new Set<string>();
        for (let offset = 0; ; offset += this.membershipPageSize) {
            const rows = await data.find(
                object,
                {
                    where,
                    fields: ['user_id'],
                    orderBy: [{ field: 'id', order: 'asc' }],
                    limit: this.membershipPageSize,
                    offset,
                },
                { context: FAN_OUT_SYSTEM_CONTEXT },
            );
            const page = Array.isArray(rows) ? rows : [];
            for (const id of userIds(page)) ids.add(id);
            if (page.length < this.membershipPageSize) return [...ids];
        }
    }

    /**
     * `owner_of:` → the owner/assignee field of the referenced record.
     *
     * [#21908, maintainer ruling Q2] The explicit system opt-in, the posture its
     * sibling {@link resolveEmail} carries (see FAN_OUT_SYSTEM_CONTEXT): the
     * read projects `id` and the owner fields and nothing else, and its result
     * leaves this method only as recipient ids. Before this the read reached the
     * engine with no principal, and the sharing middleware answers such a read
     * of a `private` object with deny-all, so an `owner_of:` audience on one
     * silently resolved to nobody. Under the opt-in it resolves the owner,
     * whatever the object's sharing model; nothing the read returns reaches the
     * emitter.
     *
     * ⛔ Never widen the projection, and never return anything but the id: the
     * record is read on the platform's authority, not the emitter's.
     */
    private async resolveOwnerOf(object: string, id: string, data: IDataEngine | undefined): Promise<string[]> {
        if (!object || !id || !data) return [];
        try {
            const rec = await data.findOne(
                object,
                { where: { id }, fields: ['id', ...this.ownerFields] },
                { context: FAN_OUT_SYSTEM_CONTEXT },
            );
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
            // The explicit system opt-in — see FAN_OUT_SYSTEM_CONTEXT: a
            // directory read on the recipient's behalf whose only use is the id.
            const user = await data.findOne(
                this.userObject,
                { where: { email }, fields: ['id'] },
                { context: FAN_OUT_SYSTEM_CONTEXT },
            );
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
