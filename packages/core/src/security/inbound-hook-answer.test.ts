// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  admitInboundHookAddress,
  inboundHookRefusal,
  inboundHookJsonResponse,
  inboundHookRefusalResponse,
  inboundHookSharedNameRefusal,
} from './inbound-hook-answer';

describe('[ADR-0150 D5] the qualified inbound hook: admission and the one refusal', () => {
  it('a namespace admits a flow one of its packages ships, and nothing else', () => {
    expect(admitInboundHookAddress({ qualifier: 'crm', flowOwner: 'com.crm', namespaceOwners: ['com.crm'] })).toBe(true);
    // a shareable namespace's co-owner ships it
    expect(admitInboundHookAddress({ qualifier: 'base', flowOwner: 'com.b', namespaceOwners: ['com.a', 'com.b'] })).toBe(true);
    // another namespace's flow, an environment flow, an uninstalled namespace
    expect(admitInboundHookAddress({ qualifier: 'hr', flowOwner: 'com.crm', namespaceOwners: ['com.hr'] })).toBe(false);
    expect(admitInboundHookAddress({ qualifier: 'crm', flowOwner: undefined, namespaceOwners: ['com.crm'] })).toBe(false);
    expect(admitInboundHookAddress({ qualifier: 'nope', flowOwner: 'com.crm', namespaceOwners: [] })).toBe(false);
  });

  it('`_env` admits a flow no package ships, never a packaged one', () => {
    expect(admitInboundHookAddress({ qualifier: '_env', flowOwner: undefined, namespaceOwners: [] })).toBe(true);
    expect(admitInboundHookAddress({ qualifier: '_env', flowOwner: 'com.crm', namespaceOwners: [] })).toBe(false);
  });

  it('the one refusal: 401 INVALID_SIGNATURE, a fresh object per call', () => {
    const first = inboundHookRefusal();
    expect(first).toEqual({ status: 401, body: { success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } } });
    (first.body as any).success = true;
    expect(inboundHookRefusal().body.success).toBe(false);
  });

  it('rendered as Hono\'s c.json renders it: the JSON body and one Content-Type header', async () => {
    const response = inboundHookRefusalResponse();
    expect(response.status).toBe(401);
    expect([...response.headers.entries()]).toEqual([['content-type', 'application/json']]);
    expect(await response.text()).toBe(JSON.stringify(inboundHookRefusal().body));
    const other = inboundHookJsonResponse({ accepted: true }, 202);
    expect([other.status, await other.text()]).toEqual([202, '{"accepted":true}']);
  });
});

describe('[ADR-0150 D5, #31696] the bare hook of a flow name two packages hold', () => {
  it('answers 409 RESOURCE_CONFLICT naming each holder\'s qualified address and every holder, never a pick', () => {
    const { status, body } = inboundHookSharedNameRefusal({
      flowName: 'lead_intake',
      hookId: 'h1',
      holders: [
        { kind: 'package', packageId: 'com.acme.alpha', namespace: 'alpha' },
        { kind: 'package', packageId: 'com.acme.beta', namespace: 'beta' },
      ],
    });
    expect(status).toBe(409);
    const error = (body as { error: { code: string; message: string; httpStatus: number; details: { candidates: unknown; addresses: string[] } } }).error;
    expect([error.code, error.httpStatus]).toEqual(['RESOURCE_CONFLICT', 409]);
    expect(error.details.addresses).toEqual(['/api/v1/automation/hooks/alpha/lead_intake/h1', '/api/v1/automation/hooks/beta/lead_intake/h1']);
    expect(error.details.candidates).toEqual([
      { kind: 'package', packageId: 'com.acme.alpha' },
      { kind: 'package', packageId: 'com.acme.beta' },
    ]);
    expect(error.message).toContain("'com.acme.alpha' and 'com.acme.beta'");
    for (const address of error.details.addresses) expect(error.message).toContain(address);
  });

  it('a holder with no qualified hook is a candidate with no address: no namespace, a namespace the address cannot carry (`runs`); the environment is `_env`', () => {
    const { body } = inboundHookSharedNameRefusal({
      flowName: 'f',
      hookId: 'h',
      holders: [
        { kind: 'package', packageId: 'com.acme.none' },
        { kind: 'package', packageId: 'com.acme.runs', namespace: 'runs' },
        { kind: 'environment' },
      ],
    });
    const error = (body as { error: { details: { candidates: unknown[]; addresses: string[] } } }).error;
    expect(error.details.addresses).toEqual(['/api/v1/automation/hooks/_env/f/h']);
    expect(error.details.candidates).toHaveLength(3);
  });
});
