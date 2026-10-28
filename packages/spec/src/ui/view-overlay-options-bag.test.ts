// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25923] A flattened list overlay carries no `options` bag: the view write
 * door refuses it by name, and a STORED bag is folded onto the top-level
 * per-kind blocks by the ADR-0087 D2 conversion `list-view-options-bag-folded`
 * before the row is served.
 *
 * ## What changed (supersedes direction A on objectui#10380)
 *
 * From #20051 until this card the list overlay member DECLARED the bag and
 * judged each `options.KIND` key by key with the kind's own schema (every key
 * optional), as an underlay the top-level block wins over per key. That ruling
 * refused only to close the bag whole, for objectui's pinned `options.map`
 * read; #25923 retires every reader of the bag, so the door closes it.
 *
 * ## What this file pins
 *
 * 1. The list overlay refuses `options` by name, whatever it holds (a legal
 *    `options.map`, an empty bag, a non-object), at `options`, with the
 *    move-to-the-top-level prescription; the union refuses it too.
 * 2. The authoring funnel does not replay the fold (the entry is retired from
 *    the load path): an author meets the refusal and is taught.
 * 3. A stored row replays it: `options.KIND` moves to `KIND`, the top-level
 *    value wins per key, `chart`'s block wins whole, and the folded row parses.
 * 4. What the fold cannot decide stays as stored, with a TODO.
 * 5. The form overlay and the view item record keep their own refusals.
 */

import { describe, it, expect } from 'vitest';
import { ViewMetadataSchema, VIEW_METADATA_MEMBERS, diagnoseViewMetadata } from './view.zod';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { applyConversions } from '../conversions/apply';
import type { ConversionNotice, ConversionTodoNotice } from '../conversions/types';

/** A bound flat list overlay — the shape a `PUT /api/v1/meta/view` carries. */
const overlay = (extra: Record<string, unknown> = {}) => ({
  name: 'crm_lead.board',
  object: 'crm_lead',
  viewKind: 'list',
  columns: ['name'],
  ...extra,
});

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };

/** The list overlay's own issue at `options` for a body (the branch the body claims). */
function listOverlayOptionsIssue(body: unknown): Issue {
  const d = diagnoseViewMetadata(body);
  expect(d.success, `expected a refusal for ${JSON.stringify(body)}`).toBe(false);
  if (d.success) throw new Error('unreachable');
  expect(d.branch).toBe('listOverlay');
  const hit = (d.issues as unknown as Issue[]).find((i) => i.path.length === 1 && i.path[0] === 'options');
  expect(hit, JSON.stringify(d.issues)).toBeDefined();
  return hit!;
}

/** Replay the chain over one stored `view` row, as every stored-row read does. */
function storedRead(row: Record<string, unknown>) {
  const notices: ConversionNotice[] = [];
  const todos: ConversionTodoNotice[] = [];
  const out = applyConversionsToStoredItem('view', row, {
    onNotice: (n) => notices.push(n),
    onTodo: (t) => todos.push(t),
  }) as Record<string, unknown>;
  const mine = (n: { conversionId: string }) => n.conversionId === 'list-view-options-bag-folded';
  return { out, notices: notices.filter(mine), todos: todos.filter(mine) };
}

