// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { PushServiceConfigSchema, type PushServiceConfig, type PushVendor } from '@objectstack/spec/system';
import { PushService, type IPushTransport } from './push-service.js';
import { envPushCredentialResolver, type PushCredentialResolver } from './credential.js';
import { ApnsPushTransport } from './transports/apns.js';
import { FcmPushTransport } from './transports/fcm.js';

export interface PushServicePluginOptions {
    /**
     * The push transports: one optional block per vendor, parsed by
     * `PushServiceConfigSchema` (`@objectstack/spec/system`) when the plugin
     * initialises, so an inline secret or a misspelt key fails the boot with
     * the schema's own guidance. A vendor with no block is not delivered to.
     */
    config?: PushServiceConfig;
    /**
     * Resolves each block's `credentialRef` to its secret when the transport
     * first signs. Default: the open tier's rule, the name of an environment
     * variable ({@link envPushCredentialResolver}).
     */
    resolveCredential?: PushCredentialResolver;
    /**
     * Transports supplied by the host, per vendor; each wins over that
     * vendor's `config` block. For a vendor endpoint the built-in transports
     * do not reach, and for tests.
     */
    transports?: Partial<Record<PushVendor, IPushTransport>>;
}

/**
 * PushServicePlugin — registers the kernel's `push` service, the transport
 * half of the `push` notification channel (ADR-0012 §4, §6; amended
 * 2026-11-03: the transports ship here, the channel in service-messaging).
 *
 * The `push` channel itself lives in `@objectstack/service-messaging`
 * (`push-channel.ts`): it is mounted while a `push` service is registered,
 * reads the recipient's devices from the device registry (`sys_user_device`,
 * owned by service-messaging), sends through this service, and retires a
 * token this service reports dead. This package holds no table and reads no
 * user.
 *
 * Configuration is the constructor's `config`, the operator's
 * `PushServiceConfigSchema` value; secrets are named by `credentialRef` and
 * resolved through {@link PushServicePluginOptions.resolveCredential}, never
 * written inline (ADR-0143 D3).
 *
 * @example
 * ```ts
 * kernel.use(new MessagingServicePlugin());
 * kernel.use(new PushServicePlugin({
 *   config: {
 *     apns: { teamId: 'ABCDE12345', keyId: 'KEY1234567', topic: 'com.example.app',
 *             environment: 'production', credentialRef: 'APNS_SIGNING_KEY' },
 *     fcm: { projectId: 'example-app', credentialRef: 'FCM_SERVICE_ACCOUNT' },
 *   },
 * }));
 * ```
 */
export class PushServicePlugin implements Plugin {
    name = 'com.objectstack.service.push';
    /** Services init() registers on every path (ADR-0116). */
    providesServices = ['push'];
    version = '1.0.0';
    type = 'standard' as const;

    private service?: PushService;

    constructor(private readonly options: PushServicePluginOptions = {}) {}

    async init(ctx: PluginContext): Promise<void> {
        const config = PushServiceConfigSchema.parse(this.options.config ?? {});
        const resolveCredential = this.options.resolveCredential ?? envPushCredentialResolver;
        const transports: Partial<Record<PushVendor, IPushTransport>> = {};
        if (config.apns) transports.apns = new ApnsPushTransport({ config: config.apns, resolveCredential });
        if (config.fcm) transports.fcm = new FcmPushTransport({ config: config.fcm, resolveCredential });
        Object.assign(transports, this.options.transports ?? {});

        this.service = new PushService({ transports, logger: ctx.logger });
        ctx.registerService('push', this.service);
        const vendors = this.service.vendors();
        ctx.logger.info(
            vendors.length > 0
                ? `PushServicePlugin: push service registered (${vendors.join(', ')})`
                : 'PushServicePlugin: push service registered with no vendor configured — the push channel delivers nothing',
        );
    }

    async destroy(): Promise<void> {
        await this.service?.close();
    }
}
