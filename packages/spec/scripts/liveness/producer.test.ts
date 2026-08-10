// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit tests for the producer / evidence-scope fold. Pure and tested for the
// same reason `orphans.mts` and `drill.mts` are: on the shipped ledgers these
// checks are almost entirely quiet, so a green gate proves nothing about whether
// they CAN fire. Every assertion below drives a failing direction.

import { describe, it, expect } from 'vitest';
import {
  EVIDENCE_SCOPES,
  buildProducerReport,
  parseEvidenceScope,
  parseProducer,
} from './producer.mts';

describe('parseEvidenceScope', () => {
  it('accepts the vocabulary', () => {
    for (const scope of EVIDENCE_SCOPES) expect(parseEvidenceScope(scope).ok).toBe(true);
  });

  it('rejects a value outside the vocabulary', () => {
    const result = parseEvidenceScope('both-repos');
    expect(result.ok).toBe(false);
    // The message must name the legal values: the field exists to be filled in
    // by whoever just re-verified an entry, not to send them reading source.
    expect(result.ok === false && result.error).toContain('in-repo | cross-repo');
  });

  it('rejects a non-string', () => {
    expect(parseEvidenceScope(true).ok).toBe(false);
  });
});

describe('parseProducer', () => {
  it('accepts a cited call site', () => {
    expect(parseProducer('packages/metadata-protocol/src/seed-loader.ts:143 (resolveEnv)').ok).toBe(true);
  });

  it('rejects an empty string — a field present but saying nothing is worse than absent', () => {
    expect(parseProducer('   ').ok).toBe(false);
    expect(parseProducer(42).ok).toBe(false);
  });
});

describe('buildProducerReport', () => {
  it('counts live entries with and without producer-side evidence', () => {
    const report = buildProducerReport([
      { key: 'seed/env', status: 'live', producer: 'seed-loader.ts:143' },
      { key: 'seed/mode', status: 'live' },
      // A dead entry has nothing to produce — it must not land on the worklist.
      { key: 'job/label', status: 'dead' },
    ]);
    expect(report.withProducer).toBe(1);
    expect(report.withoutProducer).toEqual(['seed/mode']);
    expect(report.errors).toEqual([]);
  });

  it('fails a malformed value while leaving a merely absent one alone', () => {
    const report = buildProducerReport([
      { key: 'a/x', status: 'live', evidenceScope: 'everywhere' },
      { key: 'a/y', status: 'live', producer: '' },
      { key: 'a/z', status: 'live' },
    ]);
    expect(report.errors).toHaveLength(2);
    expect(report.errors[0]).toContain('a/x');
    expect(report.errors[1]).toContain('a/y');
    // `a/z` declares neither field: a worklist row, never an error.
    expect(report.withoutProducer).toContain('a/z');
    // Two, not three: `a/x` DID declare a scope, it just declared an illegal
    // one. It is already failing the gate, so counting it on the "nobody has
    // looked" worklist as well would double-report one entry as two problems.
    expect(report.unscoped).toBe(2);
  });

  it('tallies declared scopes so the coverage of the ledger is a number, not an impression', () => {
    const report = buildProducerReport([
      { key: 'app/homePageId', status: 'dead', evidenceScope: 'cross-repo' },
      { key: 'book/groups.translations', status: 'dead', evidenceScope: 'cross-repo' },
      { key: 'seed/env', status: 'live', evidenceScope: 'in-repo', producer: 'x.ts:1' },
    ]);
    expect(report.byScope).toEqual({ 'cross-repo': 2, 'in-repo': 1 });
    expect(report.unscoped).toBe(0);
  });
});
