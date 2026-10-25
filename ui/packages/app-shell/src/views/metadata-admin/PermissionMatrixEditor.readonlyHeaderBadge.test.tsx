// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The PageShell header badge must report the gate that actually governs the
 * screen — objectui#4036, B-half of the objectstack#5768 split ruling.
 *
 * Measured on a dogfood run: `/studio/com.example.showcase/access` rendered the
 * permission set's title row as
 *
 *   权限集 · showcase_contributor · 安全 · 可写 · 已授权对象 5 · 字段覆盖 3 · 历史
 *                                        ^^^^
 *
 * while all 207 permission checkboxes and 发布 below it were disabled with the
 * read-only-package tooltip. Both renderings answer "can you write this?" and
 * they disagreed, because they read different inputs:
 *
 *   • the CONTROLS read `!!resolved.allowEnvironmentOverlay && !readOnly` — the type
 *     registry AND the host package gate;
 *   • the BADGE read `entry.allowEnvironmentOverlay` alone. `permission` was then one
 *     of the 15 overlay-allowed types, so that flag was true and the badge said
 *     "writable" no matter which package you were in.
 *
 * This suite pins the display side only. The gating assertions here are
 * CONTROLS: the B-half ruling explicitly keeps Studio's blanket package-level
 * read-only intact ("Studio 维持包级只读") pending the per-type A-half review,
 * so a fix that made anything editable would be the wrong fix even though the
 * badge assertions would still pass.
 *
 * ## Amendment — objectui#4446: the CONTROLS were the outlier, not the badge
 *
 * The paragraph above called the controls' formula "the right answer". That was
 * wrong on the type half, and this suite could not see it: every case here
 * drives the HOST gate (`readOnly` true/absent) with `allowEnvironmentOverlay: true`
 * throughout, so it never rendered the one shape where the two disagree.
 *
 * `WritabilityBadge` is read-only exactly when
 * `readOnly || (!allowEnvironmentOverlay && !allowRuntimeCreate)`; the controls were
 * read-only when `readOnly || !allowEnvironmentOverlay`. The gap is precisely
 * `!allowEnvironmentOverlay && allowRuntimeCreate` — which is the stock-boot
 * `permission` shape today (objectstack#6483 set `allowEnvironmentOverlay: false` and
 * deliberately kept `allowRuntimeCreate: true`). There the badge said
 * "create-only" over 207 dead checkboxes.
 *
 * So the badge already consulted the full disjunction and the controls did not.
 * Fixing the controls (`allowEnvironmentOverlay || allowRuntimeCreate`) makes the two
 * predicates byte-identical rather than merely closer — the convergence is
 * pinned below, across all four states, so neither side can drift again.
 *
 * The host gate is UNTOUCHED and still dominant, so "Studio 维持包级只读" holds
 * exactly as before: a read-only package locks this screen whatever the type
 * permits. What changed is the type half, and only in the direction the server
 * itself already allows (it refuses only when BOTH flags are false).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const server = {
  set: {
    name: 'showcase_contributor',
    label: 'Contributor',
    objects: { a_account: { allowRead: true } },
    fields: {},
  } as Record<string, unknown>,
};

let clientImpl: any;

function makeClient() {
  return {
    layered: async () => ({
      effective: server.set,
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    list: async (type: string) =>
      type === 'object' ? [{ item: { name: 'a_account', label: 'Account' } }] : [],
    get: async (type: string) =>
      type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null,
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  } as any;
}

// The type registry says this type IS overlay-allowed — the exact condition the
// #4036 defect needed. (`permission` was in the server's overlay-allowed list
// when this suite was written; objectstack#6483 has since flipped it to
// `allowEnvironmentOverlay: false` + `allowRuntimeCreate: true`. These cases keep the
// original shape on purpose — it is the must-not-change control for #4446 —
// while the convergence describe at the bottom drives the current one.)
let typeFlags: { allowEnvironmentOverlay?: boolean; allowRuntimeCreate?: boolean } = {
  allowEnvironmentOverlay: true,
};

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', ...typeFlags }],
  }),
}));
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(() => {
  cleanup();
  typeFlags = { allowEnvironmentOverlay: true };
});

async function renderMatrix(props?: { readOnly?: boolean }) {
  clientImpl = makeClient();
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage
        type="permission"
        name="showcase_contributor"
        packageId="com.example.showcase"
        embedded
        {...props}
      />
    </MemoryRouter>,
  );
  await screen.findByText('Account');
}

