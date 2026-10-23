// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { F } from '@objectstack/spec';

/**
 * `sys_notification_preference` — per-user × topic × channel delivery toggle
 * (ADR-0030 Layer 3).
 *
 * The mute/allow matrix the preference filter consults before fan-out. A row
 * declares whether `user_id` wants `topic` on `channel`. Resolution is
 * most-specific-wins with wildcards:
 *
 *   (user, topic, channel) → (user, topic, *) → (user, *, channel) →
 *   (user, *, *) → ('*', topic, channel) → … → ('*', '*', '*') → default ON
 *
 * A row whose `user_id` is EMPTY is the **admin global default**; a real-user
 * row **overrides** it. `topic = '*'` / `channel = '*'` are wildcards. Mandatory
 * topics (configured on the service) bypass this object entirely.
 *
 * [ADR-0118 D1] `user_id` is a `sys_user` reference, so "everyone" is the
 * empty reference, never a sentinel in a user column. It used to be a text
 * column holding a user id or the literal `'*'`: the write door stored any
 * string (a mistyped id matched nobody, silently), and the record title could
 * only show the raw id, because the formula read path reads one hop only
 * through a reference. Stored `'*'` rows are rewritten to the empty reference
 * at boot by `convertWildcardPreferenceUsers` (`../preference-user-conversion.ts`).
 *
 * Belongs to `service-messaging` (owner of the delivery pipeline).
 */
