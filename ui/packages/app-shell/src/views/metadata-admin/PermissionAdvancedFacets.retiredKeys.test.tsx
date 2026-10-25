// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins that the RLS facet never authors `rowLevelSecurity[].priority`
 * (objectstack#7130).
 *
 * The key is a `retiredKey` tombstone in `@objectstack/spec` 17.0.0
 * (`packages/spec/src/security/rls.zod.ts` — removed by objectstack#3896):
 * an authored value is REJECTED at parse time with the upgrade prescription,
 * not ignored. This editor used to seed `priority: 0` on every policy its Add
 * button created, so every permission set saved after touching the structured
 * RLS editor carried a parse-rejected key.
 *
 * Two directions are pinned, because the seed is only half of it:
 *  - the Add-policy seed's key set, so the key cannot quietly return;
 *  - an edit-and-save round-trip of an ALREADY-poisoned stored policy, which
 *    every write path spreads (`{ ...pol, name }`) and would otherwise carry
 *    the key back out verbatim.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionAdvancedFacets } from './PermissionAdvancedFacets';

afterEach(cleanup);

const t = (k: string) => k;

type Draft = Record<string, unknown>;

/**
 * Render the facets with a `setDraft` spy, and expose the drafts the component
 * asked for — the updater is applied to the draft it was rendered with, which
 * is what the host's whole-record Save would then persist.
 */
function renderFacets(draft: Draft) {
  const drafts: Draft[] = [];
  const setDraft = vi.fn((updater: (prev: Draft) => Draft) => {
    drafts.push(updater(draft));
  });
  const props = {
    draft,
    setDraft,
    writable: true,
    allSetNames: [] as string[],
    t,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<PermissionAdvancedFacets {...(props as any)} />);
  const policiesAfter = () => {
    const last = drafts[drafts.length - 1];
    return (last?.rowLevelSecurity ?? []) as Array<Record<string, unknown>>;
  };
  return { drafts, policiesAfter };
}

/** The RLS facet is collapsed by default — expand it to mount the editors. */
async function openRls(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('perm.rls.title'));
}

describe('PermissionAdvancedFacets · RLS retired-key hygiene (objectstack#7130)', () => {
  it('the Add-policy seed authors exactly the live spec keys — no `priority`', async () => {
    const user = userEvent.setup();
    const { policiesAfter } = renderFacets({ rowLevelSecurity: [] });
    await openRls(user);
    await user.click(screen.getByRole('button', { name: /perm\.rls\.add/ }));

    const policies = policiesAfter();
    expect(policies).toHaveLength(1);
    // Key SET, not just the absence of `priority`: a pin on the whole seed is
    // what stops a retired key drifting back in beside a live one.
    expect(Object.keys(policies[0]).sort()).toEqual(
      ['enabled', 'name', 'object', 'operation', 'using'].sort(),
    );
    expect('priority' in policies[0]).toBe(false);
  });

  it('an edit-and-save round-trip of a stored policy carrying `priority` comes out clean', async () => {
    const user = userEvent.setup();
    const { policiesAfter } = renderFacets({
      // What this editor itself wrote before objectstack#7130.
      rowLevelSecurity: [
        {
          name: 'p1',
          object: 'account',
          operation: 'all',
          using: 'owner_id == current_user.id',
          check: 'owner_id == current_user.id',
          enabled: true,
          priority: 0,
        },
      ],
    });
    await openRls(user);
    // Any edit re-emits the whole policy list; the name field is the cheapest.
    await user.type(screen.getByPlaceholderText('perm.rls.name'), 'x');

    const policies = policiesAfter();
    expect(policies).toHaveLength(1);
    expect('priority' in policies[0]).toBe(false);
    // Falsification: the strip is keyed to the tombstone, not a blanket
    // unknown-key purge — every live key the editor does not render survives.
    expect(policies[0].check).toBe('owner_id == current_user.id');
    expect(policies[0].using).toBe('owner_id == current_user.id');
    expect(policies[0].enabled).toBe(true);
    expect(policies[0].name).toBe('p1x');
  });

  it('a policy the editor never touches is still emitted without `priority` once any policy is edited', async () => {
    const user = userEvent.setup();
    const { policiesAfter } = renderFacets({
      rowLevelSecurity: [
        { name: 'p1', object: 'account', operation: 'all', using: 'true', enabled: true, priority: 0 },
        { name: 'p2', object: 'contact', operation: 'select', using: 'true', enabled: true, priority: 5 },
      ],
    });
    await openRls(user);
    // Adding a policy re-emits the existing ones alongside the new seed.
    await user.click(screen.getByRole('button', { name: /perm\.rls\.add/ }));

    const policies = policiesAfter();
    expect(policies).toHaveLength(3);
    expect(policies.some((p) => 'priority' in p)).toBe(false);
    expect(policies.map((p) => p.name)).toEqual(['p1', 'p2', '']);
  });
});
