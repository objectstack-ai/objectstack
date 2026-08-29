// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `sys_notification_template` — channel-agnostic render template (ADR-0030
 * cross-cutting / P3).
 *
 * One row per `(topic, channel, locale)` carrying the `subject`/`body` a channel
 * renders from the event `payload` (declarative `{{ payload.x }}` interpolation
 * — see `template-renderer.ts`). `format` tells the channel how to treat `body`
 * (markdown/html/text). When no template matches, channels fall back to
 * `payload.title` / `payload.body` (the P0/P1 behavior), so templates are purely
 * additive.
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
    description: 'Per (topic × channel × locale) render template for notifications.',
    titleFormat: '{topic} · {channel} · {locale}',
    highlightFields: ['topic', 'channel', 'locale', 'is_active'],

    fields: {
        id: Field.text({ label: 'Template ID', required: true, readonly: true }),

        topic: Field.text({
            label: 'Topic',
            required: true,
            searchable: true,
            // [#12978] Sibling-declaration bound (#11374 route A): template
            // topics are matched against the event's `sys_notification.topic`
            // (maxLength: 200 there).
            maxLength: 200,
        }),

        channel: Field.text({
            label: 'Channel',
            required: true,
            defaultValue: 'email',
            // [#12978] Machine channel-id vocabulary (#11374 route A), same
            // sourcing as `sys_notification_delivery.channel`: registered
            // `MessagingChannel.id`s, 64 per the landed machine-vocabulary
            // precedent (sys_session.revoke_reason, maxLength: 64).
            maxLength: 64,
            description: 'Channel id this template renders for (email/inbox/push/…).',
        }),

        locale: Field.text({
            label: 'Locale',
            required: true,
            defaultValue: 'en',
            // [#12978] Sibling-declaration bound (#11374 route A): the same
            // BCP-47 tag family `sys_email_template.locale` stores, bounded 16
            // there; both resolve a template by best-matching locale.
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
            description: 'Rendered into the email subject / inbox title. Supports {{ payload.x }}.',
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
});
