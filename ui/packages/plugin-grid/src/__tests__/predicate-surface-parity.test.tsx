/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One predicate, one record, THREE surfaces, one verdict (objectui#3521).
 *
 * The acceptance criterion of #3521 is not "the header stops throwing on
 * `.size()`" — it is that the same declaration reaches the same show/hide
 * conclusion in the row kebab, the selection bar and the record page header.
 * Teaching the legacy JS evaluator a few missing functions would have satisfied
 * the symptom list and left two dialects in place; routing all three surfaces
 * through `evalRowPredicate` is what makes them one.
 *
 * This file is the only place that can see all three: `plugin-grid` owns the row
 * kebab (whose items and "⋮" guard share `isCustomRowActionVisible`, from
 * `@object-ui/components`) and the selection bar (`partitionBulkRows`), and
 * depends on `@object-ui/components`, which owns `page:header`.
 *
 * Scope of the claim: most fixtures are non-empty predicate STRINGS / envelopes,
 * i.e. the dialect question #3521 asked. The boolean and empty-string shapes were
 * excluded while they still diverged — the kebab rendered a `visible: false` def
 * while the bar and the header hid it — and pinning them then would have read as
 * blessing a difference #3521 did not fix. objectui#3758 closed that divergence
 * by making the kebab's gate detect a DECLARED gate (`!= null && !== ''`) instead
 * of a truthy one, so they belong in the table now: the shapes an author can
 * write with no expression at all reach one verdict on all three surfaces too.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider, PredicateScopeProvider } from '@object-ui/react';
// Module-scope import for the registry side effect (AGENTS.md §测试纪律): the
// `page:header` renderer must be registered before the first render, and a
// dynamic import inside a hook would race the RTL assertion budget.
import '@object-ui/components';
// The row kebab's gate. `RowActionMenu` imports it from this barrel: one
// function serves this package's row menu and the related list's data table
// (objectui#11294).
import { isCustomRowActionVisible } from '@object-ui/components';
import { partitionBulkRows } from '../bulkEligibility';

const OBJECT_FIELDS = {
  f_status: { type: 'select' },
  f_tags: { type: 'select', multiple: true },
  f_multiselect: { type: 'select', multiple: true },
  f_textarea: { type: 'textarea' },
  f_date: { type: 'date' },
  owner: { type: 'user' },
};

const OBJECT_SCHEMA = { name: 'showcase_field_zoo', label: 'Field Zoo', fields: OBJECT_FIELDS };

/** What the host's `ExpressionProvider` feeds every one of the three surfaces. */
const SCOPE = { user: { id: 'U1' }, os: { user: { id: 'U1' } } };

const BASE_RECORD = {
  id: 'r1',
  f_status: 'open',
  f_tags: ['alpha', 'beta'],
  f_multiselect: ['red', 'blue'],
  f_textarea: 'please handle, urgent',
  f_date: '2020-01-01',
  owner: { id: 'U1', name: 'Ada Lovelace' },
};

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- registry component is stable
  return <Component schema={schema} />;
}

/** Surface 3 — the record page header. */
function headerVerdict(name: string, visible: unknown, record: any): boolean {
  render(
    <PredicateScopeProvider scope={SCOPE}>
      <ActionProvider>
        <RecordContextProvider
          objectName="showcase_field_zoo"
          recordId={record?.id ?? null}
          data={record}
          objectSchema={OBJECT_SCHEMA}
        >
          <PageHeader
            schema={{
              type: 'page:header',
              title: 'Specimen',
              actions: [
                { name, locations: ['record_header'], label: 'Parity Action', type: 'api', visible },
              ],
            }}
          />
        </RecordContextProvider>
      </ActionProvider>
    </PredicateScopeProvider>,
  );
  return !!screen.queryByRole('button', { name: /Parity Action/i });
}

/** Surface 1 — the row kebab / inline row button. */
function rowVerdict(name: string, visible: unknown, record: any): boolean {
  return isCustomRowActionVisible({ name, visible } as any, record, SCOPE, OBJECT_FIELDS);
}

/** Surface 2 — the selection bar's per-record eligibility fold. */
function bulkVerdict(name: string, visible: unknown, record: any): boolean {
  const { eligible } = partitionBulkRows({ name, visible } as any, [record], {
    scope: SCOPE,
    fields: OBJECT_FIELDS,
  });
  return eligible.length === 1;
}

interface Case {
  /** What the fixture demonstrates. */
  what: string;
  /** Unique action name — the warn-once registries are module-global. */
  name: string;
  visible: unknown;
  record?: Record<string, unknown>;
  expected: boolean;
}

