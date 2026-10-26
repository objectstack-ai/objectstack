/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `element:button.action` — the MEMBER SHAPE of the inline ActionDef
 * (objectui#8071).
 *
 * The member pin for this key. `ElementButtonRenderer`
 * (`renderers/basic/elements.tsx`) does NOT spread the authored `action` object
 * into the runner. It forwards an EXPLICIT WHITELIST of members, key by key,
 * and the registration publishes the key as `Inline ActionDef executed on click
 * (url / navigation / api / script / modal / flow); omitted -> renders inert`.
 * The whitelist IS the member shape: a key on it is honoured, a key off it is
 * dropped one hop before the runner and the author gets no signal at all.
 *
 * That drop is the exact defect shape objectstack#6837 (`bodyExtra`) and
 * objectstack#6938 (`bodyShape`) were filed for — an authored key that
 * validates, publishes, and then evaporates at this seam.
 *
 * ## Why a new file rather than promoting one of the two that already exist
 *
 * Both were read end to end before this pin was written:
 *
 *   - `element-button-action.test.tsx` — the closest in SUBJECT (it is about
 *     this key), but it drives exactly two members, `type` and `to`, on a
 *     single navigation action, plus the inert path. It would not fail if any
 *     other member left the whitelist.
 *   - `action-bodyExtra-forward.test.tsx` — drives `element:button`'s inline
 *     action for real and asserts `bodyExtra` survives the hop, plus the
 *     `bodyExtra`-beats-`params` merge order on the wire. Its subject is ONE
 *     member across four renderers, not this renderer's member set.
 *
 * A third file, `action-bodyShape-forward.test.tsx`, names `element:button`
 * only to say it is deliberately NOT covered there — its forward list mirrors
 * spec's `InlineActionSchema` pick list, which does not include `bodyShape`,
 * and forwarding it from here would be the forbidden renderer-first direction.
 * ⛔ That file must never be credited as this key's pin: it would satisfy the
 * locator (it names the block and the key) while asserting the opposite. The
 * negative row below is this file taking that reading over as a POSITIVE
 * statement instead — `bodyShape` is authored here and its absence downstream
 * is asserted, so the boundary is pinned rather than merely described.
 *
 * ## Limit, recorded rather than papered over
 *
 * `confirmText` is on the whitelist and is not exercised here. The runner
 * gates on it (`if (action.confirmText)`) and awaits a confirmation handler
 * before it ever reaches the action handler this file observes, so authoring it
 * would suppress the very dispatch being measured. It is pinned by the runner's
 * own confirmation suites, not by a member pin.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import '../renderers/basic/elements';

function ElementButton({ schema }: { schema: any }) {
  const C = ComponentRegistry.get('element:button');
  if (!C) throw new Error('element:button not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <C schema={schema} />;
}

const button = (action: unknown, label = 'Go') => ({
  type: 'element:button',
  properties: { label, action },
});

describe('element:button action — member shape (objectui#8071)', () => {
  // Typed with the signature `ActionProvider`'s `handlers` prop declares, not
  // `ReturnType<typeof vi.fn>` (objectui#4040).
  let api: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
  /** The members the runner was handed, snapshotted AT dispatch. */
  let received: Record<string, unknown>;

  beforeEach(() => {
    received = {};
    api = vi.fn(async (action: ActionDef) => {
      // Snapshot immediately: the runner may mutate the ActionDef it holds
      // (it merges collected params back onto `action.params`), so a read
      // taken after the await would not be a reading of the FORWARD.
      received = { ...(action as unknown as Record<string, unknown>) };
      return { success: true };
    });
  });

  /** The forwarded members that actually carry a value. */
  const definedKeys = () =>
    Object.entries(received)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k)
      .sort();

  async function click(schema: any) {
    render(
      <ActionProvider handlers={{ api }}>
        <ElementButton schema={schema} />
      </ActionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Go/i }));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
  }

  it('forwards the whitelisted members and DROPS every key off the list', async () => {
    await click(
      button({
        // …every whitelisted member that is inert for an `api` action…
        type: 'api',
        name: 'close_order',
        label: 'Close order',
        description: 'Closes the order',
        target: '/api/v1/order/close',
        endpoint: '/api/v1/order/close',
        method: 'PATCH',
        bodyExtra: { status: 'closed' },
        successMessage: 'Closed',
        errorMessage: 'Failed',
        refreshAfter: true,
        params: { note: 'from the author' },
        // …and three keys the forward list does not carry. `bodyShape` is the
        // measured one (objectstack#6938): spec's InlineActionSchema pick list
        // does not include it, so it must not arrive. `icon` and `variant` are
        // element:button's OWN sibling props — authored one level in by
        // mistake, they must not become action members either.
        bodyShape: { wrap: 'data' },
        icon: 'trash',
        variant: 'danger',
      }),
    );

    // The whitelist as a SET — arrival and drop in one assertion, so a member
    // quietly added to or removed from the forward list is red either way.
    expect(definedKeys()).toEqual([
      'bodyExtra',
      'description',
      'endpoint',
      'errorMessage',
      'label',
      'method',
      'name',
      'params',
      'refreshAfter',
      'successMessage',
      'target',
      'type',
    ]);
    // Named individually as well, because the sorted-list form above reads as
    // a blob at review time and these three are the point of the row.
    expect(received.bodyShape).toBeUndefined();
    expect(received.icon).toBeUndefined();
    expect(received.variant).toBeUndefined();
    // …and the members that DID arrive kept their values, not just their names.
    expect(received.bodyExtra).toEqual({ status: 'closed' });
    expect(received.target).toBe('/api/v1/order/close');
  });

  it('`actionType` OUTRANKS `type` when both are authored', async () => {
    // `type: action.actionType || action.type`. Authored with two different
    // action kinds so a reversed read routes the click to the other handler
    // instead of tying.
    const onNavigate = vi.fn();
    render(
      <ActionProvider handlers={{ api }} onNavigate={onNavigate}>
        <ElementButton
          schema={button({
            actionType: 'api',
            type: 'navigation',
            target: '/api/v1/order/close',
            to: '/somewhere-else',
          })}
        />
      </ActionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Go/i }));

    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(received.type).toBe('api');
    // The control that makes the line above a precedence reading rather than a
    // coincidence: the losing spelling's handler never ran.
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('an ARRAY `params` is re-routed to `actionParams` — the collection DEFINITION', async () => {
    // The one member whose NAME changes across the hop. Spec spells the
    // parameter-definition array `params`; the runner disambiguates it from the
    // static values object as `actionParams` (objectstack#5777 direction A).
    const defs = [{ name: 'reason', type: 'string' }];
    await click(button({ type: 'api', target: '/api/v1/order/close', params: defs }));

    expect(received.actionParams).toEqual(defs);
    // …and it does NOT also arrive under its authored name, which is what would
    // let a downstream consumer read the definition array as a values map.
    expect(received.params).toBeUndefined();
  });

  it('an OBJECT `params` stays `params` — the static values map', async () => {
    // The other arm of the same branch, same shape, so the row above is a
    // statement about ARRAY-ness and not about `params` generally.
    await click(
      button({ type: 'api', target: '/api/v1/order/close', params: { reason: 'duplicate' } }),
    );

    expect(received.params).toEqual({ reason: 'duplicate' });
    expect(received.actionParams).toBeUndefined();
  });

  it('the navigation members reach the navigation handler', async () => {
    // `to` and `opensInNewTab` are on the whitelist but inert for an `api`
    // action, so they are pinned on the action kind that actually consumes
    // them.
    const onNavigate = vi.fn();
    render(
      <ActionProvider onNavigate={onNavigate}>
        <ElementButton
          schema={button({ type: 'navigation', to: '/apps/crm/contacts' })}
        />
      </ActionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Go/i }));

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith('/apps/crm/contacts', expect.anything()),
    );
  });

  it('an omitted `action` leaves the button inert — no dispatch, no crash', async () => {
    // The registration's own words ("omitted -> renders inert"), and the
    // non-vacuity control for every row above: the dispatches they observe
    // happen because an action was authored, not because clicking always fires.
    render(
      <ActionProvider handlers={{ api }}>
        <ElementButton schema={{ type: 'element:button', properties: { label: 'Go' } }} />
      </ActionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Go/i }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api).not.toHaveBeenCalled();
  });
});
