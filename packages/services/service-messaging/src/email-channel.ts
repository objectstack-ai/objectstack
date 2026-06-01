// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';
import type {
    Delivery,
    ErrorClass,
    MessagingChannel,
    MessagingChannelContext,
    SendResult,
} from './channel.js';
import {
    NotificationTemplateStore,
    renderNotification,
    DEFAULT_LOCALE,
} from './template-renderer.js';

/** The user identity object a recipient id is resolved to an address against. */
export const USER_OBJECT = 'sys_user';

/**
 * Structural view of the email service (`@objectstack/plugin-email`'s
 * `EmailService`), declared locally so service-messaging takes no runtime
 * dependency on it — the channel resolves whatever is registered under the
 * `email` service and sends through this shape (mirrors the `notify` node's
 * `MessagingServiceSurface` pattern).
 */
export interface EmailSenderSurface {
    send(input: {
        to: string | string[];
        subject: string;
        html?: string;
        text?: string;
    }): Promise<{ id?: string } | unknown>;
}

export interface EmailChannelOptions {
    /** Resolve the email service; `undefined` ⇒ the channel no-ops (not installed). */
    getEmail(): EmailSenderSurface | undefined;
    /** Resolve the data engine (recipient address lookup). */
    getData(): IDataEngine | undefined;
    /** Template store for `(topic, 'email', locale)` rendering. */
    store: NotificationTemplateStore;
    /** User identity object override (default {@link USER_OBJECT}). */
    userObject?: string;
    /** Locale used when the delivery carries none (default {@link DEFAULT_LOCALE}). */
    defaultLocale?: string;
}

const EMAIL_SHAPE = (s: string): boolean => {
    // Linear, non-backtracking "looks like an email" — same shape as the
    // recipient resolver's check (avoids the ReDoS-prone regex).
    if (!s || /\s/.test(s)) return false;
    const at = s.indexOf('@');
    if (at <= 0 || at !== s.lastIndexOf('@') || at === s.length - 1) return false;
    const dot = s.slice(at + 1).indexOf('.');
    return dot > 0 && dot < s.length - at - 2;
};

/**
 * The `email` channel (ADR-0030 P3) — delivers a notification by email.
 *
 * It adds only the messaging semantics on top of the existing email transport
 * (ADR-0022 "channel delegates transport to a sub-system"): resolve the
 * recipient's address, render `(topic, 'email', locale)` from
 * `sys_notification_template` (fallback to `payload.title`/`body`), and hand the
 * subject/body to the `email` service. Retry/backoff/dead-letter come for free
 * from the P1 outbox dispatcher.
 *
 * Degrades like the inbox channel: no email service ⇒ logged no-op success
 * (capability not installed); a recipient with no resolvable address ⇒ a
 * reported failure (so the delivery row shows why).
 */
export function createEmailChannel(opts: EmailChannelOptions): MessagingChannel {
    const userObject = opts.userObject ?? USER_OBJECT;
    const defaultLocale = opts.defaultLocale ?? DEFAULT_LOCALE;

    async function resolveAddress(
        ctx: MessagingChannelContext,
        data: IDataEngine | undefined,
        recipient: string,
    ): Promise<string | undefined> {
        if (EMAIL_SHAPE(recipient)) return recipient; // already an address
        if (!data) return undefined;
        try {
            const user = await data.findOne(userObject, { where: { id: recipient }, fields: ['email'] });
            const email = user?.email;
            return typeof email === 'string' && EMAIL_SHAPE(email) ? email : undefined;
        } catch (err) {
            ctx.logger.warn(`[email] address lookup for '${recipient}' failed (${(err as Error).message})`);
            return undefined;
        }
    }

    return {
        id: 'email',

        async send(ctx: MessagingChannelContext, delivery: Delivery): Promise<SendResult> {
            const email = opts.getEmail();
            if (!email) {
                ctx.logger.warn(`[email] no email service registered; '${delivery.recipient}' not emailed`);
                return { ok: true }; // capability not installed — no-op, like inbox w/o data
            }

            const n = delivery.notification;
            const address = await resolveAddress(ctx, opts.getData(), delivery.recipient);
            if (!address) {
                return { ok: false, error: `no email address for recipient '${delivery.recipient}'` };
            }

            const payload = (n.payload ?? {}) as Record<string, unknown>;
            const locale = typeof payload.locale === 'string' ? payload.locale : defaultLocale;
            const template = await opts.store.load(n.topic ?? '', 'email', locale);
            const rendered = renderNotification(template, {
                topic: n.topic ?? '',
                payload,
                title: n.title,
                body: n.body,
            });

            try {
                const result: any = await email.send({
                    to: address,
                    subject: rendered.subject,
                    ...(rendered.html !== undefined ? { html: rendered.html } : {}),
                    ...(rendered.text !== undefined ? { text: rendered.text } : {}),
                });
                const id = result?.id;
                return { ok: true, externalId: id != null ? String(id) : undefined };
            } catch (err) {
                return { ok: false, error: `email send failed: ${(err as Error).message}` };
            }
        },

        classifyError(_err: unknown): ErrorClass {
            return 'retryable';
        },
    };
}
