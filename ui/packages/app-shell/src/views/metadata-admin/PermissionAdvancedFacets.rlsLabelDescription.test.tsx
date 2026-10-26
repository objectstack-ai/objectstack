// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins that the permission editor's own row-level-security policy list draws
 * each policy's `label` and `description` (objectui#11199).
 *
 * Both keys are declared on `@objectstack/spec`'s `RowLevelSecurityPolicy` as
 * plain optional strings and are stored and served with the permission set,
 * but before this the edit page drew neither: `PermissionPreview` draws them,
 * and no production route mounts it for `permission`. The facet's policy list
 * is the surface an author edits on, so that is where they are drawn.
 *
 * Three facts are pinned:
 *  - a policy that declares a label and a description shows both, inside its
 *    own card and nowhere else;
 *  - the control: a policy that declares neither (or declares them empty)
 *    renders exactly the card it rendered before — no caption element at all;
 *  - an edit to another key carries both keys back out on the emitted draft,
 *    so the drawn values are never lost on the host's whole-record Save.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionAdvancedFacets } from './PermissionAdvancedFacets';

afterEach(cleanup);

const t = (k: string) => k;

type Draft = Record<string, unknown>;

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
  return { policiesAfter };
}

/** The RLS facet is collapsed by default — expand it to mount the editors. */
async function openRls(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('perm.rls.title'));
}

/** A policy's card: the name input sits in the card's input row. */
function cardOf(policyName: string): HTMLElement {
  const row = screen.getByDisplayValue(policyName).parentElement;
  const card = row?.parentElement;
  if (!card) throw new Error(`no card for policy ${policyName}`);
  return card;
}

const LABELLED = {
  name: 'task_own_rows',
  label: 'Own Tasks Only',
  description: 'Contributors can only select tasks assigned to them.',
  object: 'showcase_task',
  operation: 'select',
  using: 'assignee == current_user.email',
  enabled: true,
};

const BARE = {
  name: 'tenant_isolation',
  object: 'account',
  operation: 'all',
  using: 'organization_id == current_user.organization_id',
  enabled: true,
};

describe('PermissionAdvancedFacets · RLS policy label and description are drawn (objectui#11199)', () => {
  it("draws a policy's label and description inside that policy's own card", async () => {
    const user = userEvent.setup();
    renderFacets({ rowLevelSecurity: [LABELLED, BARE] });
    await openRls(user);

    const label = screen.getByText(LABELLED.label);
    const description = screen.getByText(LABELLED.description);

    const labelled = cardOf(LABELLED.name);
    expect(labelled.contains(label)).toBe(true);
    expect(labelled.contains(description)).toBe(true);

    const bare = cardOf(BARE.name);
    expect(bare.contains(label)).toBe(false);
    expect(bare.contains(description)).toBe(false);
  });

  it('control: a policy declaring neither renders the card it rendered before', async () => {
    const user = userEvent.setup();
    renderFacets({
      rowLevelSecurity: [BARE, { ...BARE, name: 'empty_strings', label: '', description: '' }],
    });
    await openRls(user);

    // Before this change a card held exactly two children: the input row and
    // the USING / CHECK grid. A policy with nothing to draw keeps exactly that
    // — the caption is absent, not an empty box.
    for (const name of [BARE.name, 'empty_strings']) {
      const card = cardOf(name);
      expect(card.children).toHaveLength(2);
      expect(card.firstElementChild?.contains(screen.getByDisplayValue(name))).toBe(true);
    }
    // The labelled card is the one that grows by the caption — the same count
    // taken the other way, so the control cannot pass by reading a stale DOM.
    cleanup();
    renderFacets({ rowLevelSecurity: [LABELLED] });
    await openRls(user);
    expect(cardOf(LABELLED.name).children).toHaveLength(3);
  });

  it('an edit to another key carries label and description back out on the draft', async () => {
    const user = userEvent.setup();
    const { policiesAfter } = renderFacets({ rowLevelSecurity: [LABELLED] });
    await openRls(user);
    await user.type(screen.getByDisplayValue(LABELLED.name), 'x');

    const policies = policiesAfter();
    expect(policies).toHaveLength(1);
    expect(policies[0].name).toBe(`${LABELLED.name}x`);
    expect(policies[0].label).toBe(LABELLED.label);
    expect(policies[0].description).toBe(LABELLED.description);
  });
});
