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
import { RECIPIENT_LOCALE_FIELD, USER_OBJECT, resolveRecipientLocale } from './recipient-locale.js';

/**
 * Structural view of the SMS service (`@objectstack/service-sms`'s
 * `SmsService`), declared locally so service-messaging takes no runtime
 * dependency on it — the channel resolves whatever is registered under the
 * `sms` service and sends through this shape (mirrors `EmailSenderSurface`
 * in email-channel.ts).
 */
export interface SmsSenderSurface {
    send(input: {
        to: string;
        body: string;
        templateId?: string;
        templateParams?: Record<string, string>;
    }): Promise<{ id?: string; status?: string; messageId?: string; error?: string } | unknown>;
}

export interface SmsChannelOptions {
    /** Resolve the SMS service; `undefined` ⇒ the channel no-ops (not installed). */
    getSms(): SmsSenderSurface | undefined;
    /** Resolve the data engine (recipient phone-number lookup). */
    getData(): IDataEngine | undefined;
    /** Template store for `(topic, 'sms', locale)` rendering. */
    store: NotificationTemplateStore;
    /** User identity object override (default `sys_user`). */
    userObject?: string;
    /** Locale used when neither the recipient nor the deployment names one (default {@link DEFAULT_LOCALE}). */
    defaultLocale?: string;
    /**
     * The DEPLOYMENT DEFAULT locale (`II18nService.getDefaultLocale()`),
     * probed lazily — the second rung under the recipient's own
     * `sys_user.locale` (#13881), composed in `recipient-locale.ts` exactly as
     * the email channel composes it.
     */
    getDefaultTemplateLocale?(): string | undefined;
}

// Same shape rule as plugin-auth's `normalizePhoneNumber` (kept local; the
// packages must not depend on each other): 6-15 digits, optional leading `+`,
// after stripping common human separators.
const PHONE_SHAPE = (s: string): string | undefined => {
    const stripped = String(s ?? '').replace(/[\s\-().]/g, '');
    return /^\+?[0-9]{6,15}$/.test(stripped) ? stripped : undefined;
};

/**
 * The code `@objectstack/service-sms` prefixes onto `SendSmsResult.error` when
 * the deployment's daily send quota is exhausted (`SMS_QUOTA_EXCEEDED_CODE`,
 * #2814). Spelled locally for the SAME reason as `PHONE_SHAPE` above — this
 * package deliberately takes no dependency on service-sms and resolves whatever
 * is registered under the `sms` service — and pinned from both ends: the
 * producer exports the constant, and `sms-channel.test.ts` asserts this literal
 * still classifies as `rate_limited`.
 *
 * It matters that this is not classified `retryable`: an exhausted daily budget
 * is not a transient transport hiccup, and the outbox's retry ladder should
 * back off rather than burn attempts against a wall that only opens at 00:00
 * UTC.
 */
const SMS_QUOTA_EXCEEDED_CODE = 'TOO_MANY_REQUESTS';

/**
 * The `sms` channel (#2780) — delivers a notification by SMS.
 *
 * Mirrors the email channel (ADR-0022 "channel delegates transport to a
 * sub-system"): resolve the recipient's phone number (a literal number is
 * used as-is; otherwise `sys_user.phone_number`), render
 * `(topic, 'sms', locale)` from `sys_notification_template` (fallback to
 * `payload.title`/`body`), and hand the text to the `sms` service.
 * Retry/backoff/dead-letter come for free from the P1 outbox dispatcher.
 *
 * Degrades like the email channel: no sms service ⇒ logged no-op success
 * (capability not installed); a recipient with no resolvable phone number ⇒
 * a reported failure (so the delivery row shows why).
 */
