// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `sys_notification_subscription` — who is subscribed to a topic (ADR-0030
 * Layer 3).
 *
 * Declares standing interest in a `topic` by a `principal` (`role:x`, `team:x`,
 * `user:id`, or a bare user id). Where a producer emits with `audience:
 * 'subscribers'` (or no explicit audience), the resolver expands the topic's
 * subscriptions into recipients — the opt-in counterpart to the explicit
 * audience most producers pass today.
 *
 * Distinct from `sys_notification_preference`: a subscription says "include me
 * for this topic"; a preference says "but mute it on this channel".
 *
 * Belongs to `service-messaging`.
 */
export const NotificationSubscription = ObjectSchema.create({
    name: 'sys_notification_subscription',
    label: 'Notification Subscription',
    pluralLabel: 'Notification Subscriptions',
    icon: 'rss',
    isSystem: true,
    // [ADR-0103, #3355] Admin/user-writable DATA on a platform-defined schema:
    // authored from the Setup "Notification Subscriptions" grid. The bucket
    // default is full CRUD, so no `userActions` block is needed.
    managedBy: 'system-data',
    description: 'Standing subscription of a principal (role/team/user) to a notification topic.',
    titleFormat: '{principal} · {topic}',
    highlightFields: ['topic', 'principal', 'enabled', 'created_at'],

    fields: {
        id: Field.text({ label: 'Subscription ID', required: true, readonly: true }),

        topic: Field.text({
            label: 'Topic',
            required: true,
            searchable: true,
            description: 'Notification topic this principal subscribes to.',
        }),

        principal: Field.text({
            label: 'Principal',
            required: true,
            searchable: true,
            description: "Subscriber selector: 'role:x' | 'team:x' | 'user:id' | bare user id.",
        }),

        enabled: Field.boolean({
            label: 'Enabled',
            defaultValue: true,
            description: 'When false, the subscription is inactive.',
        }),

        created_at: Field.datetime({ label: 'Created At', readonly: true }),
    },

    indexes: [
        // [#8577] Scope spelled EXPLICITLY (ADR-0120 D1). On a DECLARED index
        // bare `unique: true` is the positional spelling of `'global'` — the
        // listed columns VERBATIM — so `(topic, principal)` was an
        // installation-wide key on a tenant-scoped object. Direct sibling of
        // `sys_notification_preference` (#8554): same package, same directory,
        // same ADR-0030 Layer 3, same archetype.
        // Measured live before the fix (real SqlDriver, better-sqlite3,
        // OS_TENANCY_POSTURE=isolated, this shipped declaration):
        // org_jia creates (billing.invoice, role:sales_manager) 201 / org_yi
        // the SAME pair 409 UNIQUE_VIOLATION / org_yi (billing.invoice,
        // role:only_yi) 201 / org_yi (crm.lead, role:sales_manager) 201 /
        // org_yi (billing.invoice, user:u1) 201 / org_yi's own GET on the
        // colliding pair 0 rows.
        //
        // ⚠️ [#9722, correcting this note] `principal` names are per-organization:
        // `role:x` resolves against `sys_member` (tenant-scoped org-membership
        // rows — the org-administration tier that is the sole ADR-0090 D3
        // "role" exception) and `team:x` against `sys_team_member` (tenant-scoped
        // via its `team_id` lookup into `sys_team`, itself per-organization) —
        // per `RecipientResolver.resolveRole` / `.resolveTeam`
        // (`recipient-resolver.ts`, the sole reader of this selector). NOT
        // `sys_permission_set` / `sys_position` as an earlier version of this
        // note claimed — this selector has no `permission_set:` or
        // `position:` spelling at all; `sys_position` names business roles
        // like `sales_manager` elsewhere on the platform, unrelated to
        // `role:`/`team:` here. So `role:admin` denotes a DIFFERENT set of
        // members in each organization (`sys_member.role` is the closed
        // owner/admin/delegated_admin/member vocabulary — see
        // `BUILTIN_MEMBERSHIP_ROLE_OPTIONS`) while colliding on one
        // installation-wide key. And a user who belongs to two organizations
        // could not subscribe to the same topic in both — the symptom #8323
        // measured on `sys_user_preference`.
        //
        // ⚠️ `managedBy: 'system-data'` is NOT a reason to exempt this object;
        // the already-ruled `sys_user_preference` is `system-data` too. The
        // ruling's phrase is ADMIN-AUTHORED CONTENT — the provenance of the
        // rows (this object's own header: authored from the Setup
        // "Notification Subscriptions" grid), not the management mode.
        { fields: ['topic', 'principal'], unique: 'organization' },
        { fields: ['topic'] },
    ],
});
