/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8365 — a surviving `groupBy` in the kanban config OVERRODE the lane
 * `ListView` had just resolved.
 *
 * `ListView`'s kanban branch destructured
 * `columns`/`groupByField`/`groupField`/`cardFields`/`titleField` out of the
 * merged config and spread the REST *after* its own `groupBy: laneField`. So an
 * authored `kanban.groupBy` rode the `.passthrough()` `KanbanConfig` mirror into
 * `restKanban` and won over the canonical `groupByField` the branch had already
 * resolved — the board grouped by the stray key, and nothing said so.
 *
 * ## THE DISTINGUISHING FIXTURE, and why it had to be hand-built
 *
 * The override was measured as ACTIVE, not latent. It read as latent only
 * because the one producer that fed it (`app-shell`'s `kanbanViewOptions`,
 * retired by objectui#8213) wrote both spellings with the SAME value by
 * construction — so no fixture driven by that producer could tell them apart,
 * and an override row driven by it was a test that cannot fail. The two
 * spellings therefore carry two DIFFERENT lane names here, which is the whole
 * reason this file exists:
 *
 *     options.kanban = { groupBy: 'LANE_FROM_STRAY_GROUPBY' }
 *     kanban         = { groupByField: 'LANE_FROM_CANONICAL' }
 *
 * ## THE RULING, and the two halves it asks for
 *
 * Maintainer ruling of 2026-09-12 (decision batch #117 item 5, verbatim
 * 「8365 同意」) — option B. Option A (strip the key and re-group in silence)
 * was the fallback for a measured zero of stored views and was NOT taken.
 * Honouring `groupBy` as a declared alias was never on the table: the protocol
 * refuses it BY NAME (see the control below), and legalising it would be a spec
 * change on its own `objectstack` card, never a renderer-side widening
 * (AGENTS.md #0.1).
 *
 *   1. THE CANONICAL LANE WINS — `ListView` adds `groupBy` to the destructure,
 *      so the stray key can no longer reach `restKanban`. Asserted on the
 *      GENERATED `object-kanban` node, through a registry spy, because that node
 *      is the only place the override was ever observable.
 *   2. THE STRAY KEY IS REFUSED LOUDLY, at the READ DOOR of the view and in the
 *      sentence shape the platform contract already uses for the sibling alias.
 *      That door is the view-level `KanbanConfig` mirror in `@object-ui/types`
 *      (`zod/objectql.zod.ts`), reached here through the published
 *      `safeValidateSchema` — the same entry point the CLI's `os check` /
 *      `os validate` and the VS Code extension run, i.e. where the AUTHOR of the
 *      view is standing. ⛔ Deliberately NOT a `console.warn`: the ruling names
 *      that outcome and refuses it.
 *
 *      ⚠️ TWO NESTINGS, and the second one is load-bearing rather than thorough.
 *      `ListView` merges `{ ...options.kanban, ...kanban }`, and the producer
 *      objectui#8213 retired wrote into `options.kanban` — so that is where the
 *      stored views this ruling is ABOUT carry the key. `options` was a record
 *      that could declare no member, so it took the declared arm's guidance as a
 *      CHECK (`custom`); since objectui#6152 round 12 it nests the declared slot's
 *      own block, so both nestings report the arm itself (`invalid_type`). ONE
 *      message — asserted below, because a refusal that only reached the declared nesting
 *      would leave exactly the affected population silently re-grouped, i.e.
 *      option A wearing option B's name.
 *
 * ## THE CONTROLS, and what each one would catch
 *
 * - DARK CONTROL (`groupByField` alone) — parses GREEN through the same door.
 *   Without it, "the door refuses the fixture" is satisfied by a door that
 *   refuses everything.
 * - UNDECLARED-KEY CONTROL (an undeclared `zzzBogusKey`). This card declared
 *   exactly ONE named refusal arm and did not close the object, so the key
 *   parsed GREEN here. objectui#6152 round 11 has since CLOSED `KanbanConfig`
 *   (it is the spec's strict list-view slot by reference), so the control now
 *   pins the OTHER code: the spec's own `unrecognized_keys` at `kanban`, which
 *   keeps the by-name `groupBy` arm distinguishable from a plain unknown key.
 * - PROTOCOL CONTROL — `@objectstack/spec`'s own `KanbanConfigSchema` refuses
 *   `groupBy` by name, with a lit control (`zzzBogusKey`) firing and a dark
 *   control (`groupByField` alone) drawing no `unrecognized_keys`. This is what
 *   makes "the mirror stopped being more permissive than the spec" a reading
 *   rather than a claim, and it reddens first if a later spec bump ever DECLARES
 *   `groupBy`.
 * - LANE CONTROL (`groupBy` alone, no canonical key) — the board falls back to
 *   the detector / no lane, and does NOT silently keep grouping by the stray
 *   key. This is the arm that tells option B apart from "strip it and hope".
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * remove `groupBy` from the destructure in `ListView.tsx` and the lane arms go
 * RED naming `LANE_FROM_STRAY_GROUPBY`, while every refusal arm stays GREEN;
 * remove the `groupBy` arm from `KanbanConfig` and the refusal arms go RED while
 * the lane arms stay GREEN. Two independent halves, two independent ablations —
 * the asymmetry is what proves neither arm is carrying the other.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { safeValidateSchema } from '@object-ui/types/zod';
import { KanbanConfigSchema } from '@objectstack/spec/ui';
import { ListView } from '../ListView';

const OBJECT = 'deal';

/** The two lane names the fixture holds apart. */
const STRAY = 'LANE_FROM_STRAY_GROUPBY';
const CANONICAL = 'LANE_FROM_CANONICAL';

const objectDef = {
  name: OBJECT,
  label: 'Deal',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    [CANONICAL]: { name: CANONICAL, type: 'text', label: 'Canonical lane' },
    [STRAY]: { name: STRAY, type: 'text', label: 'Stray lane' },
  },
};

/** Every `object-kanban` node the renderer generated, in order. */
let kanbanNodes: Array<Record<string, any>> = [];

ComponentRegistry.register(
  'object-kanban',
  (props: Record<string, any>) => {
    kanbanNodes.push(props.schema);
    return <div data-testid="kanban-spy" />;
  },
  { namespace: 'test', label: 'Kanban spy', category: 'view' },
);

const makeDataSource = () =>
  ({
    find: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => 0),
    getObjectSchema: vi.fn(async () => objectDef),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  }) as any;

/** Mount `ListView` on a view and return the last generated `object-kanban` node. */
async function generatedKanbanNode(view: Record<string, unknown>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, viewType: 'kanban', ...view } as never}
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(kanbanNodes.length).toBeGreaterThan(0));
  return kanbanNodes[kanbanNodes.length - 1];
}

