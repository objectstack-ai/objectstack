/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `bodyShape` survives the renderer hop (objectstack#6938).
 *
 * Sibling of `action-bodyExtra-forward.test.tsx` (#6837) and the same failure
 * shape: every action renderer forwards an EXPLICIT whitelist of keys to the
 * `ActionRunner` — deliberate, so a key no renderer honours cannot look wired —
 * and a NEW spec key stays invisible until each list is edited, with nothing
 * failing while they are not. `bodyShape` is the spec's body-WRAPPING
 * declaration for a `type: 'api'` action (`'flat'`, or `{ wrap: key }` to nest
 * the collected params). The console `apiHandler` read it unconditionally while
 * zero renderers forwarded it, so an action declaring `{ wrap: 'data' }` POSTed
 * a FLAT body and the declaration read as honoured because it parsed and
 * published.
 *
 * Deliberately NOT covered here: `element:button`. Its forward list mirrors
 * spec's `InlineActionSchema` pick list field for field (its own comment says
 * so), and that pick list does not include `bodyShape` — verified against
 * `packages/spec/src/ui/action.zod.ts` on objectstack `origin/main`, where the
 * picks are `type name label target openIn method params bodyExtra confirmText
 * successMessage errorMessage refreshAfter opensInNewTab`. `bodyShape` is not
 * inline vocabulary, and the spec's rule for that boundary is explicit:
 * "Widen this when a renderer widens, not before" — with the window always
 * opening spec-first, never renderer-first. Forwarding it from `element:button`
 * would be the forbidden direction.
 *
 * Asserted at the two ends that matter, as #6837 established: what the runner
 * RECEIVES (the forward itself) and what lands on the WIRE (the forward plus the
 * runner's body assembly). Props-only assertions would have stayed green while
 * the wrap was still dropped downstream.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import '../renderers/action/action-button';
import '../renderers/action/action-group';
import '../renderers/action/action-icon';
import '../renderers/action/action-menu';

function Registered({ type, schema }: { type: string; schema: any }) {
  const C = ComponentRegistry.get(type);
  if (!C) throw new Error(`${type} not registered`);
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <C schema={schema} />;
}

describe('bodyShape survives the declared-action renderer whitelists', () => {
  // See action-bodyExtra-forward.test.tsx for why this is not
  // `ReturnType<typeof vi.fn>` (objectui#4040).
  let api: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

  beforeEach(() => {
    api = vi.fn(async () => ({ success: true }));
  });

  /** The ActionDef the runner was handed for the click. */
  const dispatched = () => api.mock.calls[0][0];

  it('action:button forwards bodyShape off a declared ActionSchema', async () => {
    render(
      <ActionProvider handlers={{ api }}>
        <Registered
          type="action:button"
          schema={{
            actionType: 'api',
            name: 'update_organization',
            label: 'Save organization',
            target: '/api/v1/auth/organization/update',
            method: 'POST',
            bodyShape: { wrap: 'data' },
          }}
        />
      </ActionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Save organization/i }));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(dispatched().bodyShape).toEqual({ wrap: 'data' });
  });

  it('action:icon forwards bodyShape', async () => {
    render(
      <ActionProvider handlers={{ api }}>
        <Registered
          type="action:icon"
          schema={{
            actionType: 'api',
            name: 'update_organization',
            label: 'Save',
            icon: 'save',
            target: '/api/v1/auth/organization/update',
            bodyShape: { wrap: 'data' },
          }}
        />
      </ActionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(dispatched().bodyShape).toEqual({ wrap: 'data' });
  });

  it('action:group forwards bodyShape for an inline member', async () => {
    render(
      <ActionProvider handlers={{ api }}>
        <Registered
          type="action:group"
          schema={{
            type: 'action:group',
            actions: [
              {
                type: 'api',
                name: 'update_organization',
                label: 'Save organization',
                target: '/api/v1/auth/organization/update',
                bodyShape: { wrap: 'data' },
              },
            ],
          }}
        />
      </ActionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Save organization/i }));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(dispatched().bodyShape).toEqual({ wrap: 'data' });
  });

  it('action:menu forwards bodyShape for an overflow item', async () => {
    render(
      <ActionProvider handlers={{ api }}>
        <Registered
          type="action:menu"
          schema={{
            type: 'action:menu',
            label: 'More',
            actions: [
              {
                type: 'api',
                name: 'update_organization',
                label: 'Save organization',
                target: '/api/v1/auth/organization/update',
                bodyShape: { wrap: 'data' },
              },
            ],
          }}
        />
      </ActionProvider>,
    );

    // Radix opens its dropdown on pointerdown, not click — same gesture the
    // bodyExtra sibling test uses.
    fireEvent.pointerDown(screen.getByRole('button', { name: /More/i }), { button: 0 });
    const item = await screen.findByText(/Save organization/i);
    fireEvent.click(item);
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(dispatched().bodyShape).toEqual({ wrap: 'data' });
  });
});

