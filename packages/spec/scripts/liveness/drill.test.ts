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

  it('is silent on an empty tree in every direction', () => {
    const r = reconcileContainerCoverage({ observed: [], baseline: [] });
    expect(r).toEqual({
      undeclared: [],
      stale: [],
      brokenDeferrals: [],
      inheritedChildKeys: 0,
      deferredChildKeys: 0,
    });
  });
});

// ── deferrals: the #4956 claim, allowed ONLY because it is resolved ──────────
//
// "classified elsewhere" is the exact sentence that caused the bug, and it is
// also sometimes true (`object.fields[]` really is `FieldSchema`). What makes
// the difference is not the sentence but who checks it, so every one of these
// asserts the checking, not the claim.
describe('reconcileContainerCoverage — deferrals are resolved, never believed', () => {
  const fieldKeys = ['name', 'label', 'type'];
  const resolver = (t: string) => (t === 'field' ? fieldKeys : t === 'view/list' ? ['columns'] : null);

  it('accepts a deferral whose target exists and classifies exactly these keys', () => {
    const r = reconcileContainerCoverage({
      observed: [{ key: 'object/fields', childKeys: ['name', 'label', 'type'] }],
      baseline: [],
      deferred: [{ container: 'object/fields', to: 'field' }],
      classifiedKeysAt: resolver,
    });
    expect(r.brokenDeferrals).toEqual([]);
    expect(r.undeclared).toEqual([]);
    // Deferred keys are classified, so they must NOT be counted as the gap.
    expect(r.deferredChildKeys).toBe(3);
    expect(r.inheritedChildKeys).toBe(0);
  });

  it('FAILS a dangling target — the literal #4956 claim', () => {
    const r = reconcileContainerCoverage({
      observed: [{ key: 'dashboard/widgets', childKeys: ['id', 'responsive'] }],
      baseline: [],
      deferred: [{ container: 'dashboard/widgets', to: 'DashboardWidgetSchema' }],
      classifiedKeysAt: resolver,
    });
    expect(r.brokenDeferrals).toHaveLength(1);
    expect(r.brokenDeferrals[0]).toMatch(/DashboardWidgetSchema/);
    expect(r.brokenDeferrals[0]).toMatch(/does not exist/);
    expect(r.deferredChildKeys).toBe(0);
  });

  it('FAILS when the container has a key the target does not classify (drift, the #4956 hole one level down)', () => {
    const r = reconcileContainerCoverage({
      observed: [{ key: 'object/fields', childKeys: ['name', 'label', 'type', 'newKey'] }],
      baseline: [],
      deferred: [{ container: 'object/fields', to: 'field' }],
      classifiedKeysAt: resolver,
    });
    expect(r.brokenDeferrals).toHaveLength(1);
    expect(r.brokenDeferrals[0]).toMatch(/newKey/);
  });

  it('FAILS when the target classifies a key the container no longer has (equality, not subset)', () => {
    const r = reconcileContainerCoverage({
      observed: [{ key: 'object/fields', childKeys: ['name', 'label'] }],
      baseline: [],
      deferred: [{ container: 'object/fields', to: 'field' }],
      classifiedKeysAt: resolver,
    });
    expect(r.brokenDeferrals).toHaveLength(1);
    expect(r.brokenDeferrals[0]).toMatch(/classified there but absent here/);
    expect(r.brokenDeferrals[0]).toMatch(/type/);
  });

  it('resolves a drilled coordinate target, not just a type root', () => {
    const r = reconcileContainerCoverage({
      observed: [{ key: 'view/listViews', childKeys: ['columns'] }],
      baseline: [],
      deferred: [{ container: 'view/listViews', to: 'view/list' }],
      classifiedKeysAt: resolver,
    });
    expect(r.brokenDeferrals).toEqual([]);
    expect(r.deferredChildKeys).toBe(1);
  });

  it('FAILS a container declared in BOTH lists rather than silently preferring one', () => {
    // "classified nowhere" and "classified at `field`" cannot both be true, and
    // whichever the gate preferred would decide whether those keys count as a
    // gap. Refusing is the only answer that does not quietly pick.
    const r = reconcileContainerCoverage({
      observed: [{ key: 'object/fields', childKeys: ['name', 'label', 'type'] }],
      baseline: ['object/fields'],
      deferred: [{ container: 'object/fields', to: 'field' }],
      classifiedKeysAt: resolver,
    });
    expect(r.brokenDeferrals).toHaveLength(1);
    expect(r.brokenDeferrals[0]).toMatch(/BOTH lists/);
    expect(r.deferredChildKeys).toBe(0);
  });

  it('reports a gone-and-double-declared coordinate ONLY as stale', () => {
    // Both rows are wrong, but the single fix is to delete them, and a second
    // heading about a coordinate that no longer exists would obscure that —
    // the same "do not report it twice" rule orphans.mts follows.
    const r = reconcileContainerCoverage({
      observed: [],
      baseline: ['object/fields'],
      deferred: [{ container: 'object/fields', to: 'field' }],
      classifiedKeysAt: resolver,
    });
    expect(r.stale).toEqual(['object/fields']);
    expect(r.brokenDeferrals).toEqual([]);
  });

  it('reports a deferral for a container that no longer exists as STALE, not broken', () => {
    const r = reconcileContainerCoverage({
      observed: [],
      baseline: [],
      deferred: [{ container: 'object/fields', to: 'field' }],
      classifiedKeysAt: resolver,
    });
    expect(r.stale).toEqual(['object/fields']);
    expect(r.brokenDeferrals).toEqual([]);
  });
});

describe('parseUndrilledBaseline — a malformed baseline must fail, not disable the ratchet', () => {
  it('reads the container list', () => {
    expect(parseUndrilledBaseline({ containers: ['a/b', 'c/d'] })).toEqual({
      containers: ['a/b', 'c/d'],
      deferred: [],
    });
  });

  it('reads the deferral list', () => {
    const d = [{ container: 'object/fields', to: 'field' }];
    expect(parseUndrilledBaseline({ containers: [], deferred: d }).deferred).toEqual(d);
  });

  it('accepts an empty list (the ratchet fully paid down)', () => {
    expect(parseUndrilledBaseline({ containers: [] })).toEqual({ containers: [], deferred: [] });
  });

  it.each([
    ['a non-array `deferred`', { containers: [], deferred: 'object/fields' }],
    ['a deferral with no target', { containers: [], deferred: [{ container: 'object/fields' }] }],
    ['a deferral with no container', { containers: [], deferred: [{ to: 'field' }] }],
  ])('throws on %s', (_label, doc) => {
    expect(() => parseUndrilledBaseline(doc)).toThrow(/deferred/);
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
  it('names all three remedies and warns off the one that caused #4956', () => {
    // Wrapped for terminal output, so collapse the line breaks before matching —
    // otherwise this asserts the line-wrapping, not the prescription.
    const text = UNDRILLED_GUIDANCE.join(' ').replace(/\s+/g, ' ');
    expect(text).toMatch(/DRILL it/);
    expect(text).toMatch(/DEFER it/);
    expect(text).toMatch(/RECORD it/);
    // An author who is told to record a row must be told WHERE.
    expect(text).toMatch(/undrilled-containers\.baseline\.json/);
    // And it has to say out loud that a reassuring `note` is not a fourth
    // option — writing one is the original defect.
    expect(text).toMatch(/classified elsewhere/);
    expect(text).toMatch(/#4956/);
  });

  it('tells a stale row to be deleted', () => {
    expect(STALE_UNDRILLED_GUIDANCE.join('\n')).toMatch(/Delete it/);
  });
});
