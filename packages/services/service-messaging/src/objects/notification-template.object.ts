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
    managedBy: 'system',
    description: 'Per (topic × channel × locale) render template for notifications.',
    titleFormat: '{topic} · {channel} · {locale}',
    compactLayout: ['topic', 'channel', 'locale', 'is_active'],

    fields: {
        id: Field.text({ label: 'Template ID', required: true, readonly: true }),

        topic: Field.text({ label: 'Topic', required: true, searchable: true }),

        channel: Field.text({
            label: 'Channel',
            required: true,
            defaultValue: 'email',
            description: 'Channel id this template renders for (email/inbox/push/…).',
        }),

        locale: Field.text({
            label: 'Locale',
            required: true,
            defaultValue: 'en',
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
