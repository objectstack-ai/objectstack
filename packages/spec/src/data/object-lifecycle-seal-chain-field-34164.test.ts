// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from './object.zod';

// ---------------------------------------------------------------------------
// [ADR-0154 D10, note on `chainField`] `lifecycle.seal.chainField` names the
// column whose value is the organization chain a sealed row joins; absent, the
// sealer chains by `tenant_id`. Its reader is `@objectstack/plugin-audit`'s
// sealer and live check (`chainValueOf`).
//
// This file pins the authoring half: a named column the object has parses and
// is kept as authored — a declared field, or the tenant column the registry
// injects (ADR-0131 `organization_id`) — and a name the object does not have
// is refused, located at the key. Refusals are asserted by code and path.
// ---------------------------------------------------------------------------

const AUDIT = { class: 'audit', retention: { maxAge: '90d' } } as const;

const ledger = (seal: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name: 'ai_audit_probe',
  fields: {
    id: { type: 'text', label: 'ID' },
    created_at: { type: 'datetime', label: 'Created At' },
    action: { type: 'text', label: 'Action' },
    payload: { type: 'textarea', label: 'Payload' },
  },
  lifecycle: { ...AUDIT, seal },
  ...extra,
});

function refusals(input: unknown): Array<{ code: string; path: PropertyKey[] }> {
  const parsed = ObjectSchema.safeParse(input);
  expect(parsed.success, 'the declaration must NOT parse clean').toBe(false);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({ code: i.code, path: i.path }));
}

function sealOf(input: unknown) {
  const parsed = ObjectSchema.safeParse(input);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  return parsed.success ? parsed.data.lifecycle?.seal : undefined;
}

describe('lifecycle.seal.chainField — a column the object has parses, as authored', () => {
  it('accepts the tenant column the registry injects, organization_id, though the object never declares it', () => {
    expect(sealOf(ledger({ valueFields: ['payload'], chainField: 'organization_id' }))).toEqual({
      valueFields: ['payload'],
      chainField: 'organization_id',
    });
  });

  it('accepts a declared field', () => {
    const input = ledger({ valueFields: [], chainField: 'tenant_id' });
    (input.fields as Record<string, unknown>).tenant_id = { type: 'text', label: 'Organization' };
    expect(sealOf(input)).toEqual({ valueFields: [], chainField: 'tenant_id' });
  });

  it('leaves a seal that names no chain column exactly as before: no key added, no new refusal', () => {
    expect(sealOf(ledger({ valueFields: ['payload'] }))).toEqual({ valueFields: ['payload'] });
  });
});

describe('lifecycle.seal.chainField — a name the object does not have is refused at authoring', () => {
  it('refuses a name that is neither declared nor injected, at the key', () => {
    expect(refusals(ledger({ valueFields: [], chainField: 'org' }))).toEqual([
      { code: 'custom', path: ['lifecycle', 'seal', 'chainField'] },
    ]);
  });

  it('refuses tenant_id when the object does not declare it, though it is the default', () => {
    expect(refusals(ledger({ valueFields: [], chainField: 'tenant_id' }))).toEqual([
      { code: 'custom', path: ['lifecycle', 'seal', 'chainField'] },
    ]);
  });

  it.each([
    ['systemFields: false', { systemFields: false }],
    ['systemFields.tenant: false', { systemFields: { tenant: false } }],
    ['tenancy.enabled: false', { tenancy: { enabled: false } }],
  ])('refuses organization_id where the registry injects no tenant column (%s)', (_label, extra) => {
    expect(refusals(ledger({ valueFields: [], chainField: 'organization_id' }, extra))).toEqual([
      { code: 'custom', path: ['lifecycle', 'seal', 'chainField'] },
    ]);
  });
});
