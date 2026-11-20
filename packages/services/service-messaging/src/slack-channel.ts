// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type {
    ChannelAvailability,
    ChannelAvailabilityQuery,
    Delivery,
    ErrorClass,
    MessagingChannel,
    MessagingChannelContext,
    Notification,
    RecipientReachQuery,
    SendResult,
} from './channel.js';
import { SLACK_CHANNEL_ID, isTokenRefusal, type SlackAnswer, type SlackLinkStore } from './slack-links.js';

/**
 * Error-string prefixes, read back by `classifyError` (the dispatcher hands it
 * the `SendResult.error` string), the convention the sms and push channels use.
 */
const NOT_LINKED = 'slack_not_linked';
const USER_UNREACHABLE = 'slack_user_unreachable';
const TOKEN_REFUSED = 'slack_token_refused';
const TOKEN_UNREADABLE = 'slack_token_unreadable';
const RATE_LIMITED = 'slack_rate_limited';
/** Slack answers that mean this person cannot be sent a DM. */
const USER_REFUSALS = new Set(['user_not_found', 'user_disabled', 'cannot_dm_bot', 'user_not_visible', 'users_not_found']);

export interface SlackChannelOptions {
    store: SlackLinkStore;
    /**
     * The deployment's public origin a relative `actionUrl` is made absolute
     * under; default {@link deploymentOrigin}, read per delivery.
     */
    getPublicOrigin?(): string | undefined;
}

/**
 * The `slack` channel (ADR-0013 addendum of 2026-11-19, ADR-0022 §3) — a
 * direct message to the recipient's own Slack user, through connector-slack's
 * client (the `slack` service) with the organization's own bot token.
 *
 * - **Who can be sent to.** A recipient with a CONFIRMED link to their
 *   organization's active install. {@link MessagingChannel.isAvailable} answers
 *   the organization (an active install, else `transport_not_configured`);
 *   {@link MessagingChannel.reachableRecipients} answers the people, so a
 *   person with no link, or a proposal only, is skipped before any delivery
 *   row exists. Preferences, digest and quiet hours apply as on every
 *   channel: they run in fan-out and the dispatcher, before this.
 * - **What is sent.** `conversations.open` with the linked user, then
 *   `chat.postMessage`: the title in bold, linked to the notification's deep
 *   link made absolute, then the body; both already in the recipient's
 *   language. No text of its own, so nothing here needs translating.
 * - **Outcome.** A link gone or never confirmed by the time a row is sent,
 *   or a Slack user Slack no longer finds ⇒ `invalid_recipient` (suppressed,
 *   not dead-lettered). A refused token ⇒ `permanent`, and the install is
 *   marked revoked so later emits skip it. Rate limited ⇒ `rate_limited`
 *   (retried). Anything else ⇒ `retryable`.
 */
