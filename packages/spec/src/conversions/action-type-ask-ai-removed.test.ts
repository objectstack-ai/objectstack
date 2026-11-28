// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { applyMetaMigrations } from '../migrations/chain.js';
import { applyConversions, collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionTodoDetail } from './types.js';

/**
 * ADR-0160 D7, seventh amendment — `action-type-ask-ai-removed`, the D2 half of
 * the `ask_ai` action type's retirement. The fixture in `conversions.test.ts`
 * proves before → after where nothing names the action, which both doors
 * delete. What only this file pins is where the two doors part:
 *
 *   - over SOURCES (`os migrate meta --from 18`, `applyMetaMigrations`) a
 *     declared `ask_ai` action that something in the stack names is KEPT as
 *     written with each reference, and the D3 entry is listed; the conversion
 *     never deletes a reference;
 *   - AT REST (`includeRetired`, the stored and built doors) every `ask_ai`
 *     action is deleted, named or not;
 *   - the stored seam answers a stored `action` row that IS one with
 *     `undefined` — no item — and an object row loses only the action.
 */

const ID = 'action-type-ask-ai-removed';

const referencedStack = () => ({
  actions: [
    { name: 'ask_about_ticket', label: 'Ask AI', objectName: 'ticket', type: 'ask_ai' },
    { name: 'ask_unnamed', label: 'Ask AI', objectName: 'ticket', type: 'ask_ai' },
    { name: 'close_ticket', label: 'Close', objectName: 'ticket', type: 'script' },
  ],
  views: [{ name: 'ticket_list', object: 'ticket', rowActions: ['ask_about_ticket', 'close_ticket'] }],
});

describe('action-type-ask-ai-removed (ADR-0160 D7)', () => {
  it('is registered for protocol 19 and retired from the authoring load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(19);
    expect(entry!.retiredFromLoadPath).toBe(true);
  });

  it('over sources: a named ask_ai action is kept with its reference, an unnamed one is deleted, the D3 entry is listed', () => {
    const before = referencedStack();
    const result = applyMetaMigrations(before, 18, 19);
    const after = result.stack as ReturnType<typeof referencedStack>;
    expect(after.actions.map((a) => a.name)).toEqual(['ask_about_ticket', 'close_ticket']);
    expect(after.views).toEqual(before.views);
    expect(result.applied.filter((a) => a.conversionId === ID).map((a) => a.path)).toEqual(['actions[1]']);
    expect(result.todos.map((t) => t.id)).toContain('ui-action-type-ask-ai-retired');
  });

  it('over sources: the kept action is reported as a todo when the caller listens', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID)!;
    const todos: ConversionTodoDetail[] = [];
    const out = entry.apply(referencedStack(), () => {}, { reportTodo: (t) => todos.push(t) });
    expect((out.actions as { name: string }[]).map((a) => a.name)).toEqual(['ask_about_ticket', 'close_ticket']);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ path: 'actions[0]', from: 'ask_ai' });
    expect(todos[0].reason).toContain('`ask_about_ticket`');
  });

  it('an object-nested action named by its own object is kept over sources', () => {
    const stack = {
      objects: [{
        name: 'ticket',
        actions: [{ name: 'ask_row', label: 'Ask AI', type: 'ask_ai' }],
        listViews: { all: { rowActions: ['ask_row'] } },
      }],
    };
    const out = applyMetaMigrations(stack, 18, 19).stack as typeof stack;
    expect(out.objects[0].actions).toEqual(stack.objects[0].actions);
  });

  it('at rest: every ask_ai action is deleted, named or not, and the reference is left as it was', () => {
    const { stack, notices } = collectConversionNotices(referencedStack(), { includeRetired: true });
    const after = stack as ReturnType<typeof referencedStack>;
    expect(after.actions.map((a) => a.name)).toEqual(['close_ticket']);
    expect(after.views[0].rowActions).toEqual(['ask_about_ticket', 'close_ticket']);
    expect(notices.filter((n) => n.conversionId === ID).map((n) => n.path)).toEqual(['actions[0]', 'actions[1]']);
  });

  it('is idempotent: the at-rest result replays to the same reference', () => {
    const once = applyConversions(referencedStack(), { includeRetired: true });
    expect(applyConversions(once, { includeRetired: true })).toBe(once);
  });

  it('the stored seam: an action row that IS an ask_ai action yields no item', () => {
    expect(applyConversionsToStoredItem('action', { name: 'ask_about_ticket', label: 'Ask AI', type: 'ask_ai' }))
      .toBeUndefined();
  });

  it('the stored seam: a live action row and an object row with an ask_ai action keep the rest', () => {
    const live = { name: 'close_ticket', label: 'Close', type: 'script' };
    expect(applyConversionsToStoredItem('action', live)).toEqual(live);
    const object = applyConversionsToStoredItem('object', {
      name: 'ticket',
      label: 'Ticket',
      actions: [
        { name: 'ask_row', label: 'Ask AI', type: 'ask_ai' },
        { name: 'reopen_ticket', label: 'Reopen', type: 'script' },
      ],
    }) as { actions: { name: string }[] };
    expect(object.actions.map((a) => a.name)).toEqual(['reopen_ticket']);
  });

  it('applies before action-locations-acted-on: a record_header group whose only ⋯-only member is ask_ai converts to record_page', () => {
    const ids = ALL_CONVERSIONS.map((c) => c.id);
    expect(ids.indexOf(ID)).toBeLessThan(ids.indexOf('action-locations-acted-on'));
    const group = () => ({
      pages: [
        {
          name: 'ticket_desk',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'action:group',
                  properties: {
                    location: 'record_header',
                    actions: [
                      { label: 'Close', type: 'script', target: 'close_ticket', locations: ['record_header'] },
                      { label: 'Ask AI', type: 'ask_ai', locations: ['record_more'] },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const expected = {
      type: 'action:group',
      properties: {
        location: 'record_page',
        actions: [{ label: 'Close', type: 'script', target: 'close_ticket', locations: ['record_page'] }],
      },
    };
    const componentOf = (stack: unknown) =>
      (stack as ReturnType<typeof group>).pages[0]!.regions[0]!.components[0];
    // Over sources and at rest alike, the group is not left at a word protocol 19 draws nowhere.
    expect(componentOf(applyMetaMigrations(group(), 18, 19).stack)).toEqual(expected);
    expect(componentOf(applyConversions(group(), { includeRetired: true }))).toEqual(expected);
    // And no hand-rewrite TODO is left for a group the table converted.
    for (const includeRetired of [false, true]) {
      const todos: string[] = [];
      applyConversions(group(), { includeRetired, onTodo: (t) => todos.push(t.conversionId) });
      expect(todos).not.toContain('action-locations-acted-on');
    }
  });
});
