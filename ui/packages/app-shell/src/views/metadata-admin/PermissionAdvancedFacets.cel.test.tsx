// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionAdvancedFacets } from './PermissionAdvancedFacets';

afterEach(cleanup);

const t = (k: string) => k;

function renderFacets(over: Record<string, unknown> = {}) {
  const props = {
    draft: {
      rowLevelSecurity: [
        { name: 'p1', object: 'account', operation: 'all', using: 'organization_id ==', check: '', enabled: true },
      ],
    },
    setDraft: () => {},
    writable: true,
    allSetNames: [] as string[],
    loadObjectFields: async () => ['organization_id', 'owner_id'],
    t,
    ...over,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<PermissionAdvancedFacets {...(props as any)} />);
}

describe('PermissionAdvancedFacets · CEL authoring safety (objectui#2413)', () => {
  it('reports blocking CEL errors up so the host can gate Save', async () => {
    const onCelErrorsChange = vi.fn();
    const user = userEvent.setup();
    renderFacets({ onCelErrorsChange });
    // The RLS facet is collapsed by default — expand it to mount the editors.
    await user.click(screen.getByText('perm.rls.title'));
    await waitFor(() => expect(onCelErrorsChange).toHaveBeenCalledWith(1), { timeout: 3000 });
  });

  // objectui#13061 — a clause the runtime cannot lower holds Save the way a
  // parse fault does: the publish door refuses it as an error, so the editor
  // gates on the same verdict. The card's own predicate and its control.
  const policy = (using: string, check: string) => ({
    draft: { rowLevelSecurity: [{ name: 'p1', object: 'asset', operation: 'all', using, check, enabled: true }] },
    loadObjectFields: async () => ['asset_code'],
  });
  for (const [label, using, check, expected] of [
    ['a USING clause the runtime cannot lower', 'size(record.asset_code) > 3', '', 1],
    ['a CHECK clause the runtime cannot lower', "record.asset_code == 'A1'", 'size(record.asset_code) > 3', 1],
    ['both clauses', 'size(record.asset_code) > 3', 'size(record.asset_code) > 3', 2],
  ] as const) {
    it(`reports ${label} up as blocking (objectui#13061)`, async () => {
      const onCelErrorsChange = vi.fn();
      const user = userEvent.setup();
      renderFacets({ ...policy(using, check), onCelErrorsChange });
      await user.click(screen.getByText('perm.rls.title'));
      await waitFor(() => expect(onCelErrorsChange).toHaveBeenLastCalledWith(expected), { timeout: 3000 });
    });
  }

  it("CONTROL — a lowerable clause (`record.asset_code == 'A1'`) leaves Save open (objectui#13061)", async () => {
    const onCelErrorsChange = vi.fn();
    const user = userEvent.setup();
    renderFacets({ ...policy("record.asset_code == 'A1'", "record.asset_code == 'A1'"), onCelErrorsChange });
    await user.click(screen.getByText('perm.rls.title'));
    // Both clauses linted clean — the lint has spoken, so the count below is a reading.
    await waitFor(() => expect(screen.getAllByText('perm.cel.valid')).toHaveLength(2), { timeout: 3000 });
    expect(onCelErrorsChange).toHaveBeenLastCalledWith(0);
  });

  // objectui#13082 — a clause that lowers but reads something the rule refuses
  // holds Save the same way: the card's predicate in USING, in CHECK and in
  // both, and its control.
  const ownerPolicy = (using: string, check: string) => ({
    draft: { rowLevelSecurity: [{ name: 'p1', object: 'account', operation: 'all', using, check, enabled: true }] },
    loadObjectFields: async () => ['organization_id', 'owner_id'],
  });
  for (const [label, using, check, expected] of [
    ['an unknown `current_user` variable in USING', 'current_user.nope == owner_id', '', 1],
    ['an unknown `current_user` variable in CHECK', 'owner_id == current_user.id', 'current_user.nope == owner_id', 1],
    ['an unknown `current_user` variable in both clauses', 'current_user.nope == owner_id', 'current_user.nope == owner_id', 2],
  ] as const) {
    it(`reports ${label} up as blocking (objectui#13082)`, async () => {
      const onCelErrorsChange = vi.fn();
      const user = userEvent.setup();
      renderFacets({ ...ownerPolicy(using, check), onCelErrorsChange });
      await user.click(screen.getByText('perm.rls.title'));
      await waitFor(() => expect(onCelErrorsChange).toHaveBeenLastCalledWith(expected), { timeout: 3000 });
    });
  }

  it('CONTROL — `owner_id == current_user.id` on both clauses leaves Save open (objectui#13082)', async () => {
    const onCelErrorsChange = vi.fn();
    const user = userEvent.setup();
    renderFacets({ ...ownerPolicy('owner_id == current_user.id', 'owner_id == current_user.id'), onCelErrorsChange });
    await user.click(screen.getByText('perm.rls.title'));
    await waitFor(() => expect(screen.getAllByText('perm.cel.valid')).toHaveLength(2), { timeout: 3000 });
    expect(onCelErrorsChange).toHaveBeenLastCalledWith(0);
  });

  it('opens the test-run dialog for a policy', async () => {
    const user = userEvent.setup();
    renderFacets();
    await user.click(screen.getByText('perm.rls.title'));
    await user.click(await screen.findByRole('button', { name: /perm\.cel\.test\.run/ }));
    expect(await screen.findByText('perm.cel.test.title', {}, { timeout: 3000 })).toBeTruthy();
  });
});