describe('bodyShape reaches the wire, end to end', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({}) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const sentBody = () => JSON.parse((global.fetch as any).mock.calls[0][1].body);

  // The stand-in for user-collected values is authored as `properties.params`,
  // the node's static-values channel (objectui#10289, ruling A): a node-level
  // `params` object is not read by `action:button` at all.

  it('wraps the payload under the declared key', async () => {
    // No custom `api` handler on purpose: the click travels the whole chain —
    // renderer whitelist, then the runner's own executeAPI body assembly — so the
    // wrap is asserted on the actual request body rather than on props.
    render(
      <ActionProvider>
        <Registered
          type="action:button"
          schema={{
            actionType: 'api',
            name: 'update_organization',
            label: 'Save organization',
            target: '/api/v1/auth/organization/update',
            method: 'POST',
            properties: { params: { name: 'Acme Inc', slug: 'acme' } },
            bodyShape: { wrap: 'data' },
          }}
        />
      </ActionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Save organization/i }));
    await waitFor(() => expect(global.fetch as any).toHaveBeenCalledOnce());

    expect(sentBody()).toEqual({ data: { name: 'Acme Inc', slug: 'acme' } });
  });

  it('keeps bodyExtra flat BESIDE the wrap, per the spec wording', async () => {
    // "…nests the user-collected params under that key, while `recordIdParam` and
    // other top-level keys stay flat." Both console read-sites do exactly this;
    // this pins the runner to the same reading, so the body shape does not depend
    // on which host executed the action.
    render(
      <ActionProvider>
        <Registered
          type="action:button"
          schema={{
            actionType: 'api',
            name: 'update_organization',
            label: 'Save organization',
            target: '/api/v1/auth/organization/update',
            method: 'POST',
            properties: { params: { name: 'Acme Inc' } },
            bodyExtra: { organizationId: 'org_1' },
            bodyShape: { wrap: 'data' },
          }}
        />
      </ActionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Save organization/i }));
    await waitFor(() => expect(global.fetch as any).toHaveBeenCalledOnce());

    expect(sentBody()).toEqual({
      data: { name: 'Acme Inc' },   // collected params nest
      organizationId: 'org_1',      // bodyExtra stays top-level
    });
  });

  it('sends a FLAT body when no bodyShape is declared (regression pin)', async () => {
    // The default path, unchanged by this fix. Without this the wrap branch could
    // start applying to every action and nothing here would notice.
    render(
      <ActionProvider>
        <Registered
          type="action:button"
          schema={{
            actionType: 'api',
            name: 'close_order',
            label: 'Close order',
            target: '/api/v1/order/close',
            method: 'PATCH',
            properties: { params: { note: 'from the user' } },
            bodyExtra: { status: 'closed' },
          }}
        />
      </ActionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Close order/i }));
    await waitFor(() => expect(global.fetch as any).toHaveBeenCalledOnce());

    expect(sentBody()).toEqual({ note: 'from the user', status: 'closed' });
  });
});
