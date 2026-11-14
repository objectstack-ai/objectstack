// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The boot report of stored SSO providers whose `domain` list holds an entry
 * that names no domain.
 *
 * Register and edit refuse a `domain` entry that is not a bare host name
 * (`ssoDomainEntryNotBare`, `sso-account-at-proven-domain.ts`), and every
 * rule that judges an address against the list (the SSO account rule and SCIM
 * adoption) reads such an entry as naming no domain (`ssoDomainEntryHosts`).
 * A `sys_sso_provider` row saved before that refusal may still hold one
 * (`https://acme.com`). It is not rewritten, so without this report the
 * provider looks configured while no address is at a domain it has proven.
 *
 * Once per boot, on `kernel:ready`, every stored provider is read as the
 * system and each one whose list holds such an entry is named in one `warn`:
 * its `provider_id` and the entries, with the fix (send the bare host names as
 * `domain` to `POST /api/v1/auth/sso/update-provider`, then verify the domain
 * again). `warn`, not `error`: the provider refuses the sign-ins it cannot
 * judge, so nothing claims to be stored that is not.
 *
 * Reads only: no row is written. Never throws into boot: no engine, an
 * engine that cannot read, an unregistered `sys_sso_provider` or a failed
 * read reports nothing.
 */

import type { IDataEngine } from '@objectstack/core';
import { withSystemContext } from './objectql-adapter.js';
import { ssoDomainEntriesNotBare } from './sso-account-at-proven-domain.js';
import { SSO_PROVIDER_OBJECT } from './sso-client-secret.js';

/** One stored provider whose `domain` list holds entries that name no domain. */
export interface SsoStoredDomainEntryFinding {
  providerId: string;
  /** The entries `ssoDomainEntryNotBare` refuses, trimmed, in list order. */
  entries: string[];
}

/** The logger surface the report needs. */
export interface SsoStoredDomainEntryLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  debug?(message: string, meta?: Record<string, unknown>): void;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function registered(engine: IDataEngine, object: string): boolean {
  const getSchema = (engine as unknown as { getSchema?: (name: string) => unknown }).getSchema;
  return typeof getSchema !== 'function' || Boolean(getSchema.call(engine, object));
}

/**
 * The stored providers whose `domain` list holds an entry that is not a bare
 * host name, in read order. Reads `provider_id` and `domain` of every
 * provider as the system; writes nothing.
 */
export async function findSsoProvidersWithNonBareDomainEntries(
  engine: IDataEngine,
): Promise<SsoStoredDomainEntryFinding[]> {
  const reader = withSystemContext(engine);
  const rows = await reader.find(SSO_PROVIDER_OBJECT, { fields: ['provider_id', 'domain'] } as never);
  const findings: SsoStoredDomainEntryFinding[] = [];
  for (const row of Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []) {
    const entries = ssoDomainEntriesNotBare(row?.domain);
    if (entries.length > 0) findings.push({ providerId: text(row.provider_id), entries });
  }
  return findings;
}

/** The warning for one finding: the provider, its entries, and the fix. */
export function ssoStoredDomainEntryWarning(finding: SsoStoredDomainEntryFinding): string {
  const entries = finding.entries.map((entry) => `'${entry}'`).join(', ');
  const plural = finding.entries.length > 1;
  return (
    `[sso] SSO provider '${finding.providerId}' stores the domain ${plural ? 'entries' : 'entry'} ${entries}, `
    + `which ${plural ? 'are not bare host names and name' : 'is not a bare host name and names'} no domain: `
    + 'no email address is at a domain this provider has proven through '
    + `${plural ? 'them' : 'it'}. Send the bare host names as \`domain\` to `
    + 'POST /api/v1/auth/sso/update-provider (https://acme.com becomes acme.com), then verify the domain again. '
    + 'The stored row was not changed.'
  );
}

/**
 * Report {@link findSsoProvidersWithNonBareDomainEntries} at boot: one `warn`
 * per provider, nothing when every entry is a bare host name. Answers the
 * findings it reported. Never throws.
 */
export async function reportSsoProvidersWithNonBareDomainEntries(
  engine: IDataEngine | undefined,
  logger: SsoStoredDomainEntryLogger,
): Promise<SsoStoredDomainEntryFinding[]> {
  if (!engine || typeof (engine as { find?: unknown }).find !== 'function') return [];
  let findings: SsoStoredDomainEntryFinding[];
  try {
    if (!registered(engine, SSO_PROVIDER_OBJECT)) return [];
    findings = await findSsoProvidersWithNonBareDomainEntries(engine);
  } catch (err) {
    logger.debug?.('[sso] the stored SSO provider domain lists could not be read for the boot report', {
      error: String((err as Error)?.message ?? err),
    });
    return [];
  }
  for (const finding of findings) {
    logger.warn(ssoStoredDomainEntryWarning(finding), {
      providerId: finding.providerId,
      entries: finding.entries,
    });
  }
  return findings;
}
