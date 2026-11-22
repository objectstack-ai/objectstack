// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pinned list view is kept per organization (objectstack#36244): a pin can
 * name a personal view, which exists in one organization only. The
 * organization is the one the real `ActiveOrganizationStorage` holds; a switch
 * reloads the console, so each organization is a fresh mount.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ActiveOrganizationStorage } from '@object-ui/auth';
import { usePinnedListView } from './pinnedListView';

const PER_OBJECT_KEY = 'os:pref:list.view.pinned@object:crm_lead';

function openIn(orgId: string | null) {
  if (orgId) ActiveOrganizationStorage.set(orgId);
  else ActiveOrganizationStorage.clear();
  return renderHook(() => usePinnedListView('crm_lead'));
}

beforeEach(() => {
  localStorage.clear();
  // The pointer `ActiveOrganizationStorage` resolves its per-user key from.
  localStorage.setItem('auth-session-user-id', 'user-1');
});

afterEach(() => {
  ActiveOrganizationStorage.clear();
  localStorage.clear();
});

describe('usePinnedListView — kept per organization (objectstack#36244)', () => {
  it('a view pinned in A survives a round trip through B, and B holds its own', () => {
    const a = openIn('org_a');
    act(() => a.result.current[1]('pv_in_a'));
    a.unmount();

    const b = openIn('org_b');
    expect(b.result.current[0]).toBeNull();
    act(() => b.result.current[1]('pv_in_b'));
    b.unmount();

    const backInA = openIn('org_a');
    expect(backInA.result.current[0]).toBe('pv_in_a');
    backInA.unmount();
    expect(openIn('org_b').result.current[0]).toBe('pv_in_b');
  });

  it('a single organization keeps the pin kept before the organization was part of the slot, adopted once', () => {
    localStorage.setItem(PER_OBJECT_KEY, JSON.stringify({ view: 'pv_old', v: 1 }));
    const only = openIn('org_a');
    expect(only.result.current[0]).toBe('pv_old');
    expect(localStorage.getItem(PER_OBJECT_KEY)).toBeNull();
    only.unmount();

    expect(openIn('org_b').result.current[0]).toBeNull();
  });

  it('with no organization the pin stays in the per-object slot', () => {
    localStorage.setItem(PER_OBJECT_KEY, JSON.stringify({ view: 'pv_old', v: 1 }));
    const view = openIn(null);
    expect(view.result.current[0]).toBe('pv_old');
    act(() => view.result.current[1]('pv_new'));
    expect(JSON.parse(localStorage.getItem(PER_OBJECT_KEY)!)).toEqual({ view: 'pv_new', v: 1 });
  });
});
