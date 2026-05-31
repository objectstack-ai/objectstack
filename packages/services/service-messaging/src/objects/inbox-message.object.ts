// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `sys_inbox_message` — user-facing in-app notification rows (ADR-0012 §4, §11).
 *
 * Written by the always-on `inbox` messaging channel, one row per
 * `(notification, recipient)`. The client pulls these for the in-app inbox;
 * `service-realtime` decides when to ping an online user. Belongs to
 * `service-messaging` per the "protocol + service ownership" pattern.
 */
export const InboxMessage = ObjectSchema.create({
    name: 'sys_inbox_message',
    label: 'Inbox Message',
    pluralLabel: 'Inbox Messages',
    icon: 'inbox',
    description: 'User-facing in-app notification rows written by the inbox messaging channel.',
    titleFormat: '{title}',
    compactLayout: ['title', 'user_id', 'severity', 'read', 'created_at'],

    fields: {
        id: Field.text({
            label: 'Inbox Message ID',
            required: true,
            readonly: true,
        }),

        user_id: Field.text({
            label: 'Recipient User',
            required: true,
            searchable: true,
        }),

        topic: Field.text({
            label: 'Topic',
            searchable: true,
        }),

        title: Field.text({
            label: 'Title',
            required: true,
        }),

        body_md: Field.markdown({
            label: 'Body',
        }),

        severity: Field.select({
            label: 'Severity',
            options: [
                { label: 'Info', value: 'info' },
                { label: 'Warning', value: 'warning' },
                { label: 'Critical', value: 'critical' },
            ],
        }),

        action_url: Field.text({
            label: 'Action URL',
        }),

        read: Field.boolean({
            label: 'Read',
        }),

        created_at: Field.datetime({
            label: 'Created At',
            readonly: true,
        }),
    },
});
