// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';
import type {
    ChannelAvailability,
    ChannelAvailabilityQuery,
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

/** The user identity object a recipient id is resolved to an address against (re-exported from the locale seam, #13881). */
export { USER_OBJECT };

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
        /**
         * Structural mirror of `SendEmailInput.organizationId` (#11741) —
         * the tenant stamp for `sys_email.organization_id`, threaded from
         * `delivery.notification.organizationId` when the delivery holds
         * one. Optional: an org-less delivery sends without it.
         */
        organizationId?: string;
    }): Promise<{ id?: string } | unknown>;
    /**
     * Structural mirror of `IEmailService.sendTemplate` (#9205) — resolves a
     * `sys_email_template` bundle by `(template, locale)` with the documented
     * en-US fallback ladder, renders it against `data`, and delivers. OPTIONAL
     * because this is a structural view of a service resolved at runtime: an
     * older or third-party email implementation may not provide it, and a
     * delivery that needs it then fails LOUDLY on the delivery row rather than
     * degrading to unlocalized content (declared = enforced, ADR-0049).
     */
    sendTemplate?(input: {
        template: string;
        to: string | string[];
        data?: Record<string, unknown>;
        locale?: string;
        /** Same tenant stamp as on `send` (#11741) — forwarded by the email service into the send it performs. */
        organizationId?: string;
    }): Promise<{ id?: string; status?: string; error?: string } | unknown>;
    /**
     * Structural mirror of `IEmailService.renderTemplate` (#9225) — resolves a
     * `sys_email_template` bundle by `(template, locale)` with the same
     * documented en-US ladder as `sendTemplate` and returns the rendered
     * content WITHOUT sending. OPTIONAL for the same reason `sendTemplate` is:
     * an older or third-party email implementation may not provide it, and a
     * consumer that needs it (the inbox channel's template path) then fails
     * LOUDLY on the delivery row rather than degrading silently
     * (declared = enforced, ADR-0049).
     */
    renderTemplate?(input: {
        template: string;
        data?: Record<string, unknown>;
        locale?: string;
    }): Promise<{ subject: string; html: string; text: string }>;
}

export interface EmailChannelOptions {
    /**
     * Resolve the email service; `undefined` ⇒ there is no transport, which
     * {@link MessagingChannel.isAvailable} reports as
     * `transport_not_configured` and {@link MessagingChannel.send} REFUSES with
     * the same reason (#18424). ⛔ Not a no-op success: a delivery nothing was
     * sent for is never reported as delivered.
     */
    getEmail(): EmailSenderSurface | undefined;
    /** Resolve the data engine (recipient address lookup). */
    getData(): IDataEngine | undefined;
    /** Template store for `(topic, 'email', locale)` rendering. */
    store: NotificationTemplateStore;
    /** User identity object override (default {@link USER_OBJECT}). */
    userObject?: string;
    /** Locale used when the delivery carries none (default {@link DEFAULT_LOCALE}). */
    defaultLocale?: string;
    /**
     * The DEPLOYMENT DEFAULT locale — `II18nService.getDefaultLocale()`,
     * probed lazily at delivery time so it tracks live settings changes and
     * a late-registered i18n service.
     *
     * Since #13881 (maintainer ruling 2026-09-01) this is the SECOND rung of
     * the recipient-locale chain, not the whole of it: the first is the
     * recipient's own `sys_user.locale`, read off the same row the address
     * comes from, and the two are composed in ONE place —
     * `recipient-locale.ts` (`resolveRecipientLocale`). The 2026-08-13
     * deferral that made this the whole answer lifted when hotcrm measured
     * the pull. Request-scoped locale (`Accept-Language`) still does not
     * exist at async delivery time and is not a rung.
     */
    getDefaultTemplateLocale?(): string | undefined;
}

/**
 * The ONE token both members of this channel use for "there is no transport"
 * (#18424) — the reason `isAvailable()` already returns, reused verbatim so the
 * refusal `send()` writes onto the delivery row and the suppression fan-out
 * records on `sys_notification.suppressed_channels` name the same condition.
 *
 * ⛔ Deliberately NOT a new error code. The vocabulary is the closed
 * `CHANNEL_UNAVAILABLE_REASONS` set in `channel.ts`, and the annotation is what
 * holds this constant inside it: a token nobody declared would not compile
 * here, so the two spellings cannot drift apart silently.
 *
 * It leads the error string because `classifyError` below reads the row's error
 * text, and the same convention already applies to `sendTemplate`'s codes.
 */
