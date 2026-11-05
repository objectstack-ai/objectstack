// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `sys_user_device` — the push device registry (ADR-0012 §6, §11): one row per
 * (user, app install), the stored form of spec's `UserDeviceSchema`
 * (`system/push-device.zod.ts`).
 *
 * Owned by `service-messaging`: this service fills the `notification` slot
 * whose `INotificationService` device members write it
 * (`../device-registry.ts`), and the `push` channel (`../push-channel.ts`,
 * also this package) reads it through `listDevices` and retires dead tokens
 * through `invalidateDeviceToken`. `@objectstack/service-push` holds only the
 * APNs and FCM transports; it never reads or writes this table.
 *
 * The three rules spec states for the shape, and where each is kept:
 *
 * - **(a) A device belongs to a user, not to an organization.** No organization
 *   column: `tenancy: { enabled: false }` keeps the registry from injecting
 *   one, so the Layer 0 wall never applies and a phone receives its user's
 *   notifications whichever organization they come from.
 * - **(b) One live row per token.** `token` is unique across the table, so a
 *   second writer racing the first is refused by the database rather than
 *   creating a second holder; the registry moves the token (deletes the
 *   previous holder) before it writes, and retries once on that refusal.
 * - **(c) A dead token keeps its row.** `enabled: false` and `invalidated_at`,
 *   written by `invalidateDeviceToken`; a later registration re-enables it.
 *
 * System-owned: ⛔ the generic data API neither reads nor writes it
 * (`apiEnabled: false`, `apiMethods: []`, the credential-table precedent). A
 * user reaches their own rows only through the device routes
 * (`/api/v1/notifications/devices`, `runtime/src/domains/notifications.ts`),
 * whose user id is the session's, never a body member.
 */
export const UserDevice = ObjectSchema.create({
    name: 'sys_user_device',
    label: 'User Device',
    pluralLabel: 'User Devices',
    icon: 'smartphone',
    isSystem: true,
    // [ADR-0103] Engine-owned: written only by the messaging service's device
    // registry (system-context engine writes), never by a person at a grid.
    managedBy: 'engine-owned',
    // Rule (a): the device has no organization. Without this the registry
    // injects `organization_id` on an engine-owned object and the Layer 0 wall
    // would scope a person's phone to one of their organizations.
    tenancy: { enabled: false },
    description: "A user's push device: one row per app install, holding its vendor push token.",
    nameField: 'name', // [ADR-0079] canonical primary-title pointer
    highlightFields: ['user_id', 'platform', 'vendor', 'enabled', 'last_seen_at'],

    fields: {
        id: Field.text({
            label: 'Row ID',
            required: true,
            readonly: true,
        }),

        device_id: Field.text({
            label: 'Device ID',
            required: true,
            // A client-held id (a UUID the app keeps, or the one the server
            // minted); bounded like the other machine ids in this package.
            maxLength: 255,
            description: 'Client-held device id, stable per app install. Unique per user.',
        }),

        user_id: Field.lookup('sys_user', {
            label: 'User',
            required: true,
            // [ADR-0118] A person's devices go with the person.
            deleteBehavior: 'cascade',
            description: 'The user the device belongs to: the signed-in user who registered it.',
        }),

        vendor: Field.select([
            { label: 'APNs', value: 'apns' },
            { label: 'FCM', value: 'fcm' },
        ], {
            label: 'Vendor',
            required: true,
            description: 'Push vendor the token belongs to.',
        }),

        token: Field.text({
            label: 'Push Token',
            required: true,
            // APNs device tokens are 64 hex characters and FCM registration
            // tokens run to about 160; 512 leaves room without an unindexable
            // column (the unique index below covers it).
            maxLength: 512,
            description: 'Vendor push token. Held by one device at a time.',
        }),

        // Spec's `PUSH_DEVICE_PLATFORMS` is not on a public entry, so the three
        // are spelled here; `user-device.object.test.ts` holds them equal to
        // the registration schema's enum.
        platform: Field.select([
            { label: 'iOS', value: 'ios' },
            { label: 'Android', value: 'android' },
            { label: 'Web', value: 'web' },
        ], {
            label: 'Platform',
            required: true,
        }),

        app_id: Field.text({
            label: 'App ID',
            required: false,
            maxLength: 255,
            description: 'The iOS bundle ID or Android application ID the token was issued to.',
        }),

        locale: Field.text({
            label: 'Locale',
            required: false,
            // BCP 47 tags are short; 35 is the RFC 5646 practical maximum.
            maxLength: 35,
            description: 'Device locale, as the registration named it. Stored for the device; no push renders by it: a push '
                + 'arrives in the recipient\'s language (their user locale, then the deployment default).',
        }),

        name: Field.text({
            label: 'Device Name',
            required: false,
            maxLength: 255,
        }),

        enabled: Field.boolean({
            label: 'Enabled',
            defaultValue: true,
            description: 'False once the vendor reported the token dead; nothing is delivered to a disabled device.',
        }),

        invalidated_at: Field.datetime({
            label: 'Invalidated At',
            required: false,
            description: 'When the vendor reported the token dead. Cleared by the registration that re-enables it.',
        }),

        last_seen_at: Field.datetime({
            label: 'Last Seen At',
            required: false,
            description: 'When the device last registered or refreshed.',
        }),

        created_at: Field.datetime({
            label: 'Created At',
            defaultValue: 'NOW()',
            readonly: true,
        }),
    },

    indexes: [
        // The identity of a row (spec rule a).
        { fields: ['user_id', 'device_id'], unique: 'global' },
        // One holder per token (spec rule b), enforced by the database.
        { fields: ['token'], unique: 'global' },
    ],

    enable: {
        trackHistory: false,
        searchable: false,
        // System-owned: reached only through the device routes.
        apiEnabled: false,
        apiMethods: [],
    },
});
