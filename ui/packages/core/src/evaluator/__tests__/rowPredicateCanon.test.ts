/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5330 — the row-predicate spelling CANON (`record.*`), and
 * objectui#5741 — Phase 2, where the two other spellings stopped being bound.
 *
 * Two halves, and the second is pinned in the OPPOSITE direction from the
 * Phase-1 file this replaces:
 *
 *  - the DETECTOR pins are unchanged. `detectNonCanonicalRowSpelling` stays
 *    exported as the OFFLINE instrument (the objectui#5738 corpus sweep runs on
 *    it), and its three stand-downs still hold.
 *  - the BINDING pins now assert the removal. `record.*` still discriminates;
 *    a bare-field or `data.*` predicate — and a legacy `${data.x}` / `${x}`
 *    string, one scope shape for both dialects — reaches the SAME verdict on a
 *    matching and a non-matching row (it faults and takes the caller's
 *    fallback); the fault warning names the unknown variable; the Phase-1
 *    deprecation warning is gone, together with its runtime half of the module.
 *
 * The `record-alert` renderer's own pins live in
 * `plugin-detail/.../record-alert.rowBinding.test.tsx`, the `useCondition`
 * tier's in `react/.../useCondition.canonSpelling.test.tsx`; this file pins the
 * shared evaluator tier those renderers sit on, plus the detector itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import * as core from '../index.js';
import {
  detectNonCanonicalRowSpelling,
  ROW_PREDICATE_CANONICAL_ROOT,
  evalRowPredicate,
  partitionRowsByPredicate,
} from '../index.js';

const row = { status: 'in_review', amount: 10 };
const other = { status: 'draft', amount: 1 };

describe('[#5330] the canon is `record.*`', () => {
  it('names `record` as the one canonical root', () => {
    expect(ROW_PREDICATE_CANONICAL_ROOT).toBe('record');
  });

  it('reports nothing for the canonical spelling', () => {
    expect(detectNonCanonicalRowSpelling("record.status == 'in_review'", row, true)).toBeNull();
  });
});

describe('[#5330] non-canonical spellings are DETECTED (the offline instrument, kept by #5741)', () => {
  it('reports the bare shorthand, and names the canonical rewrite', () => {
    expect(detectNonCanonicalRowSpelling("status == 'in_review'", row, true)).toEqual({
      kind: 'bare-shorthand',
      identifier: 'status',
      canonical: 'record.status',
    });
  });

  it('reports a `data.`-rooted predicate on a record surface', () => {
    expect(detectNonCanonicalRowSpelling("data.status == 'in_review'", row, true)).toEqual({
      kind: 'metadata-layer-root',
      identifier: 'data',
      canonical: 'record',
    });
  });
});

/**
 * Every case here is a spelling the detector must NOT report. They are the
 * whole reason it consults the row and the caller's binding rather than
 * pattern-matching the source: a false finding sends an author to rewrite a
 * predicate that was correct.
 */
describe('[#5330] the detector stands down rather than guessing', () => {
  it('leaves `data.*` alone when `data` is NOT this row (rowless / metadata-editing layer)', () => {
    // ADR-0089 D3: `data` is the CANONICAL root of a metadata-editing form.
    // Reporting it there would contradict that layer's own contract.
    expect(detectNonCanonicalRowSpelling("data.status == 'in_review'", row, false)).toBeNull();
  });

  it('leaves a host-scope root alone', () => {
    expect(detectNonCanonicalRowSpelling('features.beta == true', row, true)).toBeNull();
  });

  it('leaves an undeclared identifier alone when it is not a field of THIS row', () => {
    // A deployment global this module cannot see is not the #4075 shorthand.
    expect(detectNonCanonicalRowSpelling('unknownGlobal == 1', row, true)).toBeNull();
  });

  it('leaves an unparseable source alone — syntax is another gate’s verdict', () => {
    expect(detectNonCanonicalRowSpelling("record.status === 'x'", row, true)).toBeNull();
  });
});