/**
 * The header badge, addressed structurally rather than by text. The identity
 * strip below the header carries its own read-only badge ("Read-only", the
 * Studio package wording) and the header carries the metadata-admin badge-slot
 * wording ("read-only"); matching on text alone would silently pass by finding
 * the wrong one the day either string moves.
 */
function headerBadgeTexts(): string[] {
  const header = document.querySelector('.border-b.bg-background');
  return Array.from(header?.querySelectorAll('[class*="rounded-"]') ?? [])
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean);
}

describe('PermissionMatrixEditPage — header writability badge vs the package gate (#4036)', () => {
  it('read-only package: the header does NOT claim the set is writable', async () => {
    await renderMatrix({ readOnly: true });

    // The defect, stated directly: an overlay-allowed TYPE inside a read-only
    // PACKAGE must not advertise writability anywhere on the screen.
    expect(headerBadgeTexts()).not.toContain('writable');
    expect(screen.queryByText('writable', { exact: true })).toBeNull();
  });

  it('read-only package: the header reports read-only, naming the package as the reason', async () => {
    await renderMatrix({ readOnly: true });

    expect(headerBadgeTexts()).toContain('read-only');
    // Reuses the wording the Studio top bar and the identity strip already use
    // for this gate, so the screen gives one reason, not two.
    const badge = screen.getByText('read-only', { exact: true });
    expect(badge).toHaveAttribute('title', expect.stringContaining('Read-only package'));
  });

  it('CONTROL — writable package: the header still reports writable', async () => {
    await renderMatrix();

    expect(headerBadgeTexts()).toContain('writable');
    expect(screen.queryByText('read-only', { exact: true })).toBeNull();
  });

  it('CONTROL — gating is untouched: read-only still disables every control and hides Save', async () => {
    await renderMatrix({ readOnly: true });

    // The A-half review must find the surface exactly as policy-consistent as
    // this PR leaves it: display-side coherence only, no loosening.
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toBeDisabled();
  });

  it('CONTROL — gating is untouched: a writable package keeps live checkboxes', async () => {
    await renderMatrix();

    // objectui#11787 — the package door autosaves: no Save button; the live controls are the writability read.
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
  });
});

/**
 * The convergence itself (objectui#4446). One table, four states, and in each
 * one the question "is the header badge read-only?" and the question "are the
 * controls locked?" must get the SAME answer. Pre-fix row 3 is the divergence:
 * badge "create-only" (not read-only) over disabled controls with no Save.
 */
describe('PermissionMatrixEditPage — badge and controls read ONE predicate (#4446)', () => {
  const cases: Array<{
    label: string;
    flags: { allowEnvironmentOverlay?: boolean; allowRuntimeCreate?: boolean };
    readOnly?: boolean;
    expectWritable: boolean;
  }> = [
    {
      label: 'read-only package dominates both flags',
      flags: { allowEnvironmentOverlay: true, allowRuntimeCreate: true },
      readOnly: true,
      expectWritable: false,
    },
    {
      label: 'overlay-allowed type in a writable package',
      flags: { allowEnvironmentOverlay: true, allowRuntimeCreate: false },
      expectWritable: true,
    },
    {
      // The stock-boot `permission` shape — the #4446 defect.
      label: 'runtime-creatable-only type in a writable package',
      flags: { allowEnvironmentOverlay: false, allowRuntimeCreate: true },
      expectWritable: true,
    },
    {
      label: 'no write channel at all',
      flags: { allowEnvironmentOverlay: false, allowRuntimeCreate: false },
      expectWritable: false,
    },
  ];

  for (const c of cases) {
    it(`${c.label} → ${c.expectWritable ? 'writable' : 'locked'}, and both renderings agree`, async () => {
      typeFlags = c.flags;
      await renderMatrix(c.readOnly ? { readOnly: true } : undefined);

      // CONTROLS side.
      const save = screen.queryByRole('button', { name: /^Save$/ });
      const readBox = screen.getByLabelText('a_account Read');

      // BADGE side — the header slot, addressed structurally (see above).
      const badgeSaysReadOnly = headerBadgeTexts().includes('read-only');

      if (c.expectWritable) {
        // objectui#11787 — the package door autosaves: no Save button; the live controls are the writability read.
        expect(save).toBeNull();
        expect(readBox).toBeEnabled();
        expect(badgeSaysReadOnly).toBe(false);
      } else {
        expect(save).toBeNull();
        expect(readBox).toBeDisabled();
        expect(badgeSaysReadOnly).toBe(true);
      }

      // The invariant, stated as the equality it is: the header never claims a
      // writability the controls do not deliver, and never withholds one they do.
      expect(badgeSaysReadOnly).toBe(!c.expectWritable);
    });
  }
});
