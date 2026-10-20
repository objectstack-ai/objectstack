// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * The channels that READ a `sys_notification_template` row — the closed set
 * `channel` accepts (the maintainer's ruling D on #24770: narrow templates to
 * the channels that render them).
 *
 * Measured, not assumed — the readers are exactly three, all keyed on one of
 * these two values:
 *
 *  - the `email` channel, on its inline path only (`email-channel.ts`: a
 *    notification naming an email template takes `sendTemplate` and returns
 *    before the store is read);
 *  - the `sms` channel (`sms-channel.ts`), whether or not the notification
 *    names an email template — it has no template path of its own;
 *  - plugin-auth's phone OTP / invitation SMS (`phone-sms-texts.ts`,
 *    `channel: 'sms'`).
 *
 * The inbox reads no row on any path (`createInboxChannel` takes no store); its
 * localised content is the `email_template` a notify step names in `template`,
 * rendered through `IEmailService.renderTemplate`. So a row naming any other
 * channel is stored and rendered nowhere — the silent no-op the ruling turns
 * into a refusal at write.
 */
const TEMPLATE_CHANNELS = ['email', 'sms'] as const;

/**
 * `sys_notification_template` — the email / SMS render template (ADR-0030
 * cross-cutting / P3).
 *
 * One row per `(topic, channel, locale)` carrying the `subject`/`body` a channel
 * renders from the event `payload` (declarative `{{ payload.x }}` interpolation
 * — see `template-renderer.ts`). `format` tells the channel how to treat `body`
 * (markdown/html/text). When no template matches, channels fall back to
 * `payload.title` / `payload.body` (the P0/P1 behavior), so templates are purely
 * additive. `channel` is one of {@link TEMPLATE_CHANNELS}; see there for who
 * reads a row and why no other value is accepted.
 *
 * Studio-configurable (contributed to the Setup → Configuration nav). Belongs to
 * `service-messaging`.
 */