/**
 * THE FIXTURE, built once and used by BOTH halves — the lane assertions read it
 * through the renderer, the refusal assertions read it through the read door, so
 * neither half can drift onto a different document than the other.
 */
const DISTINGUISHING_VIEW = {
  type: 'list-view',
  objectName: OBJECT,
  viewType: 'kanban',
  options: { kanban: { groupBy: STRAY } },
  kanban: { groupByField: CANONICAL },
} as const;

/**
 * The read door judges the AUTHORED page node (objectui#12670, ruling C on
 * objectstack-ai/objectstack#22444): its props in the `properties` bag, its
 * object named in `data`, its kind as the bag's `type`. The fixture above is
 * the `ListView` component's props, which the lane half renders; the refusal
 * half hands the door the same list view in the page spelling, and reads each
 * issue path relative to the bag.
 */
const asPageNode = ({ type, objectName, viewType, ...props }: Record<string, unknown>) => ({
  type,
  properties: {
    data: { provider: 'object', object: objectName },
    ...(viewType === undefined ? {} : { type: viewType }),
    ...props,
  },
});
const readDoor = (doc: Record<string, unknown>) => safeValidateSchema(asPageNode(doc));
const bagPath = (path: readonly PropertyKey[]) => (path[0] === 'properties' ? path.slice(1) : path).join('.');

/** Issues the read door raises at `kanban.groupBy`, if any. */
const refusalIssuesFor = (doc: Record<string, unknown>) => {
  const result = readDoor(doc);
  if (result.success) return [];
  return result.error.issues.filter((i) => bagPath(i.path).endsWith('kanban.groupBy'));
};

beforeEach(() => {
  kanbanNodes = [];
});

describe('objectui#8365 · half 1 — the CANONICAL lane wins on the generated node', () => {
  it('the distinguishing fixture resolves the lane from `groupByField`, not the stray `groupBy`', async () => {
    const node = await generatedKanbanNode(DISTINGUISHING_VIEW);
    // Before the fix this read `LANE_FROM_STRAY_GROUPBY`: the `...restKanban`
    // spread landed after the branch's own `groupBy: laneField`.
    expect(node.groupBy).toBe(CANONICAL);
    expect(node.groupBy).not.toBe(STRAY);
  });

  it('the stray key does not reach the generated node under ANY spelling', async () => {
    const node = await generatedKanbanNode(DISTINGUISHING_VIEW);
    // The node's `groupBy` IS the live lane key `ObjectKanban` reads, so the
    // assertion is about its VALUE above. This one is about the stray value:
    // it must appear nowhere on the node, including under a key the merge might
    // have carried it through.
    expect(Object.values(node)).not.toContain(STRAY);
  });

  it('CONTROL: the declared `kanban.groupByField` still resolves the lane on its own', async () => {
    const node = await generatedKanbanNode({ kanban: { groupByField: CANONICAL } });
    expect(node.groupBy).toBe(CANONICAL);
  });

  it('the retired legacy `kanban.groupField` alias no longer resolves the lane (objectui#6152 round 14)', async () => {
    // This card left the VIEW-LEVEL alias live (only the third spelling was
    // refused), and this arm pinned that it still resolved. objectui#6152 round
    // 14 retired the alias read and the core fold on their own ruling, so the
    // stored alias names no lane.
    const node = await generatedKanbanNode({ kanban: { groupField: CANONICAL } });
    expect(node.groupBy).not.toBe(CANONICAL);
  });

  it('LANE CONTROL: `groupBy` alone no longer sets the lane — option B, not a silent re-grouping', async () => {
    const node = await generatedKanbanNode({ options: { kanban: { groupBy: STRAY } } });
    expect(node.groupBy).not.toBe(STRAY);
  });
});

