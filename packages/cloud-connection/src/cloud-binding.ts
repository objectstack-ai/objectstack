// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `cloud-binding` service — this server's binding to the cloud control
 * plane (cloud ADR-0008), as `ICloudBindingService`
 * (`@objectstack/spec/contracts`) declares it.
 *
 * `CloudConnectionPlugin` registers it in `init()` and its own control-plane
 * routes read the credential through it, so the rule below has one owner:
 * the hosted push relay sender (`@objectstack/service-push`) asks this
 * service and never re-spells it (ruling on #29920, Q1 A).
 *
 * Every member reads at call time. A self-hosted server binds while it runs,
 * through the Setup page, and the bind takes effect without a restart.
 */

import { resolveControlPlaneApiKey } from '@objectstack/core';
import type { ICloudBindingService } from '@objectstack/spec/contracts';
import { resolveCloudUrl } from './cloud-url.js';
import type { ConnectionCredentialStore } from './connection-credential-store.js';

/** The kernel service name {@link createCloudBinding}'s answer is registered under. */
export const CLOUD_BINDING_SERVICE = 'cloud-binding';

export interface CloudBindingOptions {
    /** The plugin's `controlPlaneApiKey` option (the env→cloud service key); `OS_CLOUD_API_KEY` when absent. */
    controlPlaneApiKey?: string;
    /** The plugin's `controlPlaneUrl` option; `OS_CLOUD_URL`, then the default, when absent. */
    controlPlaneUrl?: string;
    /** Where a self-hosted bind persisted its `oscc_` bearer. */
    store: Pick<ConnectionCredentialStore, 'read'>;
}

/**
 * Build the binding service over the plugin's options and credential store.
 *
 * The credential is the env→cloud service key when one is set (a runtime the
 * cloud hosts, whose connection the platform manages), else the `oscc_`
 * bearer the device-code bind stored; `''` when neither. The same
 * derivation `isCloudManaged` reads in `@objectstack/core`
 * (`resolveControlPlaneApiKey`), so "platform-managed" and "which bearer"
 * cannot disagree.
 */
export function createCloudBinding(options: CloudBindingOptions): ICloudBindingService {
    const credential = (): string =>
        resolveControlPlaneApiKey(options.controlPlaneApiKey) || options.store.read()?.runtimeToken || '';
    return {
        credential,
        bound: () => credential() !== '',
        controlPlaneUrl: () => resolveCloudUrl(options.controlPlaneUrl),
    };
}
