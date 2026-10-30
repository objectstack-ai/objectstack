// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27356 (hotcrm#2320 Studio S6) — publishing a flow edit said
 * "Also changed: ~ nodes". The drill-in compared every top-level key other
 * than `fields` whole, and a flow keeps all of its steps in one `nodes` list,
 * so any step edit read as the one word `nodes`.
 *
 * Both bodies are already read for the drill-in, and each node carries its
 * `id` and `label`, so a flow's `nodes` is now diffed per node, matched by
 * `id`: a row per node added, changed or removed, led by its label, and a
 * changed node names the properties that differ (`config` one level down).
 *
 * Controls: a reorder alone (no node differs) keeps the `nodes` key row, so a
 * real difference is never summarised as none; a list that is not keyed by
 * `id` keeps the key row; a non-flow item with a `nodes` key keeps it too;
 * and `edges` stays a key row.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
    language: 'en',
  }),
}));

import { DraftChangesPanel, computeChangeDetail } from '../DraftChangesPanel';

const START = { id: 'start', type: 'start', label: 'Start' };
const END = { id: 'end', type: 'end', label: 'End' };
const CREATE_TASK = {
  id: 'create_task',
  type: 'create_record',
  label: 'Create follow-up task',
  config: { objectName: 'task', fields: { subject: 'Call back' } },
};
const NOTIFY = { id: 'notify_owner', type: 'notify', label: 'Notify owner', config: { title: 'Heads up' } };

const PUBLISHED = {
  name: 'case_follow_up',
  label: 'Case follow-up',
  type: 'autolaunched',
  nodes: [START, CREATE_TASK, NOTIFY, END],
  edges: [{ id: 'e1', source: 'start', target: 'create_task' }],
};
const DRAFT = {
  ...PUBLISHED,
  nodes: [
    START,
    { ...CREATE_TASK, config: { ...CREATE_TASK.config, fields: { subject: 'Call back', due_date: 'today' } } },
    { id: 'wait_a_day', type: 'wait', config: { duration: 'P1D' } },
    END,
  ],
  edges: [{ id: 'e1', source: 'start', target: 'create_task' }, { id: 'e2', source: 'create_task', target: 'wait_a_day' }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("computeChangeDetail names a flow's nodes (objectstack#27356)", () => {
  it('lists the node added, the node changed with the property, and the node removed; `nodes` is no key row', () => {
    const d = computeChangeDetail(PUBLISHED, DRAFT, 'flow');
    expect(d.nodes).toEqual({
      added: [{ id: 'wait_a_day' }],
      changed: [{ id: 'create_task', label: 'Create follow-up task', keys: ['config.fields'] }],
      removed: [{ id: 'notify_owner', label: 'Notify owner' }],
    });
    expect(d.keys.changed).toEqual(['edges']);
  });

  it('a changed top-level node property is named as itself', () => {
    const draft = { ...PUBLISHED, nodes: [START, { ...CREATE_TASK, label: 'Create task' }, NOTIFY, END] };
    expect(computeChangeDetail(PUBLISHED, draft, 'flow').nodes?.changed).toEqual([
      { id: 'create_task', label: 'Create task', keys: ['label'] },
    ]);
  });

  it('a NEW flow adds every node', () => {
    expect(computeChangeDetail(null, PUBLISHED, 'flow').nodes?.added.map((n) => n.id)).toEqual([
      'create_task',
      'end',
      'notify_owner',
      'start',
    ]);
  });

  it('CONTROL: a reorder alone keeps the `nodes` key row, so the draft never reads unchanged', () => {
    const d = computeChangeDetail(PUBLISHED, { ...PUBLISHED, nodes: [END, NOTIFY, CREATE_TASK, START] }, 'flow');
    expect(d.nodes).toEqual({ added: [], changed: [], removed: [] });
    expect(d.keys.changed).toEqual(['nodes']);
  });

  it('CONTROL: a node list not keyed by `id` keeps the `nodes` key row', () => {
    const d = computeChangeDetail(PUBLISHED, { ...PUBLISHED, nodes: [START, { type: 'end' }] }, 'flow');
    expect(d.nodes).toBeNull();
    expect(d.keys.changed).toContain('nodes');
  });

  it('CONTROL: an item that is not a flow compares `nodes` whole', () => {
    const d = computeChangeDetail(PUBLISHED, DRAFT, 'page');
    expect(d.nodes).toBeNull();
    expect(d.keys.changed).toEqual(['edges', 'nodes']);
  });
});

/* ─────────────── the panel ─────────────── */

function stubServer() {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/_drafts')) {
        return ok({ drafts: [{ type: 'flow', name: 'case_follow_up', packageId: 'com.x', label: 'Case follow-up' }] });
      }
      if (/\/meta\/flow(\?|$)/.test(url)) return ok([{ name: 'case_follow_up' }]);
      if (/\/meta\/flow\/case_follow_up\b/.test(url)) return ok(url.includes('state=draft') ? { item: DRAFT } : PUBLISHED);
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch,
  );
}

describe('the publish drill-in of a flow edit (objectstack#27356)', () => {
  it('names each node by its label and the property changed, and never prints "~ nodes"', async () => {
    stubServer();
    render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" />);
    const toggle = (await screen.findByText('Case follow-up')).closest('[data-testid="draft-entry-toggle"]') as HTMLElement;
    fireEvent.click(toggle);
    const detail = await screen.findByTestId('draft-entry-detail');

    const rows = await within(detail).findAllByTestId('draft-node-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      '+ wait_a_day',
      '~ Create follow-up task create_task · config.fields',
      '− Notify owner notify_owner',
    ]);
    expect(within(rows[1]!).getByText('create_task')).toHaveClass('font-mono');
    expect(detail.textContent).not.toContain('~ nodes');
    // `edges` is still a key row under "Also changed:", by its flow form label
    // (objectstack#27835).
    expect(within(detail).getByText('Also changed:')).toBeInTheDocument();
    expect(within(detail).getByTestId('draft-key-row')).toHaveTextContent('~ Edges');
  });
});