describe('objectui#8365 · half 2 — the stray key is REFUSED at the read door', () => {
  it('the distinguishing fixture is refused BY NAME, pointing at `groupByField`', () => {
    const issues = refusalIssuesFor(DISTINGUISHING_VIEW);
    expect(issues).toHaveLength(1);
    // ⭐ THE LEGACY NESTING. Until objectui#6152 round 12 `options` was a record
    // that could declare no MEMBER, so the refusal there was a CHECK (`custom`).
    // Since that round the bag is the spec's list-overlay bag by reference and
    // nests the declared slot's own block, so the arm is a member there too:
    // `invalid_type`, the same code and ONE message in both nestings.
    expect(issues[0].code).toBe('invalid_type');
    expect(bagPath(issues[0].path)).toBe('options.kanban.groupBy');
    // The lead sentence is the one the protocol's own `strictObject({ aliases })`
    // answers with, so an author meets ONE remedy on both faces.
    expect(issues[0].message).toContain('Unrecognized key(s) on this kanban configuration: `groupBy`.');
    expect(issues[0].message).toContain('Did you mean `groupBy` → `groupByField`?');
  });

  it('the DECLARED nesting is refused with the SAME message, as a declared member', () => {
    const declared = refusalIssuesFor({
      type: 'list-view',
      objectName: OBJECT,
      kanban: { groupByField: CANONICAL, groupBy: STRAY },
    });
    expect(declared).toHaveLength(1);
    // `aliasKeyRefusal` is a `z.never()` ARM here, so the envelope is
    // `invalid_type` at the key's own path.
    expect(declared[0].code).toBe('invalid_type');
    expect(bagPath(declared[0].path)).toBe('kanban.groupBy');
    // ⭐ ONE STRING, BOTH NESTINGS — the assertion that keeps the check and the
    // arm from drifting into two dialects of one remedy.
    const legacy = refusalIssuesFor(DISTINGUISHING_VIEW);
    expect(declared[0].message).toBe(legacy[0].message);
  });

  it('DARK CONTROL: the canonical config alone parses GREEN through the same door', () => {
    const result = readDoor({
      type: 'list-view',
      objectName: OBJECT,
      kanban: { groupByField: CANONICAL },
    });
    expect(result.success).toBe(true);
  });

  it('UNDECLARED-KEY CONTROL: an undeclared sibling key is refused with the spec\'s own `unrecognized_keys` (objectui#6152 round 11 closed the block)', () => {
    // Until round 11 this row pinned the block OPEN. `groupBy` is refused at its
    // own path with `invalid_type`; a key no arm names is refused at `kanban`
    // with the spec slot's `unrecognized_keys` — two codes, so the arm cannot be
    // read as a plain strictness refusal.
    const result = readDoor({
      type: 'list-view',
      objectName: OBJECT,
      kanban: { groupByField: CANONICAL, zzzBogusKey: 'refused now' },
    });
    expect(result.success).toBe(false);
    const issue = result.success
      ? undefined
      : (result.error.issues.find((i) => bagPath(i.path) === 'kanban') as { code?: string; keys?: string[] } | undefined);
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.keys).toEqual(['zzzBogusKey']);
  });
});

describe('objectui#8365 · the protocol is what this mirror is aligning to', () => {
  /** Keys `@objectstack/spec`'s strict `KanbanConfigSchema` names as refused. */
  const specRefusedKeys = (cfg: Record<string, unknown>) => {
    const r = KanbanConfigSchema.safeParse(cfg);
    if (r.success) return [];
    return r.error.issues.flatMap((i) => ((i as { keys?: string[] }).keys ?? []));
  };

  it('PROTOCOL CONTROL: the spec refuses `groupBy` BY NAME, with both controls firing', () => {
    // LIT: a bogus key is named. DARK: the canonical config draws no
    // `unrecognized_keys` at all. Between them, the middle row is a reading.
    expect(specRefusedKeys({ groupByField: 'stage', columns: ['name'], zzzBogusKey: 1 })).toContain('zzzBogusKey');
    expect(specRefusedKeys({ groupByField: 'stage', columns: ['name'] })).toEqual([]);
    expect(specRefusedKeys({ groupByField: 'stage', columns: ['name'], groupBy: 'stage' })).toContain('groupBy');
  });

  it('PROTOCOL CONTROL: `groupBy` is still not a key the spec DECLARES', () => {
    // If a later spec bump ever declares it, this reddens first and the refusal
    // arm above becomes the thing to re-decide — deliberately, on a new card.
    expect(Object.keys((KanbanConfigSchema as any).shape)).not.toContain('groupBy');
  });
});
