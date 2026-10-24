/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Tab-preset operator lowering: `ViewTab.filter` → ObjectQL AST (#3470).
 *
 * `UserFilters` used to carry its OWN operator table (`specOperatorToAst`) —
 * the second hand-kept operator map in this package — and it had drifted: it
 * lowered `not_in`/`nin` to the SPACED `'not in'`, a spelling that appears in
 * no spec vocabulary. `isFilterAST()` refuses it and the wire answers `400
 * INVALID_FILTER`, so a tab preset written with the spec's own canonical
 * spelling produced an empty list plus an error the moment it was clicked.
 *
 * The table is gone. Lowering is now purely structural — all 19
 * `VIEW_FILTER_OPERATORS` are already `VALID_AST_OPERATORS` members — with the
 * spec's OWN `normalizeFilterOperator` as the single exit, exactly as the write
 * side (`app-shell/views/viewFilterFold.ts`) and `@object-ui/core`'s saved-view
 * fold (#3431) do.
 *
 * These assertions pin the acceptance fact OFFLINE, using the spec's own
 * `isFilterAST` — the very predicate that gates the filter server-side — so the
 * fix cannot regress without a live backend in the loop. The corresponding LIVE
 * measurement (published `@objectstack/*@17.0.0-rc.2` + app-showcase) is
 * recorded on `normalizeTabPresets` and in the PR: `'not in'` → 400,
 * `not_in` → 200 with the 8 rows the `!=` baseline returns, and `before`/`after`
 * → byte-identical answers to `<`/`>` on both a `date` and a `datetime` field.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { isFilterAST, VALID_AST_OPERATORS } from '@objectstack/spec/data';
import {
  VIEW_FILTER_OPERATORS,
  VIEW_FILTER_OPERATOR_ALIASES,
  ViewFilterRuleSchema,
  normalizeFilterOperator,
} from '@objectstack/spec/ui';
import { UserFilters } from '../UserFilters';

/**
 * Render a tabs-mode `UserFilters` whose single preset is the given spec
 * `ViewFilterRule`, and return the AST node it emits.
 *
 * The preset is the DEFAULT tab, so `TabFilters`' mount effect emits it without
 * a click — the same path a user takes when a view opens on its default tab,
 * and the path that shipped the 400.
 */
/**
 * The authored rule, typed as authored metadata rather than as an untyped bag.
 *
 * `operator` is a plain `string`, not the spec's operator enum, because feeding
 * the legacy and misspelled spellings (`nin`, `notin`, `notIn`) is the point of
 * these cases — and it is OPTIONAL because one case deliberately authors a rule
 * with no operator at all, to pin that the deleted `case undefined: return '='`
 * branch does not come back. `Record<string, unknown>` expressed neither fact;
 * it merely hid both.
 */
type AuthoredRule = { field: string; operator?: string; value?: unknown };

function emitFor(rule: AuthoredRule): unknown[] {
  const onFilterChange = vi.fn();
  render(
    <UserFilters
      config={{
        element: 'tabs',
        // The tab config's own type requires a well-formed `{ field, operator }`
        // rule, which is correct — and these fixtures are precisely the authored
        // metadata that does not satisfy it. The cast is the suite's subject
        // rather than a way around it: every case below asserts that an off-spec
        // rule is REFUSED (`isFilterAST` false) or folded onto a canonical
        // spelling, never silently repaired. Injecting it here, once, keeps that
        // deliberate looseness at the one boundary it belongs to.
        tabs: [{ name: 'preset', label: 'Preset', isDefault: true, filter: [rule as Required<Pick<AuthoredRule, 'field' | 'operator'>> & { value?: unknown }] }],
      }}
      data={[]}
      onFilterChange={onFilterChange}
    />,
  );
  expect(onFilterChange).toHaveBeenCalledTimes(1);
  return onFilterChange.mock.calls[0][0];
}

describe('UserFilters tab presets — the reported defect (#3470)', () => {
  it('lowers a canonical `not_in` preset to a node isFilterAST ACCEPTS', () => {
    // BEFORE this fix: emitted `['status', 'not in', ['done']]` — isFilterAST
    // false, 400 INVALID_FILTER measured against a real backend. This is the
    // assertion that flips red→green.
    const node = emitFor({ field: 'status', operator: 'not_in', value: ['done'] });
    expect(node).toEqual([['status', 'not_in', ['done']]]);
    expect(
      isFilterAST(node),
      `a not_in tab preset produced ${JSON.stringify(node)}, which isFilterAST() rejects — `
        + 'the server answers 400 INVALID_FILTER and the tab shows an empty list',
    ).toBe(true);
  });

  it('folds the legacy `nin` spelling onto the canonical `not_in`', () => {
    // Stored view metadata carries the shorthand: saveMeta persists the authored
    // body verbatim, so the spec's own z.preprocess never reaches the row.
    const node = emitFor({ field: 'status', operator: 'nin', value: ['done'] });
    expect(node).toEqual([['status', 'not_in', ['done']]]);
    expect(isFilterAST(node)).toBe(true);
  });

  it('never emits the spaced `not in`, which no spec vocabulary defines', () => {
    for (const spelling of ['not_in', 'nin', 'notin', 'notIn']) {
      const [[, operator]] = emitFor({ field: 'status', operator: spelling, value: ['done'] }) as [
        [string, string, unknown],
      ];
      expect(operator, `authored '${spelling}' lowered to '${operator}'`).not.toBe('not in');
      expect(operator).toBe('not_in');
    }
  });
});

describe('UserFilters tab presets — lowering is structural, not translated', () => {
  it('reads both vocabularies from the spec', () => {
    // Guards every it.each below against silently passing on an empty list.
    // 19 through @objectstack/spec 17.0.0; 20 as of 17.1.0, which adds the
    // canonical `icontains` (objectui#5328).
    expect(VIEW_FILTER_OPERATORS.length).toBe(20);
    expect(VALID_AST_OPERATORS.size).toBeGreaterThan(0);
  });

  it('needs no operator table at all: every view operator is already AST-valid', () => {
    // This is WHY the private table could be deleted rather than repaired.
    expect(VIEW_FILTER_OPERATORS.filter((op) => !VALID_AST_OPERATORS.has(op))).toEqual([]);
  });

  it.each(VIEW_FILTER_OPERATORS)('a `%s` preset survives the isFilterAST gate', (op) => {
    const value = op === 'in' || op === 'not_in' ? ['a', 'b'] : op === 'between' ? [1, 2] : 'x';
    const node = emitFor({ field: 'some_field', operator: op, value });
    expect(
      isFilterAST(node),
      `a '${op}' tab preset produced ${JSON.stringify(node)}, which isFilterAST() rejects`,
    ).toBe(true);
  });

  it.each(Object.keys(VIEW_FILTER_OPERATOR_ALIASES))(
    'the legacy spelling `%s` lowers through the spec, not a local table',
    (alias) => {
      const [[, operator]] = emitFor({ field: 'f', operator: alias, value: ['a', 'b'] }) as [
        [string, string, unknown],
      ];
      // The single-exit pin: whatever the spec says, verbatim. A second table
      // reintroduced here fails this the moment it disagrees by one spelling.
      expect(operator).toBe(normalizeFilterOperator(alias));
      expect(VALID_AST_OPERATORS.has(operator)).toBe(true);
    },
  );

  it('passes `before`/`after` through instead of rewriting them to `<`/`>`', () => {
    // The one judgement call in #3470, settled by MEASUREMENT rather than
    // assumption: on the live rc.2 backend the word and the symbol return
    // identical status and identical record ids, on a `date` field and on a
    // `datetime` field, in both directions. So the rewrite was a no-op and
    // dropping it is a pure fix. (`canonicalAstOperator('before') === '<'`
    // in the spec says the same thing independently.)
    expect(emitFor({ field: 'due_date', operator: 'before', value: '2026-08-01' }))
      .toEqual([['due_date', 'before', '2026-08-01']]);
    expect(emitFor({ field: 'due_date', operator: 'after', value: '2026-08-01' }))
      .toEqual([['due_date', 'after', '2026-08-01']]);
  });

  it('passes an unknown spelling through VERBATIM so the server rejects it loudly', () => {
    // Direction note (honest reverse-verification): this one was GREEN BEFORE
    // the change too — the deleted table's `default:` branch also passed
    // unknowns through. It is here to pin the CONTRACT, not to flip: coercing
    // `bfore` to `before` would answer a plausible-looking wrong record set
    // instead of the 400 that tells the author their metadata is misspelled.
    const node = emitFor({ field: 'due_date', operator: 'bfore', value: '2026-08-01' });
    expect(node).toEqual([['due_date', 'bfore', '2026-08-01']]);
    expect(isFilterAST(node)).toBe(false);
  });

  it('refuses to invent `=` for a rule that omits the operator', () => {
    // The ONE deliberate behaviour change in #3470, and the only assertion here
    // whose "before" was a passing 200 rather than a 400. The deleted table
    // opened with `case undefined: … return '='`, so `{field, value}` with no
    // operator lowered to `['status','=','x']` — accepted by isFilterAST, and
    // answered by the server as a real equality predicate.
    //
    // `ViewFilterRuleSchema` REQUIRES `operator` (bare z.enum, no default), so
    // that rule is off-spec metadata publish validation refuses. Inventing an
    // answer for it was a lenient consumer standing in for the contract
    // (AGENTS.md #0.1); it now earns the same loud 400 as any other off-spec
    // spelling.
    expect(ViewFilterRuleSchema.safeParse({ field: 'status', value: 'x' }).success).toBe(false);

    const node = emitFor({ field: 'status', value: 'x' });
    expect(isFilterAST(node)).toBe(false);
    // What the old table would have produced, for contrast — accepted, and so
    // silently answered as `status = 'x'`.
    expect(isFilterAST([['status', '=', 'x']])).toBe(true);
  });

  it('leaves an already-lowered legacy `filters` triplet list untouched', () => {
    // The other accepted tab shape (`{ id, label, filters: triplet[] }`) never
    // went through the operator table and must not start now.
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{
          element: 'tabs',
          tabs: [{ id: 'active', label: 'Active', default: true, filters: [['status', '=', 'active']] }],
        } as never}
        data={[]}
        onFilterChange={onFilterChange}
      />,
    );
    expect(onFilterChange).toHaveBeenCalledWith([['status', '=', 'active']]);
  });
});
