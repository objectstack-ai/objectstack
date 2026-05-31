// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { MessagingService } from './messaging-service.js';
import type { Delivery, MessagingChannel, SendResult } from './channel.js';

function silentLogger() {
    return { info: () => {}, warn: () => {}, error: () => {} };
}

/** A channel that records every delivery it is handed. */
function recordingChannel(id: string, result: SendResult = { ok: true }): {
    channel: MessagingChannel;
    seen: Delivery[];
} {
    const seen: Delivery[] = [];
    return {
        seen,
        channel: {
            id,
            async send(_ctx, delivery) {
                seen.push(delivery);
                return result;
            },
        },
    };
}

describe('MessagingService', () => {
    let service: MessagingService;

    beforeEach(() => {
        service = new MessagingService({ logger: silentLogger() });
    });

    describe('channel registry', () => {
        it('registers, lists, and resolves channels', () => {
            const { channel } = recordingChannel('inbox');
            service.registerChannel(channel);
            expect(service.getRegisteredChannels()).toEqual(['inbox']);
            expect(service.getChannel('inbox')).toBe(channel);
        });

        it('replaces a channel registered under a duplicate id', () => {
            const a = recordingChannel('inbox');
            const b = recordingChannel('inbox');
            service.registerChannel(a.channel);
            service.registerChannel(b.channel);
            expect(service.getRegisteredChannels()).toEqual(['inbox']);
            expect(service.getChannel('inbox')).toBe(b.channel);
        });

        it('unregisters a channel', () => {
            const { channel } = recordingChannel('inbox');
            service.registerChannel(channel);
            service.unregisterChannel('inbox');
            expect(service.getRegisteredChannels()).toEqual([]);
            expect(service.getChannel('inbox')).toBeUndefined();
        });
    });

    describe('emit() fan-out', () => {
        it('defaults to the inbox channel and one delivery per recipient', async () => {
            const inbox = recordingChannel('inbox', { ok: true, externalId: 'row_1' });
            service.registerChannel(inbox.channel);

            const result = await service.emit({
                title: 'Deal closed',
                body: 'Acme signed 🎉',
                recipients: ['user_1', 'user_2'],
            });

            expect(inbox.seen.map((d) => d.recipient)).toEqual(['user_1', 'user_2']);
            expect(inbox.seen[0].channel).toBe('inbox');
            expect(result.delivered).toBe(2);
            expect(result.failed).toBe(0);
            expect(result.deliveries[0]).toMatchObject({ channel: 'inbox', recipient: 'user_1', ok: true, externalId: 'row_1' });
        });

        it('fans out across every requested channel', async () => {
            const inbox = recordingChannel('inbox');
            const email = recordingChannel('email');
            service.registerChannel(inbox.channel);
            service.registerChannel(email.channel);

            const result = await service.emit({
                title: 'Hi',
                body: 'there',
                recipients: ['user_1'],
                channels: ['inbox', 'email'],
            });

            expect(inbox.seen).toHaveLength(1);
            expect(email.seen).toHaveLength(1);
            expect(result.delivered).toBe(2);
        });

        it('reports a failed delivery per recipient when a channel is unregistered, without throwing', async () => {
            const result = await service.emit({
                title: 'Hi',
                body: 'there',
                recipients: ['user_1', 'user_2'],
                channels: ['email'],
            });
            expect(result.delivered).toBe(0);
            expect(result.failed).toBe(2);
            expect(result.deliveries.every((d) => /not registered/.test(d.error ?? ''))).toBe(true);
        });

        it('isolates a throwing channel as a failed delivery', async () => {
            service.registerChannel({
                id: 'inbox',
                async send() {
                    throw new Error('boom');
                },
            });
            const result = await service.emit({ title: 'x', body: 'y', recipients: ['user_1'] });
            expect(result.failed).toBe(1);
            expect(result.deliveries[0].error).toContain('boom');
        });

        it('surfaces a channel-reported failure (ok:false)', async () => {
            service.registerChannel(recordingChannel('inbox', { ok: false, error: 'quota exceeded' }).channel);
            const result = await service.emit({ title: 'x', body: 'y', recipients: ['user_1'] });
            expect(result.failed).toBe(1);
            expect(result.deliveries[0].error).toBe('quota exceeded');
        });
    });
});
