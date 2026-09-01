// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit tests for the `live-elsewhere` criteria (#13483) — the PURE half.
// The grading (which findings reach `process.exit(1)`, what the summary line
// claims) lives in check-liveness.mts and is pinned there through the real gate
// via `--ledger-root`, for the #5623 reason: a helper test cannot pin an exit
// code. What THIS file pins is the arithmetic and the boundaries of
// `checkElsewhereEntry` itself, with `now` injected so the cases cannot rot as
// wall time advances.

import { describe, it, expect } from 'vitest';
import {
  ELSEWHERE_EXPIRED_GUIDANCE,
  ELSEWHERE_GUIDANCE,
  ELSEWHERE_MAX_AGE_DAYS,
  LIVE_ELSEWHERE_STATUS,
  checkElsewhereEntry,
} from './elsewhere.mts';
import { DEFAULT_STALE_DAYS } from './verification.mts';

const NOW = new Date('2026-09-01T00:00:00Z');

/** A row satisfying every criterion, in the shipped `manifest.runtime` shape. */
function goodEntry() {
  return {
    key: 'manifest/runtime',
    evidence:
      'cloud: packages/service-cloud/src/plugin-permission-audit.ts#auditPluginPermissions @15f55df — the publish gate (HTTP 422).',
    evidenceScope: 'cross-repo',
    verifiedAt: '2026-08-29',
  };
}

describe('checkElsewhereEntry — the executable criteria', () => {
  it('passes an entry with a foreign pointer, cross-repo scope, and a fresh attestation', () => {
    const r = checkElsewhereEntry(goodEntry(), { now: NOW });
    expect(r.malformed).toEqual([]);
    expect(r.expired).toEqual([]);
  });

  it('FAILS an entry whose evidence attributes no path to a foreign realm', () => {
    // Prose that CLAIMS elsewhere-ness without pointing anywhere — the
    // unverified label the card's hard constraint names.
    const r = checkElsewhereEntry(
      { ...goodEntry(), evidence: 'enforced at the cloud marketplace publish gate (trust the note)' },
      { now: NOW },
    );
    expect(r.malformed).toHaveLength(1);
    expect(r.malformed[0]).toContain('manifest/runtime');
    expect(r.malformed[0]).toContain('no foreign-attributed path');
  });

  it('FAILS an entry with no evidence at all — a bare status is a label, not a verdict', () => {
    const { evidence: _dropped, ...rest } = goodEntry();
    const r = checkElsewhereEntry(rest, { now: NOW });
    expect(r.malformed.some((m) => m.includes('no foreign-attributed path'))).toBe(true);
  });

  it('a LOCAL path does not satisfy the foreign criterion — that is what `live` is for', () => {
    const r = checkElsewhereEntry(
      { ...goodEntry(), evidence: 'packages/spec/scripts/liveness/evidence.mts (a local consumer claim)' },
      { now: NOW },
    );
    expect(r.malformed.some((m) => m.includes('no foreign-attributed path'))).toBe(true);
  });

  it('a foreign-PREFIX path (service-ai) satisfies the foreign criterion without a realm marker', () => {
    // `packages/services/service-ai/…` is always-foreign by prefix in
    // evidence.mts — the closed cloud runtime cited repo-rooted. The criterion
    // reads the scan's `foreign` bucket, so both attribution grammars count.
    const r = checkElsewhereEntry(
      { ...goodEntry(), evidence: 'packages/services/service-ai/src/enforcer.ts#enforceTier @abc1234' },
      { now: NOW },
    );
    expect(r.malformed).toEqual([]);
  });

  it('FAILS an undeclared evidenceScope, naming it undeclared', () => {
    const { evidenceScope: _dropped, ...rest } = goodEntry();
    const r = checkElsewhereEntry(rest, { now: NOW });
    expect(r.malformed).toHaveLength(1);
    expect(r.malformed[0]).toContain('undeclared');
  });

  it('FAILS an in-repo evidenceScope — well-formed, and contradicting the verdict', () => {
    const r = checkElsewhereEntry({ ...goodEntry(), evidenceScope: 'in-repo' }, { now: NOW });
    expect(r.malformed).toHaveLength(1);
    expect(r.malformed[0]).toContain('"in-repo"');
    expect(r.malformed[0]).toContain('cross-repo claim by definition');
  });

  it('FAILS an absent verifiedAt — undated elsewhere-claims are unfalsifiable forever', () => {
    const { verifiedAt: _dropped, ...rest } = goodEntry();
    const r = checkElsewhereEntry(rest, { now: NOW });
    expect(r.malformed).toHaveLength(1);
    expect(r.malformed[0]).toContain('no verifiedAt');
    expect(r.expired).toEqual([]);
  });

  it('SKIPS a malformed verifiedAt — the verification report owns that verdict', () => {
    // The lineCountOf contract one field over: one rot, one heading. A malformed
    // date already fails the gate for every status; reporting it here too would
    // teach a reader to discount both lists.
    const r = checkElsewhereEntry({ ...goodEntry(), verifiedAt: 'not-a-date' }, { now: NOW });
    expect(r.malformed).toEqual([]);
    expect(r.expired).toEqual([]);
  });

  it('passes at exactly the window edge and FAILS one day past it', () => {
    const atEdge = checkElsewhereEntry(
      { ...goodEntry(), verifiedAt: '2026-03-05' }, // 180 days before NOW
      { now: NOW },
    );
    expect(atEdge.expired).toEqual([]);

    const pastEdge = checkElsewhereEntry(
      { ...goodEntry(), verifiedAt: '2026-03-04' }, // 181 days before NOW
      { now: NOW },
    );
    expect(pastEdge.expired).toHaveLength(1);
    expect(pastEdge.expired[0]).toContain('manifest/runtime');
    expect(pastEdge.expired[0]).toContain('2026-03-04');
    expect(pastEdge.expired[0]).toContain('181d ago');
    expect(pastEdge.expired[0]).toContain(`${ELSEWHERE_MAX_AGE_DAYS}d`);
    expect(pastEdge.malformed).toEqual([]);
  });

  it('reports every missing criterion at once, so one round repairs the row', () => {
    const r = checkElsewhereEntry({ key: 'manifest/runtime' }, { now: NOW });
    expect(r.malformed).toHaveLength(3);
  });
});

describe('the live-elsewhere constants and prescriptions', () => {
  it('shares the ledger-wide freshness threshold — one policy, decided in one place', () => {
    expect(ELSEWHERE_MAX_AGE_DAYS).toBe(DEFAULT_STALE_DAYS);
  });

  it('spells the status the way the ledger rows and STATUS_COLUMNS spell it', () => {
    expect(LIVE_ELSEWHERE_STATUS).toBe('live-elsewhere');
  });

  it('the shape prescription forbids satisfying the criteria from the note', () => {
    const text = ELSEWHERE_GUIDANCE.join('\n');
    expect(text).toContain('dead HERE by measurement');
    expect(text).toContain('Do not satisfy this from memory');
  });

  it('the expiry prescription demands a re-reading, and names the escalation', () => {
    const text = ELSEWHERE_EXPIRED_GUIDANCE.join('\n');
    expect(text).toContain('Never');
    expect(text).toContain('re-stamp without re-reading');
    expect(text).toContain('needs-user-decision');
    expect(text).toContain('Do not silence it');
  });
});
