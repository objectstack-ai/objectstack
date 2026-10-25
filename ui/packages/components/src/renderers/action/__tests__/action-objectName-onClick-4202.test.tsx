/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4202 — the four declared action surfaces carry `objectName` to the
 * runner, and the three that ignored `onClick` now honour it the way
 * `action:menu` always did.
 *
 * ## `objectName`: where the action LANDS, not only what the runner is handed
 *
 * Spec `ActionSchema.objectName` is "Target object this action belongs to".
 * Every console consumer resolves its dispatch target as `action.objectName ||
 * <page object>`, and the one these pins drive is the real, published one:
 * `@object-ui/core`'s `createServerActionHandler`, which builds
 * `/api/v1/actions/{object}/{action}` from `action.objectName ||
 * resolveObject(…)`. The console registers exactly this factory as its
 * `script` handler, with `resolveObject` answering the page's object — so the
 * harness below is that registration with the transport stubbed, not a model
 * of it.
 *
 * Each surface gets a PAIR that varies only the declaration:
 *
 *   - declared — a `crm_contact` action rendered on a `crm_account` page POSTs
 *     to `/api/v1/actions/crm_contact/…`. Before objectui#4202 the whitelist
 *     dropped the key and the same click POSTed to `crm_account`: the action
 *     acted on the page's object, with no error anywhere.
 *   - control — the same action declaring no `objectName` still POSTs to the
 *     page's object. That is the behaviour every existing action keeps.
 *
 * Both rows assert the forwarded def AND the URL. The def alone would pass a
 * consumer that ignores the key; the URL alone would pass a harness whose
 * `resolveObject` happened to answer the declared name. Each row asserts the
 * dispatch ran exactly once before reading either, so a zero reading cannot be
 * "nothing was clicked".
 *
 * ## `onClick`: invoked, and the engine never consulted
 *
 * `UIActionSchema.onClick` is the UI-local escape hatch — a function, so it
 * reaches these renderers only from a code-composed schema (an `action:bar`
 * member is spread onto its renderer whole). Its documented precedence is over
 * `type` / `target`, and `action:menu` (and `page:header`) honour it by calling
 * it and returning before the runner. The runner's own read of `onClick` is a
 * last fallback AFTER a registered handler for the declared type, so forwarding
 * the key would not have honoured it; the three surfaces call it instead.
 *
 * The fixture declares `type: 'script'` with a registered `script` handler AND
 * a `confirmText`, so a surface that routed through the engine would both ask
 * for confirmation and dispatch. Each row asserts the callback ran exactly once
 * (the positive control), then that neither engine step happened.
 * `action:menu` is in the table as the reference: it had the branch before this
 * card, so its row passing is what proves the harness can observe the outcome.
 *
 * `action:group` is driven in its inline mode. Both display modes reach the
 * runner through the group's one `handleExecute`, which is where the branch
 * sits; the dropdown's Radix portal is flaky to open in happy-dom (see
 * `action-group-dropdown-visible.test.tsx`). `action:menu` rows use
 * `autoTrigger`, which runs the identical `handleExecute` a click on the item
 * calls without opening the dropdown — the shape `action-onSuccess-forward`
 * already uses.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry, createServerActionHandler } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult, ServerActionFetch } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// Module-scope side-effect imports — these renderers register themselves with
// the ComponentRegistry, and the light `dom` project does not load the
// `@object-ui/components` graph. Module scope, not a `beforeAll`, per
// AGENTS.md §测试纪律.
import '../action-button';
import '../action-icon';
import '../action-group';
import '../action-menu';

/** The page the action is rendered on — what `resolveObject` answers. */
const PAGE_OBJECT = 'crm_account';
/** The object the action declares it acts on — a child of the page's object. */
const DECLARED_OBJECT = 'crm_contact';

const ACTION_NAME = 'send_welcome';
const LABEL = 'Send welcome';

/** A spec-shaped action (execution type spelled `type`, as inside `actions`). */
const declaration = (extra: Record<string, unknown> = {}) => ({
  name: ACTION_NAME,
  label: LABEL,
  type: 'script',
  ...extra,
});

