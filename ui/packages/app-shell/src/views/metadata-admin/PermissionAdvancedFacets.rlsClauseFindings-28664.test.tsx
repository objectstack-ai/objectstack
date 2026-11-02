// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28664 — the RLS editor offered and linted CHECK whatever the
 * policy's operation: a CHECK on a `select` policy read "Valid CEL", then the
 * door refused it 422 at `rowLevelSecurity.N.check`; an empty USING read the
 * same, refused at the policy itself.
 *
 * Pinned here against the spec's own schema, never a restated rule:
 * - a non-blank CHECK on a `select` / `delete` policy shows the spec's message
 *   under CHECK, word for word, and no "Valid CEL";
 * - a blank CHECK on those operations is not offered; on an operation that
 *   admits one it is (the control);
 * - a policy with no predicate shows the spec's message under USING;
 * - `rlsClauseFindingCount` counts what the host holds its save on.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RowLevelSecurityPolicySchema } from '@objectstack/spec/security';
import { PermissionAdvancedFacets, rlsClauseFindingCount } from './PermissionAdvancedFacets';

afterEach(cleanup);

const t = (k: string) => k;

type Policy = { name: string; object: string; operation: string; using?: string; check?: string; enabled?: boolean };

function renderPolicy(policy: Policy) {
  const props = {
    draft: { rowLevelSecurity: [policy] },
    setDraft: () => {},
    writable: true,
    allSetNames: [] as string[],
    loadObjectFields: async () => ['status', 'owner_id'],
    t,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<PermissionAdvancedFacets {...(props as any)} />);
  // The RLS facet is collapsed by default — expand it to mount the editors.
  fireEvent.click(screen.getByText('perm.rls.title'));
}

/** The spec's own message for a policy, at a path, as the schema answers it. */
function specMessages(policy: Policy, at: (path: PropertyKey[]) => boolean): string[] {
  const judged = RowLevelSecurityPolicySchema.safeParse(policy);
  if (judged.success) return [];
  return judged.error.issues.filter((i) => at(i.path)).map((i) => i.message);
}

const checkEditor = () => screen.queryByPlaceholderText('perm.rls.checkPlaceholder');

describe('a CHECK on an operation that admits none reads the spec’s refusal (objectstack#28664)', () => {
  for (const operation of ['select', 'delete'] as const) {
    it(`a non-blank CHECK on a \`${operation}\` policy shows the spec's message under CHECK, and no "Valid CEL"`, async () => {
      const policy = { name: 'open_rows', object: 'task', operation, using: "status == 'open'", check: "status == 'open'" };
      renderPolicy(policy);

      const finding = await screen.findByTestId('rls-check-finding-0');
      const expected = specMessages(policy, (p) => p[0] === 'check');
      expect(expected).toHaveLength(1);
      expect(finding.textContent).toBe(expected[0]);
      expect(finding.textContent!.startsWith(`\`check\` is never evaluated on a \`${operation}\` policy:`)).toBe(true);
      // The CHECK editor is kept: nothing the author wrote is pruned.
      expect(checkEditor()).toHaveValue("status == 'open'");
      // USING lints clean and says so; CHECK withholds its "Valid CEL".
      await waitFor(() => expect(screen.getAllByText('perm.cel.valid')).toHaveLength(1), { timeout: 3000 });
      expect(screen.queryByTestId('rls-using-finding-0')).toBeNull();
    });

    it(`a blank CHECK on a \`${operation}\` policy is not offered`, () => {
      renderPolicy({ name: 'open_rows', object: 'task', operation, using: "status == 'open'", check: '' });
      expect(checkEditor()).toBeNull();
      expect(screen.getByTestId('rls-check-not-applicable-0')).toHaveTextContent('perm.rls.checkNotApplicable');
    });
  }

  for (const operation of ['all', 'insert', 'update'] as const) {
    it(`CONTROL — a \`${operation}\` policy offers CHECK, and a CHECK there draws no finding`, async () => {
      renderPolicy({ name: 'open_rows', object: 'task', operation, using: "status == 'open'", check: "status == 'open'" });
      expect(checkEditor()).toHaveValue("status == 'open'");
      expect(screen.queryByTestId('rls-check-not-applicable-0')).toBeNull();
      await waitFor(() => expect(screen.getAllByText('perm.cel.valid')).toHaveLength(2), { timeout: 3000 });
      expect(screen.queryByTestId('rls-check-finding-0')).toBeNull();
    });
  }
});

describe('a policy with no predicate reads the spec’s refusal under USING (objectstack#28664)', () => {
  for (const operation of ['select', 'delete', 'all'] as const) {
    it(`an empty USING with no CHECK on a \`${operation}\` policy shows the spec's message under USING`, () => {
      const policy = { name: 'open_rows', object: 'task', operation, using: '', check: '' };
      renderPolicy(policy);
      const expected = specMessages(policy, (p) => p.length === 0);
      expect(expected).toHaveLength(1);
      expect(screen.getByTestId('rls-using-finding-0').textContent).toBe(expected[0]);
      expect(screen.queryByTestId('rls-check-finding-0')).toBeNull();
    });
  }

  it('CONTROL — a non-blank USING draws no finding', () => {
    renderPolicy({ name: 'open_rows', object: 'task', operation: 'select', using: "status == 'open'", check: '' });
    expect(screen.queryByTestId('rls-using-finding-0')).toBeNull();
  });

  it('CONTROL — an `update` policy with only a CHECK draws no finding under USING', () => {
    renderPolicy({ name: 'open_rows', object: 'task', operation: 'update', using: '', check: "status == 'open'" });
    expect(screen.queryByTestId('rls-using-finding-0')).toBeNull();
  });
});

describe('rlsClauseFindingCount — what the host holds its save on (objectstack#28664)', () => {
  it('counts each refused clause across the rows, and none on clean rows', () => {
    expect(
      rlsClauseFindingCount([
        { name: 'a', object: 'task', operation: 'select', using: "status == 'open'", check: "status == 'open'" },
        { name: 'b', object: 'task', operation: 'delete', using: '', check: '' },
        { name: 'c', object: 'task', operation: 'update', using: '', check: "status == 'open'" },
        { name: 'd', object: 'task', operation: 'select', using: "status == 'open'" },
      ]),
    ).toBe(2);
    expect(rlsClauseFindingCount(undefined)).toBe(0);
    expect(rlsClauseFindingCount([])).toBe(0);
  });

  it('judges the clauses even while the row has no name yet', () => {
    expect(rlsClauseFindingCount([{ name: '', object: '*', operation: 'select', using: 'true', check: 'true' }])).toBe(1);
  });
});