const TRANSPORT_NOT_CONFIGURED: ChannelUnavailableReason = 'transport_not_configured';

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
 * A delivery whose payload carries a `template` reference (a `notify` node's
 * localizable path, #9205) takes precedence over both: it routes through
 * `IEmailService.sendTemplate({ template, locale, data })`, which resolves the
 * `sys_email_template` bundle by `(name, recipient locale)`.
 *
 * The recipient locale is resolved HERE, per recipient, after fan-out
 * (#13881, maintainer ruling 2026-09-01): the recipient's own
 * `sys_user.locale` — read off the same row the address comes from — else the
 * deployment default from {@link EmailChannelOptions.getDefaultTemplateLocale};
 * absent/empty/malformed always falls back and never dead-letters. Both arms
 * of this channel (the `sendTemplate` path and the `sys_notification_template`
 * path) use that one resolution. A producer-set `payload.locale` — the
 * pre-ruling single value for the whole notification — is no longer consulted.
 *
 * Failure is always REPORTED, never absorbed (#18424): no email service ⇒ a
 * refusal carrying the declared `transport_not_configured` reason, graded
 * `permanent` so the row dead-letters on attempt one; a recipient with no
 * resolvable address ⇒ a reported failure. Either way the delivery row shows
 * why — ⛔ nothing this channel did not send is recorded as delivered.
 */
export function createEmailChannel(opts: EmailChannelOptions): MessagingChannel {
    const userObject = opts.userObject ?? USER_OBJECT;
    const defaultLocale = opts.defaultLocale ?? DEFAULT_LOCALE;

    const deploymentLocale = (): string | undefined => opts.getDefaultTemplateLocale?.();

    /**
     * The recipient, resolved ONCE per delivery: the address to send to and
     * the locale to render in (#13881 — one `sys_user` read yields both, so
     * the per-recipient locale costs no second query).
     */
    interface ResolvedRecipient {
        address: string;
        /** Already composed with the deployment default; `undefined` ⇒ the ladders' documented floor. */
        locale: string | undefined;
    }

    async function resolveRecipient(
        ctx: MessagingChannelContext,
        data: IDataEngine | undefined,
        recipient: string,
    ): Promise<ResolvedRecipient | undefined> {
        if (EMAIL_SHAPE(recipient)) {
            // A literal address has no `sys_user` row to read a locale from —
            // for it the deployment default is the whole chain.
            return { address: recipient, locale: resolveRecipientLocale(undefined, deploymentLocale) };
        }
        if (!data) return undefined;
        let user: Record<string, unknown> | null | undefined;
        // Set only when the row was read WITH the locale projection: after a
        // retry the column was never asked for, so whatever the row carries
        // under that key is not a read — rung 2 applies.
        let localeRead = false;
        try {
            user = await data.findOne(userObject, {
                where: { id: recipient },
                fields: ['email', RECIPIENT_LOCALE_FIELD],
            });
            localeRead = true;
        } catch (err) {
            // Ruling item 3: NO path may dead-letter because of the locale
            // read. A `userObject` override that lacks the column must still
            // deliver — retry the address alone and fall to the deployment
            // default. Said once per delivery, at `warn`, because the loss is
            // functional (a language), not durability.
            ctx.logger.warn(
                `[email] recipient lookup for '${recipient}' with '${RECIPIENT_LOCALE_FIELD}' failed (${(err as Error).message}); retrying address-only`,
            );
            try {
                user = await data.findOne(userObject, { where: { id: recipient }, fields: ['email'] });
            } catch (retryErr) {
                ctx.logger.warn(`[email] address lookup for '${recipient}' failed (${(retryErr as Error).message})`);
                return undefined;
            }
        }
        const email = user?.email;
        if (!(typeof email === 'string' && EMAIL_SHAPE(email))) return undefined;
        return {
            address: email,
            locale: resolveRecipientLocale(localeRead ? user?.[RECIPIENT_LOCALE_FIELD] : undefined, deploymentLocale),
        };
    }

    return {
        id: 'email',

        /**
         * Can this tenant send mail at all? (ruling on #17732 item 3.)
         *
         * Answered from the composition's transport configuration — the `email`
         * service this channel was handed — and from nothing else. No delivery
         * I/O, no recipient lookup, no settings read: a service-registry
         * closure call, which is why fan-out consults it inline and holds no
         * cache.
         *
         * ## The cost measurement the ruling asked for
         *
         * Mail configuration in this tree is the `mail` settings namespace, and
         * that manifest declares `scope: 'global'`
         * (`packages/services/service-settings/src/manifests/mail.manifest.ts`):
         * one deployment-wide provider/transport, materialised ONCE into a
         * single in-memory `IEmailTransport` on the `EmailService` and
         * hot-swapped by the settings change bus (`EmailServicePlugin`'s
         * `applySettings` → `setTransport`). So there is no per-tenant
         * transport row to read, and the answer costs no round trip at all.
         *
         * ⇒ NO CACHE, for two independent reasons: it would save nothing, and
         * it would be WRONG — a tick-scoped memo would keep answering
         * "unavailable" straight through the settings save that fixed it.
         *
         * The query still takes the tenant context, because the seam outlives
         * this measurement: the day mail configuration becomes tenant-scoped,
         * the answer changes here and no published interface has to move again.
         */
        isAvailable(_ctx: MessagingChannelContext, _query: ChannelAvailabilityQuery): ChannelAvailability {
            // A pure probe: no logging, no I/O, no side effects. The suppression
            // it causes is announced ONCE per emit by the service and recorded
            // durably on `sys_notification.suppressed_channels` — a line per
            // emit here would be the noisy half of an answer already written down.
            return opts.getEmail()
                ? { available: true }
                : { available: false, reason: 'transport_not_configured' };
        },

        async send(ctx: MessagingChannelContext, delivery: Delivery): Promise<SendResult> {
            const email = opts.getEmail();
            if (!email) {
                // [#18424] The SAME condition `isAvailable()` answers above, so
                // it gets the same answer — a refusal naming
                // `transport_not_configured`, ⛔ never `{ ok: true }`.
                //
                // This used to return success ("capability not installed —
                // no-op"), which recorded a delivery nobody performed: the row
                // reached `status: 'success'`, nothing went red, and a
                // deployment with no mail transport reported every notification
                // as delivered. The channel already KNEW it was unavailable.
                //
                // ⛔ Not a suppression either. A suppression is fan-out's
                // pre-write answer, recorded on
                // `sys_notification.suppressed_channels`; by the time `send()`
                // runs the delivery row exists and `SendResult` has no
                // suppression arm. Where both answers are decidable at once —
                // the plugin composition, whose `lazyChannelMount` gates the
                // mount on this very resolver — an absent transport is already
                // a REFUSAL (#18041/#18050), so refusing here is what makes the
                // two compositions answer one condition the same way.
                ctx.logger.warn(
                    `[email] no email service registered; '${delivery.recipient}' was NOT emailed`,
                );
                return {
                    ok: false,
                    error: `${TRANSPORT_NOT_CONFIGURED}: no 'email' service is registered; nothing was sent to '${delivery.recipient}'`,
                };
            }

            const n = delivery.notification;
            const resolved = await resolveRecipient(ctx, opts.getData(), delivery.recipient);
            if (!resolved) {
                return { ok: false, error: `no email address for recipient '${delivery.recipient}'` };
            }
            const { address, locale: recipientLocale } = resolved;

            const payload = (n.payload ?? {}) as Record<string, unknown>;

            // ── The localizable path (#9205): a `notify` node's `template`
            // reference, carried in the payload (snapshotted onto the delivery
            // row by the outbox, so it survives the durable path). Resolution
            // happens HERE, per recipient, because this is the first moment a
            // single recipient exists: `sendTemplate` picks the
            // `(name, recipient locale)` row with its documented en-US ladder
            // and renders `templateData` into the `{{var}}` holes. The
            // recipient locale is the one resolved above (#13881): the
            // recipient's own `sys_user.locale`, else the deployment default.
            const templateName =
                typeof payload.template === 'string' && payload.template.trim()
                    ? payload.template.trim()
                    : undefined;
            if (templateName) {
                if (typeof email.sendTemplate !== 'function') {
                    // Declared ≠ deliverable — fail loudly on the delivery row
                    // rather than silently downgrading to unlocalized content.
                    return {
                        ok: false,
                        error: `TEMPLATE_UNSUPPORTED: notify template '${templateName}' needs an email service with sendTemplate(); the registered 'email' service does not provide it`,
                    };
                }
                const templateLocale = recipientLocale;
                const data = (payload.templateData ?? undefined) as Record<string, unknown> | undefined;
                try {
                    const result = (await email.sendTemplate({
                        template: templateName,
                        to: address,
                        ...(data !== undefined ? { data } : {}),
                        ...(templateLocale ? { locale: templateLocale } : {}),
                        // #11741 — this channel HOLDS the organization (the
                        // tenant stamp the outbox snapshots per delivery), so
                        // it threads it for the sys_email.organization_id
                        // stamp. Absent stays absent — never fabricated.
                        ...(n.organizationId ? { organizationId: n.organizationId } : {}),
                    })) as { id?: unknown; status?: unknown; error?: unknown } | undefined;
                    // `IEmailService.send` reports transport failure as
                    // `status: 'failed'` rather than throwing — surface it.
                    if (result && result.status === 'failed') {
                        return { ok: false, error: String(result.error ?? 'email send failed') };
                    }
                    const id = result?.id;
                    return { ok: true, externalId: id != null ? String(id) : undefined };
                } catch (err) {
                    // sendTemplate's own failure vocabulary (TEMPLATE_NOT_FOUND /
                    // TEMPLATE_INACTIVE / MISSING_VARIABLES) arrives as a thrown
                    // Error — keep the code at the front of the row's error so
                    // classifyError() below can grade it permanent.
                    return { ok: false, error: (err as Error)?.message ?? String(err) };
                }
            }

            // Same per-recipient resolution on the `sys_notification_template`
            // arm (#13881); the store walks its own ladder (`zh-CN` → `zh` →
            // DEFAULT_LOCALE) underneath, so a tag with no row still renders.
            const locale = recipientLocale ?? defaultLocale;
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
                    // #11741 — same threading as the template arm above.
                    ...(n.organizationId ? { organizationId: n.organizationId } : {}),
                });
                const id = result?.id;
                return { ok: true, externalId: id != null ? String(id) : undefined };
            } catch (err) {
                return { ok: false, error: `email send failed: ${(err as Error).message}` };
            }
        },

        classifyError(err: unknown): ErrorClass {
            // #9205 — a template-resolution failure is wrong METADATA, not a
            // transport hiccup: re-trying the identical delivery can never
            // succeed until someone edits the template/node, so grade it
            // permanent (→ dead immediately, with the code on the delivery
            // row) instead of burning the whole retry schedule first. These
            // are `IEmailService.sendTemplate`'s own error codes plus this
            // channel's missing-capability refusal above.
            //
            // [#18424] `transport_not_configured` joins them, and the grade is
            // driven rather than assumed: in the shipping composition the same
            // condition already terminates a claimed row at once — the mount
            // gate unmounts the channel and the dispatcher acks
            // `dead: true, attempts: 1` without consulting this method at all.
            // Grading the refusal `retryable` would make the two compositions
            // answer one condition differently, burning the whole ladder
            // against a transport that no attempt can install.
            const msg = typeof err === 'string' ? err : String((err as Error)?.message ?? err ?? '');
            if (/\b(TEMPLATE_NOT_FOUND|TEMPLATE_INACTIVE|MISSING_VARIABLES|TEMPLATE_UNSUPPORTED)\b/.test(msg)) {
                return 'permanent';
            }
            if (msg.startsWith(`${TRANSPORT_NOT_CONFIGURED}:`)) return 'permanent';
            return 'retryable';
        },
    };
}
