// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ActionButtonPropsSchema, ActionIconPropsSchema, ComponentPropsMap } from '../ui/component.zod.js';
import { applyConversions } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice } from './types.js';

/**
 * `page-action-row-navigation-executor-to-url` — the D2 half of refusing the
 * executor value `'navigation'` on the page action rows.
 *
 * The fixture pair in `conversions.test.ts` already proves before → after over
 * the whole table. What this file pins:
 *
 *   - the stored-row seam REWRITES the alias to `'url'` on all four row shapes
 *     (the entry is `retiredFromLoadPath`, so only data-at-rest seams and
 *     `os migrate meta` apply it), and the result parses against the row that
 *     now refuses the alias;
 *   - the authoring funnel does NOT replay it — an author meets the rows'
 *     refusal instead;
 *   - every other executor value, and another block's `'navigation'`, is left
 *     byte-identical with no notice;
 *   - idempotence, and copy-on-write identity for a page with nothing to do.
 */
const ID = 'page-action-row-navigation-executor-to-url';

type Parser = { safeParse: (value: unknown) => { success: boolean } };
const GROUP = ComponentPropsMap['action:group'] as unknown as Parser;
const MENU = ComponentPropsMap['action:menu'] as unknown as Parser;

/** A stored `page` row carrying one block in a region. */
const pageWith = (component: Record<string, unknown>) => ({
  name: 'ops_links',
  regions: [{ name: 'main', components: [component] }],
});

/** The one block of a converted {@link pageWith} row. */
const blockOf = (page: unknown) =>
  (page as { regions: { components: Record<string, unknown>[] }[] }).regions[0]!.components[0]!;

/** Replay the stored chain over `page`, collecting this entry's notices. */
function replayStored(page: Record<string, unknown>) {
  const notices: ConversionNotice[] = [];
  const out = applyConversionsToStoredItem('page', page, { onNotice: (n) => notices.push(n) });
  return { out, notices: notices.filter((n) => n.conversionId === ID) };
}

const AT = 'pages[0].regions[0].components[0].properties';

describe('page-action-row-navigation-executor-to-url (ADR-0087 D2)', () => {
  it('is registered for protocol 18 and retired from the authoring load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
  });

  it.each([
    ['action:button', ActionButtonPropsSchema, { label: 'Runbook' }],
    ['action:icon', ActionIconPropsSchema, { icon: 'book' }],
  ] as const)('the stored-row seam rewrites `actionType: \'navigation\'` to `\'url\'` on `%s`', (type, schema, rest) => {
    const props = { ...rest, actionType: 'navigation', target: '/apps/ops/runbook', openIn: 'new-tab' };
    // Before: the row refuses the stored alias.
    expect(schema.safeParse(props).success).toBe(false);
    const { out, notices } = replayStored(pageWith({ type, properties: props }));
    const block = blockOf(out);
    expect(block.properties).toEqual({ ...rest, actionType: 'url', target: '/apps/ops/runbook', openIn: 'new-tab' });
    expect(schema.safeParse(block.properties).success).toBe(true);
    expect(notices.map((n) => [n.from, n.to, n.path])).toEqual([['navigation', 'url', `${AT}.actionType`]]);
  });

  it.each([
    ['action:group', GROUP],
    ['action:menu', MENU],
  ] as const)('the stored-row seam rewrites a `%s` member\'s `type: \'navigation\'` to `\'url\'`, and only that member', (type, schema) => {
    const props = {
      actions: [
        { label: 'Run', type: 'api', target: '/api/v1/ops/run' },
        { label: 'Runs', type: 'navigation', target: '/apps/ops/runs' },
      ],
    };
    expect(schema.safeParse(props).success).toBe(false);
    const { out, notices } = replayStored(pageWith({ type, properties: props }));
    const block = blockOf(out);
    expect(block.properties).toEqual({
      actions: [
        { label: 'Run', type: 'api', target: '/api/v1/ops/run' },
        { label: 'Runs', type: 'url', target: '/apps/ops/runs' },
      ],
    });
    expect(schema.safeParse(block.properties).success).toBe(true);
    // The untouched member keeps its identity (copy-on-write).
    expect((block.properties as { actions: unknown[] }).actions[0]).toBe(props.actions[0]);
    expect(notices.map((n) => [n.from, n.to, n.path])).toEqual([['navigation', 'url', `${AT}.actions[1].type`]]);
  });

  it.each([
    ['the canonical `url`', { type: 'action:button', properties: { label: 'Home', actionType: 'url', target: '/apps/ops' } }],
    ['a host-registered handler name', { type: 'action:button', properties: { label: 'Edit', actionType: 'navigate_edit' } }],
    ['an `element:button` inline action (the parse\'s own fold)', { type: 'element:button', properties: { label: 'Pricing', action: { type: 'navigation', to: '/pricing' } } }],
    ['a member that is not an object', { type: 'action:menu', properties: { actions: ['navigation'] } }],
    ['`actions` that is not a list', { type: 'action:group', properties: { actions: { type: 'navigation' } } }],
  ])('control: %s is left as stored, with no notice', (_label, component) => {
    const page = pageWith(component);
    const { out, notices } = replayStored(page);
    expect(out).toEqual(page);
    expect(notices).toEqual([]);
  });

  it('control: a canonical page comes back as the SAME reference, with no notice', () => {
    const clean = { pages: [pageWith({ type: 'action:icon', properties: { icon: 'play', actionType: 'url', target: '/apps/ops' } })] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(clean, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(out, 'nothing to rename ⇒ copy-on-write returns the input').toBe(clean);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });

  it('is idempotent — the converted result replays to itself with no second notice', () => {
    const once = applyConversions(
      { pages: [pageWith({ type: 'action:button', properties: { label: 'Go', actionType: 'navigation', target: '/apps/ops' } })] },
      { includeRetired: true },
    );
    const notices: ConversionNotice[] = [];
    const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(twice).toBe(once);
    expect(notices).toEqual([]);
  });

  it('the authoring funnel does not replay it — an author meets the rows\' refusal instead', () => {
    const authored = { pages: [pageWith({ type: 'action:button', properties: { label: 'Go', actionType: 'navigation', target: '/apps/ops' } })] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(authored, { onNotice: (n) => notices.push(n) });
    expect(out).toBe(authored);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });
});
