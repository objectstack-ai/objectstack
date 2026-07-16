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
