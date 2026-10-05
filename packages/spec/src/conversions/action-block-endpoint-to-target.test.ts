// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ActionButtonPropsSchema, ActionIconPropsSchema } from '../ui/component.zod.js';
import { applyConversions } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice, ConversionTodoNotice } from './types.js';

/**
 * [#21005] `action-block-endpoint-to-target` — the D2 half of refusing
 * `endpoint` on the `action:button` / `action:icon` rows.
 *
 * The fixture pair in `conversions.test.ts` already proves before → after over
 * the whole table. What this file pins:
 *
 *   - the stored-row seam REWRITES a stored `endpoint` to `target` on both
 *     blocks (the entry is `retiredFromLoadPath`, so only data-at-rest seams
 *     and `os migrate meta` apply it), and the result parses against the row
 *     that now refuses `endpoint`;
 *   - the authoring funnel does NOT replay it — an author meets the rows'
 *     rename instead;
 *   - every site with no lossless rewrite is left byte-identical and reported
 *     as a TODO, never converted and never silent;
 *   - idempotence, and copy-on-write identity for a page with nothing to do.
 */
const ID = 'action-block-endpoint-to-target';

/** A stored `page` row carrying one block in a region. */
const pageWith = (component: Record<string, unknown>) => ({
  name: 'ops_console',
  regions: [{ name: 'main', components: [component] }],
});

/** The one block of a converted {@link pageWith} row. */
const blockOf = (page: unknown) =>
  (page as { regions: { components: Record<string, unknown>[] }[] }).regions[0]!.components[0]!;

/** Replay the stored chain over `page`, collecting this entry's notices and TODOs. */
function replayStored(page: Record<string, unknown>) {
  const notices: ConversionNotice[] = [];
  const todos: ConversionTodoNotice[] = [];
  const out = applyConversionsToStoredItem('page', page, {
    onNotice: (n) => notices.push(n),
    onTodo: (t) => todos.push(t),
  });
  return {
    out,
    notices: notices.filter((n) => n.conversionId === ID),
    todos: todos.filter((t) => t.conversionId === ID),
  };
}

describe('action-block-endpoint-to-target (ADR-0087 D2)', () => {
  it('is registered for protocol 18 and retired from the authoring load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
  });

  it.each([
    ['action:button', ActionButtonPropsSchema, { label: 'Sync now' }],
    ['action:icon', ActionIconPropsSchema, { icon: 'refresh-cw' }],
  ] as const)('the stored-row seam rewrites a stored `endpoint` to `target` on `%s`', (type, schema, rest) => {
    const props = { ...rest, actionType: 'api', endpoint: '/api/v1/ops/sync', method: 'POST' };
    // Before: the row refuses the stored props — a pre-#21005 row would be
    // badged by the props gate without the replay.
    expect(schema.safeParse(props).success).toBe(false);
    const { out, notices, todos } = replayStored(pageWith({ type, properties: props }));
    const block = blockOf(out);
    expect(block.properties).toEqual({ ...rest, actionType: 'api', target: '/api/v1/ops/sync', method: 'POST' });
    expect(schema.safeParse(block.properties).success).toBe(true);
    expect(notices.map((n) => [n.from, n.to, n.path])).toEqual([
      ['endpoint', 'target', 'pages[0].regions[0].components[0].properties.target'],
    ]);
    expect(todos).toEqual([]);
  });

  it('a redundant twin is dropped; a disagreeing pair is kept and reported as a TODO', () => {
    const twin = replayStored(pageWith({
      type: 'action:icon',
      properties: { icon: 'x', actionType: 'api', target: '/api/v1/a', endpoint: '/api/v1/a' },
    }));
    expect(blockOf(twin.out).properties).toEqual({ icon: 'x', actionType: 'api', target: '/api/v1/a' });
    expect(twin.notices).toHaveLength(1);

    const pair = pageWith({
      type: 'action:button',
      properties: { label: 'Both', actionType: 'api', target: '/api/v1/a', endpoint: '/api/v1/b' },
    });
    const disagreeing = replayStored(pair);
    expect(disagreeing.out, 'left exactly as stored').toEqual(pair);
    expect(disagreeing.notices).toEqual([]);
    expect(disagreeing.todos.map((t) => t.path)).toEqual(['pages[0].regions[0].components[0].properties.endpoint']);
  });

  it.each([
    ['no `actionType`', { label: 'Legacy', endpoint: '/api/v1/legacy' }, /actionType: 'api'/],
    ['another `actionType`', { label: 'Open', actionType: 'url', endpoint: '/x' }, /"url"/],
    ['a non-string `endpoint`', { label: 'Cfg', actionType: 'api', endpoint: { url: '/x' } }, /not a string/],
  ])('%s: no lossless rewrite — left as stored and reported as a TODO', (_label, properties, reason) => {
    const page = pageWith({ type: 'action:button', properties });
    const { out, notices, todos } = replayStored(page);
    expect(out).toEqual(page);
    expect(notices).toEqual([]);
    expect(todos).toHaveLength(1);
    expect(todos[0]!.path).toBe('pages[0].regions[0].components[0].properties.endpoint');
    expect(todos[0]!.reason).toMatch(reason);
  });

  it('control: `endpoint` on another block type is neither converted nor reported', () => {
    const page = pageWith({ type: 'element:text', properties: { endpoint: '/not/an/action' } });
    const { out, notices, todos } = replayStored(page);
    expect(out).toEqual(page);
    expect(notices).toEqual([]);
    expect(todos).toEqual([]);
  });

  it('control: a canonical page comes back as the SAME reference, with no notice', () => {
    const clean = { pages: [pageWith({ type: 'action:button', properties: { label: 'Run', actionType: 'api', target: '/api/v1/run' } })] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(clean, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(out, 'nothing to rename ⇒ copy-on-write returns the input').toBe(clean);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });

  it('is idempotent — the converted result replays to itself with no second notice', () => {
    const once = applyConversions(
      { pages: [pageWith({ type: 'action:button', properties: { label: 'Go', actionType: 'api', endpoint: '/api/v1/go' } })] },
      { includeRetired: true },
    );
    const notices: ConversionNotice[] = [];
    const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(twice).toBe(once);
    expect(notices).toEqual([]);
  });

  it('the authoring funnel does not replay it — an author meets the rows\' rename instead', () => {
    const authored = { pages: [pageWith({ type: 'action:button', properties: { label: 'Go', actionType: 'api', endpoint: '/api/v1/go' } })] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(authored, { onNotice: (n) => notices.push(n) });
    expect(out).toBe(authored);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });
});
