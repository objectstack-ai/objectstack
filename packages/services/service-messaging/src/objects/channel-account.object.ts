// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `sys_channel_account` — one organization's install of a chat app (ADR-0013
 * §4, narrowed by its accepted addendum of 2026-11-19): for Slack, the
 * organization's own Slack app, installed into its workspace, and the bot
 * token it was issued. One row per organization and channel.
 *
 * **The token at rest** (`bot_token`) is the `secret` channel (ADR-0100), the
 * one the open connector credential store uses (`sys_connector_credential`,
 * ADR-0143): the engine encrypts it on write through the host's
 * `ICryptoProvider` (refusing the write with none), masks it on every read
 * path, and only the privileged `resolveSecretField()` dereferences it, server
 * side, when the Slack channel or the link door calls Slack. ADR-0013 §4's
 * `credentials_ref` into a vault stays Draft and enterprise.
 *
 * Engine-owned: written only through the link store (`../slack-links.ts`) —
 * by the Slack link door (`../slack-link-routes.ts`) under a system context
 * naming the administrator, and by the Slack channel marking a token Slack
 * refused as revoked. ⛔ The generic data API
 * neither reads nor writes it (`apiEnabled: false`), and `access: private`
 * keeps a plain `'*'` wildcard grant off it (ADR-0066 D2).
 */
export const ChannelAccount = ObjectSchema.create({
    name: 'sys_channel_account',
    label: 'Channel Account',
    pluralLabel: 'Channel Accounts',
    icon: 'plug',
    isSystem: true,
    managedBy: 'engine-owned',
    access: { default: 'private' },
    description: "An organization's install of a chat app, such as its own Slack app, with the bot token it was issued.",
    nameField: 'display_name', // [ADR-0079] canonical primary-title pointer

    fields: {
        // The messaging channel the install serves: `slack`.
        channel_id: Field.text({ label: 'Channel', required: true, maxLength: 64 }),
        // The workspace name and id the chat app reported for the token.
        display_name: Field.text({ label: 'Workspace', required: true, maxLength: 255 }),
        external_id: Field.text({ label: 'Workspace ID', required: true, maxLength: 64 }),
        // Encrypted at rest and masked on every read; read only by the server, to send.
        bot_token: Field.secret({ label: 'Bot Token', required: true }),
        // Revoked once the chat app refused the token; setting the token again restores it.
        status: Field.select([{ label: 'Active', value: 'active' }, { label: 'Revoked', value: 'revoked' }], {
            label: 'Status', required: true, defaultValue: 'active',
        }),
    },

    indexes: [
        // One install per organization and channel.
        { fields: ['channel_id'], unique: 'organization' },
    ],

    enable: {
        trackHistory: false,
        fieldHistory: false, // [#36290] keeps this object's "no history": values off in the activity stream
        searchable: false,
        apiEnabled: false,
        apiMethods: [],
    },
});
