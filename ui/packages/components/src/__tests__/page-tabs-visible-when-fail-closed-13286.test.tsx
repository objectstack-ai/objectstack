/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13286 — a `page:tabs` item `visibleWhen` that FAULTS on evaluation
 * fails CLOSED: the tab (header and panel) is not drawn, and the fault is
 * reported once.
 *
 * Measured on a stored page: a 391-node item predicate over the CEL engine's
 * AST bound faulted on every evaluation with `[bounds] Exceeded maxAstNodes`,
 * and the evaluator's fail-soft `true` drew the tab for a viewer the predicate
 * was written to exclude.
 *
 * Rows:
 *  (a) a throwing item predicate hides its tab; ONE warning across two renders;
 *  (b) CONTROLS — a valid `false` hides, a valid `true` shows, an absent
 *      predicate shows, a blank one (declares nothing) shows;
 *  (c) an over-budget CEL source hides its tab, while the same shape under
 *      the bound evaluates and shows;
 *  (d) CONTROL — a form FIELD `visibleWhen` that faults is still drawn: the
 *      form's documented fail-open is not this surface's to move;
 *  (e) a fault that hides the ACTIVE tab falls back to the first visible tab.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import type { PublicBlockNodeOf } from '@object-ui/types';
import { ComponentRegistry } from '@object-ui/core';
import {
  SchemaRenderer,
  PageVariablesProvider,
  usePageVariables,
  UNRESOLVABLE_VISIBILITY_PREFIX,
  __resetVisibilityPredicateWarnings,
} from '@object-ui/react';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../renderers';

const tabsSchema = (items: any[]): PublicBlockNodeOf<'page:tabs'> => ({ type: 'page:tabs', id: 'tabs', properties: { items } });

/** The spec's normalized wire shape (ADR-0089 D2). */
const cel = (source: string) => ({ dialect: 'cel', source });

/** `n` OR-ed literal comparisons — about four AST nodes per term. */
const orChain = (n: number) => Array.from({ length: n }, (_, i) => `${i} == ${i}`).join(' || ');

type WarnSpy = { mock: { calls: unknown[][] } };
const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
const reports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));

function Writer({ name, value }: { name: string; value: string }) {
  const { setVariable } = usePageVariables();
  return (
    <button type="button" onClick={() => setVariable(name, value)}>
      write
    </button>
  );
}