/**
 * The standalone NODE shape for the two leaf surfaces (objectui#7415): `type`
 * is the component id there and the execution type is `actionType`. See
 * `action-onSuccess-forward.test.tsx` for the same split.
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

type Surface = 'action:button' | 'action:icon' | 'action:group' | 'action:menu';

/** Everything `ActionProvider` takes except the subtree — typed, so a misspelt prop fails `tsc`. */
type ProviderProps = Omit<React.ComponentProps<typeof ActionProvider>, 'children'>;

/** Mount one surface carrying `decl`, and fire it the way that surface is fired. */
function mountAndFire(kind: Surface, decl: Record<string, unknown>, providerProps: ProviderProps) {
  const node =
    kind === 'action:button' || kind === 'action:icon'
      ? surface(kind, asNode(kind, decl))
      : kind === 'action:group'
        ? surface(kind, { type: 'action:group', actions: [decl] })
        : surface(kind, { type: 'action:menu', actions: [{ ...decl, autoTrigger: true }] });

  render(<ActionProvider {...providerProps}>{node}</ActionProvider>);

  if (kind !== 'action:menu') fireEvent.click(screen.getByRole('button', { name: LABEL }));
}

const SURFACES: Surface[] = ['action:button', 'action:icon', 'action:group', 'action:menu'];

// ── objectName ──────────────────────────────────────────────────────────────

let transport: Mock<ServerActionFetch>;
let script: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

beforeEach(() => {
  transport = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: {} }),
  }));
  // The console's registration, transport stubbed: `resolveObject` answers
  // the PAGE's object, exactly as `useConsoleActionRuntime` wires it.
  const dispatch = createServerActionHandler({
    fetch: transport,
    resolveObject: () => PAGE_OBJECT,
  });
  script = vi.fn((action: ActionDef, ctx: ActionContext) => dispatch(action, ctx));
});

/** Where the one POST went, after proving there was exactly one. */
async function landed(): Promise<{ def: ActionDef; url: string }> {
  await waitFor(() => expect(script).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  return { def: script.mock.calls[0][0], url: transport.mock.calls[0][0] };
}

describe('ActionSchema.objectName decides which object the action acts on, on every declared surface (#4202)', () => {
  const providerProps = (): ProviderProps => ({
    handlers: { script },
    // The console seeds the page's object into the runner context too.
    context: { objectName: PAGE_OBJECT },
    onToast: vi.fn(),
  });

  it.each(SURFACES)('%s — a declared objectName is where the action lands', async (kind) => {
    mountAndFire(kind, declaration({ objectName: DECLARED_OBJECT }), providerProps());

    const { def, url } = await landed();
    expect(def.objectName, `${kind} dropped objectName one hop before the runner`).toBe(DECLARED_OBJECT);
    expect(url).toBe(`/api/v1/actions/${DECLARED_OBJECT}/${ACTION_NAME}`);
  });

  it.each(SURFACES)('%s — control: an action declaring no objectName still lands on the page object', async (kind) => {
    mountAndFire(kind, declaration(), providerProps());

    const { def, url } = await landed();
    expect(def.objectName).toBeUndefined();
    expect(url).toBe(`/api/v1/actions/${PAGE_OBJECT}/${ACTION_NAME}`);
  });
});

// ── onClick ─────────────────────────────────────────────────────────────────

describe('onClick is the UI-local escape hatch on every declared surface: invoked, engine bypassed (#4202)', () => {
  it.each(SURFACES)('%s — calls onClick and never reaches the runner', async (kind) => {
    const onClick = vi.fn(async () => {});
    const engineHandler = vi.fn(async () => ({ success: true }) as ActionResult);
    const onConfirm = vi.fn(async () => true);

    mountAndFire(kind, declaration({ onClick, confirmText: 'Really send?' }), {
      handlers: { script: engineHandler },
      onConfirm,
      onToast: vi.fn(),
    });

    // Positive control first: the callback ran, so the surface WAS fired.
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    // …and nothing of the engine happened: no confirmation, no dispatch.
    expect(onConfirm, `${kind} routed an onClick action through the engine's confirm step`).not.toHaveBeenCalled();
    expect(engineHandler, `${kind} dispatched an onClick action to the runner`).not.toHaveBeenCalled();
  });
});
