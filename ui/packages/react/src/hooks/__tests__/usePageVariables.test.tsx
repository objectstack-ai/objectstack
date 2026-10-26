/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * PageVariablesProvider — nested context MERGING (objectui#2578, item 5).
 *
 * A nested provider (e.g. a filtered dashboard embedded in a Page with its
 * own `variables`) must not shadow the outer scope wholesale: inside the
 * nested subtree the outer variables stay readable, an inner definition with
 * the same name deliberately shadows the outer one, and writes route to the
 * scope that DEFINES the variable.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PageVariablesProvider, usePageVariables } from '../usePageVariables';
import type { PageVariable } from '@object-ui/types';

afterEach(cleanup);

/** Renders a variable's value and a button that writes to it. */
function Probe({ id, name, writeValue }: { id: string; name: string; writeValue?: any }) {
  const { variables, setVariable } = usePageVariables();
  return (
    <div>
      <span data-testid={`${id}-value`}>{JSON.stringify(variables[name] ?? null)}</span>
      <button data-testid={`${id}-write`} onClick={() => setVariable(name, writeValue)} />
    </div>
  );
}

function ResetProbe({ id }: { id: string }) {
  const { resetVariables } = usePageVariables();
  return <button data-testid={`${id}-reset`} onClick={resetVariables} />;
}

const defs = (...vars: Array<[string, any]>): PageVariable[] =>
  vars.map(([name, defaultValue]) => ({ name, type: 'string', defaultValue }) as PageVariable);

describe('PageVariablesProvider — single scope', () => {
  it('initializes from definitions and writes locally', () => {
    render(
      <PageVariablesProvider definitions={defs(['region', 'emea'])}>
        <Probe id="p" name="region" writeValue="apac" />
      </PageVariablesProvider>,
    );
    expect(screen.getByTestId('p-value').textContent).toBe('"emea"');
    fireEvent.click(screen.getByTestId('p-write'));
    expect(screen.getByTestId('p-value').textContent).toBe('"apac"');
  });
});

describe('PageVariablesProvider — nested scopes merge (objectui#2578)', () => {
  it('outer variables stay readable inside a nested provider', () => {
    render(
      <PageVariablesProvider definitions={defs(['outer_var', 'from-outer'])}>
        <PageVariablesProvider definitions={defs(['inner_var', 'from-inner'])}>
          <Probe id="outer-read" name="outer_var" />
          <Probe id="inner-read" name="inner_var" />
        </PageVariablesProvider>
      </PageVariablesProvider>,
    );
    expect(screen.getByTestId('outer-read-value').textContent).toBe('"from-outer"');
    expect(screen.getByTestId('inner-read-value').textContent).toBe('"from-inner"');
  });

  it('an inner definition with the same name shadows the outer one', () => {
    render(
      <PageVariablesProvider definitions={defs(['region', 'outer-region'])}>
        <Probe id="outer" name="region" />
        <PageVariablesProvider definitions={defs(['region', 'inner-region'])}>
          <Probe id="inner" name="region" />
        </PageVariablesProvider>
      </PageVariablesProvider>,
    );
    expect(screen.getByTestId('outer-value').textContent).toBe('"outer-region"');
    expect(screen.getByTestId('inner-value').textContent).toBe('"inner-region"');
  });

  it('writing an outer-defined name from inside the nested subtree updates the OUTER scope', () => {
    render(
      <PageVariablesProvider definitions={defs(['outer_var', 'initial'])}>
        <Probe id="outer" name="outer_var" />
        <PageVariablesProvider definitions={defs(['inner_var', ''])}>
          <Probe id="inner" name="outer_var" writeValue="written-from-inner" />
        </PageVariablesProvider>
      </PageVariablesProvider>,
    );
    fireEvent.click(screen.getByTestId('inner-write'));
    // Both subtrees observe the update — the write routed to the defining scope.
    expect(screen.getByTestId('outer-value').textContent).toBe('"written-from-inner"');
    expect(screen.getByTestId('inner-value').textContent).toBe('"written-from-inner"');
  });

  it('a name defined nowhere is created locally and never leaks to the outer scope', () => {
    render(
      <PageVariablesProvider definitions={defs(['outer_var', ''])}>
        <Probe id="outer" name="adhoc" />
        <PageVariablesProvider definitions={defs(['inner_var', ''])}>
          <Probe id="inner" name="adhoc" writeValue="local-only" />
        </PageVariablesProvider>
      </PageVariablesProvider>,
    );
    fireEvent.click(screen.getByTestId('inner-write'));
    expect(screen.getByTestId('inner-value').textContent).toBe('"local-only"');
    expect(screen.getByTestId('outer-value').textContent).toBe('null');
  });

  it('resetVariables resets only the local scope', () => {
    render(
      <PageVariablesProvider definitions={defs(['outer_var', 'outer-default'])}>
        <Probe id="outer" name="outer_var" writeValue="outer-dirty" />
        <PageVariablesProvider definitions={defs(['inner_var', 'inner-default'])}>
          <Probe id="inner" name="inner_var" writeValue="inner-dirty" />
          <ResetProbe id="inner" />
        </PageVariablesProvider>
      </PageVariablesProvider>,
    );
    fireEvent.click(screen.getByTestId('outer-write'));
    fireEvent.click(screen.getByTestId('inner-write'));
    fireEvent.click(screen.getByTestId('inner-reset'));
    // Inner back to default; outer keeps its dirty value.
    expect(screen.getByTestId('inner-value').textContent).toBe('"inner-default"');
    expect(screen.getByTestId('outer-value').textContent).toBe('"outer-dirty"');
  });
});
