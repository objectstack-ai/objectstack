// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17319 — an action declares the bulk dispatch contract its body is written
 * for (maintainer ruling, decision batch #121 item 3, 2026-09-12: 「同意」).
 *
 * What these tests pin, in the order the defect is argued:
 *
 *  - THE DEFECT, reproduced first and kept: the SAME declared action, under the
 *    two wirings, produces two params bags that differ in exactly the keys the
 *    ADR-0104 strict gate is required to wave through — so `validateActionParams`
 *    returns ZERO issues for both. That is the "nothing catches it" half of the
 *    card, measured here rather than recalled, and it is deliberately still
 *    true after this change: the key added by #17319 is an AUTHORING
 *    declaration, so the reproduction stands and the refusal lands in
 *    `@objectstack/lint` (`action-dispatch-contract-mismatch`).
 *  - THE VOCABULARY: the set of values the ACTION accepts is exactly
 *    `BulkActionExecutionSchema.options` — the def's own two — and nothing
 *    else. The ruling admits no third spelling, so the pin is the accepted SET,
 *    measured against a battery of third spellings that must all be refused.
 *  - ACCEPT / REFUSE: both values parse; the near-miss KEY spellings rename onto
 *    `execution`; `mode` does NOT (it is a declared action key with its own
 *    meaning, unlike on the def, where `mode` aliases onto `execution`).
 *  - NO SILENT DEFAULT: an action that omits the key parses, and the parsed
 *    shape carries NO `execution` — not `'perRecord'`, not `'aggregate'`.
 */

import { describe, expect, it } from 'vitest';
import { ActionSchema } from './action.zod';
import { BulkActionDefSchema, BulkActionExecutionSchema } from './bulk-action.zod';
import { ACTION_PARAM_BUILTIN_KEYS, validateActionParams } from './action-params.zod';
import type { ResolvedActionParam } from './action-params.zod';

/** The showcase's aggregate-side action, reduced to what the contract needs. */
const undeclaredAction = {
  name: 'recalc_selection',
  label: 'Recalculate selection',
  type: 'api' as const,
  target: '/api/recalc',
};
const recalcSelection = { ...undeclaredAction, execution: 'aggregate' as const };

describe('#17319 — the defect, reproduced (and still true: this is an authoring key)', () => {
  it('hands the SAME action opposite input under the two wirings, with zero diagnostics', () => {
    // One declared param — everything else in each bag is a builtin the author
    // cannot declare and the gate must admit.
    const resolved: ResolvedActionParam[] = [{ name: 'format', type: 'text' }];

    // Wiring A — `bulkActions: ['recalc_selection']`: N dispatches, each
    // carrying ONE row id and no selection.
    const perRecordBag = { format: 'png', recordId: 'task_1', objectName: 'task' };
    // Wiring B — a `bulkActionDefs` entry with `execution: 'aggregate'`: ONE
    // dispatch carrying the whole selection and no record id.
    const aggregateBag = { format: 'png', _selectedIds: ['task_1', 'task_2', 'task_3'], objectName: 'task' };

    // Opposite input…
    expect('recordId' in perRecordBag).toBe(true);
    expect('_selectedIds' in perRecordBag).toBe(false);
    expect('recordId' in aggregateBag).toBe(false);
    expect('_selectedIds' in aggregateBag).toBe(true);

    // …and the strict params gate is silent on both, because the two keys that
    // DECIDE the contract are the two it is required to admit undeclared.
    expect(validateActionParams(resolved, perRecordBag)).toEqual([]);
    expect(validateActionParams(resolved, aggregateBag)).toEqual([]);
    expect(ACTION_PARAM_BUILTIN_KEYS).toContain('recordId');
    expect(ACTION_PARAM_BUILTIN_KEYS).toContain('_selectedIds');

    // The gate is not broken — it refuses a bag key that is NOT a builtin. The
    // control that makes the two silences above a reading rather than a dead
    // probe: it could have come back the other way, and for this key it does.
    expect(validateActionParams(resolved, { format: 'png', selectedIds: ['a'] }).map((i) => i.code))
      .toEqual(['unknown_field']);
  });
});

describe("#17319 — the vocabulary is `bulkActionDefs`' own", () => {
  it('accepts exactly the def`s two options on the action, and no third spelling', () => {
    expect(BulkActionExecutionSchema.options).toEqual(['perRecord', 'aggregate']);

    for (const value of BulkActionExecutionSchema.options) {
      expect(ActionSchema.safeParse({ ...undeclaredAction, execution: value }).success).toBe(true);
    }

    // Every plausible third spelling — including `per_record`, the one the
    // filing card proposed and therefore the one most likely to be typed.
    const thirdSpellings = [
      'per_record', 'perrecord', 'PerRecord', 'record', 'single', 'each', 'fanout', 'fan_out',
      'batch', 'bulk', 'all', 'once', 'set', 'aggregated', 'Aggregate', '',
    ];
    for (const value of thirdSpellings) {
      expect(
        { value, accepted: ActionSchema.safeParse({ ...undeclaredAction, execution: value }).success },
      ).toEqual({ value, accepted: false });
    }
  });

  it('leaves the def`s own key untouched — mirrored, not moved', () => {
    expect(BulkActionDefSchema.safeParse({
      name: 'recalc_selection', operation: 'custom', execution: 'aggregate',
    }).success).toBe(true);
  });
});

describe('#17319 — accept, refuse, and the key spellings', () => {
  it('accepts both declared contracts and keeps the value verbatim', () => {
    expect(ActionSchema.parse(recalcSelection).execution).toBe('aggregate');
    expect(ActionSchema.parse({ ...undeclaredAction, execution: 'perRecord' }).execution).toBe('perRecord');
  });

  it('refuses a third value at the `execution` path, naming the two that exist', () => {
    const res = ActionSchema.safeParse({ ...undeclaredAction, execution: 'per_record' });
    expect(res.success).toBe(false);
    const issue = res.error!.issues.find((i) => i.path.join('.') === 'execution');
    expect(issue).toBeDefined();
    expect(JSON.stringify(issue)).toContain('perRecord');
    expect(JSON.stringify(issue)).toContain('aggregate');
  });

  it('renames the near-miss KEY spellings onto `execution`', () => {
    for (const alias of ['dispatch', 'dispatchContract', 'bulkExecution', 'bulkDispatch']) {
      const res = ActionSchema.safeParse({ ...undeclaredAction, [alias]: 'aggregate' });
      expect({ alias, ok: res.success }).toEqual({ alias, ok: false });
      expect(JSON.stringify(res.error!.issues)).toContain('execution');
    }
  });

  it('⛔ does NOT rename `mode` — on an ACTION that is a declared key of its own', () => {
    // The bulk def aliases `mode` onto `execution`; an action must not, or a
    // real `mode: 'create'` declaration would be renamed out from under its
    // author. This is the one place the two surfaces' alias tables differ.
    const res = ActionSchema.safeParse({ ...undeclaredAction, mode: 'create' });
    expect(res.success).toBe(true);
    expect(res.data!.mode).toBe('create');
  });
});

describe('#17319 — ⛔ no silent default for an undeclared action', () => {
  it('parses an action that omits the key, and leaves it ABSENT', () => {
    const parsed = ActionSchema.parse(undeclaredAction);
    expect(parsed.execution).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed, 'execution')).toBe(false);
  });
});
