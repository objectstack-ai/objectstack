// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Resolves a credential REFERENCE to its plaintext secret, or `undefined`/empty
 * when unknown. Two references go through it: a declarative connector's
 * `auth.credentialRef` (third in its chain, after the environment and the
 * `sys_connector_credential` store — #27237; an unresolved one degrades the
 * instance naming it), and
 * an `api` flow's start-node `config.secretRef` (at every inbound post — an
 * unresolved one refuses that post as unavailable). May be async so an
 * enterprise resolver can hit a vault. The open-tier default reads from
 * `process.env` (see {@link defaultEnvCredentialResolver}).
 */
export type CredentialResolver = (ref: string) => string | undefined | Promise<string | undefined>;

/**
 * Open-tier credential resolver (ADR-0097 §3, ADR-0015 open/enterprise line):
 * a reference is the name of an environment variable. This is the
 * degraded-but-honest story for environments without a managed secrets service —
 * static credentials from env/config are open source; managed vaulting, OAuth2
 * refresh, and per-tenant connection lifecycle are the enterprise tier.
 */
export const defaultEnvCredentialResolver: CredentialResolver = (ref) =>
    typeof process !== 'undefined' ? process.env?.[ref] : undefined;
