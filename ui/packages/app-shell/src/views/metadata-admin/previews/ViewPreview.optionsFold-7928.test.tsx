// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7928 — the stored `options.KIND` bag is folded at `ViewPreview`,
 * the one door that relays a STORED list body into `object-view`'s `listViews`.
 *
 * Director ruling on objectui#7928 (comment 5856694523, Q1 A): the named-view
 * record is the protocol's strict `ObjectListViewSchema` by reference, which
 * refuses `options`, and `plugin-view` no longer reads `options` off a named
 * view. A stored list overlay may still carry the bag — the protocol declares it
 * on that wire (objectstack#20051) and objectui#10380 ruling A keeps it legal
 * there — so `ViewPreview` folds each `options.KIND` onto the top-level `KIND`
 * block before it builds the node, the TOP-LEVEL value winning per key.
 *
 * The lane cases below are the inverted objectui#8980 legacy-nesting pins
 * (`ObjectView.namedViewProtocolKeys-8980.test.tsx`) pointed at the fold: the
 * same stored body, captured as the node `ViewPreview` hands to
 * `SchemaRenderer`, then rendered through the REAL `plugin-view` `ObjectView`.
 * Before objectui#7928 that renderer read the bag itself; these assert it
 * resolves the same lane now that the fold does the work.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { safeValidateSchema } from '@object-ui/types/zod';
import { ObjectView } from '@object-ui/plugin-view';
import { ViewPreview, foldStoredListOptions } from './ViewPreview';

/** Every schema handed to `SchemaRenderer`, in order. */
const rendered: any[] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const ReactMod = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: ReactMod.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});

const dataSource = (): any => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
});

/**
 * ⚠️ `cleanup()` is load-bearing: without it a previously mounted view keeps
 * pushing into `rendered`, and the last entry answers the previous fixture
 * (the objectui#9242 trap, recorded in the objectui#8980 pin file too).
 */
function reset() {
  cleanup();
  rendered.length = 0;
}

/** The `object-view` node `ViewPreview` builds for a stored list body. */
function previewNode(config: Record<string, unknown>): any {
  reset();
  render(<ViewPreview type="view" name="board" draft={{ name: 'task.board', object: 'task', viewKind: 'list', config }} />);
  const node = rendered.find((s) => s?.type === 'object-view');
  expect(node, 'ViewPreview did not hand an object-view node to SchemaRenderer').toBeDefined();
  return node;
}

/** The node the REAL `plugin-view` `ObjectView` generates for that preview node. */
async function renderedKindNode(node: any): Promise<any> {
  reset();
  render(<ObjectView schema={node} dataSource={dataSource()} />);
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  return rendered[rendered.length - 1];
}

beforeEach(reset);

describe('objectui#7928 — `foldStoredListOptions`, the wire → named-view translation', () => {
  it('a body with no `options` comes back as the SAME object — nothing moves for the population that never carried the bag', () => {
    const body = { type: 'kanban', columns: ['name'], kanban: { groupByField: 'stage', columns: ['name'] } };
    expect(foldStoredListOptions(body)).toBe(body);
  });

  it('each `options.KIND` becomes the top-level `KIND` block, and `options` is not relayed', () => {
    const folded = foldStoredListOptions({ type: 'kanban', columns: ['name'], options: { kanban: { groupByField: 'legacy_lane' } } });
    expect(folded.kanban).toEqual({ groupByField: 'legacy_lane' });
    expect(folded).not.toHaveProperty('options');
  });

  it('TOP-LEVEL wins per key, and a key only the bag spells survives — the merge is per key, not wholesale', () => {
    const folded = foldStoredListOptions({
      type: 'kanban',
      columns: ['name'],
      kanban: { groupByField: 'canonical_lane' },
      options: { kanban: { groupByField: 'legacy_lane', titleField: 'subject' } },
    });
    expect(folded.kanban).toEqual({ groupByField: 'canonical_lane', titleField: 'subject' });
  });

  it('every view kind the protocol carries at the top level is folded', () => {
    const kinds = ['kanban', 'calendar', 'gallery', 'timeline', 'gantt', 'map', 'chart', 'tree'];
    const options = Object.fromEntries(kinds.map((k) => [k, { marker: k }]));
    const folded = foldStoredListOptions({ columns: ['name'], options });
    for (const k of kinds) expect(folded[k], k).toEqual({ marker: k });
  });

  it('a key under `options` that is not a view kind is not lifted to the top level', () => {
    // The protocol's stored bag carries per-kind blocks and nothing else
    // (objectstack#20051), and the renderer read nothing else from it.
    const folded = foldStoredListOptions({ columns: ['name'], options: { grid: { x: 1 }, zzqxNotAKind: true } });
    expect(folded).not.toHaveProperty('grid');
    expect(folded).not.toHaveProperty('zzqxNotAKind');
    expect(folded).not.toHaveProperty('options');
  });

  it('the input body is not mutated', () => {
    const body = { columns: ['name'], kanban: { groupByField: 'a' }, options: { kanban: { titleField: 'b' } } };
    const snapshot = JSON.parse(JSON.stringify(body));
    foldStoredListOptions(body);
    expect(body).toEqual(snapshot);
  });
});

