// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11838 — the inspector's "Remove node" is refused, writing nothing,
 * while a boundary event's host or an expression root still names the node; the
 * refusal names each site under the button, the node stays selected, and the
 * refusal goes away once nothing names the node, when the removal goes through.
 *
 * Driven through the real component under a host that merges each patch
 * shallowly, as `FlowNodeInspector.renameExprRefs-11838.test.tsx` drives it.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { t, tFormat, type SupportedLocale } from '../i18n';
import type { MetadataSelection } from '../preview-registry';

afterEach(cleanup);

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

type Draft = Record<string, unknown>;
type Rec = Record<string, unknown>;

function mount(initial: Draft, select: MetadataSelection, locale: SupportedLocale = 'en-US') {
  const out = {
    patches: [] as Array<Record<string, unknown>>,
    cleared: 0,
    setDraft: null as null | ((d: Draft) => void),
    current: initial,
  };
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    out.setDraft = setDraft;
    return (
      <FlowNodeInspector
        type="flow"
        name="f"
        draft={draft}
        selection={select}
        onPatch={(patch) => {
          out.patches.push(patch);
          out.current = { ...out.current, ...patch };
          setDraft((d) => ({ ...d, ...patch }));
        }}
        onClearSelection={() => {
          out.cleared += 1;
        }}
        readOnly={false}
        locale={locale}
      />
    );
  }
  render(<Host />);
  return out;
}

const clickRemove = (locale: SupportedLocale = 'en-US') =>
  fireEvent.click(screen.getByRole('button', { name: t('engine.inspector.flowNode.remove', locale) }));
const refusal = () => screen.queryByRole('alert')?.textContent ?? null;

/** Approval `x`, read by a branch and attached to by a boundary event. */
function card(): Draft {
  return {
    name: 'f',
    label: 'F',
    type: 'autolaunched',
    nodes: [
      { id: 's', type: 'start', label: 'Start' },
      { id: 'x', type: 'approval', label: 'Approve', config: { approvers: [{ type: 'user', value: 'u1' }] } },
      { id: 'd', type: 'decision', label: 'Approved?', config: { conditions: [{ label: 'Yes', expression: "x.decision == 'approve'" }, { label: 'Else', expression: 'true' }] } },
      { id: 'be', type: 'boundary_event', label: 'On error', boundaryConfig: { attachedToNodeId: 'x', eventType: 'error' } },
      { id: 'e', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 's', target: 'x' },
      { id: 'e2', source: 'x', target: 'd' },
      { id: 'e3', source: 'd', target: 'e' },
      { id: 'e4', source: 'be', target: 'e' },
    ],
  };
}

const onX: MetadataSelection = { kind: 'node', id: 'x' };
const REFS = ['be › boundaryConfig.attachedToNodeId: `x`', "d › config.conditions[0].expression: `x.decision == 'approve'`"].join('; ');

describe('FlowNodeInspector — "Remove node" is refused while a boundary host or an expression names the node (objectui#11838)', () => {
  for (const locale of ['en-US', 'zh-CN'] as const) {
    it(`${locale}: the refusal names each site, nothing is written, and the node stays selected`, () => {
      const m = mount(card(), onX, locale);
      clickRemove(locale);
      expect(m.patches).toEqual([]);
      expect(m.cleared).toBe(0);
      expect(refusal()).toBe(tFormat('engine.inspector.flowNode.removeRefused', locale, { id: 'x', refs: REFS }));
    });
  }

  it('once nothing names the node the refusal goes, and the removal goes through', () => {
    const m = mount(card(), onX);
    clickRemove();
    expect(refusal()).not.toBeNull();
    const fixed = card();
    fixed.nodes = (fixed.nodes as Rec[])
      .filter((n) => n.id !== 'be')
      .map((n) => (n.id === 'd' ? { ...n, config: { conditions: [{ label: 'Else', expression: 'true' }] } } : n));
    fixed.edges = (fixed.edges as Rec[]).filter((e) => e.source !== 'be');
    act(() => m.setDraft!(fixed));
    expect(refusal()).toBeNull();
    clickRemove();
    expect(m.patches).toHaveLength(1);
    expect((m.patches[0].nodes as Rec[]).map((n) => n.id)).toEqual(['s', 'd', 'e']);
    expect(m.cleared).toBe(1);
  });

  it('control: a node only edges name is removed at once, with its edges', () => {
    const m = mount(card(), { kind: 'node', id: 'd' });
    clickRemove();
    expect(refusal()).toBeNull();
    expect(m.patches).toHaveLength(1);
    expect((m.patches[0].nodes as Rec[]).map((n) => n.id)).toEqual(['s', 'x', 'be', 'e']);
    expect(m.cleared).toBe(1);
  });
});
