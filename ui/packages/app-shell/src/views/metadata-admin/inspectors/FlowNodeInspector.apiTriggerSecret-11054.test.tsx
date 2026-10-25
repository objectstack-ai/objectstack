// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11054 — what the author SEES on an inbound-hook (`api`) start node.
 *
 * 1. Choosing 「Webhook / API」 writes `triggerType: 'api'`, the token the
 *    engine routes (it used to write `webhook`, which binds nothing).
 * 2. The start node offers the hook's per-flow secret when the flow's trigger
 *    kind is `api` — by the select, or by a flow-level `type: 'api'`.
 * 3. The secret is WRITE-ONLY. A value already on the node is never put back
 *    into the control, revealed, or echoed in the Advanced JSON; leaving the
 *    control blank writes nothing, so a save that never touched it keeps the
 *    node's value (and, on a server that withholds the secret from reads and
 *    serves the node without the key, sends no key — which that server reads as
 *    "keep the stored secret").
 * 4. While the flow is api-kind and the draft holds no non-blank secret, a
 *    notice says the flow is refused without one; it clears once one is typed.
 *
 * Notice wording is not pinned — only its presence, by test id.
 *
 * The table half (option value, gate, resolver agreement) is pinned in
 * `flow-node-config.apiTrigger-11054.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { OBJECTUI_SECRET_MASK } from '../widgets';
import type { MetadataSelection } from '../preview-registry';

/* ── The `meta/object` double ─────────────────────────────────────────
 * An api start node shows the Object reference field, which lists objects via
 * `GET /api/v1/meta/object` through the GLOBAL `fetch`. Answered as an empty
 * registry by a RECORDING double — the shape
 * `FlowNodeInspector.inactiveRetained.test.tsx` documents in full — and any URL
 * outside that route fails the test in `afterEach` instead of vanishing into
 * the hook's `.catch`.
 * ──────────────────────────────────────────────────────────── */

const META_OBJECT_ROUTE = '/api/v1/meta/object';
let metaCalls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      metaCalls.push(url);
      if (routeOf(url) !== META_OBJECT_ROUTE) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ type: 'object', items: [] }) };
    }),
  );
});

afterEach(() => {
  expect(metaCalls.filter((url) => routeOf(url) !== META_OBJECT_ROUTE)).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

/** A marker standing in for a value already on the node. Not a credential. */
const HELD = 'value-already-on-the-node';

type Draft = Record<string, unknown>;

function flowWith(config: Record<string, unknown> | undefined, top: Record<string, unknown> = {}): Draft {
  const start: Record<string, unknown> = { id: 'start', type: 'start', label: 'Start' };
  if (config) start.config = config;
  return { name: 'inbound', label: 'Inbound', type: 'autolaunched', ...top, nodes: [start], edges: [] };
}

const startConfig = (draft: Draft) =>
  ((draft.nodes as Array<Record<string, unknown>>)[0].config ?? {}) as Record<string, unknown>;

/**
 * The editor loop: every patch is applied to the draft the inspector renders
 * next, as the host does. `latest()` is the draft a save would send.
 */
function mount(initial: Draft, readOnly = false) {
  let current = initial;
  const patches: Draft[] = [];
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    return (
      <FlowNodeInspector
        type="flow"
        name="inbound"
        draft={draft}
        selection={{ kind: 'node', id: 'start' } as MetadataSelection}
        onPatch={(patch) => {
          patches.push(patch);
          setDraft((d) => {
            current = { ...d, ...patch };
            return current;
          });
        }}
        onClearSelection={vi.fn()}
        readOnly={readOnly}
        locale="en-US"
      />
    );
  }
  const utils = render(<Host />);
  return { ...utils, patches, latest: () => current };
}

/** The secret control, named by its field label. */
const secretBox = () => screen.queryByLabelText('Secret') as HTMLInputElement | null;
const notice = () => screen.queryByTestId('unset-notice');

describe('choosing 「Webhook / API」 writes the routed token (objectui#11054)', () => {
  it('commits `triggerType: api` on the start node', async () => {
    const { latest } = mount(flowWith({ triggerType: 'manual' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Trigger' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Webhook / API' }));
    expect(startConfig(latest()).triggerType).toBe('api');
    // …and the panel now offers the secret the engine requires for it.
    expect(secretBox()).not.toBeNull();
  });
});

describe('the secret field appears only for an api-kind flow (objectui#11054)', () => {
  it('appears for a start-node `triggerType: api`', () => {
    mount(flowWith({ triggerType: 'api' }));
    expect(secretBox()).not.toBeNull();
  });

  it('appears for a flow-level `type: api` whose start node names no trigger', () => {
    mount(flowWith(undefined, { type: 'api' }));
    expect(secretBox()).not.toBeNull();
  });

  it('does not appear for a record, schedule or manual trigger', () => {
    for (const config of [
      { triggerType: 'record-after-create', objectName: 'task' },
      { triggerType: 'schedule', schedule: { expression: '0 7 * * *' } },
      { triggerType: 'manual' },
    ]) {
      mount(flowWith(config));
      expect(secretBox(), JSON.stringify(config)).toBeNull();
      cleanup();
    }
  });
});

describe('the secret is write-only (objectui#11054)', () => {
  it('never renders a value already on the node — not in the control, not revealed, not in Advanced JSON', () => {
    const { container } = mount(flowWith({ triggerType: 'api', secret: HELD, hookId: 'intake' }));
    const box = secretBox()!;
    expect(box).not.toBeNull();
    expect(box.value).toBe('');
    // It says a value is set, through the widget's own stored-state hint.
    expect(box.getAttribute('placeholder')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }));
    expect(box.value).toBe('');
    // The Advanced block still shows the node's OTHER unowned keys — the control
    // that the absence below is not an empty panel.
    expect(container.innerHTML).toContain('intake');
    expect(container.innerHTML).not.toContain(HELD);
  });

  it('a save that never touched the control keeps the value on the node', () => {
    const { latest, patches } = mount(flowWith({ triggerType: 'api', secret: HELD }));
    // Edit a different field on the same node.
    fireEvent.change(screen.getByDisplayValue('Start'), { target: { value: 'On post' } });
    expect(patches.length).toBeGreaterThan(0);
    expect(startConfig(latest()).secret).toBe(HELD);
  });

  it('a node served WITHOUT the key gains no key from an edit that never touched the control', () => {
    const { latest, patches } = mount(flowWith({ triggerType: 'api' }));
    fireEvent.change(screen.getByDisplayValue('Start'), { target: { value: 'On post' } });
    expect(patches.length).toBeGreaterThan(0);
    expect('secret' in startConfig(latest())).toBe(false);
  });

  it('typing commits the new value; erasing it goes back to the held one', () => {
    const { latest } = mount(flowWith({ triggerType: 'api', secret: HELD }));
    const box = secretBox()!;
    fireEvent.change(box, { target: { value: 'typed-replacement' } });
    expect(startConfig(latest()).secret).toBe('typed-replacement');
    fireEvent.change(secretBox()!, { target: { value: '' } });
    expect(startConfig(latest()).secret).toBe(HELD);
  });

  it('blank with nothing held writes no key — never an empty string, never the mask', () => {
    const { latest, patches } = mount(flowWith({ triggerType: 'api' }));
    fireEvent.change(secretBox()!, { target: { value: 'x' } });
    fireEvent.change(secretBox()!, { target: { value: '' } });
    expect(patches.length).toBe(2);
    const config = startConfig(latest());
    expect('secret' in config).toBe(false);
    for (const p of patches) expect(JSON.stringify(p)).not.toContain(OBJECTUI_SECRET_MASK);
  });

  it('Clear drops the held value from the draft', () => {
    const { latest } = mount(flowWith({ triggerType: 'api', secret: HELD }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect('secret' in startConfig(latest())).toBe(false);
  });

  it('a read-only inspector renders the control disabled and writes nothing', () => {
    const { patches } = mount(flowWith({ triggerType: 'api', secret: HELD }), true);
    expect(secretBox()!.disabled).toBe(true);
    expect(patches).toHaveLength(0);
  });
});

describe('the missing-secret notice appears and clears (objectui#11054)', () => {
  it('appears on an api-kind start node with no secret, and clears once one is typed', () => {
    mount(flowWith({ triggerType: 'api' }));
    expect(notice()).not.toBeNull();
    fireEvent.change(secretBox()!, { target: { value: 'typed-value' } });
    expect(notice()).toBeNull();
  });

  it('stays up for a whitespace-only value, which the engine also refuses', () => {
    mount(flowWith({ triggerType: 'api' }));
    fireEvent.change(secretBox()!, { target: { value: '   ' } });
    expect(notice()).not.toBeNull();
  });

  it('does not appear when the node already carries a secret', () => {
    mount(flowWith({ triggerType: 'api', secret: HELD }));
    expect(secretBox()).not.toBeNull();
    expect(notice()).toBeNull();
  });

  it('does not appear on a start node whose flow is not api-kind', () => {
    mount(flowWith({ triggerType: 'manual' }));
    expect(notice()).toBeNull();
  });

  it('sits beside the secret control, not elsewhere on the panel', () => {
    mount(flowWith({ triggerType: 'api' }));
    const row = secretBox()!.closest('.space-y-1')!.parentElement!;
    expect(within(row).queryByTestId('unset-notice')).not.toBeNull();
  });
});
