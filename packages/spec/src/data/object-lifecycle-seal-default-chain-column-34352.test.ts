// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from './object.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

// ---------------------------------------------------------------------------
// [ADR-0154 D10, note on `chainField`] A `lifecycle.seal` that names no
// `chainField` chains by the default column `tenant_id`, and that column is
// held to the rules a NAMED `chainField` is: it is a field of the object
// (declared, or injected — the registry injects `organization_id`, never
// `tenant_id`), its value is one text on every store, and `valueFields` does
// not list it. Each refusal is one located issue at `lifecycle.seal`, asserted
// by code, path and the first sentence of its message. The sealer still
// reports such an object at run time for a definition that skips the parse
// (plugin-audit `audit-seal-sealer.test.ts`, "with no tenant_id field").
// ---------------------------------------------------------------------------

const AUDIT = { class: 'audit', retention: { maxAge: '90d' } } as const;

const ledger = (seal: Record<string, unknown>, fields: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  name: 'ai_audit_probe',
  fields: {
    id: { type: 'text', label: 'ID' },
    created_at: { type: 'datetime', label: 'Created At' },
    action: { type: 'text', label: 'Action' },
    payload: { type: 'textarea', label: 'Payload' },
    ...fields,
  },
  lifecycle: { ...AUDIT, seal },
  ...extra,
});

function issues(input: unknown): Array<{ code: string; path: PropertyKey[]; message: string }> {
  const parsed = ObjectSchema.safeParse(input);
  expect(parsed.success, 'the declaration must NOT parse clean').toBe(false);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));
}

function sealOf(input: unknown) {
  const parsed = ObjectSchema.safeParse(input);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  return parsed.success ? parsed.data.lifecycle?.seal : undefined;
}

const LEAD = /^`lifecycle\.seal` names no `chainField`, so the sealer chains each row by the default chain column `tenant_id`/;

describe('lifecycle.seal with no chainField — a default tenant_id the object does not have is refused', () => {
  it('refuses an object with no tenant_id field, at lifecycle.seal, naming organization_id as the fix', () => {
    const [issue, ...rest] = issues(ledger({ valueFields: ['payload'] }));
    expect(rest).toEqual([]);
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['lifecycle', 'seal']);
    expect(issue.message).toMatch(LEAD);
    expect(issue.message.split('. ')[0]).toMatch(/`tenant_id`, which is not a field of this object$/);
    expect(issue.message).toContain('`organization_id`, the tenant column the platform injects');
  });

  it.each([
    ['systemFields.tenant: false', { systemFields: { tenant: false } }],
    ['tenancy.enabled: false', { tenancy: { enabled: false } }],
  ])('names a declared column, not organization_id, where the registry injects no tenant column (%s)', (_label, extra) => {
    const [issue, ...rest] = issues(ledger({ valueFields: [] }, {}, extra));
    expect(rest).toEqual([]);
    expect(issue.path).toEqual(['lifecycle', 'seal']);
    expect(issue.message).toMatch(LEAD);
    expect(issue.message).not.toContain('organization_id');
  });
});

describe('lifecycle.seal with no chainField — a default tenant_id whose value is not one text on every store is refused', () => {
  it.each([
    ['number', { type: 'number' }],
    ['boolean', { type: 'boolean' }],
    ['datetime', { type: 'datetime' }],
    ['json', { type: 'json' }],
    ['multiselect', { type: 'multiselect', options: [{ label: 'A', value: 'org_a' }] }],
    ['lookup (multi-value)', { type: 'lookup', reference: 'sys_organization', multiple: true }],
  ])('refuses a declared %s tenant_id, at lifecycle.seal', (type, def) => {
    const [issue, ...rest] = issues(ledger({ valueFields: [] }, { tenant_id: { label: 'Organization', ...def } }));
    expect(rest).toEqual([]);
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['lifecycle', 'seal']);
    expect(issue.message).toMatch(LEAD);
    expect(issue.message.split('. ')[0]).toContain(`\`tenant_id\`, a \`${type}\` column, whose value is not one text on every store`);
  });
});

describe('lifecycle.seal with no chainField — a default tenant_id that valueFields lists is refused', () => {
  it('refuses tenant_id listed in valueFields, at lifecycle.seal', () => {
    const [issue, ...rest] = issues(ledger({ valueFields: ['payload', 'tenant_id'] }, { tenant_id: { type: 'text', label: 'Organization' } }));
    expect(rest).toEqual([]);
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['lifecycle', 'seal']);
    expect(issue.message).toMatch(LEAD);
    expect(issue.message.split('. ')[0]).toMatch(/`tenant_id`, which `lifecycle\.seal\.valueFields` also lists$/);
  });
});

describe('lifecycle.seal — CONTROLS that still parse', () => {
  it.each([
    ['text', { type: 'text' }],
    ['lookup', { type: 'lookup', reference: 'sys_organization' }],
  ])('a seal naming no chainField on an object that declares a %s tenant_id', (_label, def) => {
    expect(sealOf(ledger({ valueFields: ['payload'] }, { tenant_id: { label: 'Organization', ...def } }))).toEqual({ valueFields: ['payload'] });
  });

  it('a chainField naming a declared field, on an object with no tenant_id', () => {
    expect(sealOf(ledger({ valueFields: ['payload'], chainField: 'org_ref' }, { org_ref: { type: 'text', label: 'Org' } })))
      .toEqual({ valueFields: ['payload'], chainField: 'org_ref' });
  });

  it('a chainField naming the injected organization_id, on an object with no tenant_id', () => {
    expect(sealOf(ledger({ valueFields: ['payload'], chainField: 'organization_id' })))
      .toEqual({ valueFields: ['payload'], chainField: 'organization_id' });
  });

  it('a named chainField leaves tenant_id unjudged: a number tenant_id parses beside chainField organization_id', () => {
    expect(sealOf(ledger({ valueFields: [], chainField: 'organization_id' }, { tenant_id: { type: 'number', label: 'Legacy' } })))
      .toEqual({ valueFields: [], chainField: 'organization_id' });
  });
});

describe('lifecycle.seal with no chainField — the doors that parse ObjectSchema refuse it too', () => {
  const unchainable = () => ledger({ valueFields: ['payload'] });

  it('the stack definition `os validate` and `os build` parse', () => {
    const parsed = ObjectStackDefinitionSchema.safeParse({ objects: [unchainable()] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.filter((i) => LEAD.test(i.message)).map((i) => i.path)).toEqual([['objects', 0, 'lifecycle', 'seal']]);
  });

  it("the metadata type schema the save door judges an object against (getMetadataTypeSchema('object'))", () => {
    const schema = getMetadataTypeSchema('object');
    expect(schema).toBeDefined();
    const parsed = schema!.safeParse(unchainable());
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.filter((i) => LEAD.test(i.message)).map((i) => i.path)).toEqual([['lifecycle', 'seal']]);
  });
});
