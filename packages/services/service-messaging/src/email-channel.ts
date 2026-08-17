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
    /**
     * The recipient locale for `sys_email_template` resolution (#9205) —
     * probed lazily at delivery time so it tracks live settings changes.
     *
     * The measured source, and its limits, spelled out: the platform has no
     * per-user locale today (`sys_user` carries no locale column; the
     * 2026-08-13 ruling defers one until measured pull), and request-scoped
     * locale (`Accept-Language` → `ExecutionContext.requestLocale`) does not
     * exist at async delivery time. So "recipient locale" resolves to the
     * deployment default — `II18nService.getDefaultLocale()`, the same ruled
     * source the auth emails use (#8195) — and a per-user locale, when it
     * lands, plugs in here.
     */
    getDefaultTemplateLocale?(): string | undefined;
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
 * A delivery whose payload carries a `template` reference (a `notify` node's
 * localizable path, #9205) takes precedence over both: it routes through
 * `IEmailService.sendTemplate({ template, locale, data })`, which resolves the
 * `sys_email_template` bundle by `(name, recipient locale)` — the locale being
 * `payload.locale` if the producer set one, else the deployment default from
 * {@link EmailChannelOptions.getDefaultTemplateLocale}.
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

            // ── The localizable path (#9205): a `notify` node's `template`
            // reference, carried in the payload (snapshotted onto the delivery
            // row by the outbox, so it survives the durable path). Resolution
            // happens HERE, per recipient, because this is the first moment a
            // single recipient exists: `sendTemplate` picks the
            // `(name, recipient locale)` row with its documented en-US ladder
            // and renders `templateData` into the `{{var}}` holes.
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
                const templateLocale = typeof payload.locale === 'string' && payload.locale.trim()
                    ? payload.locale.trim()
                    : opts.getDefaultTemplateLocale?.();
                const data = (payload.templateData ?? undefined) as Record<string, unknown> | undefined;
                try {
                    const result = (await email.sendTemplate({
                        template: templateName,
                        to: address,
                        ...(data !== undefined ? { data } : {}),
                        ...(templateLocale ? { locale: templateLocale } : {}),
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

        classifyError(err: unknown): ErrorClass {
            // #9205 — a template-resolution failure is wrong METADATA, not a
            // transport hiccup: re-trying the identical delivery can never
            // succeed until someone edits the template/node, so grade it
            // permanent (→ dead immediately, with the code on the delivery
            // row) instead of burning the whole retry schedule first. These
            // are `IEmailService.sendTemplate`'s own error codes plus this
            // channel's missing-capability refusal above.
            const msg = typeof err === 'string' ? err : String((err as Error)?.message ?? err ?? '');
            if (/\b(TEMPLATE_NOT_FOUND|TEMPLATE_INACTIVE|MISSING_VARIABLES|TEMPLATE_UNSUPPORTED)\b/.test(msg)) {
                return 'permanent';
            }
            return 'retryable';
        },
    };
}
