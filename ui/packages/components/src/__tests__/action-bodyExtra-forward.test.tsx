/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `bodyExtra` survives the renderer hop (objectstack#6837).
 *
 * Every action renderer forwards an EXPLICIT whitelist of keys to the
 * `ActionRunner` — a deliberate list, not a spread, so that a key no renderer
 * honours cannot look wired. The cost of that design is that a NEW key is
 * invisible until it is added to each list, and `bodyExtra` was the live example:
 * `@objectstack/spec` 17 made it the only way a `type: 'api'` action can carry a
 * static request payload (#5777 ruling, direction A — `params` keeps its one
 * meaning as the parameter DEFINITION array), and the ADR-0087 conversion
 * rewrites old object-form `params` pages onto it at load. The whitelists then
 * dropped it one hop before the runner, so a previously-working published page
 * POSTed an empty body.
 *
 * These tests assert at the two ends that matter: what the runner RECEIVES
 * (the forward itself) and what goes on the WIRE (the forward plus the runner's
 * merge order). A test that only checked the props would have passed while the
 * payload was still lost downstream.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import '../renderers/basic/elements';
import '../renderers/action/action-button';
import '../renderers/action/action-menu';

function Registered({ type, schema }: { type: string; schema: any }) {
  const C = ComponentRegistry.get(type);
  if (!C) throw new Error(`${type} not registered`);
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <C schema={schema} />;
}

describe('bodyExtra survives the renderer forward whitelist', () => {
  // Typed with the signature `ActionProvider`'s `handlers` prop declares, not
  // `ReturnType<typeof vi.fn>` — that resolves to the un-instantiated
  // `Mock<Procedure | Constructable>`, which no handler slot accepts and whose
  // `mock.calls[0]` is the EMPTY tuple, so `dispatched()` below read `undefined`
  // as far as the compiler was concerned (objectui#4040).
  let api: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

  beforeEach(() => {
    api = vi.fn(async () => ({ success: true }));
  });

  /** The ActionDef the runner was handed for the click. */
  const dispatched = () => api.mock.calls[0][0];

  it('element:button forwards bodyExtra to the runner', async () => {
    render(
      <ActionProvider handlers={{ api }}>
        <Registered
          type="element:button"
          schema={{
            type: 'element:button',
            properties: {
              label: 'Submit inquiry',
              action: {
                type: 'api',
                target: '/api/v1/forms/contact-us/submit',
                method: 'POST',
                bodyExtra: { name: '{{page.inquiryName}}', source: 'web' },
              },
            },
          }}
        />
      </ActionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Submit inquiry/i }));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(dispatched().bodyExtra).toEqual({ name: '{{page.inquiryName}}', source: 'web' });
  });

  it('action:button forwards bodyExtra off a declared ActionSchema', async () => {
    render(
      <ActionProvider handlers={{ api }}>
        <Registered
          type="action:button"
          schema={{
            actionType: 'api',
            name: 'revoke_key',
            label: 'Revoke',
            target: '/api/v1/sys_api_key/k1',
            method: 'PATCH',
            bodyExtra: { revoked: true },
          }}
        />
      </ActionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Revoke/i }));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(dispatched().bodyExtra).toEqual({ revoked: true });
  });

  it('action:menu forwards bodyExtra for an overflow item', async () => {
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
                name: 'close_order',
                label: 'Close order',
                target: '/api/v1/order/close',
                bodyExtra: { status: 'closed' },
              },
            ],
          }}
        />
      </ActionProvider>,
    );

    // Radix opens its dropdown on pointerdown, not click — same gesture the
    // form-widget tests use for a Radix Select trigger.
    fireEvent.pointerDown(screen.getByRole('button', { name: /More/i }), { button: 0 });
    const item = await screen.findByText(/Close order/i);
    fireEvent.click(item);
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(dispatched().bodyExtra).toEqual({ status: 'closed' });
  });
});

describe('bodyExtra wins over a deprecated object-form params, end to end', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({}) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('renders, clicks, and puts bodyExtra last on the wire', async () => {
    // No custom `api` handler here on purpose: the click has to travel the whole
    // chain — renderer whitelist, then the runner's own executeAPI body assembly —
    // so the merge order is asserted on the actual request body rather than on
    // props. `status` is declared in BOTH places with different values, which is
    // what makes a reversed merge red instead of a tie.
    render(
      <ActionProvider>
        <Registered
          type="element:button"
          schema={{
            type: 'element:button',
            properties: {
              label: 'Close order',
              action: {
                type: 'api',
                target: '/api/v1/order/close',
                method: 'PATCH',
                params: { status: 'draft', note: 'from the user' },
                bodyExtra: { status: 'closed', closed_at: '2026-08-09' },
              },
            },
          }}
        />
      </ActionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Close order/i }));
    await waitFor(() => expect(global.fetch as any).toHaveBeenCalledOnce());

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body).toEqual({
      status: 'closed',       // bodyExtra beat the same-named param
      note: 'from the user',  // the untouched param still rides along
      closed_at: '2026-08-09',
    });
  });
});
