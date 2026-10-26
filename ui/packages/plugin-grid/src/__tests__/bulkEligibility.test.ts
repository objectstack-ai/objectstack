/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { hasDeclaredVisibilityGate } from '@object-ui/components';
import { partitionBulkRows, hasVisibilityGate } from '../bulkEligibility';

const ROWS = [
  { id: 'r1', done: false, owner: 'u1' },
  { id: 'r2', done: true, owner: 'u2' },
  { id: 'r3', done: false, owner: 'u2' },
];

afterEach(() => vi.restoreAllMocks());

describe('partitionBulkRows', () => {
  it('passes everything through when the def declares no visible', () => {
    const { eligible, skipped } = partitionBulkRows({ name: 'push' }, ROWS);

    // By reference — the ungated case must not bust downstream memos.
    expect(eligible).toBe(ROWS);
    expect(skipped).toBe(0);
  });

  it('evaluates a row-scoped predicate PER RECORD', () => {
    const { eligible, skipped } = partitionBulkRows({ name: 'mark_done', visible: '!record.done' }, ROWS);

    expect(eligible.map(r => r.id)).toEqual(['r1', 'r3']);
    expect(skipped).toBe(1);
  });

  it('answers the inverse predicate correctly too', () => {
    // The regression this exists for: with no record in scope BOTH
    // `!record.done` and `record.done` evaluated `true`, so one of them was
    // necessarily wrong and nothing could tell which.
    const { eligible } = partitionBulkRows({ name: 'reopen', visible: 'record.done' }, ROWS);

    expect(eligible.map(r => r.id)).toEqual(['r2']);
  });

  it('binds the host scope alongside the record', () => {
    const { eligible } = partitionBulkRows(
      { name: 'mine', visible: 'record.owner == current_user.id' },
      ROWS,
      { scope: { current_user: { id: 'u2' } } },
    );

    expect(eligible.map(r => r.id)).toEqual(['r2', 'r3']);
  });

  it('gives a record-free predicate the same verdict for every row', () => {
    // This is what makes a plain feature/permission gate keep behaving as a
    // BUTTON-level gate without the fold having to detect record references.
    const on = partitionBulkRows({ name: 'x', visible: 'features.bulk_ops' }, ROWS, {
      scope: { features: { bulk_ops: true } },
    });
    const off = partitionBulkRows({ name: 'x', visible: 'features.bulk_ops' }, ROWS, {
      scope: { features: { bulk_ops: false } },
    });

    expect(on.eligible).toHaveLength(3);
    expect(off.eligible).toHaveLength(0);
    expect(off.skipped).toBe(3);
  });

  it('fails CLOSED and warns when a predicate faults', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { eligible, skipped } = partitionBulkRows(
      { name: 'broken', visible: 'record.missing.deep == 1' },
      ROWS,
    );

    expect(eligible).toEqual([]);
    expect(skipped).toBe(3);
    // Diagnosable rather than a silent hide.
    expect(warn).toHaveBeenCalled();
  });

  it('accepts the { dialect, source } envelope', () => {
    const { eligible } = partitionBulkRows(
      { name: 'mark_done', visible: { dialect: 'cel', source: '!record.done' } },
      ROWS,
    );

    expect(eligible.map(r => r.id)).toEqual(['r1', 'r3']);
  });

  it('handles an empty selection without faulting', () => {
    const { eligible, skipped } = partitionBulkRows({ name: 'x', visible: '!record.done' }, []);

    expect(eligible).toEqual([]);
    expect(skipped).toBe(0);
  });

  // [objectui#3492] A boolean `visible` is a verdict, not an expression. The
  // engine has no AST to run for one, so it faulted and — on this fail-CLOSED
  // path — turned `visible: true` into "no record qualifies", i.e. the exact
  // inverse of what the author wrote. The other three action surfaces
  // (`useCondition` / `useRowPredicate`) have always short-circuited booleans.
  describe('boolean visible', () => {
    it('treats `true` as "every record qualifies", not as a fault', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { eligible, skipped } = partitionBulkRows({ name: 'always', visible: true }, ROWS);

      // By reference, like the ungated case: nothing was filtered.
      expect(eligible).toBe(ROWS);
      expect(skipped).toBe(0);
      // No engine call means nothing to warn about.
      expect(warn).not.toHaveBeenCalled();
    });

    it('treats `false` as "no record qualifies"', () => {
      const { eligible, skipped } = partitionBulkRows({ name: 'never', visible: false }, ROWS);

      expect(eligible).toEqual([]);
      expect(skipped).toBe(ROWS.length);
    });

    it('reports `false` as a DECLARED gate — truthiness cannot', () => {
      // What the bar keys "hide me" off. `def.visible &&` classified `false` as
      // ungated, so the button `false` was written to remove kept rendering.
      expect(hasVisibilityGate({ name: 'never', visible: false })).toBe(true);
      expect(hasVisibilityGate({ name: 'always', visible: true })).toBe(true);
      expect(hasVisibilityGate({ name: 'expr', visible: 'record.done' })).toBe(true);
      expect(hasVisibilityGate({ name: 'plain' })).toBe(false);
      expect(hasVisibilityGate({ name: 'blank', visible: '' })).toBe(false);
      expect(hasVisibilityGate(undefined)).toBe(false);
    });
  });

  // [objectui#11322] Blank text is no gate, in either spelling. The selection
  // bar used to ask "declared?" with `!= null && !== ''`, so the spellings below
  // counted as gates, every record failed them, and the bar hid an action the
  // row menu and toolbars show. `hasVisibilityGate` now asks the action family's
  // definition, and `partitionBulkRows` asks it BEFORE the core fold, whose own
  // opening test (`''` only) belongs to its field-rule callers. So the blank
  // reaches the fold as `undefined` and every record comes back by reference.
  // The `''` row above is the control; the boolean rows keep "not declared"
  // from passing as "always".
  describe('blank visible (objectui#11322)', () => {
    const BLANKS = [
      ['a whitespace-only string', '   '],
      ['an envelope whose `source` is whitespace', { dialect: 'cel', source: '   ' }],
      ['an envelope whose `source` is empty', { dialect: 'cel', source: '' }],
    ] as const;

    it.each(BLANKS)('%s is not a declared gate', (_label, visible) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(hasVisibilityGate({ name: 'blank', visible: visible as never })).toBe(false);
    });

    it.each(BLANKS)('%s passes every record through, by reference', (_label, visible) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { eligible, skipped } = partitionBulkRows({ name: 'blank', visible: visible as never }, ROWS);
      expect(eligible).toBe(ROWS);
      expect(skipped).toBe(0);
    });

    it('answers exactly what the action family answers, for every shape above', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const shapes: unknown[] = [undefined, '', false, true, 'record.done', ...BLANKS.map(([, v]) => v)];
      for (const visible of shapes) {
        expect(hasVisibilityGate({ name: 'x', visible: visible as never })).toBe(hasDeclaredVisibilityGate(visible));
      }
    });
  });

  // [objectui#11358] A `visible` that is PRESENT but has no evaluable `source`
  // — an `ast`-only envelope, `0`, `{}`, an array — is a declared gate that
  // faults, not "no gate". Before the ruling the action family's definition
  // read it as no gate, so the bar offered the action and it ran over EVERY
  // selected record, in silence. Now the definition answers "declared", the
  // fold evaluates it, the fault path fails closed (no record qualifies, so the
  // bar hides the def), and the fault is reported once, naming the def.
  describe('declared but not evaluable visible (objectui#11358)', () => {
    const UNEVALUABLE = [
      ["an `ast`-only envelope", { dialect: 'cel', ast: { kind: 'call', fn: '==' } }],
      ['0', 0],
      ['{}', {}],
      ['an array', ['record.done']],
    ] as const;

    it.each(UNEVALUABLE)('%s is a declared gate, as the action family answers', (_label, visible) => {
      expect(hasVisibilityGate({ name: 'x', visible: visible as never })).toBe(true);
      expect(hasDeclaredVisibilityGate(visible)).toBe(true);
    });

    it.each(UNEVALUABLE)('%s admits no record, and is reported once naming the def', (label, visible) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const name = `bulk_11358_${UNEVALUABLE.findIndex(([l]) => l === label)}`;
      const { eligible, skipped } = partitionBulkRows({ name, visible: visible as never }, ROWS);
      expect(eligible).toEqual([]);
      expect(skipped).toBe(ROWS.length);
      const lines = warn.mock.calls.map(c => c.map(String).join(' '));
      expect(lines.filter(l => l.includes(name))).toHaveLength(1);
      expect(lines.filter(l => l.includes('[unevaluable]'))).toHaveLength(1);
    });

    it('controls: an absent gate passes every record, a real CEL `source` evaluates as before', () => {
      expect(partitionBulkRows({ name: 'absent' }, ROWS).eligible).toBe(ROWS);
      const real = partitionBulkRows({ name: 'real', visible: { dialect: 'cel', source: '!record.done' } as never }, ROWS);
      expect(real.eligible.map(r => r.id)).toEqual(['r1', 'r3']);
      expect(real.skipped).toBe(1);
    });
  });
});
