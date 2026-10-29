// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25923 — a stored list overlay's `options` bag is folded on READ,
 * by the server, so `ViewPreview` relays the body it is handed and folds
 * nothing.
 *
 * objectui#7928 (Director ruling, comment 5856694523, Q1 A) put a fold here:
 * the named-view record is the protocol's strict `ObjectListViewSchema` by
 * reference, which refuses `options`, and `plugin-view` reads no `options` off
 * a named view, so `ViewPreview` lifted each stored `options.KIND` onto the
 * top-level `KIND` block, the TOP-LEVEL value winning per key. objectstack#25923
 * retired the bag: the spec's ADR-0087 D2 conversion
 * `list-view-options-bag-folded` does that same fold before a stored row is
 * served, and this door's `foldStoredListOptions` was deleted.
 *
 * The lane cases below are the objectui#7928 pins (themselves the inverted
 * objectui#8980 legacy-nesting pins) with each stored row run through the
 * spec's OWN stored-item conversion first, which is the body this preview now
 * receives. The node `ViewPreview` hands `SchemaRenderer` is then rendered
 * through the REAL `plugin-view` `ObjectView`, as before.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { safeValidateSchema } from '@object-ui/types/zod';
import { ObjectView } from '@object-ui/plugin-view';
import { applyConversionsToStoredItem } from '@objectstack/spec';
import { ViewPreview } from './ViewPreview';

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

/**
 * The `config` body the preview receives for a stored flattened list overlay:
 * the row as the server serves it, after the spec's stored-item conversions.
 */
function served(body: Record<string, unknown>): Record<string, unknown> {
  const row = applyConversionsToStoredItem('view', structuredClone({ name: 'task.board', object: 'task', viewKind: 'list', ...body }));
  const { name: _n, object: _o, viewKind: _k, ...config } = row as Record<string, unknown>;
  return config;
}

beforeEach(reset);

describe('objectstack#25923 — the stored row arrives folded, and `ViewPreview` relays it as served', () => {
  it('a body with no `options` is served unchanged, and relayed as the named view with its label', () => {
    const body = { type: 'kanban', columns: ['name'], kanban: { groupByField: 'stage', columns: ['name'] } };
    expect(served(body)).toEqual(body);
    const node = previewNode(served(body));
    expect(node.listViews.board).toEqual({ ...body, label: 'board' });
  });

  it('each stored `options.KIND` is served as the top-level `KIND` block, and `options` is gone', () => {
    const config = served({ type: 'kanban', columns: ['name'], options: { kanban: { groupByField: 'legacy_lane' } } });
    expect(config.kanban).toEqual({ groupByField: 'legacy_lane' });
    expect(config).not.toHaveProperty('options');
  });

  it('TOP-LEVEL wins per key, and a key only the bag spells survives — the merge is per key, not wholesale', () => {
    const config = served({
      type: 'kanban',
      columns: ['name'],
      kanban: { groupByField: 'canonical_lane' },
      options: { kanban: { groupByField: 'legacy_lane', titleField: 'subject' } },
    });
    expect(config.kanban).toEqual({ groupByField: 'canonical_lane', titleField: 'subject' });
  });

  it('every view kind the protocol carries at the top level is folded', () => {
    const kinds = ['kanban', 'calendar', 'gallery', 'timeline', 'gantt', 'map', 'chart', 'tree'];
    const options = Object.fromEntries(kinds.map((k) => [k, { marker: k }]));
    const config = served({ columns: ['name'], options });
    for (const k of kinds) expect(config[k], k).toEqual({ marker: k });
    expect(config).not.toHaveProperty('options');
  });

  it('a key under `options` that is not a view kind is not lifted to the top level', () => {
    // The bag carried per-kind blocks and nothing else (objectstack#20051); the
    // conversion leaves the rest in place for the author, it invents no key.
    const config = served({ columns: ['name'], options: { grid: { x: 1 }, zzqxNotAKind: true } });
    expect(config).not.toHaveProperty('grid');
    expect(config).not.toHaveProperty('zzqxNotAKind');
  });
});

describe('objectui#7928 — the inverted objectui#8980 legacy-nesting pins, on the served row', () => {
  it("the legacy nesting alone resolves the lane — through the server's fold, on the real renderer", async () => {
    const node = previewNode(served({ type: 'kanban', columns: ['name'], options: { kanban: { groupByField: 'legacy_lane' } } }));
    expect(node.listViews.board).not.toHaveProperty('options');
    expect(node.listViews.board.kanban).toEqual({ groupByField: 'legacy_lane' });
    const kanban = await renderedKindNode(node);
    expect(kanban.type).toBe('object-kanban');
    expect(kanban.groupBy).toBe('legacy_lane');
  });

  it('the canonical block WINS for a key both spell', async () => {
    const node = previewNode(served({
      type: 'kanban',
      columns: ['name'],
      kanban: { groupByField: 'canonical_lane' },
      options: { kanban: { groupByField: 'legacy_lane' } },
    }));
    const kanban = await renderedKindNode(node);
    expect(kanban.groupBy).toBe('canonical_lane');
    expect(kanban.groupBy).not.toBe('legacy_lane');
  });

  it('a key the canonical block does NOT restate survives from the legacy nesting — the merge is per-key, not wholesale', async () => {
    const node = previewNode(served({
      type: 'kanban',
      columns: ['name'],
      kanban: { groupByField: 'canonical_lane' },
      options: { kanban: { titleField: 'subject' } },
    }));
    const kanban = await renderedKindNode(node);
    expect(kanban.groupBy).toBe('canonical_lane');
    expect(kanban.titleField).toBe('subject');
  });

  it('CONTROL: `ViewPreview` folds nothing — an UNFOLDED body on the same renderer does NOT resolve the lane', async () => {
    // The firing control for the three cases above: the stored body handed to
    // the preview as written, skipping the server's conversion. The renderer
    // reads no `options` off a named view (objectui#7928) and this door no
    // longer lifts the bag (objectstack#25923), so only the served fold makes
    // the cases above pass.
    const node = previewNode({ type: 'kanban', columns: ['name'], options: { kanban: { groupByField: 'legacy_lane' } } });
    expect(node.listViews.board).not.toHaveProperty('kanban');
    const kanban = await renderedKindNode(node);
    expect(kanban.groupBy).not.toBe('legacy_lane');
  });
});

describe('objectui#7928 — the node `ViewPreview` builds is one the contract accepts', () => {
  it('a stored body carrying the legacy bag, as served, becomes a named view `ObjectViewSchema` parses green', () => {
    const node = previewNode(served({
      type: 'kanban',
      columns: ['name'],
      options: { kanban: { groupByField: 'stage', columns: ['name'] } },
    }));
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
