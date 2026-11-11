// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from './object.zod';

// ---------------------------------------------------------------------------
// [ADR-0154 D10] `lifecycle.seal = { valueFields: string[] }` — the opt-in that
// seals an audit-class object's rows into signed checkpoints. Its reader is
// `@objectstack/plugin-audit`'s sealer.
//
// This file pins the SHAPE: a well-formed declaration round-trips, its absence
// changes nothing, and every refusal ADR-0154 D10 names is raised at authoring,
// located at the offending key. Refusals are asserted by code and path — the
// machine-readable subject — never by the prose.
// ---------------------------------------------------------------------------

const ledger = (lifecycle: Record<string, unknown>, fields: Record<string, unknown> = {}) => ({
  name: 'compliance_ledger_probe',
  fields: {
    id: { type: 'text', label: 'ID' },
    created_at: { type: 'datetime', label: 'Created At' },
    action: { type: 'text', label: 'Action' },
    old_value: { type: 'textarea', label: 'Old Value' },
    ...fields,
  },
  lifecycle,
});

// An audit class needs a bounding policy (ADR-0057 §3.5), so the base declares one.
const SEALED = { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['old_value'] } } as const;

/** The refusal issues, as `{ code, path }`, of an input that must NOT parse. */
function refusals(input: unknown): Array<{ code: string; path: PropertyKey[] }> {
  const parsed = ObjectSchema.safeParse(input);
  expect(parsed.success, 'the declaration must NOT parse clean').toBe(false);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({ code: i.code, path: i.path }));
}

function parsesClean(input: unknown) {
  const parsed = ObjectSchema.safeParse(input);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  return parsed;
}

describe('ObjectSchema lifecycle.seal — the declaration', () => {
  it('accepts a seal on an audit-class object and keeps it as authored', () => {
    const parsed = parsesClean(ledger({ ...SEALED, archive: { after: '90d', to: 'archive', keep: '7y' } }));
    if (!parsed.success) return;
    expect(parsed.data.lifecycle?.seal).toEqual({ valueFields: ['old_value'] });
  });

  it('accepts an empty valueFields: every declared column then enters in clear', () => {
    const parsed = parsesClean(ledger({ ...SEALED, seal: { valueFields: [] } }));
    if (!parsed.success) return;
    expect(parsed.data.lifecycle?.seal).toEqual({ valueFields: [] });
  });

  it('accepts a ttl measured from created_at beside it (a created_at cutoff aligns to windows)', () => {
    parsesClean(ledger({ class: 'audit', seal: SEALED.seal, ttl: { field: 'created_at', expireAfter: '30d' } }));
  });

  it('accepts retention.maxAge beside it — only onlyWhen is refused', () => {
    parsesClean(ledger({ ...SEALED }));
  });

  it('is optional: a lifecycle without it parses exactly as before, with no key materialized (control)', () => {
    const parsed = parsesClean(ledger({ class: 'audit', retention: { maxAge: '90d' } }));
    if (!parsed.success) return;
    expect('seal' in (parsed.data.lifecycle ?? {})).toBe(false);
  });

  it('is a known key at the authoring factory, so `ObjectSchema.create()` takes it', () => {
    const created = ObjectSchema.create({
      name: 'compliance_ledger_probe',
      fields: { id: { type: 'text', label: 'ID' }, old_value: { type: 'textarea', label: 'Old Value' } },
      lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['old_value'] } },
    });
    expect(created.lifecycle?.seal).toEqual({ valueFields: ['old_value'] });
  });

  it('is a closed shape: an unknown key under seal is refused, not dropped', () => {
    expect(refusals(ledger({ ...SEALED, seal: { valueFields: [], window: '1h' } })))
      .toContainEqual(expect.objectContaining({ path: ['lifecycle', 'seal'] }));
  });

  it('requires valueFields', () => {
    expect(refusals(ledger({ ...SEALED, seal: {} })))
      .toContainEqual({ code: 'invalid_type', path: ['lifecycle', 'seal', 'valueFields'] });
  });
});