export const NotificationTemplate = ObjectSchema.create({
    name: 'sys_notification_template',
    label: 'Notification Template',
    pluralLabel: 'Notification Templates',
    icon: 'file-text',
    isSystem: true,
    // [ADR-0103, #3355] Admin-writable DATA on a platform-defined schema: authored
    // from the Setup "Notification Templates" grid. The bucket default is full
    // CRUD, so no `userActions` block is needed — affordance is a declaration
    // only; permission sets remain the authz.
    managedBy: 'system-data',
    // Admin-facing copy; one row per (topic, channel, locale) — see the docblock.
    // It names the two channels that read a row and says the inbox reads none
    // (TEMPLATE_CHANNELS above is the measurement behind both halves).
    description: 'The email and SMS text each notification topic sends, per language. The in-app inbox never uses these templates.',
    titleFormat: '{topic} · {channel} · {locale}',
    highlightFields: ['topic', 'channel', 'locale', 'is_active'],

    // The one list view this object ships, declared for its `emptyState`: with
    // no view at all the console synthesizes an "All records" tab and draws
    // the generic "Nothing here yet" under it, which says nothing about what
    // belongs on this page. `columns: []` declares no projection on purpose —
    // the spec's "left to the renderer" form — so the grid keeps exactly the
    // columns it derived from `highlightFields` before this view existed, and
    // the view adds no filter, sort or page size of its own.
    listViews: {
        all: {
            type: 'grid',
            name: 'all',
            label: 'All',
            data: { provider: 'object', object: 'sys_notification_template' },
            columns: [],
            // Which channels read a row, what they send without one, and what
            // a notification naming an email template does: email and the
            // inbox render that email template and skip these rows, while SMS
            // has no template path and still reads its row here.
            emptyState: {
                title: 'No templates yet',
                message: 'Add a template per topic, channel (email or SMS) and language; until then, those channels send the title and body the notification carries. In-app content comes from an email template: a notification that names one sends it by email and in the inbox, and SMS still uses the template here.',
            },
        },
    },

    fields: {
        id: Field.text({ label: 'Template ID', required: true, readonly: true }),

        topic: Field.text({
            label: 'Topic',
            required: true,
            searchable: true,
            // [commit e4902d2b9] Sibling-declaration bound (route A, ruling 2026-08-24): template
            // topics are matched against the event's `sys_notification.topic`
            // (maxLength: 200 there).
            maxLength: 200,
        }),

        channel: Field.text({
            label: 'Channel',
            required: true,
            defaultValue: 'email',
            // [commit e4902d2b9] Machine channel-id vocabulary (route A, ruling 2026-08-24), same
            // sourcing as `sys_notification_delivery.channel`: registered
            // `MessagingChannel.id`s, 64 per the landed machine-vocabulary
            // precedent (sys_session.revoke_reason, maxLength: 64).
            maxLength: 64,
            // [#24924] The accepted values are TEMPLATE_CHANNELS, enforced by
            // the `channel_renders_template` rule below. The field stays `text`
            // on purpose — see that rule for why a `select` is not the spelling.
            description: 'Which channel uses this template: email or sms. The in-app inbox never does; for in-app content, write an email template and name it in the notification\'s template.',
        }),

        locale: Field.text({
            label: 'Locale',
            required: true,
            defaultValue: 'en',
            // [commit e4902d2b9] Sibling-declaration bound (route A, ruling 2026-08-24): the same
            // BCP-47 tag family `sys_email_template.locale` stores, bounded 16
            // there. The BOUND is shared; the RESOLUTION is not, and neither
            // side picks a "best-matching" locale. This object is loaded by
            // `NotificationTemplateStore` on `(topic, channel, locale)` and
            // walks a fixed candidate list — the named tag, then its primary
            // subtag (`zh-CN` -> `zh`), then `DEFAULT_LOCALE` ('en').
            // `sys_email_template` matches `(name, locale)` EXACTLY, folds no
            // subtag at all, and retries the single literal rung `en-US`.
            maxLength: 16,
            description: "BCP-47 locale, e.g. 'en' / 'en-US' / 'zh-CN'.",
        }),

        version: Field.number({
            label: 'Version',
            required: false,
            defaultValue: 1,
        }),

        subject: Field.text({
            label: 'Subject / Title',
            required: false,
            // The inbox reads no row, so this is the email subject; the SMS
            // channel sends the body, falling back to this only when the
            // rendered body is empty (`sms-channel.ts`).
            description: 'The email subject; an SMS sends it only when the body is empty. Supports {{ payload.x }}.',
        }),

        body: Field.markdown({
            label: 'Body',
            required: false,
            description: 'Template body. Supports {{ payload.x }}. Interpreted per `format`.',
        }),

        format: Field.select(['markdown', 'html', 'text', 'mjml'], {
            label: 'Body Format',
            required: false,
            defaultValue: 'markdown',
        }),

        is_active: Field.boolean({
            label: 'Active',
            defaultValue: true,
            description: 'Only active templates are selected at render time.',
        }),

        created_at: Field.datetime({ label: 'Created At', readonly: true }),
        updated_at: Field.datetime({ label: 'Updated At', required: false }),
    },

    indexes: [
        { fields: ['topic', 'channel', 'locale'] },
        { fields: ['topic'] },
    ],

    // [#24924] The closed `channel` set, refused at write with the prescription
    // the ruling asks for. objectql's rule validator runs `validations` on
    // insert, by-id update and bulk update — the import runner's writes
    // included — so no write reaches the column without passing here.
    //
    // A `format` rule judges the WRITE, never the stored row: it reads only
    // a payload that names `channel` (`checkFormat` returns early otherwise),
    // so a row already stored with another channel keeps reading, listing,
    // deleting and saving every other column exactly as before — and keeps
    // rendering nowhere, as it always did. A save that NAMES another channel
    // (a new row, a change of channel, or a client re-sending the stored
    // value) is refused.
    //
    // Why not a `select` with options `email` / `sms`, measured at this
    // commit:
    //  - its refusal is the generic catalog sentence ("Channel must be one
    //    of: email, sms"), keyed by message key only — no per-field override
    //    exists, so it cannot carry the email-template prescription;
    //  - an import with `createMissingOptions` admits a value outside a
    //    select's options (`keptOptionValues`), so the closed set would leak
    //    through the import door;
    //  - Setup's select widget (objectui `SelectField`, at the console pin)
    //    clears on load a stored value its options do not offer, so editing
    //    ANY column of a stored `inbox` row would save `channel: null` and be
    //    refused as a cleared required field — a stored-row path newly
    //    refused, which the release rule for narrowings keeps out of 18.x;
    //  - a select carries no `maxLength`, so the column's physical width and
    //    its keyed-text bound would move with it.
    validations: [
        {
            type: 'format',
            name: 'channel_renders_template',
            label: 'Channel renders the template',
            description: 'Only the email and SMS channels read a notification template, so a template for any other channel would never be sent.',
            field: 'channel',
            regex: `^(?:${TEMPLATE_CHANNELS.join('|')})$`,
            severity: 'error',
            message: 'Channel must be email or sms: only those channels use a notification template, and a template for any other channel is never sent. For in-app (inbox) content, write an email template (email_template) and name it in the notify step\'s template; email and the inbox both render it.',
        },
    ],
});