export function createSmsChannel(opts: SmsChannelOptions): MessagingChannel {
    const userObject = opts.userObject ?? USER_OBJECT;
    const defaultLocale = opts.defaultLocale ?? DEFAULT_LOCALE;

    const deploymentLocale = (): string | undefined => opts.getDefaultTemplateLocale?.();

    /**
     * The recipient, resolved ONCE per delivery: the number to text and the
     * locale to render in (#13881 — one `sys_user` read yields both).
     */
    async function resolveRecipient(
        ctx: MessagingChannelContext,
        data: IDataEngine | undefined,
        recipient: string,
    ): Promise<{ phone: string; locale: string | undefined } | undefined> {
        const literal = PHONE_SHAPE(recipient);
        if (literal) {
            // A literal number has no `sys_user` row to read a locale from.
            return { phone: literal, locale: resolveRecipientLocale(undefined, deploymentLocale) };
        }
        if (!data) return undefined;
        let user: Record<string, unknown> | null | undefined;
        try {
            user = await data.findOne(userObject, {
                where: { id: recipient },
                fields: ['phone_number', RECIPIENT_LOCALE_FIELD],
            });
        } catch (err) {
            // Ruling item 3 (#13881): the locale read must never cost the
            // delivery — retry the number alone, fall to the deployment default.
            ctx.logger.warn(
                `[sms] recipient lookup for '${recipient}' with '${RECIPIENT_LOCALE_FIELD}' failed (${(err as Error).message}); retrying phone-only`,
            );
            try {
                user = await data.findOne(userObject, { where: { id: recipient }, fields: ['phone_number'] });
            } catch (retryErr) {
                ctx.logger.warn(`[sms] phone lookup for '${recipient}' failed (${(retryErr as Error).message})`);
                return undefined;
            }
        }
        const raw = user?.phone_number;
        const phone = typeof raw === 'string' ? PHONE_SHAPE(raw) : undefined;
        if (!phone) return undefined;
        return { phone, locale: resolveRecipientLocale(user?.[RECIPIENT_LOCALE_FIELD], deploymentLocale) };
    }

    return {
        id: 'sms',

        async send(ctx: MessagingChannelContext, delivery: Delivery): Promise<SendResult> {
            const sms = opts.getSms();
            if (!sms) {
                ctx.logger.warn(`[sms] no sms service registered; '${delivery.recipient}' not messaged`);
                return { ok: true }; // capability not installed — no-op, like email w/o service
            }

            const n = delivery.notification;
            const resolved = await resolveRecipient(ctx, opts.getData(), delivery.recipient);
            if (!resolved) {
                return { ok: false, error: `no phone number for recipient '${delivery.recipient}'` };
            }
            const { phone } = resolved;

            const payload = (n.payload ?? {}) as Record<string, unknown>;
            // Per-recipient locale (#13881): the recipient's own
            // `sys_user.locale`, else the deployment default, else this
            // channel's static default; the store walks its own ladder
            // underneath. `payload.locale` is no longer consulted.
            const locale = resolved.locale ?? defaultLocale;
            const template = await opts.store.load(n.topic ?? '', 'sms', locale);
            const rendered = renderNotification(template, {
                topic: n.topic ?? '',
                payload,
                title: n.title,
                body: n.body,
            });

            // SMS is a single short text: the rendered body wins; a
            // body-less notification falls back to its title/subject.
            const body = rendered.text?.trim() || rendered.subject?.trim() || '';
            if (!body) {
                return { ok: false, error: 'notification rendered to an empty SMS body' };
            }

            try {
                const result: any = await sms.send({
                    to: phone,
                    body,
                    // Template-only providers (Aliyun) substitute the whole text
                    // into a catch-all `${content}` template by default.
                    templateParams: { content: body },
                });
                if (result?.status === 'failed') {
                    return { ok: false, error: `sms send failed: ${result?.error ?? 'unknown error'}` };
                }
                const id = result?.messageId ?? result?.id;
                return { ok: true, externalId: id != null ? String(id) : undefined };
            } catch (err) {
                return { ok: false, error: `sms send failed: ${(err as Error).message}` };
            }
        },

        classifyError(err: unknown): ErrorClass {
            // The dispatcher hands this `SendResult.error` — the string built
            // above — not a thrown Error, so the quota refusal arrives as
            // `sms send failed: TOO_MANY_REQUESTS: …`.
            const text = err instanceof Error ? err.message : String(err ?? '');
            if (text.includes(SMS_QUOTA_EXCEEDED_CODE)) return 'rate_limited';
            return 'retryable';
        },
    };
}
