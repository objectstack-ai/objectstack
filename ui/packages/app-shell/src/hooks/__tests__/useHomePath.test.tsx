/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7256 — `useHomePath()`, the target the console chrome's Home
 * affordances point at (top-bar logo, sidebar Home row, mobile sidebar Home
 * row, app-switcher Home entry).
 *
 * The measured defect: cloud's control plane lands a signed-in customer on
 * `/apps/cloud_control` (→ its Welcome page, declared by `isDefault` + nav
 * order), while the top bar's logo said `/home` — the environment launcher,
 * whose "Build an app" / "Start from a template" cards act on an environment
 * the control plane does not have, and whose "Your apps" tiles are the control
 * plane's own internal management apps ("Cloud", "Account"). Same product, two
 * homes, two voices.
 *
 * These assert the hook's ANSWER. That the four chrome sites actually consume
 * it is pinned by `homeAffordancesFollowDeclaration-7256.test.ts`, and that `/`
 * resolves to the same place by
 * `apps/console/src/components/landingHomeParity-7256.test.ts`. None of the
 * three replaces another.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const metadata = vi.hoisted(() => ({ apps: undefined as unknown }));

vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: metadata.apps }),
}));

const { useHomePath } = await import('../useHomePath');

beforeEach(() => {
  metadata.apps = undefined;
});

describe('useHomePath', () => {
  it('follows the DECLARED landing on the control plane', () => {
    metadata.apps = [
      { name: 'cloud_control', label: 'Cloud', isDefault: true },
      { name: 'account', label: 'Account' },
    ];
    expect(renderHook(() => useHomePath()).result.current).toBe('/apps/cloud_control');
  });

  it('keeps the launcher on an ordinary environment — the unchanged status quo', () => {
    metadata.apps = [{ name: 'crm' }, { name: 'setup' }];
    expect(renderHook(() => useHomePath()).result.current).toBe('/home');
  });

  it('answers the launcher while the app list is still in flight', () => {
    // A LINK target, not a redirect: an in-flight answer costs nothing because
    // the href settles long before a boot-time click. `/`'s resolver is the one
    // that must refuse to conclude from an unresolved list (objectui#4233) —
    // fossilizing a wrong answer into history is a redirect-only hazard.
    metadata.apps = undefined;
    expect(renderHook(() => useHomePath()).result.current).toBe('/home');
    metadata.apps = [];
    expect(renderHook(() => useHomePath()).result.current).toBe('/home');
  });

  it('re-answers when the declaration arrives', () => {
    metadata.apps = [];
    const { result, rerender } = renderHook(() => useHomePath());
    expect(result.current).toBe('/home');

    metadata.apps = [{ name: 'cloud_control', isDefault: true }];
    rerender();
    expect(result.current).toBe('/apps/cloud_control');
  });
});
