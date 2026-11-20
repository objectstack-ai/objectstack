// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `sys_channel_user_link` — a person's link to their own user in a chat
 * workspace (ADR-0013 §8, narrowed by its accepted addendum of 2026-11-19):
 * the platform user, the organization's install (`sys_channel_account`), and
 * the chat user id.
 *
 * A link is `proposed` by matching the person's verified email against the
 * workspace's users and delivers nothing until the person `confirmed` it,
 * once, while that email is still verified and still theirs
 * (`proposal_email_hash`). A person,
 * or an administrator of the organization, may remove it; it goes with the
 * person (`user_id` cascades, as `sys_user_device`), with the install
 * (`account_id` cascades), and the link store removes it when the person is
 * banned or leaves the organization (`../slack-links.ts`).
 *
 * Every write is an engine write under a context naming who acted, so the
 * platform's write audit records each creation, confirmation and removal.
 * Engine-owned; ⛔ the generic data API neither reads nor writes it.
 */
export const ChannelUserLink = ObjectSchema.create({
    name: 'sys_channel_user_link',
    label: 'Channel User Link',
    pluralLabel: 'Channel User Links',
    icon: 'link',
    isSystem: true,
    managedBy: 'engine-owned',
    access: { default: 'private' },
    description: "A person's link to their own user in a chat workspace: proposed by email match, delivering once they confirm it.",
    nameField: 'external_display_name', // [ADR-0079] canonical primary-title pointer

    fields: {
        account_id: Field.lookup('sys_channel_account', { label: 'Account', required: true, deleteBehavior: 'cascade' }),
        // [ADR-0118] A person's links go with the person, as their devices do.
        user_id: Field.lookup('sys_user', { label: 'User', required: true, deleteBehavior: 'cascade' }),
        external_user_id: Field.text({ label: 'Chat User ID', required: true, maxLength: 64 }),
        external_display_name: Field.text({ label: 'Chat User Name', maxLength: 255 }),
        // Proposed by an email match; nothing is delivered until the person confirms.
        state: Field.select([{ label: 'Proposed', value: 'proposed' }, { label: 'Confirmed', value: 'confirmed' }], {
            label: 'State', required: true, defaultValue: 'proposed',
        }),
        confirmed_at: Field.datetime({ label: 'Confirmed At' }),
        // SHA-256 of the email the proposal was made for; a confirmation requires the person's verified email to still match it.
        proposal_email_hash: Field.text({ label: 'Proposal Email Hash', maxLength: 64 }),
    },

    indexes: [
        // One link per person per install, and one person per chat user.
        { fields: ['account_id', 'user_id'], unique: 'global' },
        { fields: ['account_id', 'external_user_id'], unique: 'global' },
    ],

    enable: {
        trackHistory: false,
        searchable: false,
        apiEnabled: false,
        apiMethods: [],
    },
});
