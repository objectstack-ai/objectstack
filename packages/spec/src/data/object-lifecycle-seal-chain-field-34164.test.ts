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

  it('leaves a seal that names no chain column, on an object that declares tenant_id, as authored: no key added', () => {
    // The default chain column is judged too (object-lifecycle-seal-default-chain-column-34352.test.ts).
    const input = ledger({ valueFields: ['payload'] });
    (input.fields as Record<string, unknown>).tenant_id = { type: 'text', label: 'Organization' };
    expect(sealOf(input)).toEqual({ valueFields: ['payload'] });
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

// ---------------------------------------------------------------------------
// A column the object HAS is still refused when it cannot name an
// organization chain: a column whose value is not one text on every store, a
// column that orders the leaves, and a `valueFields` member. Each refusal is
// asserted by code, path and the first sentence of its message.
// ---------------------------------------------------------------------------

function issues(input: unknown): Array<{ code: string; path: PropertyKey[]; message: string }> {
  const parsed = ObjectSchema.safeParse(input);
  expect(parsed.success, 'the declaration must NOT parse clean').toBe(false);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));
}

const withField = (name: string, def: Record<string, unknown>, seal: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const input = ledger(seal, extra);
  (input.fields as Record<string, unknown>)[name] = { label: name, ...def };
  return input;
};

describe('lifecycle.seal.chainField — a text column that holds the organization parses', () => {
  it.each([
    ['text', { type: 'text' }],
    ['lookup', { type: 'lookup', reference: 'sys_organization' }],
    ['select', { type: 'select', options: [{ label: 'A', value: 'org_a' }] }],
  ])('accepts a declared %s column', (_label, def) => {
    expect(sealOf(withField('org_ref', def, { valueFields: ['payload'], chainField: 'org_ref' }))).toEqual({
      valueFields: ['payload'],
      chainField: 'org_ref',
    });
  });
});

describe('lifecycle.seal.chainField — a column whose value is not one text on every store is refused', () => {
  it.each([
    ['number', { type: 'number' }],
    ['currency', { type: 'currency' }],
    ['boolean', { type: 'boolean' }],
    ['date', { type: 'date' }],
    ['datetime', { type: 'datetime' }],
    ['json', { type: 'json' }],
    ['multiselect', { type: 'multiselect', options: [{ label: 'A', value: 'opt_a' }] }],
  ])('refuses a declared %s column, at the key', (type, def) => {
    const [issue, ...rest] = issues(withField('org_ref', def, { valueFields: [], chainField: 'org_ref' }));
    expect(rest).toEqual([]);
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['lifecycle', 'seal', 'chainField']);
    expect(issue.message).toMatch(
      new RegExp(`^\`lifecycle\\.seal\\.chainField\` names \`org_ref\`, a \`${type}\` column, whose value is not one text on every store\\.`),
    );
  });

  it('refuses a lookup declared multiple: true, which stores a list', () => {
    const [issue, ...rest] = issues(
      withField('org_ref', { type: 'lookup', reference: 'sys_organization', multiple: true }, { valueFields: [], chainField: 'org_ref' }),
    );
    expect(rest).toEqual([]);
    expect(issue.path).toEqual(['lifecycle', 'seal', 'chainField']);
    expect(issue.message).toMatch(/^`lifecycle\.seal\.chainField` names `org_ref`, a `lookup \(multi-value\)` column, whose value is not one text on every store\./);
  });

  it('judges an injected column by the definition the registry injects: updated_at is a datetime', () => {
    const [issue, ...rest] = issues(ledger({ valueFields: [], chainField: 'updated_at' }));
    expect(rest).toEqual([]);
    expect(issue.path).toEqual(['lifecycle', 'seal', 'chainField']);
    expect(issue.message).toMatch(/^`lifecycle\.seal\.chainField` names `updated_at`, a `datetime` column, whose value is not one text on every store\./);
  });
});

describe('lifecycle.seal.chainField — a column that orders the leaves is refused, by the predicate valueFields reads', () => {
  it.each([
    ['id, declared', 'id'],
    ['created_at, declared', 'created_at'],
  ])('refuses %s, at the key', (_label, name) => {
    const [issue, ...rest] = issues(ledger({ valueFields: [], chainField: name }));
    expect(rest).toEqual([]);
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['lifecycle', 'seal', 'chainField']);
    expect(issue.message).toMatch(new RegExp(`^\`lifecycle\\.seal\\.chainField\` cannot name \`${name}\`: it orders each sealed leaf, and it names no organization\\.`));
  });

  it('refuses id where only the driver provides it (no declared id)', () => {
    const input = ledger({ valueFields: [], chainField: 'id' });
    delete (input.fields as Record<string, unknown>).id;
    const [issue, ...rest] = issues(input);
    expect(rest).toEqual([]);
    expect(issue.path).toEqual(['lifecycle', 'seal', 'chainField']);
    expect(issue.message).toMatch(/^`lifecycle\.seal\.chainField` cannot name `id`: it orders each sealed leaf/);
  });
});

describe('lifecycle.seal.chainField — a valueFields member is refused', () => {
  it('refuses a chain column the leaf also commits, at the key', () => {
    const [issue, ...rest] = issues(withField('org_ref', { type: 'text' }, { valueFields: ['payload', 'org_ref'], chainField: 'org_ref' }));
    expect(rest).toEqual([]);
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['lifecycle', 'seal', 'chainField']);
    expect(issue.message).toMatch(/^`lifecycle\.seal\.chainField` names `org_ref`, which `lifecycle\.seal\.valueFields` also lists\./);
  });

  it('refuses the injected organization_id listed in valueFields too', () => {
    // valueFields judges names against the AUTHORED map, so the undeclared name is refused there as well.
    const found = issues(ledger({ valueFields: ['organization_id'], chainField: 'organization_id' }));
    expect(found.filter((i) => i.path.join('.') === 'lifecycle.seal.chainField').map((i) => i.message.split('. ')[0])).toEqual([
      '`lifecycle.seal.chainField` names `organization_id`, which `lifecycle.seal.valueFields` also lists',
    ]);
  });
});
