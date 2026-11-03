// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29574] `ConnectorConnectionState.redirectUri` — the deployment's derived
 * OAuth redirect URI, answered on the connection read so the Console's Connect
 * step can show it before an administrator registers a client with the vendor
 * (ADR-0143 D5, D2.1).
 *
 * Pinned at the type level, because a TypeScript interface member has no Zod
 * schema to assert against (the `automation-toggle-flow-caller` pin's form,
 * compiled by `check:test-typecheck` under `tsconfig.test.json`):
 *
 *  1. **One optional string.** Absent is a legal answer (no base to derive
 *     from), so a state without it still compiles, and the key carries the URI
 *     itself, never a structure around it.
 *  2. **Read-only.** No connection request carries it: the redirect URI is
 *     never taken from a request, so the request type has no such key.
 *  3. **Additive.** Every key the state carried before keeps its type.
 *  4. **The TSDoc states when it is present.** Prose is unassertable except by
 *     reading it, so the contract source is read and the doc block above the
 *     key is required to name both absence conditions.
 *
 * ⛔ Not pinned here: that the connection door answers it. That is the server
 * half, `@objectstack/service-automation`'s `getConnectorConnection` (#29463).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import type { ConnectorConnectionRequest, ConnectorConnectionState } from './automation-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert< T extends true > = T;

// Exported deliberately — an unread alias is TS6196, and a pin no program compiles is no pin at all.

/** The key is a string, and optional. */
export type RedirectUriIsAnOptionalString = Assert< Eq< ConnectorConnectionState['redirectUri'], string | undefined > >;
export type RedirectUriIsOptional = Assert< Eq< {} extends Pick< ConnectorConnectionState, 'redirectUri' > ? true : false, true > >;
/** No request names it: the URI is fixed per deployment, never taken from a caller. */
export type RequestCarriesNoRedirectUri = Assert< Eq< 'redirectUri' extends keyof ConnectorConnectionRequest ? true : false, false > >;
/** Additive: the keys the state carried before are unchanged. */
export type PriorKeysUnchanged = Assert< Eq<
  Omit< ConnectorConnectionState, 'redirectUri' >,
  {
    connector: string;
    organizationId: string;
    status: 'not_connected' | 'connected' | 'reconnect_required';
    statusReason?: string;
    scopes?: string;
    expiresAt?: string;
    connectedAt?: string;
    connectedBy?: string;
    client?: { source: 'installer'; clientId: string; hasSecret: boolean };
  }
> >;

/** A state the server could derive no URI for still compiles. */
export const withoutBase: ConnectorConnectionState = { connector: 'docusign', organizationId: 'org_1', status: 'not_connected' };
// @ts-expect-error — the key carries the URI itself, not a structure around it.
export const structured: ConnectorConnectionState = { ...withoutBase, redirectUri: { url: 'https://crm.example.com' } };

const SOURCE = readFileSync(fileURLToPath(new URL('./automation-service.ts', import.meta.url)), 'utf8');

/** The doc block directly above the key, read from the contract source. */
function docAbove(key: string): string {
  const at = SOURCE.indexOf(`    ${key}?: string;\n}`);
  expect(at, `${key} is the last member of ConnectorConnectionState`).toBeGreaterThan(0);
  const open = SOURCE.lastIndexOf('/**', at);
  return SOURCE.slice(open, at);
}

describe('ConnectorConnectionState.redirectUri — the derived OAuth redirect URI', () => {
  it('a state carries the URI the server derived, and reads it back unchanged', () => {
    const uri = 'https://crm.example.com/api/v1/automation/connectors/oauth/callback';
    const state: ConnectorConnectionState = { ...withoutBase, redirectUri: uri };
    expect(state.redirectUri).toBe(uri);
    expect(withoutBase.redirectUri).toBeUndefined();
  });

  it('the TSDoc names the callback path, the derivation chain and both absence conditions', () => {
    const doc = docAbove('redirectUri');
    expect(doc.length).toBeGreaterThan(0);
    expect(doc).toContain('/api/v1/automation/connectors/oauth/callback');
    for (const source of ['connectorOAuthRedirectUri', 'OS_AUTH_URL', 'OS_BASE_URL']) expect(doc).toContain(source);
    // Absent when there is no base — never a guess.
    expect(doc).toMatch(/Absent when\s+\*?\s*the deployment has no base/);
    expect(doc).toMatch(/never guessed/);
    // Absent for every grant other than `authorization_code`.
    expect(doc).toMatch(/no other grant ever\s+\*?\s*carries it/);
  });
});
