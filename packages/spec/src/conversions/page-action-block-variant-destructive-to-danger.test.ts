// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import {
  ActionButtonPropsSchema,
  ActionGroupPropsSchema,
  ActionIconPropsSchema,
  ActionMenuPropsSchema,
  ElementButtonPropsSchema,
  RecordAlertActionSchema,
  RecordQuickActionsProps,
} from '../ui/component.zod.js';
import { ActionSchema } from '../ui/action.zod.js';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry.js';
import { applyConversions } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice } from './types.js';

/**
 * `page-action-block-variant-destructive-to-danger` — one spelling for an
 * action's destructive variant (#26779).
 *
 * `ActionSchema.variant`, the declaration the action runner dispatches, says
 * `danger`; the action block rows said `destructive` and refused `danger`.
 * The rows now take `danger` and refuse `destructive` with the rename, and
 * this D2 entry rewrites the old value in data at rest. The fixture pair in
 * `conversions.test.ts` already proves before → after over the whole table.
 * What this file pins:
 *
 *   - the six rows accept `danger` and refuse `destructive` with the rename
 *     prescription at `variant`, while every other miss keeps the enum's own
 *     message, and the block dialect's `danger` is the declaration's word;
 *   - the stored-row seam REWRITES `destructive` to `danger` on every row
 *     shape, and the result parses against the row that now refuses it;
 *   - the authoring funnel does NOT replay it;
 *   - the same seam renames an `action:bar`'s own `variant` and its members',
 *     though the bar has no row: it draws its members through the blocks;
 *   - another component type's `variant`, even `destructive`, and every other
 *     variant are left byte-identical with no notice;
 *   - the D3 entry's text says what the rows measure: `element:button` spells
 *     the arm `danger` and refuses `destructive`, and only the record blocks
 *     that forward to the Button primitive still take its `destructive`;
 *   - idempotence, and copy-on-write identity for a page with nothing to do.
 */
const ID = 'page-action-block-variant-destructive-to-danger';

type Parse = { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } };
type Parser = { safeParse: (value: unknown) => Parse };

/** Each row, and how to place `variant` on it. */
const ROWS: Array<[string, Parser, (variant: string) => Record<string, unknown>, PropertyKey[]]> = [
  ['action:button', ActionButtonPropsSchema, (variant) => ({ label: 'Purge', variant }), ['variant']],
  ['action:icon', ActionIconPropsSchema, (variant) => ({ icon: 'trash', variant }), ['variant']],
  ['action:group', ActionGroupPropsSchema, (variant) => ({ actions: [], variant }), ['variant']],
  ['action:group member', ActionGroupPropsSchema, (variant) => ({ actions: [{ label: 'Purge', type: 'script', variant }] }), ['actions', 0, 'variant']],
  ['action:menu', ActionMenuPropsSchema, (variant) => ({ actions: [], variant }), ['variant']],
  ['action:menu member', ActionMenuPropsSchema, (variant) => ({ actions: [{ label: 'Purge', type: 'script', variant }] }), ['actions', 0, 'variant']],
];

