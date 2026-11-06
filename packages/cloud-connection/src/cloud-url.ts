// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
    isControlPlaneDeclined as isControlPlaneDeclinedInCore,
    isControlPlaneDeclinedSpelling as isDeclinedSpelling,
} from '@objectstack/core';

/**
 * Shared marketplace / cloud control-plane defaults.
 *
 * Centralised so every plugin + the CLI auto-inject path agree on
 * "what cloud URL do we mean when the user didn't set OS_CLOUD_URL?".
 * Until we have a competing public hosted cloud, this points at the
 * ObjectStack-operated control plane so a vanilla `objectstack dev` can
 * browse the marketplace out of the box.
 */
export const DEFAULT_CLOUD_URL = 'https://cloud.objectos.ai';

// The "no control plane" spellings live in `@objectstack/core`
// (`CLOUD_DECLINED_SPELLINGS`), beside `resolveControlPlaneApiKey`, so a
// package that cannot depend on this one (the push relay sender, #29920) reads
// the same definition. ONE definition, read in two directions here:
// `resolveCloudUrl()` turns it into an empty URL, and
// {@link isControlPlaneDeclined} answers whether it was said at all. Keeping
// two copies would let "what counts as off" drift between "no cloud calls" and
// "no client telemetry", which is precisely the pair that must never disagree.

/**
 * Resolve the effective control-plane URL from an explicit constructor
 * value, the OS_CLOUD_URL env var, or the default. Returns an empty
 * string when the caller explicitly disabled cloud with
 * `OS_CLOUD_URL=off` / `local` — callers should treat that as
 * "marketplace unavailable on this runtime".
 */
export function resolveCloudUrl(explicit?: string | null): string {
    const raw = (explicit ?? process.env.OS_CLOUD_URL ?? '').trim();
    if (isDeclinedSpelling(raw)) {
        return '';
    }
    const picked = raw || DEFAULT_CLOUD_URL;
    return picked.replace(/\/+$/, '');
}

/**
 * Did this deployment DECLARE that it has no control plane (#10805)?
 *
 * ## Why this is not `resolveCloudUrl(...) === ''`
 *
 * That test conflates two opposite deployments, and the conflation is not
 * theoretical — it is what every CLI-served runtime looks like. `''` is also
 * how a host says **"keep requests on this origin"**, which
 * `RuntimeConfigPlugin`'s constructor special-cases before it ever calls the
 * resolver. That says where requests go, not who serves them: the runtime may
 * serve the catalog itself or proxy a control plane it does not name, so `''`
 * reads neither as "this runtime is the cloud" nor as "there is no upstream".
 * Measured on `main`: `Serve.RUNTIME_CONFIG_OPTIONS` passes
 * `controlPlaneUrl: ''` on **both** the cloud-connected arm and the air-gapped
 * arm of the CLI's marketplace wiring, so the resolved URL carries no posture
 * information whatsoever on the product path. A posture read built on it would
 * report every hosted console as air-gapped and every air-gapped box as
 * hosted — in the second direction, silently.
 *
 * This asks the different, answerable question: was one of the documented
 * decline spellings actually said? An empty string is not one of them, an
 * unset env var is not one of them, and `https://…` is not one of them.
 *
 * Pass the host's explicit argument to ask about that argument; pass nothing to
 * ask about the deployment's environment. Callers that must catch both doors
 * ask twice — see `RuntimeConfigPlugin.declinesControlPlane()`.
 */
export function isControlPlaneDeclined(explicit?: string | null): boolean {
    return isControlPlaneDeclinedInCore(explicit);
}