describe('ObjectSchema lifecycle.seal — what it refuses (ADR-0154 D10)', () => {
  it.each(['record', 'transient', 'telemetry', 'event'] as const)('refuses seal on class %s, at lifecycle.seal', (cls) => {
    // A non-record class needs a bounding policy of its own; `record` takes none.
    const bound = cls === 'record' ? {} : { retention: { maxAge: '30d' } };
    expect(refusals(ledger({ class: cls, ...bound, seal: { valueFields: [] } }))).toEqual([{ code: 'custom', path: ['lifecycle', 'seal'] }]);
  });

  it('refuses a valueFields name that is not a declared field, at its index', () => {
    expect(refusals(ledger({ ...SEALED, seal: { valueFields: ['old_value', 'secret_note', 'action'] } })))
      .toEqual([{ code: 'custom', path: ['lifecycle', 'seal', 'valueFields', 1] }]);
  });

  it('refuses every undeclared name, one issue each', () => {
    expect(refusals(ledger({ ...SEALED, seal: { valueFields: ['a', 'b'] } })))
      .toEqual([
        { code: 'custom', path: ['lifecycle', 'seal', 'valueFields', 0] },
        { code: 'custom', path: ['lifecycle', 'seal', 'valueFields', 1] },
      ]);
  });

  it('refuses retention.onlyWhen beside it, at lifecycle.retention.onlyWhen', () => {
    expect(refusals(ledger({ ...SEALED, retention: { maxAge: '90d', onlyWhen: { action: 'delete' } } })))
      .toEqual([{ code: 'custom', path: ['lifecycle', 'retention', 'onlyWhen'] }]);
  });

  it('refuses a ttl on a field other than created_at beside it, at lifecycle.ttl.field', () => {
    expect(refusals(ledger({ class: 'audit', seal: SEALED.seal, ttl: { field: 'expires_at', expireAfter: '30d' } }, { expires_at: { type: 'datetime', label: 'Expires At' } })))
      .toEqual([{ code: 'custom', path: ['lifecycle', 'ttl', 'field'] }]);
  });

  it('refuses ttl.onlyWhen beside it, at lifecycle.ttl.onlyWhen', () => {
    expect(refusals(ledger({ class: 'audit', seal: SEALED.seal, ttl: { field: 'created_at', expireAfter: '30d', onlyWhen: { action: 'delete' } } })))
      .toEqual([{ code: 'custom', path: ['lifecycle', 'ttl', 'onlyWhen'] }]);
  });

  it('refuses id or created_at as a value field, at its index: they order the leaves', () => {
    expect(refusals(ledger({ ...SEALED, seal: { valueFields: ['id', 'old_value', 'created_at'] } })))
      .toEqual([
        { code: 'custom', path: ['lifecycle', 'seal', 'valueFields', 0] },
        { code: 'custom', path: ['lifecycle', 'seal', 'valueFields', 2] },
      ]);
  });

  it('refuses rotation storage beside it, at lifecycle.storage', () => {
    expect(refusals(ledger({ class: 'audit', seal: SEALED.seal, storage: { strategy: 'rotation', shards: 7, unit: 'day' } })))
      .toEqual([{ code: 'custom', path: ['lifecycle', 'storage'] }]);
  });

  it('names ADR-0154 D10 in each refusal', () => {
    const parsed = ObjectSchema.safeParse(ledger({ class: 'telemetry', seal: { valueFields: ['nope'] }, storage: { strategy: 'rotation', shards: 7, unit: 'day' } }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const sealIssues = parsed.error.issues.filter((i) => i.message.includes('seal'));
    expect(sealIssues.length).toBe(3);
    for (const issue of sealIssues) expect(issue.message).toContain('ADR-0154 D10');
  });
});
