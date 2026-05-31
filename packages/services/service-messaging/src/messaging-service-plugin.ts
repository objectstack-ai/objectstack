// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { MessagingService } from './messaging-service.js';
import { createInboxChannel } from './inbox-channel.js';
import { InboxMessage } from './objects/index.js';

export interface MessagingServicePluginOptions {
    /**
     * Register the always-on `inbox` channel during init (default `true`).
     * Set `false` only for tests that want an empty registry.
     */
    registerInbox?: boolean;
}

/**
 * MessagingServicePlugin — registers the `messaging` service (ADR-0012 M1,
 * minimal slice).
 *
 * After bootstrap, `kernel.getService('messaging')` is a {@link MessagingService}
 * with the always-on `inbox` channel registered. The baseline `notify` flow
 * node dispatches through it; flows therefore stop being no-ops once this
 * plugin is installed. Other channels (email/webhook/push/IM) register
 * themselves on this same service.
 *
 * @example
 * ```ts
 * const kernel = new ObjectKernel();
 * kernel.use(new AutomationServicePlugin()); // ships the `notify` node
 * kernel.use(new MessagingServicePlugin());  // backs it with delivery
 * await kernel.bootstrap();
 * ```
 */
export class MessagingServicePlugin implements Plugin {
    name = 'com.objectstack.service.messaging';
    version = '1.0.0';
    type = 'standard' as const;
    dependencies = ['com.objectstack.engine.objectql'];

    private readonly options: MessagingServicePluginOptions;

    constructor(options: MessagingServicePluginOptions = {}) {
        this.options = { registerInbox: true, ...options };
    }

    async init(ctx: PluginContext): Promise<void> {
        const service = new MessagingService({ logger: ctx.logger });

        if (this.options.registerInbox) {
            const getData = (): IDataEngine | undefined => {
                try {
                    return (
                        ctx.getService<IDataEngine>('data') ??
                        ctx.getService<IDataEngine>('objectql')
                    );
                } catch {
                    return undefined;
                }
            };
            service.registerChannel(createInboxChannel({ getData }));
        }

        ctx.registerService('messaging', service);

        // Register the inbox object so `sys_inbox_message` rows can be written.
        ctx.getService<{ register(m: unknown): void }>('manifest').register({
            id: 'com.objectstack.service.messaging',
            name: 'Messaging Service',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [InboxMessage],
        });

        ctx.logger.info(
            `[messaging] service registered with channels: ${service.getRegisteredChannels().join(', ') || '(none)'}`,
        );
    }
}
