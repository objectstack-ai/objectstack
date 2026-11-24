// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Slack binding store (ADR-0013 addendum of 2026-11-19, step 2): an
 * organization's install (`sys_channel_account`) and each person's link to
 * their Slack user (`sys_channel_user_link`), proposed by email match and
 * confirmed once by the person.
 *
 * ## The proposal
 *
 * A Slack link is proposed only for a verified email, and names no one before
 * it is confirmed: {@link SlackLinkStore.propose} looks a Slack user up only
 * for the person's email while `sys_user.email_verified` reads verified, and
 * answers an unverified email exactly as it answers no match. The proposal
 * records a digest of the email it was made for, and no Slack user;
 * {@link SlackLinkStore.confirm} confirms only while the person's email is
 * still verified and still that email, looks it up again, records the Slack
 * user it names, and applies only to the proposal that was checked. A new
 * proposal replaces one made for another email.
 *
 * ## What every write carries
 *
 * Each write is an ENGINE write under a system context that names the person
 * who acted (`userId`), and the organization (`tenantId`) on the install's
 * writes. So the platform's write audit (`afterInsert` / `afterUpdate` /
 * `afterDelete`, which these objects are not excluded from) records the
 * proposal, the confirmation (ADR-0013 §8 item 2's one-time row) and every
 * removal, with who did it (ruling `7024100939`, rider 1). A cascade (the
 * person or the install deleted) runs the same hooks on each link it removes.
 *
 * ## The token
 *
 * `bot_token` is a `secret` field: the engine encrypts it on write (the
 * install's organization in the encryption context) and masks it on every
 * read. {@link SlackLinkStore.slackFor} is its one reader, through the
 * engine's privileged `resolveSecretField`, and hands it only to the `slack`
 * client service. No answer of this module, and no route, carries it.
 *
 * ## Removal triggers (rider 3)
 *
 * {@link bindSlackLinkRemovalTriggers}: a person who leaves an organization
 * (`sys_member` deleted, or moved to another organization) loses their links
 * there; a banned person loses all of theirs. The deletion of the person
 * cascades by the object's own declaration. Engine hooks, as the session
 * trigger in plugin-auth: a write below the engine (a raw driver delete) is
 * not seen, and the per-delivery check in the Slack channel still requires a
 * confirmed link on an active install.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { isEmailVerifiedUserRow } from '@objectstack/types';
import type { EmitInput } from './messaging-service.js';
import { enMessages, type MessagingMessageId } from './translations/messages.js';

export const CHANNEL_ACCOUNT_OBJECT = 'sys_channel_account';
export const CHANNEL_USER_LINK_OBJECT = 'sys_channel_user_link';
export const SLACK_CHANNEL_ID = 'slack';
/** The topic of the notice a person gets when an administrator removes their link (rider 2). */
export const SLACK_LINK_REMOVED_TOPIC = 'messaging.slack_link_removed';
const TOKEN_FIELD = 'bot_token';
const USER_OBJECT = 'sys_user';
const MEMBER_OBJECT = 'sys_member';
/** Slack answers that mean the install's token no longer works. */
const TOKEN_REFUSALS = new Set(['invalid_auth', 'token_revoked', 'token_expired', 'account_inactive', 'not_authed']);

/**
 * connector-slack's client, as its plugin registers it under the `slack`
 * service (`SlackClientService`). Declared here, structurally, because this
 * package cannot import connector-slack: that dependency would close a
 * workspace cycle through `@objectstack/service-automation`.
 */
export interface SlackClientSurface {
    client(token: string): { call(input: Record<string, unknown>): Promise<Record<string, unknown>> };
}

/** One Slack Web API answer, read off connector-slack's `call` result. */
export interface SlackAnswer {
    readonly ok: boolean;
    readonly status: number;
    readonly body: Record<string, any>;
    readonly error?: string;
}

/** One API client for one install: `method` with `params`. */
export type SlackCall = (method: string, params?: Record<string, unknown>) => Promise<SlackAnswer>;

export interface SlackAccount {
    readonly id: string;
    readonly organizationId: string;
    readonly displayName: string;
    readonly externalId: string;
    readonly status: 'active' | 'revoked';
}

export interface SlackLink {
    readonly id: string;
    readonly accountId: string;
    readonly userId: string;
    /** The linked Slack user: recorded at confirmation, so a proposal has none. */
    readonly externalUserId?: string;
    readonly externalDisplayName?: string;
    readonly state: 'proposed' | 'confirmed';
    readonly confirmedAt?: string;
    /** The digest of the email the proposal was made for ({@link emailDigest}). Never answered. */
    readonly proposalEmailHash?: string;
}

/**
 * A refusal a door answers with its own status and code. `messageId` names the
 * refusal's sentence in the messaging catalog (`translations/messages.ts`),
 * whose `en` entry is `message`; the door answers it in the caller's language.
 */
export class SlackLinkError extends Error {
    constructor(readonly status: number, readonly code: string, message: string, readonly messageId?: MessagingMessageId) {
        super(message);
        this.name = 'SlackLinkError';
    }
}

/** The digest a proposal records of the email it was made for: SHA-256 of the trimmed, lower-cased address. */
export function emailDigest(email: string): string {
    return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

type SecretEngine = IDataEngine & {
    resolveSecretField?(object: string, recordId: string, field: string, opts?: { tenantId?: string }): Promise<string | null>;
};

export interface SlackLinkStoreOptions {
    getData(): IDataEngine | undefined;
    /** The `slack` client service; `undefined` when connector-slack is not composed. */
    getSlack(): SlackClientSurface | undefined;
    /** The messaging ingress, for the notice an administrator's removal sends (rider 2). */
    notify(input: EmitInput): Promise<unknown>;
    logger: { warn(...args: unknown[]): void };
    now?(): string;
    /** How many links one read takes when every link of an install is removed (default {@link LINK_PAGE}). */
    linkPageSize?: number;
}

/** The page an install's removal reads its links in, so it reaches every one of them. */
const LINK_PAGE = 500;

const READ = { context: { isSystem: true } } as const;
const by = (userId: string | undefined, organizationId?: string) => ({
    context: { isSystem: true, ...(userId ? { userId } : {}), ...(organizationId ? { tenantId: organizationId } : {}) },
});
const str = (v: unknown): string | undefined => (v == null || v === '' ? undefined : String(v));

function toAccount(row: Record<string, any>): SlackAccount {
    return {
        id: String(row.id),
        organizationId: String(row.organization_id ?? ''),
        displayName: String(row.display_name ?? ''),
        externalId: String(row.external_id ?? ''),
        status: row.status === 'revoked' ? 'revoked' : 'active',
    };
}

function toLink(row: Record<string, any>): SlackLink {
    return {
        id: String(row.id),
        accountId: String(row.account_id),
        userId: String(row.user_id),
        ...(str(row.external_user_id) ? { externalUserId: String(row.external_user_id) } : {}),
        ...(str(row.external_display_name) ? { externalDisplayName: String(row.external_display_name) } : {}),
        state: row.state === 'confirmed' ? 'confirmed' : 'proposed',
        ...(str(row.confirmed_at) ? { confirmedAt: String(row.confirmed_at) } : {}),
        ...(str(row.proposal_email_hash) ? { proposalEmailHash: String(row.proposal_email_hash) } : {}),
    };
}

export class SlackLinkStore {
    constructor(private readonly opts: SlackLinkStoreOptions) {}

    private data(): SecretEngine {
        const data = this.opts.getData();
        if (!data) throw new SlackLinkError(503, 'SERVICE_UNAVAILABLE', 'This server has no data engine, so Slack links cannot be read or changed.');
        return data as SecretEngine;
    }

    private slack(): SlackClientSurface {
        const slack = this.opts.getSlack();
        if (!slack) {
            throw new SlackLinkError(503, 'SERVICE_UNAVAILABLE',
                'This server has no Slack transport: compose ConnectorSlackPlugin (@objectstack/connector-slack) to install Slack and connect people to it. Nothing was changed.');
        }
        return slack;
    }

    /** The organization's Slack install, or `undefined`. */
    async account(organizationId: string): Promise<SlackAccount | undefined> {
        const row = await this.data().findOne(CHANNEL_ACCOUNT_OBJECT, {
            where: { organization_id: organizationId, channel_id: SLACK_CHANNEL_ID },
            fields: ['id', 'organization_id', 'display_name', 'external_id', 'status'],
        }, READ);
        return row ? toAccount(row) : undefined;
    }

    /**
     * Install (or replace the token of) the organization's own Slack app. The
     * token is proven with `auth.test` first, and its workspace is what the
     * row records; a token for another workspace than the one installed is
     * refused, since every link names a user of the installed one.
     */
    async install(organizationId: string, token: string, actor: string): Promise<SlackAccount> {
        const answer = await callWith(this.slack(), token)('auth.test');
        const teamId = str(answer.body.team_id);
        if (!answer.ok || !teamId) {
            throw new SlackLinkError(400, 'VALIDATION_ERROR',
                `Slack did not accept this token (${answer.error ?? `HTTP ${answer.status}`}). Nothing was saved.`);
        }
        const values = {
            display_name: str(answer.body.team) ?? teamId,
            external_id: teamId,
            [TOKEN_FIELD]: token,
            status: 'active',
        };
        const data = this.data();
        const existing = await this.account(organizationId);
        if (existing && existing.externalId !== teamId) {
            throw new SlackLinkError(409, 'RESOURCE_CONFLICT',
                `This token belongs to another Slack workspace than the one installed (${existing.displayName}). ` +
                'Remove the install first, which removes every link to it. Nothing was saved.');
        }
        if (existing) {
            await data.update(CHANNEL_ACCOUNT_OBJECT, values, { where: { id: existing.id }, ...by(actor, organizationId) } as never);
        } else {
            await data.insert(CHANNEL_ACCOUNT_OBJECT,
                { id: randomUUID(), organization_id: organizationId, channel_id: SLACK_CHANNEL_ID, ...values }, by(actor, organizationId));
        }
        return (await this.account(organizationId))!;
    }

    /**
     * Remove the install and, first, every link to it, each as an administrator's
     * removal that tells the person. The links are read in pages, in id order,
     * until a page comes back short, so every linked person is reached.
     */
    async uninstall(organizationId: string, actor: string): Promise<boolean> {
        const account = await this.account(organizationId);
        if (!account) return false;
        const data = this.data();
        const size = Math.max(1, this.opts.linkPageSize ?? LINK_PAGE);
        for (let after: string | undefined; ;) {
            const rows = await data.find(CHANNEL_USER_LINK_OBJECT, {
                where: { account_id: account.id, ...(after === undefined ? {} : { id: { $gt: after } }) },
                orderBy: [{ field: 'id', order: 'asc' }],
                limit: size,
            }, READ);
            const page = (rows ?? []).map(toLink);
            for (const link of page) await this.removeLink(link, account, actor, true);
            if (page.length < size) break;
            after = page[page.length - 1]!.id;
        }
        await data.delete(CHANNEL_ACCOUNT_OBJECT, { where: { id: account.id }, ...by(actor, organizationId) } as never);
        return true;
    }

    /** Every link to the organization's install. */
    async links(organizationId: string): Promise<SlackLink[]> {
        const account = await this.account(organizationId);
        if (!account) return [];
        const rows = await this.data().find(CHANNEL_USER_LINK_OBJECT, { where: { account_id: account.id }, limit: 10000 }, READ);
        return (rows ?? []).map(toLink);
    }

    /** The person's link to the organization's install, or `undefined`. */
    async linkOf(organizationId: string, userId: string): Promise<SlackLink | undefined> {
        const account = await this.account(organizationId);
        if (!account) return undefined;
        const row = await this.data().findOne(CHANNEL_USER_LINK_OBJECT, { where: { account_id: account.id, user_id: userId } }, READ);
        return row ? toLink(row) : undefined;
    }

    /**
     * Propose a link by the person's verified email (Slack
     * `users.lookupByEmail`). A confirmed link, or a proposal made for the
     * person's current verified email, is answered as it is; a proposal made
     * for another email, or for one no longer verified, is replaced.
     * `undefined` — nothing proposed, and Slack is not asked — when the person
     * has no verified email; `undefined` too when no Slack user holds it, or
     * that Slack user is already linked to another person in this install.
     */
    async propose(organizationId: string, userId: string): Promise<SlackLink | undefined> {
        const account = await this.requireActive(organizationId);
        const email = await this.verifiedEmail(userId);
        const existing = await this.linkOf(organizationId, userId);
        if (existing) {
            if (existing.state === 'confirmed' || (email && existing.proposalEmailHash === emailDigest(email))) return existing;
            await this.removeLink(existing, undefined, userId, false);
        }
        if (!email) return undefined;
        const data = this.data();
        // `users.lookupByEmail` reads its argument from the query string or a
        // form body, not JSON (Slack's accepted content types for the method).
        const answer = await (await this.slackFor(account))(`users.lookupByEmail?email=${encodeURIComponent(email)}`);
        if (!answer.ok) {
            if (answer.error === 'users_not_found') return undefined;
            throw await this.slackFault(account, answer);
        }
        if (!(await this.linkableUser(account, answer))) return undefined;
        await data.insert(CHANNEL_USER_LINK_OBJECT, {
            id: randomUUID(),
            organization_id: organizationId,
            account_id: account.id,
            user_id: userId,
            proposal_email_hash: emailDigest(email),
            state: 'proposed',
        }, by(userId, organizationId));
        return this.linkOf(organizationId, userId);
    }

    /**
     * The person confirms their proposal: from now on it delivers. Only while
     * their email is still verified and still the email the proposal was made
     * for, and while Slack still names a user for it that no one else in the
     * install is linked to; otherwise refused, and the person asks for a new
     * proposal. The Slack user is recorded here. The write applies only to the
     * proposal that was checked: it is conditioned on the row's id, its
     * `proposed` state and that email's digest, and a write that matches no
     * row is refused the same way.
     */
    async confirm(organizationId: string, userId: string): Promise<SlackLink> {
        const link = await this.linkOf(organizationId, userId);
        if (!link) {
            throw new SlackLinkError(404, 'RESOURCE_NOT_FOUND',
                'You have no proposed Slack link in this organization to confirm: ask for a proposal first. Nothing was changed.');
        }
        if (link.state === 'confirmed') return link;
        const outdated = () => new SlackLinkError(409, 'RESOURCE_CONFLICT', enMessages.slackLinkProposalOutdated, 'slackLinkProposalOutdated');
        const email = await this.verifiedEmail(userId);
        const digest = email ? emailDigest(email) : undefined;
        if (!email || !digest || link.proposalEmailHash !== digest) throw outdated();
        const account = await this.requireActive(organizationId);
        const answer = await (await this.slackFor(account))(`users.lookupByEmail?email=${encodeURIComponent(email)}`);
        if (!answer.ok && answer.error !== 'users_not_found') throw await this.slackFault(account, answer);
        const found = answer.ok ? await this.linkableUser(account, answer) : undefined;
        if (!found) throw outdated();
        // A predicate write (`multi: true`), so every `where` key is evaluated
        // and the answer is the count of rows it changed: at most this one.
        const written = await this.data().update(CHANNEL_USER_LINK_OBJECT, {
            state: 'confirmed',
            confirmed_at: this.opts.now?.() ?? new Date().toISOString(),
            external_user_id: found.id,
            external_display_name: found.name ?? null,
        }, { where: { id: link.id, state: 'proposed', proposal_email_hash: digest }, multi: true, ...by(userId, organizationId) } as never);
        if (!written) throw outdated();
        return (await this.linkOf(organizationId, userId))!;
    }

    /** The person removes their own link. */
    async removeOwn(organizationId: string, userId: string): Promise<boolean> {
        const link = await this.linkOf(organizationId, userId);
        if (!link) return false;
        await this.removeLink(link, undefined, userId, false);
        return true;
    }

    /** An administrator removes one person's link in their organization; the person is told (rider 2). */
    async removeByAdmin(organizationId: string, linkId: string, actor: string): Promise<boolean> {
        const account = await this.account(organizationId);
        if (!account) return false;
        const row = await this.data().findOne(CHANNEL_USER_LINK_OBJECT, { where: { id: linkId, account_id: account.id } }, READ);
        if (!row) return false;
        await this.removeLink(toLink(row), account, actor, true);
        return true;
    }

    /**
     * Remove every link of `userId` — in `organizationId`, or everywhere when
     * it is absent — attributed to `actor` (rider 3's triggers). One predicate
     * delete (`multi: true`); the engine runs the delete hooks once per row it
     * removes, so each removal is audited as before. Answers how many went.
     */
    async removeAllOf(userId: string, organizationId: string | undefined, actor: string | undefined): Promise<number> {
        const where: Record<string, unknown> = { user_id: userId };
        if (organizationId) where.organization_id = organizationId;
        const removed = await this.data().delete(CHANNEL_USER_LINK_OBJECT, { where, multi: true, ...by(actor) } as never);
        return Number(removed) || 0;
    }

    /** The recipients among `userIds` with a confirmed link to the organization's ACTIVE install. */
    async confirmedUsers(organizationId: string, userIds: readonly string[]): Promise<Set<string>> {
        const account = await this.account(organizationId);
        if (!account || account.status !== 'active' || userIds.length === 0) return new Set();
        const rows = await this.data().find(CHANNEL_USER_LINK_OBJECT, {
            where: { account_id: account.id, state: 'confirmed', user_id: { $in: [...userIds] } },
            fields: ['user_id'],
            limit: userIds.length,
        }, READ);
        return new Set((rows ?? []).map((r: any) => String(r.user_id)));
    }

    /** Where to deliver to `userId`: their confirmed link and the active install, or `undefined`. */
    async deliveryTarget(organizationId: string, userId: string): Promise<{ account: SlackAccount; link: SlackLink } | undefined> {
        const account = await this.account(organizationId);
        if (!account || account.status !== 'active') return undefined;
        const link = await this.linkOf(organizationId, userId);
        return link?.state === 'confirmed' && link.externalUserId ? { account, link } : undefined;
    }

    /** A Slack API client for the install, with its token read through the privileged dereference. */
    async slackFor(account: SlackAccount): Promise<SlackCall> {
        const slack = this.slack();
        const data = this.data();
        if (typeof data.resolveSecretField !== 'function') {
            throw new SlackLinkError(503, 'SERVICE_UNAVAILABLE', 'This data engine cannot read an encrypted field, so the Slack token cannot be used.');
        }
        const token = await data.resolveSecretField(CHANNEL_ACCOUNT_OBJECT, account.id, TOKEN_FIELD, { tenantId: account.organizationId });
        if (!token) throw new SlackLinkError(503, 'SERVICE_UNAVAILABLE', 'The Slack install has no readable token: set it again.');
        return callWith(slack, token);
    }

    /** Record that Slack refused the install's token, so no further delivery is attempted on it. */
    async markRevoked(account: SlackAccount): Promise<void> {
        try {
            await this.data().update(CHANNEL_ACCOUNT_OBJECT, { status: 'revoked' }, { where: { id: account.id }, ...by(undefined, account.organizationId) } as never);
        } catch (err) {
            this.opts.logger.warn(`[slack] Slack refused the token of the install '${account.id}', which could not be marked revoked: ${(err as Error)?.message}`);
        }
    }

    /** The person's email while `sys_user.email_verified` reads verified, else `undefined`. */
    private async verifiedEmail(userId: string): Promise<string | undefined> {
        const user = await this.data().findOne(USER_OBJECT, { where: { id: userId }, fields: ['email', 'email_verified'] }, READ);
        return isEmailVerifiedUserRow(user) ? str(user?.email) : undefined;
    }

    /**
     * The Slack user a `users.lookupByEmail` answer names, while it can be
     * linked: a person, not deleted, and linked to no one in this install.
     */
    private async linkableUser(account: SlackAccount, answer: SlackAnswer): Promise<{ id: string; name?: string } | undefined> {
        const found = answer.body.user ?? {};
        const id = str(found.id);
        if (!id || found.deleted === true || found.is_bot === true) return undefined;
        const taken = await this.data().findOne(CHANNEL_USER_LINK_OBJECT, { where: { account_id: account.id, external_user_id: id } }, READ);
        if (taken) return undefined;
        const name = str(found.real_name) ?? str(found.name);
        return name ? { id, name } : { id };
    }

    private async requireActive(organizationId: string): Promise<SlackAccount> {
        const account = await this.account(organizationId);
        if (!account || account.status !== 'active') {
            throw new SlackLinkError(409, 'RESOURCE_CONFLICT',
                account
                    ? 'Slack refused this organization\'s token: an administrator sets it again before anyone can connect. Nothing was changed.'
                    : 'Slack is not installed for this organization: an administrator installs it first. Nothing was changed.');
        }
        return account;
    }

    private async slackFault(account: SlackAccount, answer: SlackAnswer): Promise<SlackLinkError> {
        if (answer.error && TOKEN_REFUSALS.has(answer.error)) await this.markRevoked(account);
        return new SlackLinkError(502, 'EXTERNAL_SERVICE_ERROR', `Slack answered ${answer.error ?? `HTTP ${answer.status}`}. Nothing was changed.`);
    }

    private async removeLink(link: SlackLink, account: SlackAccount | undefined, actor: string, byAdmin: boolean): Promise<void> {
        await this.data().delete(CHANNEL_USER_LINK_OBJECT, { where: { id: link.id }, ...by(actor) } as never);
        if (!byAdmin || !account) return;
        const workspace = account.displayName;
        try {
            await this.opts.notify({
                topic: SLACK_LINK_REMOVED_TOPIC,
                audience: [`user:${link.userId}`],
                organizationId: account.organizationId,
                channels: ['inbox', 'email'],
                actorId: actor,
                severity: 'info',
                payload: {
                    title: enMessages.slackLinkRemovedTitle,
                    body: enMessages.slackLinkRemovedBody.replace('{{workspace}}', workspace),
                },
                keyedText: {
                    titleKey: 'messages.slackLinkRemovedTitle',
                    bodyKey: 'messages.slackLinkRemovedBody',
                    params: { workspace },
                },
            });
        } catch (err) {
            this.opts.logger.warn(
                `[slack] the link of '${link.userId}' was removed by '${actor}', but the notice telling them failed: ${(err as Error)?.message}`,
            );
        }
    }
}

/** The answer of connector-slack's `call`, normalised. */
export function callWith(slack: SlackClientSurface, token: string): SlackCall {
    const api = slack.client(token);
    return async (method, params = {}) => {
        const out = await api.call({ method, params });
        return {
            ok: out.ok === true,
            status: Number(out.status ?? 0),
            body: (out.body && typeof out.body === 'object' ? out.body : {}) as Record<string, any>,
            ...(typeof out.error === 'string' ? { error: out.error } : {}),
        };
    };
}

/** Is this Slack error code a refusal of the install's token? */
export function isTokenRefusal(error: string | undefined): boolean {
    return error !== undefined && TOKEN_REFUSALS.has(error);
}

/** The slice of the engine the triggers need. */
export interface SlackTriggerEngine {
    registerHook?(event: string, handler: (ctx: any) => Promise<void>, opts: { object: string; packageId: string }): void;
    unregisterHooksByPackage?(packageId: string): number;
}

const TRIGGER_PACKAGE = 'com.objectstack.service.messaging.slack-links';

/**
 * Rider 3: remove a person's links when they leave an organization or are
 * banned. Never throws into the write that triggered it: a failure is said at
 * `error`, because the person keeps a link that should be gone while
 * everything looks normal.
 */
export function bindSlackLinkRemovalTriggers(
    engine: SlackTriggerEngine | null | undefined,
    store: SlackLinkStore,
    logger: { error(...args: unknown[]): void },
): boolean {
    if (!engine || typeof engine.registerHook !== 'function') return false;
    const register = engine.registerHook.bind(engine);
    const remove = async (userId: string | undefined, organizationId: string | undefined, actor: string | undefined, why: string) => {
        if (!userId) return;
        try {
            await store.removeAllOf(userId, organizationId, actor);
        } catch (err) {
            logger.error(
                `[slack] '${userId}' ${why}, but their Slack links could not be removed (${(err as Error)?.message}): they keep ` +
                'receiving notifications on Slack until an administrator removes the link (DELETE /api/v1/messaging/slack/links/:id).',
            );
        }
    };
    register('afterDelete', async (ctx) => {
        await remove(str(ctx?.previous?.user_id), str(ctx?.previous?.organization_id), str(ctx?.session?.userId), 'left an organization');
    }, { object: MEMBER_OBJECT, packageId: TRIGGER_PACKAGE });
    register('afterUpdate', async (ctx) => {
        const data = ctx?.input?.data;
        const before = str(ctx?.previous?.organization_id);
        if (!data || !('organization_id' in data) || !before || before === str(data.organization_id)) return;
        await remove(str(ctx?.previous?.user_id), before, str(ctx?.session?.userId), 'left an organization');
    }, { object: MEMBER_OBJECT, packageId: TRIGGER_PACKAGE });
    register('afterUpdate', async (ctx) => {
        if (ctx?.input?.data?.banned !== true) return;
        await remove(str(ctx?.input?.id) ?? str(ctx?.previous?.id), undefined, str(ctx?.session?.userId), 'was banned');
    }, { object: USER_OBJECT, packageId: TRIGGER_PACKAGE });
    return true;
}

/** Unbind {@link bindSlackLinkRemovalTriggers} (plugin teardown). */
export function unbindSlackLinkRemovalTriggers(engine: SlackTriggerEngine | null | undefined): void {
    engine?.unregisterHooksByPackage?.(TRIGGER_PACKAGE);
}
