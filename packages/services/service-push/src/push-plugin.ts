// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { isControlPlaneDeclined } from '@objectstack/core';
import type { ICloudBindingService } from '@objectstack/spec/contracts';
import { PushServiceConfigSchema, type PushServiceConfig, type PushVendor } from '@objectstack/spec/system';
import { PushService, type IPushTransport } from './push-service.js';
import { envPushCredentialResolver, type PushCredentialResolver } from './credential.js';
import { ApnsPushTransport } from './transports/apns.js';
import { FcmPushTransport } from './transports/fcm.js';
import { CLOUD_BINDING_SERVICE, RelayPushSender, relayTransport } from './transports/relay.js';

export interface PushServicePluginOptions {
    /**
     * The push transport, parsed by `PushServiceConfigSchema`
     * (`@objectstack/spec/system`) when the plugin initialises, so an inline
     * secret or a misspelt key fails the boot with the schema's own guidance.
     *
     * Both transports are served. The hosted relay (`transport: 'relay'`, and
     * the default `{}` that reads as it) sends through the cloud's push relay,
     * authenticated by this server's cloud binding (the `cloud-binding`
     * service, `@objectstack/cloud-connection`); it is refused at init only on
     * a deployment that declared it has no control plane
     * ({@link PUSH_RELAY_AIR_GAPPED_MESSAGE}). The direct transport
     * (`transport: 'direct'`, or a block with an `apns` / `fcm` block and no
     * `transport`) builds one vendor transport per block; a vendor with no
     * block is not delivered to.
     */
    config?: PushServiceConfig;
    /**
     * Resolves each direct block's `credentialRef` to its secret when the
     * transport first signs. Default: the open tier's rule, the name of an
     * environment variable ({@link envPushCredentialResolver}). The relay
     * names no secret: its bearer is the cloud binding credential.
     */
    resolveCredential?: PushCredentialResolver;
    /**
     * Transports supplied by the host, per vendor; each wins over that
     * vendor's `config` block or the relay. For a vendor endpoint the built-in
     * transports do not reach, and for tests.
     */
    transports?: Partial<Record<PushVendor, IPushTransport>>;
    /** `fetch` for the relay sender, injectable for a test. Not authorable. */
    relayFetch?: typeof fetch;
}

/**
 * The refusal a relay configuration meets at init on a deployment that
 * declared it has no control plane (`OS_CLOUD_URL=off`, `none`, `local` or
 * `disabled`). The relay is hosted by the cloud and there is no self-hosted
 * relay, so such a deployment has no system push (ADR-0012 §6.1, the air-gap
 * rule): booting a `push` service that can never deliver is worse than
 * refusing, because the channel would mount and every push would look sent.
 * The text is printed at the operator, so it names no tracker id
 * (check:doc-authoring).
 */
export const PUSH_RELAY_AIR_GAPPED_MESSAGE =
    "PushServicePlugin: the hosted push relay (transport: 'relay', which is also what an empty push config reads as) "
    + 'cannot be reached from a deployment that declared it has no control plane (OS_CLOUD_URL is off, none, local '
    + 'or disabled): the relay is hosted by the cloud, so an air-gapped deployment has no system push. Users read '
    + 'their notifications in the in-app inbox, which needs no push service; leave push out of the stack\'s requires. '
    + "For a white-label build signed with your own APNs key or Firebase project, write transport: 'direct' with an "
    + 'apns and/or fcm block, each naming its secret by credentialRef.';

/**
 * PushServicePlugin — registers the kernel's `push` service, the transport
 * half of the `push` notification channel (ADR-0012 §4, §6, §6.1; amended
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
 * `PushServiceConfigSchema` value.
 *
 * - **The hosted relay** (the default) sends each push to the cloud's push
 *   relay as an ID-only `PushRelayRequestSchema`, with this server's cloud
 *   binding credential as the bearer, read from the `cloud-binding` service
 *   on every send (ruling on #29920: Q1 A, Q2 A, Q3 A). While the server is
 *   not bound the relay transport is unavailable: the service lists no
 *   vendor, the push channel reports `transport_not_configured`, and the boot
 *   says so once at `warn`. A bind done while the server runs takes effect
 *   without a restart.
 * - **The direct transport** sends with the operator's own APNs key and
 *   Firebase project. Secrets are named by `credentialRef` and resolved
 *   through {@link PushServicePluginOptions.resolveCredential}, never written
 *   inline (ADR-0143 D3).
 *
 * @example
 * ```ts
 * kernel.use(new MessagingServicePlugin());
 * kernel.use(new PushServicePlugin({
 *   config: {
 *     transport: 'direct',
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
    private relay?: RelayPushSender;

    constructor(private readonly options: PushServicePluginOptions = {}) {}

    async init(ctx: PluginContext): Promise<void> {
        const config = PushServiceConfigSchema.parse(this.options.config ?? {});
        const transports: Partial<Record<PushVendor, IPushTransport>> = {};
        if (config.transport === 'relay') {
            if (isControlPlaneDeclined()) throw new Error(PUSH_RELAY_AIR_GAPPED_MESSAGE);
            const relay = new RelayPushSender({
                config,
                // Resolved on every send, never at init: the binding service is
                // registered by another plugin, and the bind itself happens
                // while the server runs.
                binding: () => ctx.getService<ICloudBindingService>(CLOUD_BINDING_SERVICE),
                fetch: this.options.relayFetch,
            });
            this.relay = relay;
            transports.apns = relayTransport('apns', relay);
            transports.fcm = relayTransport('fcm', relay);
        } else {
            const resolveCredential = this.options.resolveCredential ?? envPushCredentialResolver;
            if (config.apns) transports.apns = new ApnsPushTransport({ config: config.apns, resolveCredential });
            if (config.fcm) transports.fcm = new FcmPushTransport({ config: config.fcm, resolveCredential });
        }
        Object.assign(transports, this.options.transports ?? {});

        this.service = new PushService({ transports, logger: ctx.logger });
        ctx.registerService('push', this.service);
        if (this.relay) {
            ctx.logger.info('PushServicePlugin: push service registered (apns, fcm through the hosted push relay)');
            return;
        }
        const vendors = this.service.vendors();
        ctx.logger.info(
            vendors.length > 0
                ? `PushServicePlugin: push service registered (${vendors.join(', ')})`
                : 'PushServicePlugin: push service registered with no vendor configured — the push channel delivers nothing',
        );
    }

    /**
     * With the relay, says once, when every plugin has registered, whether the
     * server is bound: an unbound server keeps booting, and its pushes wait for
     * the bind.
     */
    async start(ctx: PluginContext): Promise<void> {
        const relay = this.relay;
        if (!relay || typeof ctx.hook !== 'function') return;
        ctx.hook('kernel:ready', async () => {
            if (relay.bound()) return;
            ctx.logger.warn(
                'PushServicePlugin: this server is not bound to the cloud, so the hosted push relay delivers nothing until '
                + 'it is. Bind it on the Cloud connection setup page; the bind takes effect without a restart. Until then '
                + 'the push channel reports transport_not_configured, and notifications reach users in the in-app inbox.',
            );
        });
    }

    async destroy(): Promise<void> {
        await this.service?.close();
    }
}