const CASES: Case[] = [
  // The three CEL-only families from the issue. Before #3521 the header threw
  // on every one of them and fail-closed hid the button, so the header column
  // read `false` while the other two read the real verdict.
  { what: 'method call `.size()` — true', name: 'par_size_true', visible: 'record.f_tags.size() > 0', expected: true },
  {
    what: 'method call `.size()` — false',
    name: 'par_size_false',
    visible: 'record.f_tags.size() > 0',
    record: { f_tags: [] },
    expected: false,
  },
  {
    what: 'method call `.contains()` — true',
    name: 'par_contains_true',
    visible: 'record.f_textarea.contains("urgent")',
    expected: true,
  },
  { what: '`in` operator — true', name: 'par_in_true', visible: '"red" in record.f_multiselect', expected: true },
  { what: '`in` operator — false', name: 'par_in_false', visible: '"green" in record.f_multiselect', expected: false },
  {
    what: 'stdlib `today()` — true',
    name: 'par_today_true',
    visible: 'record.f_date != null && record.f_date < today()',
    expected: true,
  },
  {
    what: 'stdlib `today()` — false',
    name: 'par_today_false',
    visible: 'record.f_date != null && record.f_date < today()',
    record: { f_date: '2999-01-01' },
    expected: false,
  },
  // A CEL construct inside the `{ dialect, source }` envelope — the shape the
  // spec bridge produces for every authored predicate.
  {
    what: 'CEL envelope',
    name: 'par_envelope',
    visible: { dialect: 'cel', source: 'record.f_tags.size() > 1' },
    expected: true,
  },
  // objectui#3501's binding half, now reached through the shared entry on all
  // three surfaces: an EXPANDED relation compares as the foreign key, and an
  // unexpanded one reaches the same verdict.
  {
    what: 'relation bound as its foreign key (expanded payload)',
    name: 'par_relation_expanded',
    visible: 'record.owner == os.user.id && record.f_tags.size() > 0',
    expected: true,
  },
  {
    what: 'relation bound as its foreign key (unexpanded payload)',
    name: 'par_relation_unexpanded',
    visible: 'record.owner == os.user.id && record.f_tags.size() > 0',
    record: { owner: 'U1' },
    expected: true,
  },
  {
    what: 'relation on someone else’s record',
    name: 'par_relation_other',
    visible: 'record.owner == os.user.id',
    record: { owner: { id: 'U2', name: 'Grace' } },
    expected: false,
  },
  // The bare-field and `data.*` spellings retired in objectui#5741 (Phase 2 of
  // the objectui#5330 canon): unbound on every record surface, they fault and
  // fail CLOSED on all three — the parity claim now holds for the retirement.
  {
    what: 'bare field shorthand — retired (objectui#5741), fails closed on all three',
    name: 'par_bare',
    visible: 'f_status == "open"',
    expected: false,
  },
  {
    what: '`data.*` — retired (objectui#5741), fails closed on all three',
    name: 'par_data',
    visible: 'data.f_status == "open"',
    expected: false,
  },
  // The legacy fallback lives inside the shared entry, so parity covers it too.
  {
    what: 'legacy `${…}` template — true',
    name: 'par_legacy_template',
    visible: '${record.f_status === "open"}',
    expected: true,
  },
  {
    what: 'legacy `===` — false',
    name: 'par_legacy_strict_eq',
    visible: 'record.f_status === "closed"',
    expected: false,
  },
  // A predicate that cannot be evaluated: fail-CLOSED on all three.
  { what: 'faulting predicate fails closed', name: 'par_fault', visible: 'no_such_var_par == 1', expected: false },
  // The non-expression shapes, parity-checked since objectui#3758. A declared
  // BOOLEAN is a verdict every surface short-circuits rather than evaluating;
  // `''` and an absent `visible` are no gate at all on every surface.
  { what: 'declared boolean false excludes every row', name: 'par_bool_false', visible: false, expected: false },
  { what: 'declared boolean true offers every row', name: 'par_bool_true', visible: true, expected: true },
  { what: 'empty-string `visible` is no gate', name: 'par_empty_string', visible: '', expected: true },
  { what: 'absent `visible` is no gate', name: 'par_absent', visible: undefined, expected: true },
];

describe('one predicate, one verdict on all three action surfaces (#3521)', () => {
  it.each(CASES)('$what', ({ what, name, visible, record, expected }) => {
    const row = { ...BASE_RECORD, ...(record ?? {}) };
    const verdicts = {
      rowKebab: rowVerdict(name, visible, row),
      selectionBar: bulkVerdict(name, visible, row),
      recordHeader: headerVerdict(name, visible, row),
    };
    expect(verdicts, what).toEqual({
      rowKebab: expected,
      selectionBar: expected,
      recordHeader: expected,
    });
  });
});
