// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #17319 — both directions of the refusal, and both directions of the
// ACCEPTANCE. A rule that only ever fires is indistinguishable from a rule
// that always fires, so every refusal pin below has a correctly-wired twin
// that must stay clean; those twins are the cost-direction half of this file
// and they are the ones that hold the blast radius down when someone
// "strengthens" the rule later.

import { describe, it, expect } from 'vitest';
import {
  validateActionDispatchContract,
  ACTION_DISPATCH_CONTRACT_MISMATCH,
} from './validate-action-dispatch-contract.js';

/**
 * The showcase's own pair, reduced: two actions against ONE endpoint, written
 * for the two contracts. They exist as two actions precisely because, until
 * #17319, the platform had no way for one action to say which one it was.
 */
const stack = (actions: Record<string, unknown>[], list: Record<string, unknown>) => ({
  objects: [{ name: 'task', fields: { name: { type: 'text' } } }],
  actions,
  views: [{ name: 'task', object: 'task', list }],
});

const PER_RECORD = { name: 'recalc_estimate', label: 'Recalc', type: 'api', execution: 'perRecord' };
const AGGREGATE = { name: 'recalc_selection', label: 'Recalc all', type: 'api', execution: 'aggregate' };
const UNDECLARED = { name: 'mark_done', label: 'Mark done', type: 'script' };

