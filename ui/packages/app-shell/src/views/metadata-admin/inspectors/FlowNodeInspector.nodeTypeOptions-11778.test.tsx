// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11778 — the inspector's Node Type select offers the add-node
 * palette's list, with the palette's display names.
 *
 * It was a hand list (`FLOW_NODE_TYPE_OPTIONS`) that left out `notify`, so a
 * node could not be turned into the Notify the palette adds, and it showed raw
 * type names (`http_request`, `connector_action`, `try_catch`). The palette
 * hook runs for real here: the engine overlay answers "absent" (the palette's
 * offline answer is the hardcoded `NODE_PALETTE`) except in the one case that
 * serves an engine descriptor, which the select must then offer too.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { NODE_PALETTE } from '../previews/flow-canvas-parts';
import { t, type SupportedLocale } from '../i18n';
import type { MetadataSelection } from '../preview-registry';

const ACTIONS_ROUTE = '/api/v1/automation/actions';
let engineActions: unknown[] | null = null;

beforeEach(() => {
  engineActions = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input).split('?')[0];
      if (url === ACTIONS_ROUTE && engineActions) {
        return new Response(JSON.stringify({ data: { actions: engineActions } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Node = { id: string; type: string; label?: string };

function mount(node: Node, locale: SupportedLocale = 'en-US') {
  const onPatch = vi.fn();
  render(
    <FlowNodeInspector
      type="flow"
      name="f"
      draft={{ nodes: [{ id: 'start', type: 'start', label: 'Start' }, node], edges: [] }}
      selection={{ kind: 'node', id: node.id } as MetadataSelection}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale={locale}
    />,
  );
  return { onPatch };
}

const typeSelect = (locale: SupportedLocale = 'en-US') =>
  screen.getByRole('combobox', { name: t('engine.inspector.flowNode.type', locale) });

async function optionNames(locale: SupportedLocale = 'en-US'): Promise<string[]> {
  await userEvent.click(typeSelect(locale));
  return (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
}

describe('the Node Type select is the palette\'s list (objectui#11778)', () => {
  it('offers every palette type under its display name, in the palette\'s order — Notify included', async () => {
    mount({ id: 'n1', type: 'create_record', label: 'Create record' });
    const names = await optionNames();
    // Derived from the palette's own registry, never restated.
    expect(names).toEqual(NODE_PALETTE.map((p) => p.label));
    expect(names).toContain('Notify');
  });

  it('shows no raw type name — not even for the types the hand list spelled raw', async () => {
    mount({ id: 'n1', type: 'create_record', label: 'Create record' });
    const names = await optionNames();
    for (const raw of ['http', 'connector_action', 'try_catch', 'create_record', 'notify']) {
      expect(names, raw).not.toContain(raw);
    }
  });

  it('picking Notify turns the node into a notify node', async () => {
    const { onPatch } = mount({ id: 'n1', type: 'create_record', label: 'Create record' });
    await optionNames();
    await userEvent.click(screen.getByRole('option', { name: 'Notify' }));
    expect(onPatch).toHaveBeenCalled();
    const patch = onPatch.mock.calls.at(-1)![0] as { nodes: Node[] };
    expect(patch.nodes.find((n) => n.id === 'n1')!.type).toBe('notify');
  });

  it('zh-CN reads the palette\'s localized names', async () => {
    mount({ id: 'n1', type: 'create_record', label: '创建记录' }, 'zh-CN');
    const names = await optionNames('zh-CN');
    expect(names).toContain('通知');
    expect(names).toContain('创建记录');
    expect(names).not.toContain('Notify');
  });

  it('a stored type the palette does not offer shows under its display name, for that node only', async () => {
    mount({ id: 'start2', type: 'start', label: 'Begin' });
    expect(typeSelect().textContent, 'the trigger names the type, not the raw `start`').toBe('Start');
    const names = await optionNames();
    expect(names.filter((n) => n === 'Start')).toHaveLength(1);
    cleanup();
    mount({ id: 'n1', type: 'create_record', label: 'Create record' });
    expect(await optionNames(), 'another node is not offered Start').not.toContain('Start');
  });

  it('an engine-published node type joins the list, as it joins the palette', async () => {
    engineActions = [{ type: 'map', name: 'Map items', description: 'Run a subflow per item', paradigms: ['flow'] }];
    mount({ id: 'n1', type: 'create_record', label: 'Create record' });
    // The engine answers after the first paint; let its answer land first.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(await optionNames()).toContain('Map items');
  });
});
