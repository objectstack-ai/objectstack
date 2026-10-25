// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11838 — renaming a node in the inspector's ID field carries every
 * expression reference to the node's outputs in the SAME patch as the node and
 * its edges (objectui#11827), and refuses — writing nothing — when a
 * reference cannot be carried, naming it under the field.
 *
 * Driven through the real component under a host that merges each patch
 * shallowly — the `{ ...d, ...patch }` merge the Studio Automations pillar
 * applies, as `FlowNodeInspector.renameNode-11827.test.tsx` drives it.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

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
import { missingNodePositions } from '../previews/flow-node-refs';

afterEach(cleanup);

// The node inspectors read the object catalog (`/api/v1/meta/object`); answer
// every read as an absent engine, installed once for the whole file (the shape
// `RecordDetailView.approvalDeclaredActions.test.tsx` documents).
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

type Draft = Record<string, unknown>;
type Rec = Record<string, unknown>;

function mount(initial: Draft, select: MetadataSelection, locale: SupportedLocale = 'en-US') {
  const out = { patches: [] as Array<Record<string, unknown>>, current: initial };
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    const [selection, setSelection] = React.useState<MetadataSelection>(select);
    return (
      <FlowNodeInspector
        type="flow"
        name="f"
        draft={draft}
        selection={selection}
        onPatch={(patch) => {
          out.patches.push(patch);
          out.current = { ...out.current, ...patch };
          setDraft((d) => ({ ...d, ...patch }));
        }}
        onClearSelection={() => {}}
        onSelectionChange={(next) => {
          if (next) setSelection(next);
        }}
        readOnly={false}
        locale={locale}
      />
    );
  }
  render(<Host />);
  return { patches: out.patches, draft: () => out.current };
}

const idField = (locale: SupportedLocale = 'en-US') =>
  screen.getByLabelText(t('engine.inspector.flowNode.id', locale)) as HTMLInputElement;
function renameTo(next: string, locale: SupportedLocale = 'en-US') {
  fireEvent.change(idField(locale), { target: { value: next } });
  fireEvent.blur(idField(locale));
}
const refusal = () => screen.queryByRole('alert')?.textContent ?? null;

/** The card's flow: approval `x`, read by a decision branch, its edge guard and a record write. */
function card(): Draft {
  return {
    name: 'f',
    label: 'F',
    type: 'autolaunched',
    nodes: [
      { id: 's', type: 'start', label: 'Start' },
      { id: 'x', type: 'approval', label: 'Approve', config: { approvers: [{ type: 'user', value: 'u1' }] } },
      {
        id: 'd',
        type: 'decision',
        label: 'Approved?',
        config: { conditions: [{ label: 'Yes', expression: "x.decision == 'approve'" }, { label: 'Else', expression: 'true' }] },
      },
      { id: 'c', type: 'create_record', label: 'Log', config: { objectName: 'task', fields: { subject: '{x.comment}', note: '{{x.comment}}' } } },
      { id: 'e', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 's', target: 'x' },
      { id: 'e2', source: 'x', target: 'd' },
      { id: 'e3', source: 'd', target: 'c', condition: "x.decision == 'approve'", label: 'Yes' },
      { id: 'e4', source: 'd', target: 'e', isDefault: true },
      { id: 'e5', source: 'c', target: 'e' },
    ],
  };
}

const onX: MetadataSelection = { kind: 'node', id: 'x' };
const nodeOf = (d: Draft, id: string) => (d.nodes as Rec[]).find((n) => n.id === id)!;

describe('FlowNodeInspector — a rename carries the expressions that read the node (objectui#11838)', () => {
  it("the card's pin: x → renamed — the branch, the edge guard and the {{ }} hole follow in the one patch; a single-brace {x.comment} is literal and stays (objectui#12390)", () => {
    const m = mount(card(), onX);
    renameTo('renamed');
    expect(m.patches).toHaveLength(1);
    const d = m.draft();
    expect((nodeOf(d, 'd').config as Rec).conditions).toEqual([
      { label: 'Yes', expression: "renamed.decision == 'approve'" },
      { label: 'Else', expression: 'true' },
    ]);
    expect((nodeOf(d, 'c').config as Rec).fields).toEqual({ subject: '{x.comment}', note: '{{renamed.comment}}' });
    expect((d.edges as Rec[]).find((e) => e.id === 'e3')).toEqual({ id: 'e3', source: 'd', target: 'c', condition: "renamed.decision == 'approve'", label: 'Yes' });
    expect(missingNodePositions(d)).toEqual([]);
    expect(refusal()).toBeNull();
  });

  it('control: renaming a node nothing reads writes the node and its edges only', () => {
    const before = card();
    const m = mount(before, { kind: 'node', id: 'c' });
    renameTo('log_it');
    expect(m.patches).toHaveLength(1);
    const d = m.draft();
    for (const id of ['s', 'x', 'd', 'e']) expect(nodeOf(d, id)).toBe(nodeOf(before, id));
    expect((d.edges as Rec[]).filter((e) => e.source === 'log_it' || e.target === 'log_it').map((e) => e.id)).toEqual(['e3', 'e5']);
    expect(missingNodePositions(d)).toEqual([]);
  });

  for (const locale of ['en-US', 'zh-CN'] as const) {
    it(`${locale}: a reference that does not parse refuses the rename, naming it, and nothing is written`, () => {
      const draft = card();
      (nodeOf(draft, 'd').config as Rec).conditions = [{ label: 'Yes', expression: 'x.decision ==' }];
      const m = mount(draft, onX, locale);
      renameTo('renamed', locale);
      expect(m.patches).toEqual([]);
      expect(refusal()).toBe(
        tFormat('engine.inspector.flowNode.idRefsUnparsed', locale, {
          id: 'x',
          refs: 'd › config.conditions[0].expression: `x.decision ==`',
        }),
      );
      expect(idField(locale).value).toBe('x');
    });
  }

  it('a node id that is also a variable name refuses the rename, naming every reference', () => {
    const draft = card();
    draft.variables = [{ name: 'x', type: 'object' }];
    const m = mount(draft, onX);
    renameTo('renamed');
    expect(m.patches).toEqual([]);
    expect(refusal()).toContain(tFormat('engine.inspector.flowNode.idRefsAmbiguous', 'en-US', { name: 'x', refs: '' }).split(':')[0]);
    expect(refusal()).toContain('d → c › condition: `x.decision == \'approve\'`');
  });
});
