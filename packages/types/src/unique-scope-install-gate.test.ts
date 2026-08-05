// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  collectGlobalUniques,
  globalUniqueFindingId,
  isPlatformOwnedObject,
  fieldUniqueIsGlobal,
  declaredIndexUniqueIsGlobal,
  unconfirmedGlobalUniques,
  recordGlobalUniqueAttestation,
  buildGlobalUniqueStopMessage,
  postureGatesGlobalUniques,
  describeGlobalUniqueFinding,
  type GlobalUniqueFinding,
} from './unique-scope-install-gate.js';

/**
 * ADR-0120 D5e — the enumeration behind the `isolated` install gate.
 *
 * These pin the CLASSIFICATION, which is where the gate can silently go wrong:
 * a spelling wrongly excluded is a bypass (the constraint lands cross-customer
 * and nobody is asked), a spelling wrongly included is the #4884 false-alarm
 * class (every install of every app stops over a per-organization constraint).
 */
describe('ADR-0120 D5e — collectGlobalUniques', () => {
  it('finds a field-level `unique: \'global\'` on an app object', () => {
    const findings = collectGlobalUniques([
      { name: 'material', fields: { code: { type: 'text', unique: 'global' } } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      object: 'material',
      kind: 'field',
      name: 'code',
      columns: ['code'],
      spelling: 'global',
    });
  });

  it("finds a declared index spelled `unique: 'global'`", () => {
    const findings = collectGlobalUniques([
      { name: 'account', fields: {}, indexes: [{ name: 'uk_ext', fields: ['external_id'], unique: 'global' }] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ object: 'account', kind: 'index', name: 'uk_ext', spelling: 'global' });
  });

  it('ALSO finds a declared index spelled with the deprecated bare `true` — same physical shape (D1)', () => {
    // The gate must not be bypassable by spelling. Bare `true` on a declared
    // index IS `'global'` until protocol 18 rejects it (#5082); a gate that read
    // only the explicit word would leave the identical hazard uncaught for the
    // whole of 17.x.
    const findings = collectGlobalUniques([
      { name: 'account', fields: {}, indexes: [{ fields: ['code'], unique: true }] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].spelling).toBe(true);
    expect(describeGlobalUniqueFinding(findings[0])).toContain("deprecated bare spelling of 'global'");
  });

  it('does NOT flag per-organization declarations in any spelling', () => {
    const findings = collectGlobalUniques([
      {
        name: 'contact',
        // field-level `true` is the documented synonym of `'organization'`
        // (Resolved #2 — valid indefinitely, never a finding).
        fields: { email: { type: 'email', unique: true }, code: { type: 'text', unique: 'organization' } },
        indexes: [{ fields: ['department', 'code'], unique: 'organization' }],
      },
    ]);
    expect(findings).toEqual([]);
  });

  it('does not flag non-unique indexes or undeclared uniques', () => {
    const findings = collectGlobalUniques([
      {
        name: 'invoice',
        fields: { note: { type: 'text' }, total: { type: 'number', unique: false } },
        indexes: [{ fields: ['status'], unique: false }, { fields: ['issued_at'] }],
      },
    ]);
    expect(findings).toEqual([]);
  });

  it('skips platform-owned objects — the S5 engine idempotency inventory', () => {
    // `sys_job.name`, `sys_notification.dedup_key`, … are platform-wide BY
    // CONSTRUCTION and identical under every posture. Asking about them on each
    // app install is the #4884 false-alarm class.
    const findings = collectGlobalUniques([
      { name: 'sys_job', fields: {}, indexes: [{ fields: ['name'], unique: true }] },
      { name: 'sys_notification', fields: {}, indexes: [{ fields: ['dedup_key'], unique: 'global' }] },
      { name: 'base_thing', fields: { slug: { type: 'text', unique: 'global' } } },
      { name: 'app_thing', fields: { slug: { type: 'text', unique: 'global' } } },
    ]);
    expect(findings.map((f) => f.object)).toEqual(['app_thing']);
  });

  it('accepts the array field shape as well as the map shape', () => {
    const findings = collectGlobalUniques([
      { name: 'device', fields: [{ name: 'serial', type: 'text', unique: 'global' }] },
    ]);
    expect(findings.map((f) => f.id)).toEqual([globalUniqueFindingId('device', 'field', ['serial'])]);
  });

  it('is deterministic: objects in supplied order, fields before indexes', () => {
    const findings = collectGlobalUniques([
      { name: 'b_obj', fields: { x: { unique: 'global' } }, indexes: [{ fields: ['y'], unique: 'global' }] },
      { name: 'a_obj', fields: { z: { unique: 'global' } } },
    ]);
    expect(findings.map((f) => f.id)).toEqual([
      'b_obj:field:x',
      'b_obj:index:y',
      'a_obj:field:z',
    ]);
  });

  it('tolerates junk input without throwing', () => {
    expect(collectGlobalUniques(undefined)).toEqual([]);
    expect(collectGlobalUniques(null)).toEqual([]);
    expect(collectGlobalUniques([null, {}, { name: '' }, { name: 'x', fields: 'nope', indexes: 'nope' }])).toEqual([]);
    expect(collectGlobalUniques([{ name: 'x', indexes: [{ unique: 'global' }] }])).toEqual([]);
  });
});

describe('ADR-0120 D5e — spelling predicates', () => {
  it('field level: only the explicit `\'global\'` is installation-wide', () => {
    expect(fieldUniqueIsGlobal('global')).toBe(true);
    expect(fieldUniqueIsGlobal(true)).toBe(false);
    expect(fieldUniqueIsGlobal('organization')).toBe(false);
    expect(fieldUniqueIsGlobal(false)).toBe(false);
    expect(fieldUniqueIsGlobal(undefined)).toBe(false);
  });

  it('declared index: `\'global\'` AND bare `true` are installation-wide', () => {
    expect(declaredIndexUniqueIsGlobal('global')).toBe(true);
    expect(declaredIndexUniqueIsGlobal(true)).toBe(true);
    expect(declaredIndexUniqueIsGlobal('organization')).toBe(false);
    expect(declaredIndexUniqueIsGlobal(false)).toBe(false);
  });

  it('platform-owned prefixes', () => {
    expect(isPlatformOwnedObject('sys_job')).toBe(true);
    expect(isPlatformOwnedObject('SYS_JOB')).toBe(true);
    expect(isPlatformOwnedObject('base_thing')).toBe(true);
    expect(isPlatformOwnedObject('system_of_record')).toBe(false);
    expect(isPlatformOwnedObject('contact')).toBe(false);
    expect(isPlatformOwnedObject(undefined)).toBe(false);
  });
});

describe('ADR-0120 D5e — posture gating', () => {
  it("gates on 'isolated' only", () => {
    expect(postureGatesGlobalUniques('isolated')).toBe(true);
    expect(postureGatesGlobalUniques('multi')).toBe(true); // legacy alias of isolated
    expect(postureGatesGlobalUniques('group')).toBe(false);
    expect(postureGatesGlobalUniques('single')).toBe(false);
    expect(postureGatesGlobalUniques('nonsense')).toBe(false);
  });
});

describe('ADR-0120 D5e — attestation (ADR-0104 style)', () => {
  const findings: GlobalUniqueFinding[] = collectGlobalUniques([
    { name: 'material', fields: { code: { unique: 'global' } }, indexes: [{ fields: ['ext_id'], unique: 'global' }] },
  ]);

  it('with no attestation every finding needs an answer', () => {
    expect(unconfirmedGlobalUniques(findings, null, 'isolated')).toHaveLength(2);
  });

  it('a recorded confirmation is never re-asked', () => {
    const att = recordGlobalUniqueAttestation(null, findings.map((f) => f.id), 'isolated', 'usr_1', '2026-08-04T00:00:00.000Z');
    expect(unconfirmedGlobalUniques(findings, att, 'isolated')).toEqual([]);
    expect(att).toMatchObject({ posture: 'isolated', attestedBy: 'usr_1', attestedAt: '2026-08-04T00:00:00.000Z' });
  });

  it('a NEW constraint in a later version is asked about; the old answers stand', () => {
    const first = recordGlobalUniqueAttestation(null, ['material:field:code'], 'isolated', 'usr_1');
    const still = unconfirmedGlobalUniques(findings, first, 'isolated');
    expect(still.map((f) => f.id)).toEqual(['material:index:ext_id']);

    const second = recordGlobalUniqueAttestation(first, ['material:index:ext_id'], 'isolated', 'usr_2');
    expect(second.confirmed).toEqual(['material:field:code', 'material:index:ext_id']);
    expect(unconfirmedGlobalUniques(findings, second, 'isolated')).toEqual([]);
  });

  it('an attestation from another posture is NOT consent — the question was never asked there', () => {
    const underSingle = recordGlobalUniqueAttestation(null, findings.map((f) => f.id), 'single');
    expect(unconfirmedGlobalUniques(findings, underSingle, 'isolated')).toHaveLength(2);
    // …and re-recording under `isolated` replaces rather than merges.
    const underIsolated = recordGlobalUniqueAttestation(underSingle, ['material:field:code'], 'isolated');
    expect(underIsolated.confirmed).toEqual(['material:field:code']);
  });
});

describe('ADR-0120 D5e — stop message', () => {
  it('lists each index and carries the confirm/rewrite prescription', () => {
    const findings = collectGlobalUniques([
      { name: 'material', fields: { code: { unique: 'global' } }, indexes: [{ name: 'uk_ext', fields: ['a', 'b'], unique: true }] },
    ]);
    const msg = buildGlobalUniqueStopMessage('com.acme.mrp', findings);
    expect(msg).toContain('com.acme.mrp');
    expect(msg).toContain("declares 2 installation-wide unique constraint(s)");
    expect(msg).toContain('material.code — field-level');
    expect(msg).toContain("material — declared index 'uk_ext' [a, b]");
    expect(msg).toContain("rewrite it to `unique: 'organization'`");
    expect(msg).toContain('never again for the same constraints');
  });
});
