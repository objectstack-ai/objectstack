// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';
import type {
    ChannelUnavailableReason,
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
    /**
     * Resolve the SMS service; `undefined` ⇒ there is no transport, which
     * {@link MessagingChannel.send} REFUSES with the declared
     * `transport_not_configured` reason (#18424). ⛔ Not a no-op success: a
     * delivery nothing was sent for is never reported as delivered.
     */
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
 * The ONE token used for "there is no transport" (#18424) — the same value the
 * email channel's `isAvailable()` returns, so the refusal this channel writes
 * onto a delivery row and the suppression fan-out records on
 * `sys_notification.suppressed_channels` name one condition.
 *
 * ⛔ Deliberately NOT a new error code. The vocabulary is the closed
 * `CHANNEL_UNAVAILABLE_REASONS` set in `channel.ts`, and the annotation is what
 * holds this constant inside it: a token nobody declared would not compile
 * here, so the spellings cannot drift apart silently.
 *
 * It leads the error string because `classifyError` below reads the row's error
 * text — the same convention {@link SMS_QUOTA_EXCEEDED_CODE} already relies on.
 */
const TRANSPORT_NOT_CONFIGURED: ChannelUnavailableReason = 'transport_not_configured';

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
 * Failure is always REPORTED, never absorbed (#18424): no sms service ⇒ a
 * refusal carrying the declared `transport_not_configured` reason, graded
 * `permanent` so the row dead-letters on attempt one; a recipient with no
 * resolvable phone number ⇒ a reported failure. Either way the delivery row
 * shows why — ⛔ nothing this channel did not send is recorded as delivered.
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
        // Set only when the row was read WITH the locale projection — after a
        // retry the column was never asked for, so rung 2 applies.
        let localeRead = false;
        try {
            user = await data.findOne(userObject, {
                where: { id: recipient },
                fields: ['phone_number', RECIPIENT_LOCALE_FIELD],
            });
            localeRead = true;
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
        return {
            phone,
            locale: resolveRecipientLocale(localeRead ? user?.[RECIPIENT_LOCALE_FIELD] : undefined, deploymentLocale),
        };
    }

    return {
        id: 'sms',

        async send(ctx: MessagingChannelContext, delivery: Delivery): Promise<SendResult> {
            const sms = opts.getSms();
            if (!sms) {
                // [#18424] A refusal, ⛔ never `{ ok: true }`. This used to
                // return success ("capability not installed — no-op"), which
                // recorded a delivery nobody performed: the row reached
                // `status: 'success'`, nothing went red, and a deployment with
                // no SMS transport reported every notification as delivered.
                //
                // ⛔ Not a suppression either. A suppression is fan-out's
                // pre-write answer on `sys_notification.suppressed_channels`;
                // by the time `send()` runs the delivery row exists and
                // `SendResult` has no suppression arm. Where both answers are
                // decidable at once — the plugin composition, whose
                // `lazyChannelMount` gates the mount on this very resolver — an
                // absent transport is already a REFUSAL (#18041/#18050), so
                // refusing here is what makes the two compositions answer one
                // condition the same way.
                ctx.logger.warn(`[sms] no sms service registered; '${delivery.recipient}' was NOT messaged`);
                return {
                    ok: false,
                    error: `${TRANSPORT_NOT_CONFIGURED}: no 'sms' service is registered; nothing was sent to '${delivery.recipient}'`,
                };
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
            // [#18424] The grade is driven rather than assumed: in the shipping
            // composition the same condition already terminates a claimed row
            // at once — the mount gate unmounts the channel and the dispatcher
            // acks `dead: true, attempts: 1` without consulting this method at
            // all. Grading the refusal `retryable` would make the two
            // compositions answer one condition differently, burning the whole
            // ladder against a transport that no attempt can install.
            if (text.startsWith(`${TRANSPORT_NOT_CONFIGURED}:`)) return 'permanent';
            return 'retryable';
        },
    };
}
