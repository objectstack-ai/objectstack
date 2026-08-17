// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8990 — the showcase's authored predicates survive the SPARSE action face.
 *
 * `predicate-matrix.action.ts` is a LIVE browser specimen: every gate in it is
 * declared on `list_item` / `record_more`, so its `visible` binds a LIST ROW
 * carrying only the view's `$select` projection — not a total record. Unguarded,
 * a predicate reading a column the list does not show aborts at key resolution,
 * and CEL's fault is fail-closed: the button silently is not offered, which
 * looks exactly like the predicate having said no.
 *
 * What this file pins is the property that made the migration safe rather than
 * the spelling of any one predicate: **no authored showcase predicate may fault
 * on a sparse binding**. Measured against the running app's own payloads, 40 of
 * these 53 aborted with `No such key` on a default-list row before #8990 and 0
 * do after, while every verdict on a fully-projected record is unchanged.
 *
 * The rule itself lives on `materializeDeclaredFields` in `@objectstack/objectql`
 * (`packages/objectql/src/declared-fields.ts`, #8975 + #8990's leaf-first
 * refinement). ⛔ Do not restate it here.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { allPredicateMatrixActions } from '../src/ui/actions/predicate-matrix.action.js';
import { MarkDoneAction, SubmitForSignoffAction, ArchiveTaskAction } from '../src/ui/actions/index.js';

/** `defineAction` normalizes the CEL shorthand into a `{dialect, source}` envelope. */
function sourceOf(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  return (raw as { source?: string } | undefined)?.source ?? '';
}

function evaluate(source: string, record: Record<string, unknown>): boolean | string {
  const r = celEngine.evaluate({ dialect: 'cel', source }, {
    record,
    user: { id: 'u1' },
    os: { user: { id: 'u1' } },
  } as never);
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
  return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
}

/** The record field names a predicate reads, top level only. */
function fieldsOf(source: string): string[] {
  return [...new Set([...source.matchAll(/record\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!))];
}

/** Every record-scoped predicate authored in the matrix, as `[label, source]`. */
const matrixPredicates: [string, string][] = allPredicateMatrixActions.flatMap((a) => {
  const rec = a as unknown as Record<string, unknown>;
  return (['visible', 'disabled'] as const).flatMap((key) => {
    const s = sourceOf(rec[key]);
    return s && s.includes('record.')
      ? ([[`${String(rec.name)}.${key}`, s]] as [string, string][])
      : [];
  });
});

describe('#8990 — showcase action predicates on the sparse face', () => {

  it('finds the whole authored matrix (guards against a silently empty sweep)', () => {
    // The census is helper-indirected: `zooTypeGate(name, label, visible)` passes
    // the predicate POSITIONALLY, so a `visible:`-key grep sees 8 of these and
    // misses 45. Reading them off the exported actions is what makes the sweep
    // total — and this assertion is what keeps it that way.
    expect(matrixPredicates.length).toBe(53);
  });

  it.each(matrixPredicates)(
    '%s answers instead of faulting on an EMPTY list row',
    (_label, source) => {
      // The row a view projected nothing onto — the absent-key half.
      expect(evaluate(source, {})).toBeTypeOf('boolean');
    },
  );

  it.each(matrixPredicates)(
    '%s answers instead of faulting when every read column is projected NULL',
    (_label, source) => {
      // The row that carries the column holding NULL — the other half. Both are
      // live at once on this face, and each guard half covers exactly one.
      const record: Record<string, unknown> = {};
      for (const f of fieldsOf(source)) record[f] = null;
      expect(evaluate(source, record)).toBeTypeOf('boolean');
    },
  );

  it('every matrix predicate carries has() on the columns it reads', () => {
    for (const [label, source] of matrixPredicates) {
      for (const field of fieldsOf(source)) {
        expect(`${label}: ${source}`).toContain(`has(record.${field})`);
      }
    }
  });

  describe('the ordinary showcase row actions', () => {
    const cases: [string, unknown][] = [
      ['showcase_mark_done', MarkDoneAction.visible],
      ['showcase_submit_for_signoff', SubmitForSignoffAction.visible],
      ['showcase_archive_task', ArchiveTaskAction.disabled],
    ];

    it.each(cases)('%s is has()-guarded and never faults', (_name, raw) => {
      const source = sourceOf(raw);
      expect(source).toContain('has(record.');
      expect(evaluate(source, {})).toBeTypeOf('boolean');
    });

    it('mark-done still hides on a finished task and offers on an unfinished one', () => {
      const source = sourceOf(MarkDoneAction.visible);
      expect(evaluate(source, { done: true })).toBe(false);
      expect(evaluate(source, { done: false })).toBe(true);
      // A projected-but-null `done` reads as "not done", so the button is
      // offered — `!=` against a literal never faults, which is exactly why
      // `has()` alone is the whole guard here and `!record.done` was not.
      expect(evaluate(source, { done: null })).toBe(true);
      // The spelling this replaced, pinned so the regression is recognisable.
      expect(evaluate('!record.done', { done: null })).toBe('FAULT no such overload: !null');
      expect(evaluate('!record.done', {})).toBe('FAULT No such key: done');
    });
  });

  it('keeps the Full-vs-Minimal contrast the fixture exists to demonstrate', () => {
    // A record-DETAIL read projects every declared column, so the absent half
    // never fires there and the specimens must still disagree across the two
    // seeded records. `f_boolean` is the three-authoring-forms gate.
    const gate = sourceOf(
      allPredicateMatrixActions.find((a) => (a as { name: string }).name === 'showcase_zoo_visible_string')!.visible,
    );
    expect(evaluate(gate, { f_boolean: true })).toBe(true);
    expect(evaluate(gate, { f_boolean: false })).toBe(false);
  });
});
