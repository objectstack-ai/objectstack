/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Kanban `conditionalFormatting` is authored where it is DECLARED, and nowhere
 * else (objectui#5248).
 *
 * ## What this pins, and why it is a contract test rather than a refactor test
 *
 * `generateViewSchema`'s kanban branch resolves the rule list from ONE
 * declared place: the active view's own `conditionalFormatting` — the view
 * definition declares it, and it is what Studio's CEL editor writes.
 *
 * ⚠️ objectui#6152 round 15: a second link, the per-kind block's
 * `kanban.conditionalFormatting`, used to win over it, on the reading that
 * `ObjectKanbanSchema` declares the key. That declaration is the
 * `object-kanban` NODE's (its pin is
 * `packages/types/src/__tests__/kanban-conditional-formatting.test.ts`), not
 * the list view's kanban block: the protocol's block is `groupByField` /
 * `columns` / `titleField` / `summarizeField`, and every door that judges it
 * refuses `kanban.conditionalFormatting` by name. The read retired; its two
 * arms below were TURNED, not deleted.
 *
 * A third link used to sit at the end: `(schema as any).conditionalFormatting`,
 * read straight off the `object-view` node. Nothing declared it —
 * `ObjectViewSchema` has no such member, the `object-view` registry
 * registration does not publish it in `inputs`, and `BaseSchema`'s index
 * signature meant tsc said nothing either. It was honoured anyway, because this
 * branch runs exactly when no host supplied `renderListView` — the path the
 * REGISTERED renderer takes.
 *
 * That made it the one counter-example to the objectui#5097 exemption, whose
 * stated basis is that its 27 keys are reachable only through the host-supplied
 * delegation. Maintainer ruling 2026-08-19 (verbatim 「全部接受」, recorded on
 * objectui#5248): Option 2, gated on a liveness check — Option 1 (declare the
 * key on `ObjectViewSchema` + registry `inputs`) had the check found real
 * authored usage. The check came back empty, so the read was dropped.
 *
 * ## The half that must NOT move
 *
 * The key stays HOST surface. The `renderListView` delegation still reads it
 * off the object-view node and forwards it to the host's list renderer — a
 * stored app-shell document that carries it must keep working. The last
 * describe below is that half, asserted from the same file so the two cannot
 * drift apart: narrowing one is a ruling, narrowing both is a bug.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

/** Every schema the view hands to SchemaRenderer, in order. */
const rendered: any[] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const dataSource = (): any => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
});

/** The two authoring shapes, distinct enough that a mix-up is visible. */
const TOP_LEVEL_RULE = [{ condition: "record.stage == 'won'", style: { backgroundColor: '#top' } }];
const VIEW_LEVEL_RULE = [{ condition: "record.stage == 'won'", style: { backgroundColor: '#view' } }];
const NESTED_RULE = [{ condition: "record.stage == 'won'", style: { backgroundColor: '#nested' } }];

/**
 * Renders a kanban view through the REGISTERED renderer's path — i.e. with no
 * `renderListView` — and returns the `object-kanban` node the branch emits.
 */
async function renderKanbanView(opts: {
  schemaExtras?: Record<string, unknown>;
  view?: Record<string, unknown>;
}): Promise<any> {
  rendered.length = 0;
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task', ...(opts.schemaExtras ?? {}) } as unknown as ObjectViewSchema}
      views={[{ id: 'k', label: 'Board', type: 'kanban' as any, kanban: { groupByField: 'stage' }, ...(opts.view ?? {}) }] as any}
      dataSource={dataSource()}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  const node = rendered[rendered.length - 1];
  expect(node.type).toBe('object-kanban');
  return node;
}