beforeEach(() => {
  __resetVisibilityPredicateWarnings();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#13286 (a) — a faulting item predicate hides its tab, reported once', () => {
  it('a throwing `visibleWhen` is not rendered, and two renders log ONE warning', () => {
    const warn = spyWarn();
    const fault = 'nosuchroot13286.x > 1';
    const items = () => [
      { label: 'Details', value: 'details', children: [] },
      { label: 'Related', value: 'related', children: [] },
      { label: 'Contracts', value: 'contracts', visibleWhen: fault, children: [] },
    ];
    const { queryByText, getByText, rerender } = render(<SchemaRenderer schema={tabsSchema(items())} />);
    expect(getByText('Details')).toBeTruthy();
    expect(getByText('Related')).toBeTruthy();
    expect(queryByText('Contracts')).toBeNull();

    // A second render with a FRESH schema object — the dedupe is per authored
    // source, not per schema identity.
    rerender(<SchemaRenderer schema={tabsSchema(items())} />);
    expect(queryByText('Contracts')).toBeNull();

    const lines = reports(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('page:tabs');
    expect(lines[0]).toContain(fault);
    expect(lines[0]).toContain('WITHHELD');
  });

  it('a faulting CEL envelope hides its tab too', () => {
    spyWarn();
    const { queryByText, getByText } = render(
      <SchemaRenderer
        schema={tabsSchema([
          { label: 'Details', value: 'details', children: [] },
          { label: 'Related', value: 'related', children: [] },
          { label: 'Contracts', value: 'contracts', visibleWhen: cel('record.kind =='), children: [] },
        ])}
      />,
    );
    expect(getByText('Details')).toBeTruthy();
    expect(queryByText('Contracts')).toBeNull();
  });
});

describe('objectui#13286 (b) — CONTROLS: a predicate that evaluates decides as before', () => {
  it('false hides, true shows, absent shows, blank (declares nothing) shows — and none of them faults', () => {
    const warn = spyWarn();
    const { queryByText, getByText } = render(
      <SchemaRenderer
        schema={tabsSchema([
          { label: 'Absent', value: 'absent', children: [] },
          { label: 'True', value: 'yes', visibleWhen: cel('1 == 1'), children: [] },
          { label: 'False', value: 'no', visibleWhen: cel('1 == 2'), children: [] },
          { label: 'Blank', value: 'blank', visibleWhen: '', children: [] },
        ])}
      />,
    );
    expect(getByText('Absent')).toBeTruthy();
    expect(getByText('True')).toBeTruthy();
    expect(queryByText('False')).toBeNull();
    expect(getByText('Blank')).toBeTruthy();
    // The blank gate is diagnosed (ADR-0137 D4) but not withheld.
    expect(reports(warn).some((l) => l.includes('WITHHELD'))).toBe(false);
  });
});

describe('objectui#13286 (c) — an over-budget source hides its tab', () => {
  it('an item predicate beyond the AST bound is withheld; the same shape under the bound shows', () => {
    const warn = spyWarn();
    const { queryByText, getByText } = render(
      <SchemaRenderer
        schema={tabsSchema([
          { label: 'Details', value: 'details', children: [] },
          { label: 'Small', value: 'small', visibleWhen: cel(orChain(4)), children: [] },
          { label: 'Huge', value: 'huge', visibleWhen: cel(orChain(120)), children: [] },
        ])}
      />,
    );
    expect(getByText('Small')).toBeTruthy();
    expect(queryByText('Huge')).toBeNull();
    const lines = reports(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[bounds]');
  });
});

describe('objectui#13286 (d) — CONTROL: a form field rule keeps its fail-open', () => {
  it('a field whose `visibleWhen` faults is still drawn', () => {
    spyWarn();
    const Form = ComponentRegistry.get('form')!;
    render(
      <Form
        schema={{
          type: 'form',
          showSubmit: false,
          showCancel: false,
          fields: [
            { name: 'subject', label: 'Subject', type: 'input' },
            { name: 'notes', label: 'Notes', type: 'input', visibleWhen: cel('record.kind ==') },
          ],
        }}
      />,
    );
    expect(screen.getByLabelText(/^subject/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^notes/i)).toBeInTheDocument();
  });
});

describe('objectui#13286 (e) — a fault that hides the ACTIVE tab falls back to the first visible tab', () => {
  it('the active tab whose predicate starts faulting vanishes, and the first visible panel shows', () => {
    spyWarn();
    const { getByText, queryByText } = render(
      <PageVariablesProvider definitions={[{ name: 'stage', type: 'string', source: 'w' }]}>
        <Writer name="stage" value="closed" />
        <SchemaRenderer
          schema={tabsSchema([
            { label: 'Details', value: 'details', children: [{ type: 'element:text', properties: { content: 'DETAILS BODY' } }] },
            {
              label: 'Contracts',
              value: 'contracts',
              // Short-circuits to `true` until the variable flips; then the
              // right-hand side reads an unbound root and faults.
              visibleWhen: "page.stage != 'closed' || nosuchroot13286e.x > 1",
              children: [{ type: 'element:text', properties: { content: 'CONTRACTS BODY' } }],
            },
            { label: 'Related', value: 'related', children: [] },
          ])}
        />
      </PageVariablesProvider>,
    );
    act(() => {
      fireEvent.mouseDown(getByText('Contracts'), { button: 0 });
    });
    expect(getByText('CONTRACTS BODY')).toBeTruthy();

    act(() => {
      fireEvent.click(getByText('write'));
    });
    expect(queryByText('Contracts')).toBeNull();
    expect(queryByText('CONTRACTS BODY')).toBeNull();
    expect(getByText('DETAILS BODY')).toBeTruthy();
  });
});
