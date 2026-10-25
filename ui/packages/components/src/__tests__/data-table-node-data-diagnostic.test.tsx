/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6665 — a `${...}` expression written into node-level `data` is not
 * evaluated, and the table renders a correct-looking header over `No results
 * found` with nothing thrown and nothing logged.
 *
 * ## Why this file RE-RUNS the measurement instead of quoting it
 *
 * The four-leg table below reached the card as a quotation from
 * `skills/objectui/rules/protocol.md`, which states it as a measurement on
 * `f1c27f037` — a commit nobody had re-run it against since. A behaviour table
 * that lives only in prose ages silently: the day the renderer changes, the doc
 * still reads as a measurement. Re-run on merge-base `5967be095` against a tree
 * with none of this card's code in it, all four legs reproduced exactly, and
 * they are pinned HERE from now on so the next change to any of them is a red
 * test rather than a stale paragraph.
 *
 * ## The contrast IS the argument
 *
 * The same expression is evaluated under `properties` and not evaluated at node
 * level. That side-by-side is what makes this a defect rather than a design
 * choice, so all four legs are asserted together in one table-driven test
 * rather than split across files where they could drift apart.
 *
 * ## What this card did NOT change
 *
 * Behaviour. Making node-level `data` evaluate expressions is a behaviour
 * change on a published component, and the triage ruling put it on the
 * maintainer floor rather than in this PR. Every RENDER assertion below
 * therefore passes identically against the tree before the diagnostic existed;
 * only the WARNING assertions can tell the two apart. That is deliberate: the
 * trap stops being silent, it does not stop being a trap.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider, PredicateScopeProvider } from '@object-ui/react';

// The REAL renderers, imported at module scope so `data-table` is in the
// registry before the first render (AGENTS.md §测试纪律 — never behind a lazy
// boundary inside a bounded window). The relative path is required: this file
// lives INSIDE `@object-ui/components`, and a bare specifier would be a package
// self-import (`scripts/check-package-self-import.mjs`).
import '../renderers';
import {

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are the `data` ROOT of the expression scope — the renderer binds
 * `SchemaRendererContext.dataSource` as `data` for every predicate, which is
 * the second meaning this one key carries.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */
  DATA_TABLE_BIND_DIAGNOSTIC_PREFIX,
  DATA_TABLE_DATA_DIAGNOSTIC_PREFIX,
} from '../renderers/complex/dataTableBindDiagnostic';
import type { DataSource } from '@object-ui/types';

/** Identical in every leg, so the only variable is where `data` was written. */
const COLUMNS = [
  { header: 'Name', accessorKey: 'name' },
  { header: 'Email', accessorKey: 'email' },
];

const RECORDS = [
  { name: 'Ada Lovelace', email: 'ada@example.com' },
  { name: 'Grace Hopper', email: 'grace@example.com' },
];

/** The provider really does hold the path every expression below spells. */
const SCOPE = { customers: RECORDS };

const ROWS_ON_SCREEN = [
  'Ada Lovelace',
  'ada@example.com',
  'Grace Hopper',
  'grace@example.com',
];

/** The single cell the empty state renders — one `tbody tr`, not zero. */
const EMPTY_STATE = ['No results foundTry adjusting your filters or search query.'];

/** Every rendered body cell's text, row-major. */
function bodyCells(): string[] {
  return Array.from(document.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
}

/**
 * Console lines this render emitted on a given diagnostic channel.
 *
 * Filtered by the diagnostic's own prefix rather than by call count: these
 * renders go through the REAL `SchemaRenderer` and the real registry, and an
 * unrelated warning from some other component (react-i18next emits one here)
 * must not be able to satisfy — or break — an assertion about this one.
 */
function warningsOn(prefix: string): string[] {
  const spy = console.warn as unknown as { mock?: { calls: unknown[][] } };
  return (spy.mock?.calls ?? [])
    .map((args) => String(args[0]))
    .filter((line) => line.startsWith(prefix));
}

function tree(schema: unknown) {
  return (
    <PredicateScopeProvider scope={{ data: SCOPE }}>
      <SchemaRendererProvider dataSource={SCOPE as unknown as DataSource}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>
    </PredicateScopeProvider>
  );
}

function renderNode(schema: unknown) {
  return render(tree(schema));
}

describe('data-table node-level `data` — the four-leg table, re-measured (#6665)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [
      'node-level `data` holding a `${...}` expression',
      { type: 'data-table', data: '${data.customers}', columns: COLUMNS },
      EMPTY_STATE,
    ],
    [
      'the same expression under the `props` envelope',
      { type: 'data-table', props: { data: '${data.customers}' }, columns: COLUMNS },
      EMPTY_STATE,
    ],
    [
      'the same expression under `properties`',
      { type: 'data-table', properties: { data: '${data.customers}' }, columns: COLUMNS },
      ROWS_ON_SCREEN,
    ],
    [
      'node-level `data` holding the literal array',
      { type: 'data-table', data: RECORDS, columns: COLUMNS },
      ROWS_ON_SCREEN,
    ],
  ] as const)('%s', (_label, node, expected) => {
    renderNode(node);
    expect(bodyCells()).toEqual(expected);
  });

  it('the header is correct in the failing leg — which is why it reads as success', () => {
    // The failure shape the card is about: nothing on screen says anything went
    // wrong. Measured, rather than asserted from the card's description.
    renderNode({ type: 'data-table', data: '${data.customers}', columns: COLUMNS });
    const headers = Array.from(document.querySelectorAll('thead th')).map((th) =>
      (th.textContent ?? '').trim(),
    );
    expect(headers).toContain('Name');
    expect(headers).toContain('Email');
    expect(screen.getByText('No results found')).toBeInTheDocument();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  });
});