export const NotificationPreference = ObjectSchema.create({
    name: 'sys_notification_preference',
    label: 'Notification Preference',
    pluralLabel: 'Notification Preferences',
    icon: 'bell-ring',
    isSystem: true,
    // [ADR-0103, #3355] Admin/user-writable DATA on a platform-defined schema: a
    // user authors their own mute/allow rows (and admins the empty-`user_id`
    // global defaults) from the Setup "Notification Preferences" grid. The bucket
    // default is full CRUD, so no `userActions` block is needed — RLS is the authz.
    managedBy: 'system-data',
    // Admin-facing copy; the per-user × topic × channel matrix is described in
    // the docblock above (ADR-0030 Layer 3).
    description: 'Which topics and channels each user receives; admins set the defaults.',
    // [ADR-0079] The record title is `display_title`, a text formula over the
    // same three columns `titleFormat` names. With no pointer declared, the
    // registry's designate-only pass stamped `nameField: 'id'` (the first
    // title-eligible field), so a renderer honouring ADR-0079's order (an
    // explicit `nameField` wins over `titleFormat`) drew the raw id as the
    // record page's H1. `titleFormat` stays for renderers that still read it
    // first; `notification-display-title.test.ts` holds the two to the same text.
    displayNameField: 'display_title',
    nameField: 'display_title', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
    titleFormat: '{user_id} · {topic} · {channel}',
    highlightFields: ['user_id', 'topic', 'channel', 'enabled', 'digest'],

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
            data: { provider: 'object', object: 'sys_notification_preference' },
            columns: [],
            emptyState: {
                title: 'No preferences yet',
                message: 'Nothing is muted until a preference is added; add one to mute or allow a topic on a channel, for one user or as the default for everyone.',
            },
        },
    },

    fields: {
        id: Field.text({ label: 'Preference ID', required: true, readonly: true }),

        // [ADR-0079] The record title (`nameField` above). A formula is computed
        // on read and has no stored column. It names the PERSON, not the raw
        // user id: the user's `name`, or their `email` where the name is blank
        // (the platform's `name || email` handle rule), read ONE hop through
        // `user_id` (ADR-0079 addendum), under the reader's own authority.
        //
        // The empty reference is the admin-global default (ADR-0118 D1), and
        // the optional read (`.?field.orValue(…)`) is what answers it: an
        // EMPTY reference reads 'All users'. A reference the read cannot
        // resolve (a user that is gone, or one this reader may not read) is a
        // different case and leaves the whole title null; it is never
        // rendered as 'All users', which would name the wrong row.
        // `user_id` is read only through the hop: a bare read beside a
        // traversal is refused (`traversal-bare-and-traversed`). `topic` and
        // `channel` are required and default to '*', so they need no guard.
        display_title: Field.formula({
            label: 'Title',
            returnType: 'text',
            expression: F`(isBlank(trim(record.user_id.?name.orValue(''))) ? record.user_id.?email.orValue('All users') : record.user_id.?name.orValue('')) + ' · ' + record.topic + ' · ' + record.channel`,
            description: 'Record title: the person (or All users), the topic and the channel this toggle covers (computed on read)',
        }),

        // [ADR-0118 D1] A `sys_user` reference. Empty = the admin-global
        // default for every user; never a sentinel. The write door refuses an
        // id no `sys_user` row holds (`reference_not_found`), so `'*'` and a
        // mistyped id are refused instead of being stored to match nobody.
        //
        // `deleteBehavior: 'cascade'` is load-bearing. The lookup default is
        // `set_null`, which empties the reference when the user is deleted,
        // and here the empty reference MEANS everyone: that person's own mute
        // would become the admin-global mute for every user. Their rows go
        // with them instead.
        //
        // No `maxLength`: a reference holds the referenced row's id, whose
        // width is the parent's id column, not this field's to declare.
        user_id: Field.lookup('sys_user', {
            label: 'User',
            required: false,
            searchable: true,
            deleteBehavior: 'cascade',
            description: 'The user this preference applies to. Leave empty for the default that applies to all users.',
        }),

        topic: Field.text({
            label: 'Topic',
            required: true,
            searchable: true,
            defaultValue: '*',
            // [commit e4902d2b9] Sibling-declaration bound (route A, ruling 2026-08-24): rows are
            // matched against the event's `sys_notification.topic`
            // (maxLength: 200 there) — `preference-resolver` keys
            // `${user}|${topic}|${channel}` against `ctx.topic` — so a longer
            // stored topic could never match an event the platform can store.
            // '*' is 1 char.
            maxLength: 200,
            description: "Notification topic, or '*' for all topics.",
        }),

        channel: Field.text({
            label: 'Channel',
            required: true,
            defaultValue: '*',
            // [commit e4902d2b9] Machine channel-id vocabulary (route A, ruling 2026-08-24), same
            // sourcing as `sys_notification_delivery.channel`: registered
            // `MessagingChannel.id`s (inbox/email/sms today; spec's widest
            // enum member is 7 chars), 64 per the landed machine-vocabulary
            // precedent (sys_session.revoke_reason, maxLength: 64). '*' is
            // 1 char.
            maxLength: 64,
            description: "Channel id (inbox/email/push/…), or '*' for all channels.",
        }),

        enabled: Field.boolean({
            label: 'Enabled',
            defaultValue: true,
            description: 'When false, this (user, topic, channel) is muted.',
        }),

        digest: Field.select(['none', 'daily', 'weekly'], {
            label: 'Digest',
            required: false,
            defaultValue: 'none',
            description:
                'Collect these notifications into one summary instead of sending each as it arrives: daily sends it at midnight, ' +
                'weekly on Monday at midnight, none sends each one right away. Critical notifications are always sent at once. ' +
                'Takes effect on a preference whose channel is * (all channels).',
        }),

        quiet_hours: Field.json({
            label: 'Quiet Hours',
            required: false,
            description:
                'A daily window when notifications are held and delivered when it ends, for example ' +
                '{ "tz": "Europe/Berlin", "start": "22:00", "end": "07:00" }. Times are HH:MM in that time zone (UTC when tz is left out), ' +
                'and the window may run past midnight. Critical notifications are not held. ' +
                'Takes effect on a preference whose channel is * (all channels).',
        }),

        created_at: Field.datetime({ label: 'Created At', readonly: true }),
        updated_at: Field.datetime({ label: 'Updated At', required: false }),
    },

    indexes: [
        // [#8554] Scope spelled EXPLICITLY (ADR-0120 D1). On a DECLARED index
        // bare `unique: true` is the positional spelling of `'global'` — the
        // listed columns VERBATIM — so `(user_id, topic, channel)` was an
        // installation-wide key on a tenant-scoped object. This is the near-exact
        // analogue of `sys_user_preference` (#8323): a user who belongs to two
        // organizations could not hold INDEPENDENT per-topic toggles, because the
        // first organization's row claimed the triple for the whole installation.
        // Measured live before the fix: org_jia creates
        // (user_u1, billing.invoice, email) 201 / org_yi the SAME triple 409
        // UNIQUE_VIOLATION / org_yi the same pair on `push` 201 / org_yi a
        // different topic on `email` 201 / org_yi's own GET on the colliding
        // triple 0 rows.
        //
        // ⚠️ `managedBy: 'system-data'` is NOT a reason to exempt this object.
        // The already-ruled `sys_user_preference` is `system-data` too; the
        // ruling's phrase is ADMIN-AUTHORED CONTENT — the provenance of the
        // rows, not the management mode of the object.
        //
        // [ADR-0118 D1, ADR-0120 D4] `user_id` is EMPTY on every admin-global
        // default row, and SQL UNIQUE treats NULLs as distinct, so as declared
        // this key does not stop two global defaults for one (topic, channel)
        // in one organization. The NULL-safe form,
        // `(organization_id, COALESCE(user_id, ''), topic, channel)` under this
        // same index name, is built at `kernel:ready` by `metadata-protocol`'s
        // `ensureNotificationPreferenceIdentityIndex` on SQLite and PostgreSQL.
        // This declaration stays the fallback shape for a driver that never
        // runs that migration (MySQL refuses the key parts; driver-memory keys
        // the listed columns).
        { fields: ['user_id', 'topic', 'channel'], unique: 'organization' },
        { fields: ['topic'] },
    ],
});
