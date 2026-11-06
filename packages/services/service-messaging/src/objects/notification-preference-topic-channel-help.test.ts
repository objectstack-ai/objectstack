// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_notification_preference.topic` and `.channel` stay free text, and their
 * help says what to type (#25346, ruling A 2026-10-23); both, and
 * `sys_notification_template.topic`, declare the console's pick-or-type input
 * over the served list (#30208 row 6, ruling E on #30527).
 *
 * Setup → Notification Preferences offered two bare text boxes, so muting a
 * topic meant knowing its machine name. Neither set can be a picker: topics
 * are whatever string a sender writes (nothing registers them), and channels
 * are registered at runtime through an open seam while a `select` is closed on
 * the write path and cannot spell the stored `'*'` wildcard. The help carries
 * the vocabulary instead, and these pins keep it honest:
 *
 *  - both fields stay `text` with the `'*'` default the resolver reads as
 *    "all", so no stored row or write changes meaning;
 *  - the channel help names exactly the ids of the channels this package
 *    builds, read from the channel factories themselves, so a channel added
 *    or renamed here fails this file until the help says so (push joined the
 *    four with #29041);
 *  - the topic help names where topics come from and the wildcard;
 *  - the widget hints name the two inputs the console registers, and only a
 *    hint: the field type and the wildcard default do not move with them, and
 *    the template's channel, which has its own refusal, declares none.
 */

import { describe, expect, it } from 'vitest';
import { NotificationPreference } from './notification-preference.object.js';
import { NotificationTemplate } from './notification-template.object.js';
import { createInboxChannel } from '../inbox-channel.js';
import { createEmailChannel } from '../email-channel.js';
import { createSmsChannel } from '../sms-channel.js';
import { createPushChannel } from '../push-channel.js';
import { NotificationTemplateStore } from '../template-renderer.js';

type FieldShape = { type?: string; defaultValue?: unknown; description?: string; widget?: string };
const fields = NotificationPreference.fields as Record<string, FieldShape>;
const templateFields = NotificationTemplate.fields as Record<string, FieldShape>;

/** The ids of the channels `MessagingServicePlugin` registers, read off the factories. */
function builtInChannelIds(): string[] {
    const getData = () => undefined;
    const store = new NotificationTemplateStore({ getData });
    return [
        createInboxChannel({ getData }).id,
        createEmailChannel({ getEmail: () => undefined, getData, store }).id,
        createSmsChannel({ getSms: () => undefined, getData, store }).id,
        createPushChannel({ getPush: () => undefined, devices: {} as any, getData }).id,
    ];
}

/** Lowercase words of a help text that read as a channel id (`inbox`, `email`, …). */
function channelIdsNamedIn(help: string, candidates: readonly string[]): string[] {
    return candidates.filter((id) => new RegExp(`(^|[^a-z_])${id}([^a-z_]|$)`).test(help));
}

describe('sys_notification_preference topic / channel help (#25346)', () => {
    it('both stay free text defaulting to the * wildcard', () => {
        for (const name of ['topic', 'channel']) {
            expect(fields[name]?.type, name).toBe('text');
            expect(fields[name]?.defaultValue, name).toBe('*');
            expect(fields[name]?.description, name).toMatch(/Enter \* for all /);
        }
    });

    it('the channel help names every channel this package builds, and no channel it does not', () => {
        const help = fields.channel?.description ?? '';
        const ids = builtInChannelIds();
        expect(ids).toEqual(['inbox', 'email', 'sms', 'push']);
        expect(channelIdsNamedIn(help, ids)).toEqual(ids);
        // Ids the spec's channel vocabulary carries that no channel here implements.
        expect(channelIdsNamedIn(help, ['webhook', 'slack', 'teams', 'in-app'])).toEqual([]);
        // The seam is open: a plugin's own channel id is a valid value too.
        expect(help).toMatch(/a channel an installed plugin adds/);
    });

    it('the topic help says where a topic comes from', () => {
        const help = fields.topic?.description ?? '';
        expect(help).toMatch(/notify step/);
        expect(help).toMatch(/approval\.requested/);
    });

    it('the topic and channel inputs declare the pick-or-type widgets, and nothing else moves', () => {
        expect(fields.topic?.widget).toBe('notification-topic');
        expect(fields.channel?.widget).toBe('notification-channel');
        expect(templateFields.topic?.widget).toBe('notification-topic');
        expect(templateFields.topic?.type).toBe('text');
        // The template channel keeps `channel_renders_template` and no widget.
        expect(templateFields.channel?.widget).toBeUndefined();
        expect(templateFields.channel?.type).toBe('text');
    });
});
