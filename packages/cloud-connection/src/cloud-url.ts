// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

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

/**
 * The spellings by which a deployment declares "this runtime has no control
 * plane" — the repo's one existing, documented, network-posture declaration.
 *
 * ONE definition, read in two directions: `resolveCloudUrl()` turns it into an
 * empty URL, and {@link isControlPlaneDeclined} answers whether it was said at
 * all. They were a single inline list until the telemetry posture (#10805)
 * needed the second question; keeping two copies would let "what counts as
 * off" drift between "no cloud calls" and "no client telemetry", which is
 * precisely the pair that must never disagree.
 */
const CLOUD_DECLINED_SPELLINGS: readonly string[] = ['off', 'none', 'local', 'disabled'];

/** Is this raw declaration one of the documented "no control plane" spellings? */
function isDeclinedSpelling(raw: string): boolean {
    return CLOUD_DECLINED_SPELLINGS.includes(raw.trim().toLowerCase());
}

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
 * how a host says **"this runtime IS the cloud"** (same origin), which
 * `RuntimeConfigPlugin`'s constructor special-cases before it ever calls the
 * resolver. Measured on `main`: `Serve.RUNTIME_CONFIG_OPTIONS` passes
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
    return isDeclinedSpelling(explicit ?? process.env.OS_CLOUD_URL ?? '');
}