describe('the kanban branch reads `conditionalFormatting` only where it is declared (objectui#5248)', () => {
  it('a TOP-LEVEL rule on the object-view node does not reach the kanban node', async () => {
    const node = await renderKanbanView({ schemaExtras: { conditionalFormatting: TOP_LEVEL_RULE } });

    expect(
      Object.prototype.hasOwnProperty.call(node, 'conditionalFormatting'),
      'A `conditionalFormatting` written at the TOP LEVEL of an object-view node reached the kanban\n'
        + 'node again. Nothing declares that key there: it is not a member of ObjectViewSchema, the\n'
        + '`object-view` registration does not publish it in `inputs`, and BaseSchema\'s index\n'
        + 'signature keeps tsc silent — so honouring it is the "renderer reads it, manifest denies\n'
        + 'it" condition. Ruled out on objectui#5248 (2026-08-19). Author it on the\n'
        + 'view, as its view-level `conditionalFormatting` (objectui#6152 round 15).',
    ).toBe(false);
    expect(node.conditionalFormatting).toBeUndefined();
  });

  it('the VIEW-level rule still reaches the kanban node', async () => {
    const node = await renderKanbanView({ view: { conditionalFormatting: VIEW_LEVEL_RULE } });
    expect(node.conditionalFormatting).toEqual(VIEW_LEVEL_RULE);
  });

  // TURNED (objectui#6152 round 15): read `toEqual(NESTED_RULE)`.
  it('the NESTED `kanban.conditionalFormatting` rule no longer reaches the kanban node (objectui#6152 round 15)', async () => {
    const node = await renderKanbanView({
      view: { kanban: { groupByField: 'stage', conditionalFormatting: NESTED_RULE } },
    });
    expect(Object.prototype.hasOwnProperty.call(node, 'conditionalFormatting')).toBe(false);
    // The branch still built the board from the same block: a nested key that
    // vanished with the whole node would pass the line above as well.
    expect(node.groupBy).toBe('stage');
  });

  // TURNED (objectui#6152 round 15): read "nested wins over view-level" and
  // `toEqual(NESTED_RULE)`. The view-level rule is now the only one read.
  it('the view-level rule is the one read: a nested block rule does not displace it, nor does a top-level key', async () => {
    const node = await renderKanbanView({
      schemaExtras: { conditionalFormatting: TOP_LEVEL_RULE },
      view: {
        conditionalFormatting: VIEW_LEVEL_RULE,
        kanban: { groupByField: 'stage', conditionalFormatting: NESTED_RULE },
      },
    });
    expect(node.conditionalFormatting).toEqual(VIEW_LEVEL_RULE);
  });

  it('a top-level key does not fill in for a view that declares none', async () => {
    // The chain is the view-level key alone (the nested link retired in
    // objectui#6152 round 15). With it absent the answer is "no conditional
    // formatting", not "fall back to the undeclared
    // top-level key" — this is the case the dropped read used to serve, and the
    // only one whose behaviour objectui#5248 changes.
    const withTop = await renderKanbanView({ schemaExtras: { conditionalFormatting: TOP_LEVEL_RULE } });
    const withoutTop = await renderKanbanView({});
    expect(withTop.conditionalFormatting).toEqual(withoutTop.conditionalFormatting);
    expect(withoutTop.conditionalFormatting).toBeUndefined();
  });

  it('the other kanban resolution is untouched — groupBy and card fields still flow', async () => {
    // The control. Without it, every assertion above would pass just as happily
    // against a kanban branch that had stopped emitting anything at all.
    const node = await renderKanbanView({
      view: { kanban: { groupByField: 'stage', columns: ['name', 'amount'], titleField: 'name' } },
    });
    expect(node.groupBy).toBe('stage');
    // TURNED, not deleted (objectui#7773). This line read
    // `expect(node.groupField).toBe('stage')` and pinned a duplicate write the
    // `object-kanban` renderer never read — the key objectui#7322 retired on
    // that node (`groupField?: never` / `retirementTombstone()`). Kept in place
    // and inverted so the history stays legible and so re-adding the write
    // reddens here, rather than being silently re-blessed by a missing
    // assertion. ⚠️ Node-local: the VIEW-LEVEL `kanban.groupField` alias this
    // very view could have been authored with is a separate key, retired on
    // this route in objectui#6152 round 14.
    expect(node.groupField).toBeUndefined();
    expect(node.titleField).toBe('name');
    expect(node.cardFields).toEqual(['name', 'amount']);
  });
});

describe('the HOST delegation still carries the top-level key — not narrowed (objectui#5097)', () => {
  it('`renderListView` receives `conditionalFormatting` read off the object-view node', async () => {
    const seen: Array<Record<string, unknown>> = [];
    render(
      <ObjectView
        schema={{
          type: 'object-view',
          objectName: 'task',
          conditionalFormatting: TOP_LEVEL_RULE,
        } as unknown as ObjectViewSchema}
        dataSource={dataSource()}
        renderListView={({ schema: s }: { schema: Record<string, unknown> }) => {
          seen.push(s);
          return <div data-testid="delegated" />;
        }}
      />,
    );
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));

    expect(
      seen[0].conditionalFormatting,
      'The host `renderListView` delegation stopped forwarding `conditionalFormatting`. objectui#5248\n'
        + 'narrowed the AUTHOR-reachable kanban read only; the key remains host-composition surface\n'
        + '(objectui#5097) and a stored app-shell document that carries it must keep rendering. ⛔ Do\n'
        + 'not narrow this half to match the other.',
    ).toEqual(TOP_LEVEL_RULE);
    expect(seen[0].type).toBe('list-view');
  });
});