describe('objectui#7928 — the inverted objectui#8980 legacy-nesting pins, pointed at the fold', () => {
  it('the legacy nesting alone resolves the lane — through the fold, on the real renderer', async () => {
    const node = previewNode({ type: 'kanban', columns: ['name'], options: { kanban: { groupByField: 'legacy_lane' } } });
    expect(node.listViews.board).not.toHaveProperty('options');
    expect(node.listViews.board.kanban).toEqual({ groupByField: 'legacy_lane' });
    const kanban = await renderedKindNode(node);
    expect(kanban.type).toBe('object-kanban');
    expect(kanban.groupBy).toBe('legacy_lane');
  });

  it('the canonical block WINS for a key both spell', async () => {
    const node = previewNode({
      type: 'kanban',
      columns: ['name'],
      kanban: { groupByField: 'canonical_lane' },
      options: { kanban: { groupByField: 'legacy_lane' } },
    });
    const kanban = await renderedKindNode(node);
    expect(kanban.groupBy).toBe('canonical_lane');
    expect(kanban.groupBy).not.toBe('legacy_lane');
  });

  it('a key the canonical block does NOT restate survives from the legacy nesting — the merge is per-key, not wholesale', async () => {
    const node = previewNode({
      type: 'kanban',
      columns: ['name'],
      kanban: { groupByField: 'canonical_lane' },
      options: { kanban: { titleField: 'subject' } },
    });
    const kanban = await renderedKindNode(node);
    expect(kanban.groupBy).toBe('canonical_lane');
    expect(kanban.titleField).toBe('subject');
  });

  it('CONTROL: without the fold, the same body on the same renderer does NOT resolve the lane', async () => {
    // The firing control for the three cases above: the stored body handed to
    // the renderer as-is, which is what `ViewPreview` did before the fold. The
    // renderer stopped reading `options` off a named view at objectui#7928, so
    // only the fold makes the cases above pass.
    const kanban = await renderedKindNode({
      type: 'object-view',
      objectName: 'task',
      listViews: { board: { type: 'kanban', columns: ['name'], options: { kanban: { groupByField: 'legacy_lane' } } } },
      defaultListView: 'board',
    });
    expect(kanban.groupBy).not.toBe('legacy_lane');
  });
});

describe('objectui#7928 — the node `ViewPreview` builds is one the contract accepts', () => {
  it('a stored body carrying the legacy bag becomes a named view `ObjectViewSchema` parses green', () => {
    const node = previewNode({
      type: 'kanban',
      columns: ['name'],
      options: { kanban: { groupByField: 'stage', columns: ['name'] } },
    });
    const r = safeValidateSchema(node);
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });

  it('CONTROL: the same body relayed unfolded is refused at `options`, by name', () => {
    const r = safeValidateSchema({
      type: 'object-view',
      objectName: 'task',
      listViews: { board: { label: 'Board', type: 'kanban', columns: ['name'], options: { kanban: { groupByField: 'stage', columns: ['name'] } } } },
    });
    expect(r.success).toBe(false);
    const issues = r.success ? [] : r.error.issues;
    const refusal = issues.find((i) => i.code === 'unrecognized_keys' && i.path.join('.') === 'listViews.board');
    expect(refusal, JSON.stringify(issues)).toBeDefined();
    expect((refusal as { keys?: string[] }).keys).toEqual(['options']);
  });
});