describe('[#5741] `evalRowPredicate` — the row is bound as `record.*` only', () => {
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  const messages = (): string[] => warn.mock.calls.map((c) => String(c[0]));
  const faultReports = (): string[] => messages().filter((m) => m.includes('failed to evaluate'));

  it('`record.*` still discriminates: true on the matching row, false on the other, silently', () => {
    expect(evalRowPredicate("record.status == 'in_review'", row)).toBe(true);
    expect(evalRowPredicate("record.status == 'in_review'", other)).toBe(false);
    expect(messages()).toHaveLength(0);
  });

  it.each([
    ['bare shorthand', "status == 'in_review'"],
    ['`data.*`', "data.status == 'in_review'"],
    ['legacy `${data.x}`', '${data.status === "in_review"}'],
    ['legacy `${x}`', '${status === "in_review"}'],
  ])('a %s predicate no longer discriminates — the caller fallback on BOTH rows', (_what, pred) => {
    // A retired spelling is unbound: it faults, and the fault takes the
    // caller's fallback, so the verdict is the same whichever row is bound.
    // Both fallbacks are driven, so a constant that happened to equal one of
    // them could not pass by accident.
    expect(evalRowPredicate(pred, row)).toBe(false);
    expect(evalRowPredicate(pred, other)).toBe(false);
    expect(evalRowPredicate(pred, row, { fallback: true })).toBe(true);
    expect(evalRowPredicate(pred, other, { fallback: true })).toBe(true);
  });

  it('the fault warning on the fast route names the unknown variable and carries the `record.` hint', () => {
    evalRowPredicate('amount > 5', row, { label: 'row action "approve"' });
    const faults = faultReports();
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('Unknown variable: amount');
    expect(faults[0]).toContain("bound under 'record.'");
    expect(faults[0]).toContain('row action "approve"');
  });

  it('… and on the fail-closed route (`warnOnError`) it names the variable (no `record.` hint there)', () => {
    expect(evalRowPredicate('data.amount > 5', row, { warnOnError: true, label: 'grid' })).toBe(false);
    const faults = faultReports();
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('Unknown variable: data');
    expect(faults[0]).toContain('(grid)');
    expect(faults[0]).not.toContain("bound under 'record.'");
  });

  it('a legacy `${…}` string on a row surface lands in the SAME fallback / warning path', () => {
    expect(evalRowPredicate('${amount > 5}', row, { warnOnError: true, label: 'kanban' })).toBe(false);
    const faults = faultReports();
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('[legacy]');
    expect(faults[0]).toContain('amount is not defined');
    expect(faults[0]).toContain('(kanban)');
  });

  it('the Phase-1 deprecation warning is gone', () => {
    evalRowPredicate("status == 'in_review'", row, { label: 'row action "approve"' });
    evalRowPredicate("data.status == 'in_review'", row, { label: 'row action "approve"' });
    expect(messages().filter((m) => m.includes('DEPRECATED spelling'))).toHaveLength(0);
  });

  it('… and so is its runtime half of the module: only the offline detector is exported', () => {
    expect('warnNonCanonicalRowSpelling' in core).toBe(false);
    expect('resetRowPredicateCanonWarnings' in core).toBe(false);
    expect(typeof core.detectNonCanonicalRowSpelling).toBe('function');
    expect(core.ROW_PREDICATE_CANONICAL_ROOT).toBe('record');
  });

  it('`partitionRowsByPredicate`: `record.*` still partitions; a retired spelling excludes EVERY row', () => {
    expect(partitionRowsByPredicate("record.status == 'in_review'", [row, other])).toEqual({
      eligible: [row],
      skipped: 1,
    });
    expect(partitionRowsByPredicate("status == 'in_review'", [row, other])).toEqual({ eligible: [], skipped: 2 });
    expect(partitionRowsByPredicate("data.status == 'in_review'", [row, other])).toEqual({ eligible: [], skipped: 2 });
  });

  it("a host's own `data` is left standing: `data.*` reads the HOST object, never the row", () => {
    const host = { data: { status: 'draft' } };
    // The same verdict on both rows — the row never enters it.
    expect(evalRowPredicate("data.status == 'draft'", row, { scope: host })).toBe(true);
    expect(evalRowPredicate("data.status == 'draft'", other, { scope: host })).toBe(true);
    expect(evalRowPredicate("data.status == 'in_review'", row, { scope: host })).toBe(false);
    // …while `record` is still the row, pinned over any host key of that name.
    expect(evalRowPredicate("record.status == 'in_review'", row, { scope: { ...host, record: other } })).toBe(true);
  });
});
