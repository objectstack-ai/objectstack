/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5493 — `ActionSchema.onSuccess` must SURVIVE the hop on all four
 * declared action surfaces.
 *
 * The key became authorable on `ActionSchema` with the `@objectstack/spec`
 * 17.1.0 pin bump (objectui#5328) and the runner has read it off the forwarded
 * def since objectui#5221 (`handlePostExecution` → `readOnSuccessNavigation` →
 * `navigateOnSuccess` → the app's own `navigationHandler`). Between those two
 * halves sat these four whitelists, which never carried the key: the action
 * succeeded, the declared post-success hop silently did not happen.
 *
 * ## What these pins assert, and why it is not "the action succeeded"
 *
 * An assertion that the action ran passes in BOTH worlds — it cannot see a
 * dropped key. Each row here asserts the two facts that differ:
 *
 *   1. the handler is handed a def whose `onSuccess` is the authored block
 *      (the forward itself), and
 *   2. the runner performs the hop — `onNavigate` is called with the
 *      `${result.*}`-INTERPOLATED url and the declared `openIn` branch.
 *
 * (2) is the artefact that matters; a url only this declaration can produce
 * (`/app/crm/contacts/rec_42`, interpolated from the handler's own payload)
 * is what keeps it off a truthiness check.
 *
 * ## The positive control is in every row
 *
 * Each row asserts `api` was called exactly once BEFORE asserting on the
 * navigation spy. A zero-navigation reading therefore cannot be "the harness
 * never executed anything" (an unmounted renderer, an un-clicked button, an
 * assertion that ran before the async execute settled) — the two failure
 * modes are distinguishable from the failure message alone.
 *
 * ## Why one row per surface
 *
 * These are four separate whitelists, not one helper: a fix or a regression on
 * one renderer must show up as exactly one red row. `openIn` is exercised on
 * both branches across the rows (`'self'` on three, `'newTab'` on `action:menu`)
 * so the pin covers the forwarded BLOCK rather than only its `navigate` string.
 *
 * `element:button` (spec's `InlineActionSchema` pick list) is deliberately
 * absent: `onSuccess` is not on that pick list, so that surface never owed it —
 * the same split `scripts/check-action-forward-parity.mjs` derives rather than
 * registers.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// Module-scope side-effect imports — these renderers register themselves with
// the ComponentRegistry, and the light `dom` project does not load the
// `@object-ui/components` graph. Module scope, not a `beforeAll`, per
// AGENTS.md §测试纪律.
import '../action-button';
import '../action-icon';
import '../action-group';
import '../action-menu';

/** The handler's own return value — what `${result.*}` reads (objectui#2904). */
const PAYLOAD = { id: 'rec_42' };

/** The authored block, spelled as the spec declares it: `{ navigate, openIn }`. */
const ONSUCCESS_SELF = { navigate: '/app/crm/contacts/${result.id}', openIn: 'self' } as const;
const ONSUCCESS_NEWTAB = { navigate: '/app/crm/contacts/${result.id}', openIn: 'newTab' } as const;

/** The customer shape (clone a record, then jump to the clone). */
const clone = (onSuccess: unknown, extra: Record<string, unknown> = {}) => ({
  name: 'clone_record',
  label: 'Clone',
  type: 'api',
  target: '/api/v1/records/clone',
  locations: ['list_toolbar'],
  onSuccess,
  ...extra,
});

// Typed with the signatures the provider's props declare, not
// `ReturnType<typeof vi.fn>` — see action-bodyExtra-forward.test.tsx
// (objectui#4040).
let api: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let nav: Mock<(url: string, options?: { external?: boolean; newTab?: boolean }) => void>;

beforeEach(() => {
  api = vi.fn(async () => ({ success: true, data: PAYLOAD }));
  nav = vi.fn();
});

const renderSurface = (node: React.ReactNode) =>
  render(
    <ActionProvider handlers={{ api }} onNavigate={nav} onToast={vi.fn()}>
      {node}
    </ActionProvider>,
  );

/**
 * The standalone NODE shape for the two leaf action components (objectui#7415).
 *
 * `clone()` above returns a spec `ActionSchema`, whose execution type is spelled
 * `type` — and that spelling is still correct where the declaration sits inside
 * an `actions` array (`action:group` / `action:menu` below, untouched). As a
 * NODE handed straight to `action:button` / `action:icon`, `type` is the SDUI
 * component discriminator and the execution type is the renamed `actionType`
 * input, so the two spellings are separated here rather than conflated.
 */
const asNode = (component: string, decl: Record<string, unknown>) => {
  const { type, ...rest } = decl;
  return { ...rest, type: component, actionType: type };
};

/** The renderer under test, straight off the registry (as `action:bar` gets it). */
function surface(type: string, schema: Record<string, unknown>) {
  const C = ComponentRegistry.get(type);
  if (!C) throw new Error(`${type} is not registered`);
  return <C schema={schema as never} />;
}

/** The def the `api` handler was handed — i.e. what reached the runner. */
const executedDef = () => api.mock.calls[0][0] as ActionDef & { onSuccess?: unknown };

/**
 * The two facts, in order: the action ran (positive control), the block was
 * forwarded, and the hop happened with the interpolated url.
 */
async function expectHop(expected: { openIn: 'self' | 'newTab'; block: unknown }) {
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(executedDef().onSuccess).toEqual(expected.block);

  await waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
  const [url, options] = nav.mock.calls[0];
  expect(url).toBe('/app/crm/contacts/rec_42');
  expect(options?.newTab).toBe(expected.openIn === 'newTab');
}

describe('ActionSchema.onSuccess reaches the runner from every declared surface (#5493)', () => {
  it('action:button — a clicked button performs the declared post-success hop', async () => {
    renderSurface(surface('action:button', asNode('action:button', clone(ONSUCCESS_SELF))));

    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

    await expectHop({ openIn: 'self', block: ONSUCCESS_SELF });
  });

  it('action:icon — the icon-only surface hops too, not only the labelled one', async () => {
    // Same declaration, dense layout. Which renderer an action gets is a host's
    // choice (`component`), so a whitelist that carries the key on one surface
    // and drops it on another makes the hop a function of the layout.
    renderSurface(surface('action:icon', asNode('action:icon', clone(ONSUCCESS_SELF))));

    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

    await expectHop({ openIn: 'self', block: ONSUCCESS_SELF });
  });

  it('action:group — an inline group member hops', async () => {
    renderSurface(surface('action:group', { type: 'action:group', actions: [clone(ONSUCCESS_SELF)] }));

    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

    await expectHop({ openIn: 'self', block: ONSUCCESS_SELF });
  });

  it("action:menu — the overflow surface hops, and carries openIn: 'newTab'", async () => {
    // `autoTrigger` runs `handleExecute`, the identical function a click on the
    // menu item calls, without opening the Radix dropdown (whose
    // pointerdown-driven portal is flaky to synthesize in happy-dom — see
    // `action-group-dropdown-visible.test.tsx`). The `newTab` branch rides here
    // so the pin covers the forwarded BLOCK, not just its `navigate` string.
    renderSurface(
      surface('action:menu', {
        type: 'action:menu',
        actions: [clone(ONSUCCESS_NEWTAB, { autoTrigger: true })],
      }),
    );

    await expectHop({ openIn: 'newTab', block: ONSUCCESS_NEWTAB });
  });
});
