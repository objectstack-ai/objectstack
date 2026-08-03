// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit tests for container-coverage reconciliation — the liveness gate's third
// direction (see drill.mts for why it exists).
//
// Same reasoning as orphans.test.ts, one turn sharper. The tree is fully
// reconciled by construction the moment this lands (every undrilled container is
// baselined), so a green `check:liveness` proves only that the check is quiet —
// never that it can FIRE. And "quiet" is precisely the failure mode this rule
// exists to end: the gate was quiet about 22 unclassified widget keys for a
// release while printing a completeness claim. The proof that it now speaks up
// has to live here.

import { describe, it, expect } from 'vitest';
import {
  STALE_UNDRILLED_GUIDANCE,
  UNDRILLED_GUIDANCE,
  parseUndrilledBaseline,
  reconcileContainerCoverage,
} from './drill.mts';

describe('reconcileContainerCoverage — inheritance it must catch', () => {
  it('fails an undeclared container and names the keys the blanket verdict covers', () => {
    // The #4956 shape exactly: one `live` verdict standing in for the whole
    // DashboardWidgetSchema, with `responsive` among the keys nobody asked about.
    const { undeclared } = reconcileContainerCoverage({
      observed: [{ key: 'dashboard/widgets', childKeys: ['id', 'dataset', 'responsive'] }],
      baseline: [],
    });
    expect(undeclared).toEqual([
      { key: 'dashboard/widgets', childKeys: ['id', 'dataset', 'responsive'] },
    ]);
    // The child keys travel with the finding — a bare coordinate would make the
    // author go looking for the surface they are being asked to account for.
    expect(undeclared[0].childKeys).toContain('responsive');
  });

  it('reports every undeclared container, not just the first', () => {
    const { undeclared } = reconcileContainerCoverage({
      observed: [
        { key: 'report/chart', childKeys: ['type'] },
        { key: 'page/slots', childKeys: ['header', 'tabs'] },
      ],
      baseline: [],
    });
    expect(undeclared.map((u) => u.key)).toEqual(['report/chart', 'page/slots']);
  });

  it('fails a STALE baseline row once its container is drilled away', () => {
    // Drilling removes the container from `observed` (the gate only records the
    // blanket branch), so the row now claims a gap that is closed. Same rot as
    // an orphan ledger row, opposite direction.
    const { stale, undeclared } = reconcileContainerCoverage({
      observed: [],
      baseline: ['dashboard/widgets'],
    });
    expect(stale).toEqual(['dashboard/widgets']);
    expect(undeclared).toEqual([]);
  });

  it('sorts stale rows so the failure output is stable across runs', () => {
    const { stale } = reconcileContainerCoverage({
      observed: [],
      baseline: ['view/listViews', 'action/ai', 'object/fields'],
    });
    expect(stale).toEqual(['action/ai', 'object/fields', 'view/listViews']);
  });
});

describe('reconcileContainerCoverage — cases it must stay quiet on', () => {
  it('passes a container that is recorded in the baseline', () => {
    const r = reconcileContainerCoverage({
      observed: [{ key: 'field/options', childKeys: ['label', 'value', 'color'] }],
      baseline: ['field/options'],
    });
    expect(r.undeclared).toEqual([]);
    expect(r.stale).toEqual([]);
  });

  it('counts the child keys riding on declared inheritance — the size of the gap', () => {
    const r = reconcileContainerCoverage({
      observed: [
        { key: 'field/options', childKeys: ['label', 'value'] },
        { key: 'report/order', childKeys: ['by', 'direction'] },
      ],
      baseline: ['field/options', 'report/order'],
    });
    expect(r.inheritedChildKeys).toBe(4);
  });

  it('does NOT count an undeclared container toward the recorded population', () => {
    // Otherwise a failing container would inflate the "recorded debt" number and
    // the two readings of the tree would disagree about what is accounted for.
    const r = reconcileContainerCoverage({
      observed: [
        { key: 'field/options', childKeys: ['label', 'value'] },
        { key: 'dashboard/widgets', childKeys: ['id', 'responsive'] },
      ],
      baseline: ['field/options'],
    });
    expect(r.inheritedChildKeys).toBe(2);
    expect(r.undeclared.map((u) => u.key)).toEqual(['dashboard/widgets']);
  });

  it('is silent on an empty tree in both directions', () => {
    const r = reconcileContainerCoverage({ observed: [], baseline: [] });
    expect(r).toEqual({ undeclared: [], stale: [], inheritedChildKeys: 0 });
  });
});

describe('parseUndrilledBaseline — a malformed baseline must fail, not disable the ratchet', () => {
  it('reads the container list', () => {
    expect(parseUndrilledBaseline({ containers: ['a/b', 'c/d'] })).toEqual(['a/b', 'c/d']);
  });

  it('accepts an empty list (the ratchet fully paid down)', () => {
    expect(parseUndrilledBaseline({ containers: [] })).toEqual([]);
  });

  it.each([
    ['a missing `containers` key', { note: 'oops' }],
    ['a non-array `containers`', { containers: 'a/b' }],
    ['a non-string row', { containers: ['a/b', 42] }],
    ['a null document', null],
  ])('throws on %s rather than reading it as "no debt recorded"', (_label, doc) => {
    // Silently reading a broken baseline as `[]` would turn every recorded
    // container into a NEW failure — or, with the reconcile inverted, silently
    // exempt the whole tree. Both are the malformed-`verifiedAt` shape: a bad
    // value that quietly switches a check off.
    expect(() => parseUndrilledBaseline(doc)).toThrow(/containers/);
  });
});

describe('guidance', () => {
  it('names both remedies and warns off the one that caused #4956', () => {
    const text = UNDRILLED_GUIDANCE.join('\n');
    expect(text).toMatch(/DRILL it/);
    expect(text).toMatch(/undrilled-containers\.baseline\.json/);
    // The prescription has to say out loud that a reassuring `note` is not a
    // third option — writing one is the original defect.
    expect(text).toMatch(/classified elsewhere/);
    expect(text).toMatch(/#4956/);
  });

  it('tells a stale row to be deleted', () => {
    expect(STALE_UNDRILLED_GUIDANCE.join('\n')).toMatch(/Delete it/);
  });
});
