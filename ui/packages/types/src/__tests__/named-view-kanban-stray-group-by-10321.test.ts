/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10321 — a named view's stray `kanban.groupBy` is refused at the
 * object-view read door.
 *
 * ## ⭐ RE-PINNED at objectui#11073: the protocol's refusal, and no pointer
 *
 * Until `@objectstack/spec` 17.5.0 this door added objectui's pointer
 * (`custom` at `listViews.KEY.kanban.groupBy`, the `list-view` route's string)
 * beside the protocol's `unrecognized_keys`. 17.5.0 makes that refusal TERMINAL,
 * zod then skips even a `when`-guarded check, and the pointer
 * (`checkNamedViewKanbanStrayGroupBy`) was retired (seat ruling Q2 → A on
 * objectui#11073). The rows below pin what stands: the protocol refuses the
 * key by name at `listViews.KEY.kanban`, and objectui adds no issue of its own.
 * The `list-view` route keeps the pointer; `listViewRouteMessage` still reads it
 * there, as the control that the pointer lives on and was not deleted.
 *
 * The objectui#8365 ruling (B, maintainer 「8365 同意」) refuses a stored view's
 * `kanban.groupBy` loudly 「at the read door of the view, visible to the author
 * of the view」. PR objectui#9236 installed that refusal on the `list-view` route
 * only: the `KanbanConfig` arm (`kanban.groupBy`) and the legacy-bag check
 * (`options.kanban.groupBy`). A named view on an `object-view` document is the
 * second route (`generateViewSchema`, objectui#9242), and its `listViews` is
 * unmirrored, so `safeValidateSchema` ACCEPTED the key there in both nestings
 * and kept it. This file pins the door that closes that.
 *
 * ## What is asserted
 *
 * - REFUSED through the published tolerant door (`safeValidateSchema`):
 *   the protocol's `unrecognized_keys` at the block,
 *   naming the key (since objectui#11073; until then also objectui's pointer,
 *   a message EQUAL to the one the `list-view` route gives).
 * - DARK CONTROL: the canonical named view parses green through the same door.
 * - SCOPE CONTROLS: the door is not a mirror of `listViews`. An undeclared
 *   sibling in the kanban block is kept, a kanban block without the spec's
 *   required `columns` is accepted, and so is the legacy `options.kanban` bag
 *   without the stray key.
 * - SIBLING CONTROL: the calendar block on the same door is refused the same
 *   way, by the protocol, naming its retired spelling.
 *
 * ## ⭐ Inverted at objectui#7928, ⛔ no assertion deleted
 *
 * `listViews` is the protocol's strict `ObjectListViewSchema` record by
 * reference now (ruling A; director ruling on `options`, comment 5856694523).
 * So the protocol refuses the stray key itself (`unrecognized_keys` at
 * `listViews.KEY.kanban`), and this door adds the pointer beside that refusal.
 * The legacy `options.kanban` nesting is refused WHOLE (`options` by name) and
 * no longer judged inside. The scope controls that asserted "not a mirror" now
 * assert the mirror: an undeclared sibling, a block without `columns` and the
 * legacy bag are each refused by the record, and the door still adds no issue
 * of its own to any of them. Fixtures meant as canonical carry the protocol's
 * required `columns`.
 *
 * The reverse verification objectui#10321 recorded (unwiring the pointer turned
 * the REFUSED arms red) described the retired check; it is not re-runnable.
 */

import { describe, it, expect } from 'vitest';
import { safeValidateSchema } from '../zod/index.zod';
import { ListViewSchema } from '../zod/objectql.zod';

type Issue = { code: string; path: PropertyKey[]; message: string };

/** An `object-view` document whose named views are `listViews`. */
const objectView = (listViews: Record<string, unknown>) => ({
  type: 'object-view',
  objectName: 'deal',
  listViews,
});

const issuesOf = (result: ReturnType<typeof safeValidateSchema>): Issue[] =>
  result.success ? [] : (result.error.issues as Issue[]);

const issueAt = (result: ReturnType<typeof safeValidateSchema>, path: string): Issue | undefined =>
  issuesOf(result).find((i) => i.path.join('.') === path);

/** The message the `list-view` route answers the same key with. Read, not copied. */
function listViewRouteMessage(): string {
  const result = ListViewSchema.safeParse({
    type: 'list-view',
    objectName: 'deal',
    kanban: { groupByField: 'stage', groupBy: 'stage' },
  });
  const message = result.success
    ? ''
    : result.error.issues.find((i) => i.path.join('.') === 'kanban.groupBy')?.message ?? '';
  expect(message, 'the list-view route no longer refuses the key; there is no string to share').not.toBe('');
  return message;
}

/** A canonical kanban named view: the protocol's required `columns`, at both levels. */
const CANONICAL_KANBAN = { type: 'kanban', columns: ['name'], kanban: { groupByField: 'stage', columns: ['name'] } } as const;

const customIssues = (result: ReturnType<typeof safeValidateSchema>) => issuesOf(result).filter((i) => i.code === 'custom');

describe('objectui#10321 · a named view authoring the stray `kanban.groupBy` is REFUSED', () => {
  it('declared `kanban` block: refused by the protocol, naming the key at the block (objectui#11073)', () => {
    const view = { ...CANONICAL_KANBAN, kanban: { ...CANONICAL_KANBAN.kanban, groupBy: 'stage' } };
    const result = safeValidateSchema(objectView({ v1: view }));
    expect(result.success, 'listViews.v1.kanban.groupBy still parses green').toBe(false);
    // One key written, one issue: the protocol's refusal at the block. The pointer
    // that stood beside it at `listViews.v1.kanban.groupBy` was retired.
    expect(issuesOf(result), 'one key written: the protocol\'s refusal alone').toHaveLength(1);
    const refusal = issueAt(result, 'listViews.v1.kanban') as (Issue & { keys?: string[] }) | undefined;
    expect(refusal?.code).toBe('unrecognized_keys');
    expect(refusal?.keys).toEqual(['groupBy']);
    expect(refusal?.message).toContain('`groupBy`');
    expect(issueAt(result, 'listViews.v1.kanban.groupBy')).toBeUndefined();
    // Control: the `list-view` route still answers the same key with objectui's pointer.
    expect(listViewRouteMessage()).toContain('Did you mean `groupBy` → `groupByField`?');
  });

  it('INVERTED — legacy `options.kanban` bag: refused WHOLE, `options` by name, and no longer judged inside (objectui#7928)', () => {
    // Was "refused by name at its own path, with the list-view route's string"
    // at `listViews.v1.options.kanban.groupBy`. The protocol refuses a named
    // view's `options` bag outright, and a stored body's bag is folded onto
    // `kanban` at `ViewPreview`, where the arm above judges it.
    const path = 'listViews.v1.options.kanban.groupBy';
    const result = safeValidateSchema(objectView({ v1: { ...CANONICAL_KANBAN, options: { kanban: { groupBy: 'stage' } } } }));
    expect(result.success, `${path} still parses green`).toBe(false);
    const issue = issueAt(result, path);
    expect(issue).toBeUndefined();
    expect(customIssues(result)).toEqual([]);
    const whole = issueAt(result, 'listViews.v1') as (Issue & { keys?: string[] }) | undefined;
    expect(whole?.code).toBe('unrecognized_keys');
    expect(whole?.keys).toEqual(['options']);
  });

  it('the key is judged in EVERY named view, and reported under that view\'s own key', () => {
    const result = safeValidateSchema(objectView({
      clean: CANONICAL_KANBAN,
      stray: { ...CANONICAL_KANBAN, kanban: { ...CANONICAL_KANBAN.kanban, groupBy: 'owner' } },
    }));
    expect(issuesOf(result).filter((i) => i.code === 'unrecognized_keys').map((i) => i.path.join('.'))).toEqual(['listViews.stray.kanban']);
    expect(customIssues(result)).toEqual([]);
    // …and nothing at all is reported under the clean view.
    expect(issuesOf(result).filter((i) => i.path.join('.').startsWith('listViews.clean'))).toEqual([]);
  });
});

describe('objectui#10321 · the controls, each able to fire on its own', () => {
  it('DARK CONTROL: the canonical named view parses GREEN through the same door', () => {
    // `columns` at the top level too since objectui#7928: the protocol's named
    // view requires it.
    const result = safeValidateSchema(objectView({ v1: CANONICAL_KANBAN }));
    expect(result.success, JSON.stringify(issuesOf(result))).toBe(true);
  });

  it('INVERTED SCOPE CONTROL: an undeclared sibling in the kanban block is REFUSED by the record, and this door adds nothing (objectui#7928)', () => {
    // Was "accepted and KEPT". The protocol's kanban block declares
    // `columns` / `groupByField` / `summarizeField` only, and the named view is
    // that block by reference now. The door still judges `groupBy` alone.
    const result = safeValidateSchema(objectView({
      v1: { ...CANONICAL_KANBAN, kanban: { ...CANONICAL_KANBAN.kanban, swimlaneField: 'owner' } },
    }));
    expect(result.success, JSON.stringify(issuesOf(result))).toBe(false);
    const refusal = issueAt(result, 'listViews.v1.kanban') as (Issue & { keys?: string[] }) | undefined;
    expect(refusal?.code).toBe('unrecognized_keys');
    expect(refusal?.keys).toEqual(['swimlaneField']);
    expect(customIssues(result)).toEqual([]);
  });

  it('INVERTED SCOPE CONTROL: the spec value type IS the mirror — `columns` required, the legacy bag refused (objectui#7928)', () => {
    // Was "no spec value type leaked in": a door that adopted either would be a
    // mirror of `listViews`, and objectui#7928 made the mirror exactly that.
    const noColumns = safeValidateSchema(objectView({ v1: { type: 'kanban', kanban: { groupByField: 'stage' } } }));
    expect(noColumns.success, JSON.stringify(issuesOf(noColumns))).toBe(false);
    expect(issueAt(noColumns, 'listViews.v1.columns')).toBeDefined();
    expect(issueAt(noColumns, 'listViews.v1.kanban.columns')).toBeDefined();
    const legacyBag = safeValidateSchema(objectView({ v1: { ...CANONICAL_KANBAN, options: { kanban: { groupByField: 'stage' } } } }));
    expect(legacyBag.success, JSON.stringify(issuesOf(legacyBag))).toBe(false);
    expect((issueAt(legacyBag, 'listViews.v1') as (Issue & { keys?: string[] }) | undefined)?.keys).toEqual(['options']);
    // The door itself still adds no issue to either.
    expect(customIssues(noColumns)).toEqual([]);
    expect(customIssues(legacyBag)).toEqual([]);
  });

  it('SIBLING CONTROL: the calendar block on the same door is refused by the protocol too, naming its retired spelling', () => {
    const result = safeValidateSchema(objectView({ v1: { type: 'calendar', calendar: { dateField: 'kickoff' } } }));
    const refusal = issueAt(result, 'listViews.v1.calendar') as (Issue & { keys?: string[] }) | undefined;
    expect(refusal?.code).toBe('unrecognized_keys');
    expect(refusal?.keys).toEqual(['dateField']);
    expect(issueAt(result, 'listViews.v1.calendar.dateField')).toBeUndefined();
    expect(customIssues(result)).toEqual([]);
  });
});
