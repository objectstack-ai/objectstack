// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7357 — the snake_case twin `depends_on` is RETIRED, and the
 * retirement is observable, not merely declared.
 *
 * `BaseFieldMetadata.depends_on` was objectui's own consumer-side twin of
 * `@objectstack/spec`'s field-level `dependsOn`. It was never a spec key —
 * `FieldSchema` refuses it BY NAME, pinned in
 * `@object-ui/types`' `field-metadata-depends-on-declared-6153.test.ts` — so a
 * producer that authored it produced a document the publish door rejects.
 * ADR-0049 enforce-or-remove, maintainer ruling A on objectui#6153
 * (2026-09-02), no grace window (2026-08-27 ruling): one spelling, one concept.
 *
 * ## Why this file exists, when the type member is already gone
 *
 * Deleting the member is a COMPILE-time fact and is pinned type-level. The
 * runtime read arm is a separate fact: `LookupField` reached its cascade key
 * through `cascadeMeta?.depends_on ?? cascadeMeta?.dependsOn`, and every host
 * that hands the widget an untyped bag (`as any`, `Record<string, any>`, a
 * JSON metadata document off the wire) bypasses the type entirely. For those
 * hosts the type deletion changes NOTHING; only dropping the arm does. This
 * file measures the arm.
 *
 * ## The shape of each assertion: a live control on every zero
 *
 * Every "snake does nothing" assertion is paired with the SAME document spelled
 * `dependsOn`, asserted to still do the thing. Without that pair a zero here
 * would be satisfied by a broken harness — a widget that gates nothing, a data
 * source that is never called — rather than by the retirement.
 */

import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LookupField } from './LookupField';
import { SelectField } from './SelectField';

const contacts = [
  { id: 'c1', name: 'Nora Field', account: 'a1' },
  { id: 'c2', name: 'Oscar Grant', account: 'a2' },
];

function makeDataSource() {
  const find = vi.fn(async (_obj: string, params: { $filter?: Record<string, unknown> } | undefined) => {
    const account = params?.$filter?.account;
    const data = account ? contacts.filter((c) => c.account === account) : contacts;
    return { data, total: data.length };
  });
  return { find } as unknown as { find: ReturnType<typeof vi.fn> };
}

/** The reported document, minus its cascade key — each test adds one spelling. */
const baseLookup = {
  name: 'contact',
  label: 'Contact',
  reference: 'contacts',
  reference_field: 'name',
};

function renderLookup(field: Record<string, unknown>, dependentValues: Record<string, unknown>) {
  const ds = makeDataSource();
  render(
    <LookupField
      field={field as any}
      value={undefined}
      onChange={vi.fn()}
      readonly={false}
      dataSource={ds as any}
      {...({ dependentValues } as any)}
    />,
  );
  return ds;
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
  try {
    localStorage.clear();
  } catch {
    /* jsdom */
  }
});

afterEach(cleanup);

describe('objectui#7357 — a lookup carrying ONLY `depends_on` no longer cascades', () => {
  it('CONTROL: the same document spelled `dependsOn` still GATES while the parent is empty', () => {
    renderLookup({ ...baseLookup, dependsOn: ['account'] }, { account: null });
    const gated = screen.getByTestId('lookup-trigger-gated');
    expect(gated).toBeDisabled();
    expect(gated).toHaveTextContent(/select account first/i);
  });

  it('the snake_case document does NOT gate — the arm that read it is gone', () => {
    renderLookup({ ...baseLookup, depends_on: ['account'] }, { account: null });
    // The zero: no gated trigger at all. Its control is the assertion above,
    // which found one on the identical document spelled the spec's way.
    expect(screen.queryByTestId('lookup-trigger-gated')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /select/i })).not.toBeDisabled();
  });

  it('CONTROL: the same document spelled `dependsOn` still SCOPES the candidate query', async () => {
    const ds = renderLookup({ ...baseLookup, dependsOn: ['account'] }, { account: 'a1' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
    });
    await waitFor(() => {
      expect(ds.find).toHaveBeenCalledWith(
        'contacts',
        expect.objectContaining({ $filter: expect.objectContaining({ account: 'a1' }) }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Nora Field')).toBeInTheDocument();
      expect(screen.queryByText('Oscar Grant')).not.toBeInTheDocument();
    });
  });

  it('the snake_case document does NOT filter the lookup — every candidate is offered', async () => {
    const ds = renderLookup({ ...baseLookup, depends_on: ['account'] }, { account: 'a1' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
    });
    // Positive control for the zero below: the query really went out, so
    // "no `account` in `$filter`" is a reading of a real call and not of silence.
    await waitFor(() => {
      expect(ds.find).toHaveBeenCalled();
    });
    for (const call of ds.find.mock.calls) {
      expect(call[1]?.$filter ?? {}).not.toHaveProperty('account');
    }
    // The visible half of the same fact: the unscoped set reaches the popover.
    await waitFor(() => {
      expect(screen.getByText('Nora Field')).toBeInTheDocument();
      expect(screen.getByText('Oscar Grant')).toBeInTheDocument();
    });
  });
});

/**
 * The select half of the card's pin.
 *
 * ⚠️ Measured, and worth stating rather than implying: on the option widgets
 * this was ALREADY true before this card. `SelectField` reads
 * `field?.dependsOn ?? dependsOnProp` and has never had a snake arm
 * (objectui#6153 landed that read through the declared type). So these two
 * assertions pin a fact this change did not alter — they close the card's pin
 * honestly instead of implying a behaviour change the lookup alone carried.
 */
describe('objectui#7357 — a select carrying ONLY `depends_on` does not gate either', () => {
  const options = [
    { label: 'Zhejiang', value: 'zj' },
    { label: 'California', value: 'ca' },
  ];

  it('CONTROL: `dependsOn` gates the authored list while the parent is empty', () => {
    render(
      <SelectField
        value={undefined}
        onChange={vi.fn()}
        field={{ name: 'province', type: 'select', dependsOn: ['country'], options } as any}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    expect(screen.getByTestId('select-empty-province')).toHaveTextContent(/select country first/i);
    expect(screen.queryByTestId('select-trigger-province')).not.toBeInTheDocument();
  });

  it('`depends_on` does not gate — the authored list is offered', () => {
    render(
      <SelectField
        value={undefined}
        onChange={vi.fn()}
        field={{ name: 'province', type: 'select', depends_on: ['country'], options } as any}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    expect(screen.queryByTestId('select-empty-province')).not.toBeInTheDocument();
    expect(screen.getByTestId('select-trigger-province')).toBeInTheDocument();
  });
});
