// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An authored connector entry (`DeclarativeConnectorEntrySchema`, behind
// `defineStack({ connectors })`, `os validate` / `os compile`, the artifact load
// and `PUT /meta/connector/:name`) refuses every TOP-LEVEL key its shape does
// not declare, located at the key, where it used to parse green. Every refusal
// is pinned by its issue `code`, `path` and `keys`; every case has a CONTROL
// accept, so a refusal that fired on everything could not pass. The open
// runtime carrier, `ConnectorSchema`, keeps its posture, pinned as a control.
//
// Every value below is an obviously-fake placeholder, and the refusal must
// never echo it.

import { describe, it, expect } from 'vitest';
import { ConnectorSchema, DeclarativeConnectorEntrySchema } from './connector.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';

const PLACEHOLDER = 'TEST_PLACEHOLDER_NOT_A_SECRET';

const INSTANCE = {
  name: 'vendor',
  label: 'Vendor',
  type: 'api',
  provider: 'rest',
  providerConfig: { baseUrl: 'https://vendor.example.com' },
  auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN' },
} as const;

const DESCRIPTOR = { name: 'erp', label: 'ERP', type: 'database', enabled: false } as const;

/** The one issue of a refused parse, as `[code, path, keys]`, and its message. */
function refusal(input: unknown): { located: [string, string, unknown]; message: string } {
  const result = DeclarativeConnectorEntrySchema.safeParse(input);
  expect(result.success, 'the entry must be refused').toBe(false);
  expect(result.error!.issues, JSON.stringify(result.error!.issues)).toHaveLength(1);
  const issue = result.error!.issues[0]!;
  return {
    located: [issue.code, issue.path.join('.'), (issue as { keys?: unknown }).keys],
    message: issue.message,
  };
}

describe('an authored connector entry refuses an undeclared top-level key', () => {
  it.each([
    ['a provider-bound instance', INSTANCE],
    ['a catalog descriptor', DESCRIPTOR],
  ] as const)('CONTROL: %s with only declared keys parses', (_label, entry) => {
    expect(DeclarativeConnectorEntrySchema.safeParse(entry).success).toBe(true);
  });

  it.each([
    ['a credential-shaped scalar', { apiKey: PLACEHOLDER }, ['apiKey']],
    ['a nested container', { extraConfig: { secret: PLACEHOLDER } }, ['extraConfig']],
    ['two undeclared keys', { token: PLACEHOLDER, vendorRegion: 'eu' }, ['token', 'vendorRegion']],
  ] as const)('%s: refused at the entry root, naming each key, never the value', (_label, extra, keys) => {
    for (const entry of [INSTANCE, DESCRIPTOR]) {
      const { located, message } = refusal({ ...entry, ...extra });
      expect(located).toEqual(['unrecognized_keys', '', keys]);
      expect(message).toContain('this connector entry');
      for (const key of keys) expect(message).toContain(`\`${key}\``);
      expect(message).not.toContain(PLACEHOLDER);
    }
  });

  it('a credential-shaped key meets the credentialRef prescription', () => {
    const { message } = refusal({ ...INSTANCE, apiKey: PLACEHOLDER });
    expect(message).toContain('`auth: { type, credentialRef }`');
  });

  it('a provider setting written at the top level is pointed at `providerConfig`', () => {
    const { message } = refusal({ ...INSTANCE, baseUrl: 'https://vendor.example.com' });
    expect(message).toContain('`providerConfig`');
  });

  it('the refusal is terminal: an undeclared key beside a refined fault is the one issue', () => {
    // An inline `authentication` is the ADR-0097 refinement's refusal; with an
    // undeclared key beside it the entry meets the closed shape's refusal alone.
    const { located } = refusal({ ...INSTANCE, authentication: { type: 'bearer', token: 'x' }, vendorRegion: 'eu' });
    expect(located).toEqual(['unrecognized_keys', '', ['vendorRegion']]);
  });

  it('the ADR-0010 protection envelope is declared, so a stamped entry still parses', () => {
    const stamped = {
      ...INSTANCE,
      _lock: 'full',
      _lockReason: 'shipped by a package',
      _lockSource: 'package',
      _provenance: 'package',
      _packageId: 'com.example.vendor',
      _packageVersion: '1.0.0',
    };
    const parsed = DeclarativeConnectorEntrySchema.safeParse(stamped);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data!._packageId).toBe('com.example.vendor');
  });

  it('a retired key keeps its own prescription, and a retired default stays accepted as residue', () => {
    const retired = DeclarativeConnectorEntrySchema.safeParse({ ...INSTANCE, triggers: [] });
    expect(retired.success).toBe(false);
    expect(retired.error!.issues.map((i) => i.code)).not.toContain('unrecognized_keys');
    expect(DeclarativeConnectorEntrySchema.safeParse({ ...INSTANCE, status: 'inactive' }).success).toBe(true);
  });

  it('the stack door refuses it too, located at the entry', () => {
    const result = ObjectStackDefinitionSchema.safeParse({ connectors: [{ ...INSTANCE, apiKey: PLACEHOLDER }] });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.path.join('.')).toBe('connectors.0');
    expect((issue as { keys?: unknown }).keys).toEqual(['apiKey']);
    expect(ObjectStackDefinitionSchema.safeParse({ connectors: [INSTANCE] }).success).toBe(true);
  });

  it('CONTROL: the runtime carrier `ConnectorSchema` keeps its open posture', () => {
    // The def a plugin hands to `registerConnector` is a code-to-code shape and
    // is not narrowed here: it still drops an undeclared key at parse.
    const parsed = ConnectorSchema.safeParse({ ...INSTANCE, vendorRegion: 'eu' });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('vendorRegion');
  });
});
