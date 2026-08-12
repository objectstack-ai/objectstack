// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0060 P1 — unit coverage for the reusable `checkLedger` helper. The two
// real ledgers (authz, expression) exercise it end-to-end; this pins each
// invariant in isolation.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { checkLedger, type ConformanceRow } from '@objectstack/verify';

const HERE = dirname(fileURLToPath(import.meta.url));
const ok = (extra: Partial<ConformanceRow> = {}): ConformanceRow =>
  ({ id: 'a', summary: 's', state: 'enforced', enforcement: 'site', ...extra });

describe('checkLedger (ADR-0060)', () => {
  it('a sound ledger yields no problems', () => {
    expect(checkLedger([ok()], { proofRoot: HERE })).toEqual([]);
  });
  it('flags duplicate ids', () => {
    expect(checkLedger([ok(), ok()], { proofRoot: HERE }).some((x) => x.includes('duplicate id'))).toBe(true);
  });
  it('flags invalid state', () => {
    expect(checkLedger([{ id: 'a', summary: 's', state: 'bogus' as never }], { proofRoot: HERE }).some((x) => x.includes('invalid state'))).toBe(true);
  });
  it('flags enforced-without-enforcement', () => {
    expect(checkLedger([{ id: 'a', summary: 's', state: 'enforced' }], { proofRoot: HERE }).some((x) => x.includes('names no enforcement'))).toBe(true);
  });
  it('flags experimental-without-note', () => {
    expect(checkLedger([{ id: 'a', summary: 's', state: 'experimental' }], { proofRoot: HERE }).some((x) => x.includes('carries no note'))).toBe(true);
  });
  it('flags a missing proof file; accepts an existing one', () => {
    expect(checkLedger([ok({ proof: 'does/not/exist.ts' })], { proofRoot: HERE }).some((x) => x.includes('proof missing on disk'))).toBe(true);
    expect(checkLedger([ok({ proof: 'conformance-helper.test.ts' })], { proofRoot: HERE })).toEqual([]);
  });
  it('high-risk must carry a proof', () => {
    expect(checkLedger([ok()], { proofRoot: HERE, highRisk: ['a'] }).some((x) => x.includes('must carry a proof'))).toBe(true);
  });
  it('proofRequiredForEnforced flags enforced-without-proof', () => {
    expect(checkLedger([ok()], { proofRoot: HERE, proofRequiredForEnforced: true }).some((x) => x.includes('carries no proof'))).toBe(true);
  });
  it('flags a surface classified by two rows', () => {
    expect(checkLedger([ok({ id: 'a', covers: ['x'] }), ok({ id: 'b', covers: ['x'] })], { proofRoot: HERE }).some((x) => x.includes('more than one row'))).toBe(true);
  });
  it('ratchet: unclassified discovered surface', () => {
    expect(checkLedger([ok({ covers: ['x'] })], { proofRoot: HERE, discover: () => ['x', 'y'] }).some((x) => x.includes('UNCLASSIFIED surface') && x.includes('y'))).toBe(true);
  });
  it('ratchet: stale covers', () => {
    expect(checkLedger([ok({ covers: ['x', 'z'] })], { proofRoot: HERE, discover: () => ['x'] }).some((x) => x.includes('STALE covers') && x.includes('z'))).toBe(true);
  });
  it('ratchet: fully covered yields no problems', () => {
    expect(checkLedger([ok({ covers: ['x', 'y'] })], { proofRoot: HERE, discover: () => ['x', 'y'] })).toEqual([]);
  });
});

// #7976 — `attribution` binds a row to its proof BY NAME. Without it, existence
// is the whole contract, which is what let a row cite a file exercising a
// neighbouring primitive. These pin the helper's half in isolation; the authz
// ledger drives it end-to-end.
describe('checkLedger attribution (#7976)', () => {
  // This very file carries the fixture claims below, in the form the checker
  // reads them (comment-anchored, so a mention in prose or a string is not a
  // claim). `checkLedger` is being pointed at the test file that declares them.
  // helper-fixture-row: a
  const SELF = 'conformance-helper.test.ts';
  const attribution = { marker: 'helper-fixture-row' } as const;

  it('is OPT-IN — existence alone still passes without it', () => {
    expect(checkLedger([ok({ id: 'unclaimed', proof: SELF })], { proofRoot: HERE })).toEqual([]);
  });

  it('accepts a row its proof claims', () => {
    expect(checkLedger([ok({ id: 'a', proof: SELF })], { proofRoot: HERE, attribution })).toEqual([]);
  });

  it('flags a row its proof does NOT claim, naming the row', () => {
    const problems = checkLedger([ok({ id: 'unclaimed', proof: SELF })], { proofRoot: HERE, attribution });
    expect(problems.some((x) => x.startsWith('unclaimed:') && x.includes('does not claim this row'))).toBe(true);
  });

  it('flags an orphaned claim — a claimed id that is not a ledger row', () => {
    const problems = checkLedger([ok({ id: 'b', proof: SELF })], { proofRoot: HERE, attribution });
    expect(problems.some((x) => x.includes('orphaned claim') && x.includes('a'))).toBe(true);
  });

  it('flags a one-way claim — the row exists but cites something else', () => {
    const rows = [ok({ id: 'a', proof: 'authz-conformance.test.ts' }), ok({ id: 'c', proof: SELF })];
    const problems = checkLedger(rows, { proofRoot: HERE, attribution });
    expect(problems.some((x) => x.includes('attribution is not mutual'))).toBe(true);
  });

  it('`scan` reaches claims in files NO row cites', () => {
    const rows = [ok({ id: 'a' })]; // 'a' is claimed by SELF, but cites nothing
    expect(checkLedger(rows, { proofRoot: HERE, attribution })).toEqual([]);
    const scanned = checkLedger(rows, { proofRoot: HERE, attribution: { ...attribution, scan: () => [SELF] } });
    expect(scanned.some((x) => x.includes('attribution is not mutual'))).toBe(true);
  });

  it('a proof missing on disk is reported once, not twice', () => {
    const problems = checkLedger([ok({ proof: 'does/not/exist.ts' })], { proofRoot: HERE, attribution });
    expect(problems.filter((x) => x.includes('does/not/exist.ts'))).toHaveLength(1);
  });
});
