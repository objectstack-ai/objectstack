// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CelPredicateField } from './CelPredicateField';
import {
  tokenAt,
  memberTokenAt,
  buildCandidates,
  filterCandidates,
  __setCelFormulaLoader,
} from './celAuthoring';
import { validateRlsPredicateEnforceability } from '@objectstack/lint';

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

const t = (k: string) => k;

/** Controlled harness — the field is controlled, so hold its value in state. */
function Harness({ initial = '', ...rest }: { initial?: string } & Record<string, unknown>) {
  const [v, setV] = React.useState(initial);
  return (
    <CelPredicateField
      value={v}
      onChange={setV}
      label="USING"
      objectName="account"
      fieldNames={['organization_id', 'owner_id']}
      clause="using"
      t={t}
      {...rest}
    />
  );
}

describe('tokenAt', () => {
  it('returns the identifier run ending at the caret', () => {
    expect(tokenAt('org', 3)).toEqual({ start: 0, end: 3, text: 'org' });
    expect(tokenAt('a && org', 8)).toEqual({ start: 5, end: 8, text: 'org' });
  });
  it('suppresses member-access segments (after a dot)', () => {
    expect(tokenAt('current_user.org', 16)).toBeNull();
  });
  it('returns null when the caret is not at an identifier', () => {
    expect(tokenAt('a == ', 5)).toBeNull();
    expect(tokenAt('', 0)).toBeNull();
  });
  it('ignores a leading digit (not an identifier)', () => {
    expect(tokenAt('123', 3)).toBeNull();
  });
});

describe('memberTokenAt', () => {
  it('returns the member segment and its root', () => {
    expect(memberTokenAt('record.sta', 10)).toEqual({ root: 'record', start: 7, end: 10, text: 'sta' });
  });
  it('returns an EMPTY segment right after the dot', () => {
    expect(memberTokenAt('record.', 7)).toEqual({ root: 'record', start: 7, end: 7, text: '' });
  });
  it('returns null for a bare identifier (no dot)', () => {
    expect(memberTokenAt('record', 6)).toBeNull();
  });
  it('returns null for a deeper chain (unknown member shape)', () => {
    expect(memberTokenAt('record.owner.na', 15)).toBeNull();
    expect(memberTokenAt('record.owner.', 13)).toBeNull();
  });
  it('returns null when the segment is digit-led or the root is missing', () => {
    expect(memberTokenAt('record.1a', 9)).toBeNull();
    expect(memberTokenAt('.foo', 4)).toBeNull();
  });
});

describe('buildCandidates / filterCandidates', () => {
  const scope = {
    fields: ['organization_id', 'owner_id'],
    roots: ['current_user', 'record'],
    functions: ['has', 'contains'],
  };
  it('merges fields, roots and functions (deduped, fields first)', () => {
    const c = buildCandidates(scope);
    expect(c[0]).toEqual({ label: 'organization_id', kind: 'field' });
    expect(c.find((x) => x.label === 'current_user')?.kind).toBe('root');
    expect(c.find((x) => x.label === 'has')?.kind).toBe('function');
  });
  it('prefix-filters case-insensitively and excludes exact matches', () => {
    const c = buildCandidates(scope);
    expect(filterCandidates(c, 'org').map((x) => x.label)).toEqual(['organization_id']);
    expect(filterCandidates(c, 'ORG').map((x) => x.label)).toEqual(['organization_id']);
    expect(filterCandidates(c, 'organization_id')).toEqual([]); // exact excluded
    expect(filterCandidates(c, '')).toEqual([]);
  });
  it('returns the full (capped) catalog for an empty query when allowEmpty', () => {
    const c = buildCandidates(scope);
    expect(filterCandidates(c, '', true).length).toBe(c.length);
  });
});