describe('validateActionDispatchContract — the refusal (both directions)', () => {
  it('refuses an `aggregate`-declared action wired as a bare string', () => {
    const findings = validateActionDispatchContract(
      stack([AGGREGATE], { bulkActions: ['recalc_selection'] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
    expect(findings[0]!.rule).toBe(ACTION_DISPATCH_CONTRACT_MISMATCH);
    expect(findings[0]!.path).toBe('views[0].list.bulkActions[0]');
  });

  it('refuses a `perRecord`-declared action wired through an aggregate def', () => {
    const findings = validateActionDispatchContract(
      stack([PER_RECORD], {
        bulkActionDefs: [{ name: 'recalc_estimate', operation: 'custom', execution: 'aggregate' }],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
    expect(findings[0]!.path).toBe('views[0].list.bulkActionDefs[0]');
  });

  // The ruling's own words for item 2: the refusal names the action, the view
  // and BOTH contracts. Asserted as four independent substrings rather than one
  // golden string, so re-wording the prose does not silently drop a name.
  it('names the action, the view and BOTH contracts, in both directions', () => {
    for (const [findings, declared, wired] of [
      [validateActionDispatchContract(stack([AGGREGATE], { bulkActions: ['recalc_selection'] })), 'aggregate', 'perRecord'],
      [
        validateActionDispatchContract(
          stack([PER_RECORD], {
            bulkActionDefs: [{ name: 'recalc_estimate', operation: 'custom', execution: 'aggregate' }],
          }),
        ),
        'perRecord',
        'aggregate',
      ],
    ] as const) {
      const f = findings[0]!;
      const action = declared === 'aggregate' ? 'recalc_selection' : 'recalc_estimate';
      expect(f.message).toContain(`"${action}"`);       // the action
      expect(f.where).toContain('view "task"');          // the view
      expect(f.message).toContain(`execution: '${declared}'`); // the declared contract
      expect(f.message).toContain(`execution: '${wired}'`);    // the wired contract
      // …and what each one actually delivers, so the reader does not have to
      // already know which key belongs to which.
      expect(f.message).toContain('_selectedIds');
      expect(f.message).toContain('recordId');
    }
  });

  it('offers both ends of the fix, never only one', () => {
    const f = validateActionDispatchContract(stack([AGGREGATE], { bulkActions: ['recalc_selection'] }))[0]!;
    expect(f.hint).toContain("execution: 'perRecord'");   // change the declaration
    expect(f.hint).toContain('bulkActionDefs');           // or change the wiring
  });
});

describe('validateActionDispatchContract — the cost direction (must stay clean)', () => {
  it('accepts a `perRecord`-declared action wired as a bare string', () => {
    expect(
      validateActionDispatchContract(stack([PER_RECORD], { bulkActions: ['recalc_estimate'] })),
    ).toEqual([]);
  });

  it('accepts an `aggregate`-declared action wired through an aggregate def', () => {
    expect(
      validateActionDispatchContract(
        stack([AGGREGATE], {
          bulkActionDefs: [{ name: 'recalc_selection', operation: 'custom', execution: 'aggregate' }],
        }),
      ),
    ).toEqual([]);
  });

  it('accepts the showcase shape: both actions, both wirings, in ONE list view', () => {
    expect(
      validateActionDispatchContract(
        stack([PER_RECORD, AGGREGATE, UNDECLARED], {
          bulkActions: ['mark_done', 'recalc_estimate'],
          bulkActionDefs: [{ name: 'recalc_selection', operation: 'custom', execution: 'aggregate' }],
        }),
      ),
    ).toEqual([]);
  });

  // ⛔ No silent default (the ruling's 「创业阶段不渐进」). An undeclared action
  // is undeclared, not per-record-until-proven-otherwise — including when it is
  // wired BOTH ways, which is the case the ADR-0087 semantic migration entry
  // hands back as a structured TODO rather than deciding.
  it('says nothing about an UNDECLARED action, even wired both ways', () => {
    expect(
      validateActionDispatchContract(
        stack([UNDECLARED], {
          bulkActions: ['mark_done'],
          bulkActionDefs: [{ name: 'mark_done', operation: 'custom', execution: 'aggregate' }],
        }),
      ),
    ).toEqual([]);
  });

  it('leaves a data-plane def alone even when its button id matches a declared action', () => {
    // `operation: 'update'` dispatches no action at all — its `name` is a
    // button id. Judging it would refuse a def that never reaches the body.
    expect(
      validateActionDispatchContract(
        stack([AGGREGATE], {
          bulkActionDefs: [{ name: 'recalc_selection', operation: 'update', patch: { done: true } }],
        }),
      ),
    ).toEqual([]);
  });

  it('skips a def carrying an inlined `actionDef` — it brings its own dispatcher', () => {
    expect(
      validateActionDispatchContract(
        stack([PER_RECORD], {
          bulkActionDefs: [
            { name: 'recalc_estimate', operation: 'custom', execution: 'aggregate', actionDef: { type: 'api' } },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("stays silent when two declarations of one name disagree — that is not the view's defect", () => {
    const findings = validateActionDispatchContract({
      objects: [{ name: 'task', actions: [{ name: 'recalc', type: 'api', execution: 'aggregate' }] }],
      actions: [{ name: 'recalc', type: 'api', execution: 'perRecord' }],
      views: [{ name: 'task', object: 'task', list: { bulkActions: ['recalc'] } }],
    });
    expect(findings).toEqual([]);
  });

  it('returns nothing at all for a stack that declares no contract anywhere', () => {
    expect(
      validateActionDispatchContract(stack([UNDECLARED], { bulkActions: ['mark_done'] })),
    ).toEqual([]);
    expect(validateActionDispatchContract({})).toEqual([]);
  });
});

describe('validateActionDispatchContract — every list tier', () => {
  it('judges `listViews.<key>` on a view', () => {
    const findings = validateActionDispatchContract({
      objects: [{ name: 'task' }],
      actions: [AGGREGATE],
      views: [
        {
          name: 'task',
          object: 'task',
          listViews: { bulk: { bulkActions: ['recalc_selection'] } },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe('views[0].listViews.bulk.bulkActions[0]');
    expect(findings[0]!.where).toContain('listViews.bulk');
  });

  it("judges an OBJECT's own `listViews` — the tier an object-embedded action is wired from", () => {
    const findings = validateActionDispatchContract({
      objects: [
        {
          name: 'task',
          actions: [PER_RECORD],
          listViews: {
            all: {
              bulkActionDefs: [{ name: 'recalc_estimate', operation: 'custom', execution: 'aggregate' }],
            },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe('objects[0].listViews.all.bulkActionDefs[0]');
    expect(findings[0]!.where).toContain('object "task"');
  });
});