describe('data-table node-level `data` — the diagnostic (#6665)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the expression string that was swallowed', () => {
    renderNode({
      type: 'data-table',
      id: 'customers-table',
      caption: 'Customers',
      data: '${data.customers}',
      columns: COLUMNS,
    });

    // Behaviour stays pinned above; THIS is the load-bearing half of the card —
    // every other assertion in this file passes identically against the tree
    // before the diagnostic existed.
    const warnings = warningsOn(DATA_TABLE_DATA_DIAGNOSTIC_PREFIX);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("id: 'customers-table'");
    expect(warnings[0]).toContain("`data: '${data.customers}'` was never evaluated");
    expect(warnings[0]).toContain('at node level is read as a literal string');
    expect(warnings[0]).toContain('renders its header over an empty body');
    expect(warnings[0]).toContain('Resolve the rows in the host');

    // The #6575 channel stays silent: this node carries no `bind`, and the
    // ruling is explicit that its silence here is correct, not a gap.
    expect(warningsOn(DATA_TABLE_BIND_DIAGNOSTIC_PREFIX)).toEqual([]);
  });

  it.each([
    ['a number', 42, 'the number `42`'],
    ['null', null, '`null`'],
    ['an object', { rows: RECORDS }, 'an object'],
    ['a plain string', 'customers', "the string 'customers'"],
  ] as const)('covers the general non-array case: %s', (_label, value, expected) => {
    // The ruling's second constraint. `data-table.tsx`'s
    // `Array.isArray(rawData) ? rawData : EMPTY_ROWS` swallows every one of
    // these exactly as silently as the `${...}` string, so a diagnostic keyed
    // on the expression shape alone would leave each to arrive as a fresh card.
    renderNode({ type: 'data-table', data: value, columns: COLUMNS });

    expect(bodyCells()).toEqual(EMPTY_STATE);
    const warnings = warningsOn(DATA_TABLE_DATA_DIAGNOSTIC_PREFIX);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(expected);
    expect(warnings[0]).toContain('takes its rows only from an array');
    // Only the `${...}` value earns the sharper sentence.
    expect(warnings[0]).not.toContain('was never evaluated');
  });

  it('says it ONCE across re-renders that rebuild the node', () => {
    // The rate limit is the effect key, and the key is the MESSAGE rather than
    // the raw value on purpose: an authored object is a fresh reference on
    // every render that rebuilds the node, so a `rawData`-keyed effect would
    // reprint the same line indefinitely. Two renders of an equal-but-new
    // object is the cheapest reading that tells those two keys apart.
    const { rerender } = render(
      tree({ type: 'data-table', data: { rows: RECORDS }, columns: COLUMNS }),
    );
    rerender(tree({ type: 'data-table', data: { rows: RECORDS }, columns: COLUMNS }));

    expect(warningsOn(DATA_TABLE_DATA_DIAGNOSTIC_PREFIX)).toHaveLength(1);
  });

  it('stays silent on every leg that puts rows on screen', () => {
    // The zeros that keep this diagnostic worth reading. Each is a reading
    // rather than a dead code path because the tests above find a line through
    // the same helper, on the same channel, one `data` value apart.
    for (const node of [
      { type: 'data-table', data: RECORDS, columns: COLUMNS },
      { type: 'data-table', properties: { data: '${data.customers}' }, columns: COLUMNS },
    ]) {
      const { unmount } = renderNode(node);
      expect(bodyCells()).toEqual(ROWS_ON_SCREEN);
      expect(warningsOn(DATA_TABLE_DATA_DIAGNOSTIC_PREFIX)).toEqual([]);
      unmount();
    }
  });

  it('stays silent on a table that authored no `data` at all', () => {
    // An absent key is not an authoring mistake — a `data-table` awaiting rows
    // is ordinary. Warning here would fire on tables that are merely empty,
    // which is how a diagnostic teaches authors to ignore it.
    renderNode({ type: 'data-table', columns: COLUMNS });
    expect(bodyCells()).toEqual(EMPTY_STATE);
    expect(warningsOn(DATA_TABLE_DATA_DIAGNOSTIC_PREFIX)).toEqual([]);
  });

  it('is not fooled by an empty array — that is a real, authored answer', () => {
    renderNode({ type: 'data-table', data: [], columns: COLUMNS });
    expect(bodyCells()).toEqual(EMPTY_STATE);
    expect(warningsOn(DATA_TABLE_DATA_DIAGNOSTIC_PREFIX)).toEqual([]);
  });

  it('does NOT reach into the `props` envelope — a separate, wider defect', () => {
    // An honest boundary, recorded rather than quietly left out. `properties.*`
    // is HOISTED onto the node by `SchemaRenderer` (which is why leg 3 above
    // renders rows); `props` is not — it is spread as React props, and
    // `DataTableRenderer` reads only `schema`. So node-level `data` is
    // genuinely ABSENT here and this diagnostic is correctly silent. Diagnosing
    // the dropped envelope is a `SchemaRenderer`-level question affecting every
    // renderer that reads `schema`, not a data-table one; widening this
    // predicate to `props.data` would patch one component against a repo-wide
    // problem.
    renderNode({ type: 'data-table', props: { data: '${data.customers}' }, columns: COLUMNS });
    expect(bodyCells()).toEqual(EMPTY_STATE);
    expect(warningsOn(DATA_TABLE_DATA_DIAGNOSTIC_PREFIX)).toEqual([]);
  });
});