describe('CelPredicateField · inline lint (real engine)', () => {
  it('flags malformed CEL and marks the field invalid', async () => {
    render(<Harness initial="organization_id ==" />);
    const ta = screen.getByRole('combobox');
    await waitFor(() => expect(ta.getAttribute('aria-invalid')).toBe('true'), { timeout: 3000 });
  });

  it('shows the valid affordance for a clean predicate', async () => {
    render(<Harness initial="organization_id == current_user.organization_id" />);
    expect(await screen.findByText('perm.cel.valid', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('warns (non-blocking) on an unknown-field near miss', async () => {
    render(<Harness initial="organizaton_id == 1" />);
    const ta = screen.getByRole('combobox');
    expect(await screen.findByText(/did you mean/i, {}, { timeout: 3000 })).toBeTruthy();
    // A warning must NOT mark the field invalid (never block on a maybe-typo).
    expect(ta.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('blocks on a USING clause the runtime cannot lower, in @objectstack/lint\'s words (objectui#13061)', async () => {
    const source = 'upper(status) == "OPEN"';
    const [rule] = validateRlsPredicateEnforceability({ permissions: [{ rowLevelSecurity: [{ using: source }] }] });
    render(<Harness initial={source} />);
    const ta = screen.getByRole('combobox');
    // The producer's message as written — no catalogue key, so the harness's
    // echoing `t` is never consulted for it.
    expect(await screen.findByText(rule.message, {}, { timeout: 3000 })).toBeTruthy();
    expect(ta.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('CelPredicateField · result-type affordance (role="value", real engine)', () => {
  it('shows the inferred type for a proven-Number formula', async () => {
    render(
      <Harness
        initial="record.amount * 0.2"
        role="value"
        scope="record"
        roots={['record']}
        fieldNames={['amount']}
        clause={undefined}
      />,
    );
    expect(await screen.findByText('perm.cel.type.number', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('reports Unknown with the pinning hint when the type cannot be proven', async () => {
    render(
      <Harness
        initial="record.amount + record.owner_id"
        role="value"
        scope="record"
        roots={['record']}
        fieldNames={['amount', 'owner_id']}
        clause={undefined}
      />,
    );
    expect(await screen.findByText('perm.cel.type.unknown', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/perm\.cel\.type\.unknownHint/)).toBeTruthy();
  });

  it('does NOT show the affordance for predicate roles', async () => {
    render(<Harness initial="organization_id == 1" />);
    // Wait for the lint pass to complete (the valid affordance appears)…
    expect(await screen.findByText('perm.cel.valid', {}, { timeout: 3000 })).toBeTruthy();
    // …and confirm no result-type line accompanied it.
    expect(screen.queryByText(/perm\.cel\.type/)).toBeNull();
  });

  it('withholds the affordance while the expression has lint errors', async () => {
    render(
      <Harness
        initial="amount * 0.2"
        role="value"
        scope="record"
        roots={['record']}
        fieldNames={['amount']}
        clause={undefined}
      />,
    );
    const ta = screen.getByRole('combobox');
    await waitFor(() => expect(ta.getAttribute('aria-invalid')).toBe('true'), { timeout: 3000 });
    expect(screen.queryByText(/perm\.cel\.type\./)).toBeNull();
  });
});

describe('CelPredicateField · autocomplete', () => {
  it('offers field/scope suggestions and inserts on Enter', async () => {
    __setCelFormulaLoader(() =>
      Promise.resolve({
        validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
        introspectScope: () => ({
          fields: ['organization_id', 'owner_id'],
          roots: ['current_user'],
          functions: ['has'],
        }),
      }),
    );
    const user = userEvent.setup();
    render(<Harness initial="" />);
    const ta = screen.getByRole('combobox') as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, 'org');
    const option = await screen.findByRole('option', { name: /organization_id/i }, { timeout: 3000 });
    expect(option).toBeTruthy();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(ta.value).toBe('organization_id'));
  });

  it('does not suggest after a member-access dot on an unknown-shape root', async () => {
    __setCelFormulaLoader(() =>
      Promise.resolve({
        validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
        introspectScope: () => ({ fields: ['organization_id'], roots: ['current_user'], functions: [] }),
      }),
    );
    const user = userEvent.setup();
    render(<Harness initial="" />);
    const ta = screen.getByRole('combobox') as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, 'current_user.org');
    // Give the catalog a beat to load; the menu must stay closed for member access.
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('completes field names after record. — including right at the dot', async () => {
    __setCelFormulaLoader(() =>
      Promise.resolve({
        validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
        introspectScope: () => ({
          fields: ['organization_id', 'owner_id'],
          roots: ['record', 'previous', 'parent'],
          functions: ['has'],
        }),
      }),
    );
    const user = userEvent.setup();
    render(<Harness initial="" scope="record" roots={['record', 'previous', 'parent']} />);
    const ta = screen.getByRole('combobox') as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, 'record.');
    // The full field catalog surfaces the moment the dot is typed…
    const options = await screen.findAllByRole('option', {}, { timeout: 3000 });
    expect(options.map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('organization_id'), expect.stringContaining('owner_id')]),
    );
    // …and narrowing + accepting inserts the member, not a bare field.
    await user.type(ta, 'own');
    await screen.findByRole('option', { name: /owner_id/i }, { timeout: 3000 });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(ta.value).toBe('record.owner_id'));
  });

  it('withholds BARE field suggestions in record scope (fields live under record.*)', async () => {
    __setCelFormulaLoader(() =>
      Promise.resolve({
        validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
        introspectScope: () => ({
          fields: ['organization_id'],
          roots: ['record', 'previous', 'parent'],
          functions: ['has'],
        }),
      }),
    );
    const user = userEvent.setup();
    render(<Harness initial="" scope="record" roots={['record', 'previous', 'parent']} />);
    const ta = screen.getByRole('combobox') as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, 'org');
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByRole('option')).toBeNull();
    // Roots still complete bare — `rec` offers `record`.
    await user.clear(ta);
    await user.type(ta, 'rec');
    expect(await screen.findByRole('option', { name: /record/i }, { timeout: 3000 })).toBeTruthy();
  });
});