/** A stored `page` row carrying one block in a region. */
const pageWith = (component: Record<string, unknown>) => ({
  name: 'ops_cleanup',
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

describe('the action block rows spell the destructive variant `danger` (#26779)', () => {
  it('`danger` is the word `ActionSchema.variant` declares', () => {
    expect(ActionSchema.safeParse({ name: 'purge', label: 'Purge', type: 'script', target: 'purge', variant: 'danger' }).success).toBe(true);
  });

  it.each(ROWS)('%s accepts `danger`', (_row, schema, place) => {
    expect(schema.safeParse(place('danger')).success).toBe(true);
  });

  it.each(ROWS)('%s refuses `destructive` with the rename onto `danger`', (_row, schema, place, at) => {
    const refused = schema.safeParse(place('destructive'));
    expect(refused.success).toBe(false);
    const issues = refused.error!.issues.filter((issue) => issue.path.join('.') === at.join('.'));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("`variant: 'destructive'` was renamed `'danger'` in @objectstack/spec 18");
    expect(issues[0]!.message).toContain("Write `variant: 'danger'`");
  });

  it.each(ROWS)('CONTROL: %s keeps the enum\'s own message for any other miss', (_row, schema, place, at) => {
    const refused = schema.safeParse(place('loud'));
    expect(refused.success).toBe(false);
    const issues = refused.error!.issues.filter((issue) => issue.path.join('.') === at.join('.'));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).not.toContain('renamed');
    expect(issues[0]!.message).toContain('"danger"');
  });
});

describe('page-action-block-variant-destructive-to-danger (ADR-0087 D2)', () => {
  it('is registered for protocol 18 and retired from the authoring load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
  });

  it.each([
    ['action:button', ActionButtonPropsSchema, { label: 'Purge', actionType: 'script', confirmText: 'This cannot be undone.' }],
    ['action:icon', ActionIconPropsSchema, { icon: 'trash', actionType: 'script' }],
    ['action:group', ActionGroupPropsSchema, { actions: [] }],
    ['action:menu', ActionMenuPropsSchema, { actions: [] }],
  ] as const)('the stored-row seam rewrites `variant: \'destructive\'` to `\'danger\'` on `%s`', (type, schema, rest) => {
    const props = { ...rest, variant: 'destructive' };
    expect(schema.safeParse(props).success).toBe(false);
    const { out, notices } = replayStored(pageWith({ type, properties: props }));
    const block = blockOf(out);
    expect(block.properties).toEqual({ ...rest, variant: 'danger' });
    expect(schema.safeParse(block.properties).success).toBe(true);
    expect(notices.map((n) => [n.from, n.to, n.path])).toEqual([['destructive', 'danger', `${AT}.variant`]]);
  });

  it.each([
    ['action:group', ActionGroupPropsSchema],
    ['action:menu', ActionMenuPropsSchema],
  ] as const)('the stored-row seam rewrites a `%s` member\'s `variant: \'destructive\'`, and only that member', (type, schema) => {
    const props = {
      actions: [
        { label: 'Copy', type: 'script', variant: 'ghost' },
        { label: 'Purge', type: 'script', variant: 'destructive' },
      ],
    };
    expect(schema.safeParse(props).success).toBe(false);
    const { out, notices } = replayStored(pageWith({ type, properties: props }));
    const block = blockOf(out);
    expect(block.properties).toEqual({
      actions: [
        { label: 'Copy', type: 'script', variant: 'ghost' },
        { label: 'Purge', type: 'script', variant: 'danger' },
      ],
    });
    expect(schema.safeParse(block.properties).success).toBe(true);
    // The untouched member keeps its identity (copy-on-write).
    expect((block.properties as { actions: unknown[] }).actions[0]).toBe(props.actions[0]);
    expect(notices.map((n) => [n.from, n.to, n.path])).toEqual([['destructive', 'danger', `${AT}.actions[1].variant`]]);
  });

  it('the stored-row seam rewrites an `action:bar`\'s own `variant` and its `actions` / `systemActions` members\'', () => {
    const props = {
      variant: 'destructive',
      actions: [
        { name: 'copy', label: 'Copy', type: 'script', variant: 'ghost' },
        { name: 'purge', label: 'Purge', type: 'script', variant: 'destructive' },
      ],
      systemActions: [{ name: 'sys_delete', label: 'Delete', type: 'script', variant: 'destructive' }],
    };
    const { out, notices } = replayStored(pageWith({ type: 'action:bar', properties: props }));
    const block = blockOf(out);
    expect(block.properties).toEqual({
      variant: 'danger',
      actions: [
        { name: 'copy', label: 'Copy', type: 'script', variant: 'ghost' },
        { name: 'purge', label: 'Purge', type: 'script', variant: 'danger' },
      ],
      systemActions: [{ name: 'sys_delete', label: 'Delete', type: 'script', variant: 'danger' }],
    });
    expect((block.properties as { actions: unknown[] }).actions[0]).toBe(props.actions[0]);
    expect(notices.map((n) => [n.from, n.to, n.path])).toEqual([
      ['destructive', 'danger', `${AT}.variant`],
      ['destructive', 'danger', `${AT}.actions[1].variant`],
      ['destructive', 'danger', `${AT}.systemActions[0].variant`],
    ]);
  });

  it.each([
    ['the canonical `danger`', { type: 'action:button', properties: { label: 'Purge', variant: 'danger' } }],
    ['another variant', { type: 'action:icon', properties: { icon: 'copy', variant: 'outline' } }],
    ["another component type's `destructive` (an `element:button`, whose own row refuses it)", { type: 'element:button', properties: { label: 'Reset', variant: 'destructive' } }],
    ["a `destructive` member on a block that has no members", { type: 'action:button', properties: { label: 'Go', actions: [{ variant: 'destructive' }] } }],
    ['a member that is not an object', { type: 'action:menu', properties: { actions: ['destructive'] } }],
    ['`actions` that is not a list', { type: 'action:group', properties: { actions: { variant: 'destructive' } } }],
    ["a `systemActions` list on a block that has no such list", { type: 'action:menu', properties: { systemActions: [{ variant: 'destructive' }] } }],
  ])('control: %s is left as stored, with no notice', (_label, component) => {
    const page = pageWith(component);
    const { out, notices } = replayStored(page);
    expect(out).toEqual(page);
    expect(notices).toEqual([]);
  });

  it('control: a canonical page comes back as the SAME reference, with no notice', () => {
    const clean = { pages: [pageWith({ type: 'action:icon', properties: { icon: 'trash', variant: 'danger' } })] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(clean, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(out, 'nothing to rename ⇒ copy-on-write returns the input').toBe(clean);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });

  it('is idempotent — the converted result replays to itself with no second notice', () => {
    const once = applyConversions(
      { pages: [pageWith({ type: 'action:button', properties: { label: 'Purge', variant: 'destructive' } })] },
      { includeRetired: true },
    );
    const notices: ConversionNotice[] = [];
    const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(twice).toBe(once);
    expect(notices).toEqual([]);
  });

  it('the authoring funnel does not replay it — an author meets the rows\' refusal instead', () => {
    const authored = { pages: [pageWith({ type: 'action:button', properties: { label: 'Purge', variant: 'destructive' } })] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(authored, { onNotice: (n) => notices.push(n) });
    expect(out).toBe(authored);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });
});

/**
 * The D3 entry's `reason` is compiled into the 18.x upgrade guide, so its
 * sentence about the components this rename leaves alone is pinned against
 * the rows it describes (#27589). It once said `element:button` keeps
 * `destructive`, a value that row refuses: an author who followed the guide
 * wrote a page the save door rejects.
 */
describe('the D3 entry says what the untouched components accept (#27589)', () => {
  // Read from the generated chain, the source `build-upgrade-guide.ts` prints.
  const refusedEntry = MIGRATIONS_BY_MAJOR[18]!.semantic.find(
    (s) => s.id === 'ui-page-action-block-variant-destructive-refused',
  )!;

  it('is registered on the protocol 18 step', () => {
    expect(refusedEntry, 'the D3 entry is on step 18').toBeDefined();
  });

  it('`element:button` spells the arm `danger` and refuses `destructive`', () => {
    expect(ElementButtonPropsSchema.safeParse({ label: 'Reset', variant: 'danger' }).success).toBe(true);
    expect(ElementButtonPropsSchema.safeParse({ label: 'Reset', variant: 'destructive' }).success).toBe(false);
    expect(refusedEntry.reason).toContain(
      '`element:button` already spells it `danger` (`ElementButtonPropsSchema.variant`) and refuses `destructive`, '
        + 'so it is not touched.',
    );
  });

  it('the record blocks that forward to the Button primitive still take its `destructive`', () => {
    expect(RecordQuickActionsProps.safeParse({ actionNames: ['purge'], variant: 'destructive' }).success).toBe(true);
    expect(RecordAlertActionSchema.safeParse({ actionName: 'purge', variant: 'destructive' }).success).toBe(true);
    expect(refusedEntry.reason).toContain(
      "`destructive` is the React Button primitive's own word; the two record blocks that forward a variant to that "
        + 'primitive unchanged, `record:quick_actions` and a `record:alert` action, still take it and are not touched '
        + 'either.',
    );
  });

  it('no longer tells an author that `element:button` keeps `destructive`', () => {
    for (const text of [refusedEntry.reason, refusedEntry.replacement, refusedEntry.acceptanceCriteria]) {
      expect(text).not.toMatch(/keeps? `destructive`/);
      expect(text).not.toContain('`element:button` and the like');
    }
  });
});