export function createSlackChannel(opts: SlackChannelOptions): MessagingChannel {
    const { store } = opts;
    const origin = () => (opts.getPublicOrigin ?? deploymentOrigin)();

    return {
        id: SLACK_CHANNEL_ID,

        async isAvailable(_ctx: MessagingChannelContext, query: ChannelAvailabilityQuery): Promise<ChannelAvailability> {
            const account = query.organizationId ? await store.account(query.organizationId) : undefined;
            return account?.status === 'active' ? { available: true } : { available: false, reason: 'transport_not_configured' };
        },

        async reachableRecipients(_ctx: MessagingChannelContext, query: RecipientReachQuery): Promise<ReadonlySet<string>> {
            return query.organizationId ? store.confirmedUsers(query.organizationId, query.recipients) : new Set();
        },

        async send(_ctx: MessagingChannelContext, delivery: Delivery): Promise<SendResult> {
            const n = delivery.notification;
            const target = n.organizationId ? await store.deliveryTarget(n.organizationId, delivery.recipient) : undefined;
            if (!target) {
                return { ok: false, error: `${NOT_LINKED}: '${delivery.recipient}' has no confirmed Slack link to an active install in this organization` };
            }
            let call;
            try {
                call = await store.slackFor(target.account);
            } catch (err) {
                return { ok: false, error: `${TOKEN_UNREADABLE}: ${(err as Error)?.message ?? String(err)}` };
            }
            const opened = await call('conversations.open', { users: target.link.externalUserId });
            const channel = opened.body.channel?.id;
            if (!opened.ok || typeof channel !== 'string') return failure(store, target.account, opened);
            const posted = await call('chat.postMessage', {
                channel,
                text: slackDmText(n, origin()),
                unfurl_links: false,
                unfurl_media: false,
            });
            if (!posted.ok) return failure(store, target.account, posted);
            return { ok: true, externalId: typeof posted.body.ts === 'string' ? posted.body.ts : undefined };
        },

        classifyError(err: unknown): ErrorClass {
            const message = typeof err === 'string' ? err : (err as Error)?.message ?? '';
            if (message.startsWith(NOT_LINKED) || message.startsWith(USER_UNREACHABLE)) return 'invalid_recipient';
            if (message.startsWith(TOKEN_REFUSED) || message.startsWith(TOKEN_UNREADABLE)) return 'permanent';
            if (message.startsWith(RATE_LIMITED)) return 'rate_limited';
            return 'retryable';
        },
    };
}

async function failure(store: SlackLinkStore, account: Parameters<SlackLinkStore['markRevoked']>[0], answer: SlackAnswer): Promise<SendResult> {
    const why = answer.error ?? `HTTP ${answer.status}`;
    if (isTokenRefusal(answer.error)) {
        await store.markRevoked(account);
        return { ok: false, error: `${TOKEN_REFUSED}: Slack refused the install's token (${why}); an administrator sets it again` };
    }
    if (answer.error && USER_REFUSALS.has(answer.error)) return { ok: false, error: `${USER_UNREACHABLE}: ${why}` };
    if (answer.status === 429 || answer.error === 'ratelimited') return { ok: false, error: `${RATE_LIMITED}: ${why}` };
    return { ok: false, error: `slack_failed: ${why}` };
}

/** Slack's mrkdwn control characters, escaped as Slack asks. */
function escapeSlack(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The DM's text: the title in bold, linked to the deep link when one can be
 * made absolute, then the body.
 */
export function slackDmText(n: Pick<Notification, 'title' | 'body' | 'actionUrl'>, origin: string | undefined): string {
    const title = escapeSlack(n.title);
    const link = absoluteLink(n.actionUrl, origin);
    const head = link ? `*<${link}|${title}>*` : `*${title}*`;
    return n.body ? `${head}\n${escapeSlack(n.body)}` : head;
}

/**
 * `actionUrl` as an absolute `http(s)` URL: as it is when it already is one,
 * under `origin` when it is a path on this server, else none (a DM reader is
 * outside the Console, so a relative link opens nothing).
 */
export function absoluteLink(actionUrl: string | undefined, origin: string | undefined): string | undefined {
    if (!actionUrl) return undefined;
    let url: URL | undefined;
    try {
        url = actionUrl.startsWith('/') && !actionUrl.startsWith('//')
            ? (origin ? new URL(`${origin}${actionUrl}`) : undefined)
            : new URL(actionUrl);
    } catch {
        url = undefined;
    }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return undefined;
    // `|` ends a Slack link's URL part.
    return url.href.replace(/\|/g, '%7C');
}

/**
 * The deployment's public origin, in the order the approval e-mail's link
 * reads it: `OS_AUTH_URL` (legacy `BETTER_AUTH_URL`), then `OS_BASE_URL`; an
 * absolute `http(s)` URL with no trailing slash, else `undefined`.
 */
export function deploymentOrigin(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
    const raw = env.OS_AUTH_URL ?? env.BETTER_AUTH_URL ?? env.OS_BASE_URL;
    if (!raw?.trim()) return undefined;
    try {
        const url = new URL(raw.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
        return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
        return undefined;
    }
}
