// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Resolves a `credentialRef` to the secret it names (ADR-0143 D3, ADR-0097 §3).
 *
 * The push transports never hold a secret in configuration: the APNs `.p8`
 * signing key and the FCM service-account JSON are each named by a
 * `credentialRef` (`PushServiceConfigSchema`), and the transport asks this
 * resolver for the value when it first needs to sign. May be async, so an
 * enterprise resolver can read a vault. Answers `undefined` (or an empty
 * string) when the reference names nothing.
 */
export type PushCredentialResolver = (ref: string) => string | undefined | Promise<string | undefined>;

/**
 * The open-tier resolver: a reference is the name of an environment variable.
 * The same rule as service-automation's `defaultEnvCredentialResolver` for a
 * connector's `credentialRef`.
 */
export const envPushCredentialResolver: PushCredentialResolver = (ref) =>
    typeof process !== 'undefined' ? process.env?.[ref] : undefined;

/**
 * Resolve `ref`, refusing an empty answer with an error that names the
 * reference and never a value.
 */
export async function resolveRequiredCredential(
    resolve: PushCredentialResolver,
    ref: string,
    what: string,
): Promise<string> {
    const value = await resolve(ref);
    if (typeof value !== 'string' || value.trim() === '') {
        throw new PushCredentialError(
            `credential_unresolved: the ${what} credentialRef '${ref}' names no secret `
            + '(in the open tier, set the environment variable of that name)',
        );
    }
    return value;
}

/**
 * A credential that is missing or unusable. No retry can repair it, so the
 * transports answer it as a non-retryable failure.
 */
export class PushCredentialError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PushCredentialError';
    }
}