describe('the list overlay refuses the `options` bag by name', () => {
  it.each([
    ['a legal legacy `options.map`, the read objectui pinned', { map: { locationField: 'location', titleField: 'legacy_title' } }],
    ['an `options.kanban` / `options.calendar` pair', { kanban: { groupByField: 'status', columns: ['name'] }, calendar: { startDateField: 'created_at' } }],
    ['an empty bag', {}],
    ['`options.grid`', { grid: {} }],
    ['a non-object bag', 'map'],
  ])('%s is refused at `options` with the prescription', (_label, options) => {
    const hit = listOverlayOptionsIssue(overlay({ type: 'map', options }));
    expect(hit.message).toMatch(/^A list view's `options` bag was removed in @objectstack\/spec 18\.3\.0/);
    expect(hit.message).toContain('Move each `options.KIND` block to `KIND`');
    expect(ViewMetadataSchema.safeParse(overlay({ type: 'map', options })).success).toBe(false);
    expect(VIEW_METADATA_MEMBERS.listOverlay.safeParse(overlay({ type: 'map', options })).success).toBe(false);
  });

  it('CONTROL: the same keys written top-level parse', () => {
    const parsed = ViewMetadataSchema.safeParse(overlay({ type: 'map', map: { locationField: 'location', titleField: 'legacy_title' } }));
    expect(parsed.success, JSON.stringify(!parsed.success && parsed.error.issues)).toBe(true);
  });

  it('CONTROL: an overlay with no `options` parses, with no `options` key', () => {
    const parsed = ViewMetadataSchema.safeParse(overlay({ type: 'grid' }));
    expect(parsed.success).toBe(true);
    expect('options' in (parsed as { data: Record<string, unknown> }).data).toBe(false);
  });
});

describe('the authoring funnel does not fold the bag — the author is taught', () => {
  it('`applyConversions` without retired entries leaves the bag, so the parse refuses it', () => {
    const stack = { views: [overlay({ type: 'kanban', options: { kanban: { groupByField: 'status', columns: ['name'] } } })] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(structuredClone(stack), { onNotice: (n) => notices.push(n) });
    expect(out).toEqual(stack);
    expect(notices.filter((n) => n.conversionId === 'list-view-options-bag-folded')).toHaveLength(0);
  });
});

describe('a stored row replays the fold', () => {
  it('`options.KIND` with no top-level block becomes the block, and the row parses', () => {
    const row = overlay({ type: 'kanban', options: { kanban: { groupByField: 'status', columns: ['name'] } } });
    const { out, notices, todos } = storedRead(row);
    expect(out).toEqual(overlay({ type: 'kanban', kanban: { groupByField: 'status', columns: ['name'] } }));
    expect(notices.map((n) => n.path)).toEqual(['views[0].options.kanban']);
    expect(todos).toEqual([]);
    expect(ViewMetadataSchema.safeParse(out).success).toBe(true);
  });

  it('both present: the top-level value wins per key, and a key only the bag set is kept', () => {
    // objectui's per-key population (`ObjectView.namedViewProtocolKeys-8980`):
    // the top-level block restates `groupByField`, the bag adds `titleField`.
    const row = overlay({
      type: 'kanban',
      kanban: { groupByField: 'status', columns: ['name'] },
      options: { kanban: { groupByField: 'owner', titleField: 'subject' } },
    });
    const { out } = storedRead(row);
    expect(out.kanban).toEqual({ groupByField: 'status', columns: ['name'], titleField: 'subject' });
    expect('options' in out).toBe(false);
    expect(ViewMetadataSchema.safeParse(out).success).toBe(true);
  });

  it('`chart` is the exception: its block replaced the bag WHOLE, so a bag beside a block is dropped', () => {
    const row = overlay({
      type: 'chart',
      chart: { dataset: 'deals', values: ['amount'] },
      options: { chart: { dataset: 'old', values: ['amount'], dimensions: ['stage'] } },
    });
    const { out, notices } = storedRead(row);
    expect(out.chart).toEqual({ dataset: 'deals', values: ['amount'] });
    expect('options' in out).toBe(false);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.to).toContain('replaces it whole');
  });

  it('a bag block can fold into a block still missing a required key — the row is served badged invalid', () => {
    // The bag was judged with every key optional; the D3 entry names the remedy.
    const { out } = storedRead(overlay({ type: 'gantt', options: { gantt: { startDateField: 's', endDateField: 'e' } } }));
    expect(out.gantt).toEqual({ startDateField: 's', endDateField: 'e' });
    const d = diagnoseViewMetadata(out);
    expect(d.success).toBe(false);
  });

  it('the fold is idempotent: a second read changes nothing and says nothing', () => {
    const once = storedRead(overlay({ type: 'map', options: { map: { locationField: 'location' } } })).out;
    const twice = storedRead(once);
    expect(twice.out).toEqual(once);
    expect(twice.notices).toEqual([]);
  });
});

describe('what the fold cannot decide stays as stored, with a TODO', () => {
  it('`options.grid` stays in the bag (a grid has no block); the folded kinds still move', () => {
    const { out, todos } = storedRead(overlay({ type: 'grid', options: { grid: { striped: true }, kanban: { titleField: 'name' } } }));
    expect(out.options).toEqual({ grid: { striped: true } });
    expect(out.kanban).toEqual({ titleField: 'name' });
    expect(todos).toHaveLength(1);
    expect(todos[0]!.path).toBe('views[0].options');
    expect(todos[0]!.reason).toContain('`grid`');
  });

  it('a non-object bag is left as stored, with a TODO', () => {
    const row = overlay({ options: 'map' });
    const { out, todos, notices } = storedRead(row);
    expect(out).toEqual(row);
    expect(notices).toEqual([]);
    expect(todos).toHaveLength(1);
  });

  it('a bag on a FORM overlay is left as stored, with a TODO — its blocks have no home on a form', () => {
    const row = { name: 'lead.contact_us', object: 'lead', viewKind: 'form', type: 'simple', options: { kanban: { groupByField: 'status' } } };
    const { out, todos } = storedRead(row);
    expect(out).toEqual(row);
    expect(todos.map((t) => t.reason).join(' ')).toContain('form view');
  });

  it('CONTROL: a view item record (`config` present) is not this conversion\'s business', () => {
    const row = { name: 'crm_lead.board', object: 'crm_lead', viewKind: 'list', config: { columns: ['name'] }, options: { kanban: {} } };
    const { out, notices, todos } = storedRead(row);
    expect(out).toEqual(row);
    expect(notices).toEqual([]);
    expect(todos).toEqual([]);
  });
});

describe('the form overlay cannot take the bag the list overlay refused', () => {
  it('a column-less, type-less body with a bad `options` bag is refused, not accepted as a form', () => {
    // Without the form overlay's `options` pin this body is ACCEPTED: the list
    // member refuses it (no `columns`, and the bag), the form member — which
    // `.strip()`s and requires no list key — takes it, and the bag is stored
    // unjudged after all.
    const body = {
      name: 'crm_lead.all',
      object: 'crm_lead',
      viewKind: 'list',
      sort: [{ field: 'name', order: 'asc' }],
      options: { timeline: { metaFields: ['region'] } },
    };
    expect(ViewMetadataSchema.safeParse(body).success).toBe(false);
    const form = VIEW_METADATA_MEMBERS.formOverlay.safeParse(body);
    expect(form.success).toBe(false);
  });

  it('a flat form overlay carrying `options` is refused with the list-view prescription', () => {
    const body = {
      name: 'lead.contact_us',
      object: 'lead',
      viewKind: 'form',
      type: 'simple',
      options: { kanban: { groupByField: 'status' } },
    };
    const d = diagnoseViewMetadata(body);
    expect(d.success).toBe(false);
    if (d.success) return;
    expect(d.branch).toBe('formOverlay');
    const hit = (d.issues as unknown as Issue[]).find((i) => i.path[0] === 'options');
    expect(hit?.message).toContain('A form view carries no `options` bag');
  });

  it('CONTROL: a flat form overlay without `options` still parses', () => {
    const body = { name: 'lead.contact_us', object: 'lead', viewKind: 'form', type: 'simple' };
    expect(ViewMetadataSchema.safeParse(body).success).toBe(true);
  });
});

/**
 * [#20051] Stage (iv), Q3: the same legacy bag on a ViewItem RECORD
 * (`{ name, object, viewKind, config }`) is refused by name, on both arms, with
 * the prescription to write `config.KIND`. The record member's top-level
 * `.strip()` used to drop it unread; with the save storing the parsed body it
 * would have vanished on a `200` instead.
 */
describe('a ViewItem record carries no top-level `options` bag', () => {
  const record = (extra: Record<string, unknown> = {}) => ({
    name: 'crm_lead.board',
    object: 'crm_lead',
    viewKind: 'list',
    config: {
      type: 'kanban',
      data: { provider: 'object', object: 'crm_lead' },
      columns: ['name'],
      kanban: { groupByField: 'stage', columns: ['name'] },
    },
    ...extra,
  });

  function recordIssueAtOptions(body: unknown): Issue {
    const d = diagnoseViewMetadata(body);
    expect(d.success, `expected a refusal for ${JSON.stringify(body)}`).toBe(false);
    if (d.success) throw new Error('unreachable');
    expect(d.branch).toBe('viewItem');
    const hit = (d.issues as unknown as Issue[]).find((i) => i.path.length === 1 && i.path[0] === 'options');
    expect(hit, JSON.stringify(d.issues)).toBeDefined();
    return hit!;
  }

  it('on the list arm: refused at `options`, prescribing `config.KIND`', () => {
    const hit = recordIssueAtOptions(record({ options: { kanban: { groupByField: 'stage' } } }));
    expect(hit.message).toMatch(/^A view item record carries no top-level `options` bag/);
    expect(hit.message).toContain('Move each `options.KIND` block to `config.KIND`');
    expect(VIEW_METADATA_MEMBERS.viewItem.safeParse(record({ options: {} })).success).toBe(false);
  });

  it('on the form arm too', () => {
    const hit = recordIssueAtOptions({
      name: 'lead.contact_us',
      object: 'lead',
      viewKind: 'form',
      config: { type: 'simple', data: { provider: 'object', object: 'lead' } },
      options: { timeline: { titleField: 'name' } },
    });
    expect(hit.message).toMatch(/^A view item record carries no top-level `options` bag/);
  });

  it('CONTROL: the record without the bag parses, and `config.kanban` is where the block lives', () => {
    const parsed = ViewMetadataSchema.safeParse(record());
    expect(parsed.success).toBe(true);
  });
});
