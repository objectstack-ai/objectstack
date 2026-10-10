// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `slots.details` beside `slots.tabs` is refused (#22568, triage direction b).
 *
 * The slot menu reads as seven independent slots, and two of them are not:
 * `details` is the BODY of the Details tab, which lives inside the synthesized
 * `page:tabs` strip, and `tabs` replaces that whole strip. The console's
 * default-page synthesizer therefore reads `tabs` and never reads `details`
 * when both are authored, so the pair parsed, validated and saved while the
 * authored details body — its `sections`, its `hideFields` — never applied.
 * The platform's own `sys_user_detail` page was the measured instance.
 *
 * Bookkeeping shapes, pinned below:
 *
 *   1. `checkPageSlotPair`, an exported object-level check attached to
 *      `PageSchema` beside the three page checks before it, refuses the pair
 *      at `slots.details`, naming both slots and the fix. Its parity with the
 *      schema is pinned in `object-refinement-check-exports.test.ts`.
 *   2. No D2 conversion: where the details body goes inside an authored strip
 *      is the author's decision (which item, which label), and moving it makes
 *      visible a body that never rendered. A stored row replays unchanged.
 *   3. The D3 entry is `page-slots-details-beside-tabs-refused`.
 *
 * On the assertion set: a bare `PageSchema` parse raises zod issues, pinned by
 * `code`, `path` and the message's named subjects; the stack door wraps them
 * in the ADR-0112 envelope, pinned by `code` and `status`.
 */

import { describe, expect, it } from 'vitest';

import { applyConversionsToStoredItem } from '../conversions/stored';
import type { ConversionNotice } from '../conversions/types';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { PageSchema, definePage } from './page.zod';

const D3_ID = 'page-slots-details-beside-tabs-refused';

const DETAILS = {
  type: 'record:details',
  properties: {
    hideFields: ['id', 'internal_notes'],
    sections: [{ label: 'Identity', fields: ['name'] }],
  },
};
const TABS = {
  type: 'page:tabs',
  properties: {
    items: [{ label: 'Related', children: [{ type: 'record:related_list', properties: { objectName: 'contact', relationshipField: 'account_id' } }] }],
  },
};
const page = (slots: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name: 'account_detail',
  label: 'Account',
  type: 'record',
  object: 'account',
  kind: 'slotted',
  regions: [],
  slots,
  ...extra,
});

function refusalOf(value: unknown) {
  const r = PageSchema.safeParse(value);
  expect(r.success, 'expected a refusal').toBe(false);
  return r.success ? [] : r.error.issues;
}

describe('`slots.details` beside `slots.tabs` — the parse refuses the pair', () => {
  it.each([
    ['one component each', { details: DETAILS, tabs: TABS }],
    ['each an array', { details: [DETAILS], tabs: [TABS] }],
    ['an EMPTY `details: []` — a present slot is refused, not its contents', { details: [], tabs: TABS }],
  ])('refuses the pair (%s), at `slots.details`, naming both slots and the fix', (_label, slots) => {
    const issues = refusalOf(page(slots));
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue!.code).toBe('custom');
    expect(issue!.path).toEqual(['slots', 'details']);
    expect(issue!.message.startsWith('`slots.details` and `slots.tabs` are refused together')).toBe(true);
    // The remedy names the component to move and where it goes.
    expect(issue!.message).toContain('`record:details`');
    expect(issue!.message).toContain('`tabs` items');
    // Runtime prose carries no tracker number (`check:doc-authoring`).
    expect(issue!.message).not.toMatch(/#\d/);
  });

  it('refuses the pair whatever the page\'s `kind` — a page that omits it (the `full` default) too', () => {
    const { kind: _kind, ...kindless } = page({ details: DETAILS, tabs: TABS });
    expect(PageSchema.parse({ ...kindless, slots: {} }).kind).toBe('full');
    const issues = refusalOf(kindless);
    expect(issues.map((i) => i.path.join('.'))).toEqual(['slots.details']);
  });

  it('`definePage` — the authoring helper — throws on the pair', () => {
    expect(() => definePage(page({ details: DETAILS, tabs: TABS }) as never)).toThrow(/`slots\.details` and `slots\.tabs`/);
  });

  it('the stack door wraps the same refusal in its ADR-0112 envelope, at `pages.N.slots.details`', () => {
    const stack = {
      manifest: { id: 'com.example.pages', name: 'pages', version: '1.0.0', type: 'app', namespace: 'pgs' },
      pages: [
        page({ tabs: { type: 'page:tabs', properties: { items: [{ label: 'Details', children: [DETAILS] }] } } }, { name: 'pgs_moved' }),
        page({ details: DETAILS, tabs: TABS }, { name: 'pgs_pair' }),
      ],
    };
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
    try {
      defineStack(stack as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the pair page').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'pages.1.slots.details', code: 'custom' },
    ]);
  });
});

describe('CONTROL — a page authoring only one of the two slots is unchanged', () => {
  it.each([
    ['only `details`', { details: DETAILS }],
    ['only `tabs`', { tabs: TABS }],
    ['only `tabs`, carrying the `record:details` in its first item (the fix)', {
      tabs: { type: 'page:tabs', properties: { items: [{ label: 'Details', children: [DETAILS] }, ...TABS.properties.items] } },
    }],
    ['neither', { discussion: [] }],
  ])('%s — parses, and the slot map comes back as authored', (_label, slots) => {
    const r = PageSchema.safeParse(page(slots));
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
    if (r.success) expect(Object.keys(r.data.slots ?? {}).sort()).toEqual(Object.keys(slots).sort());
  });
});

describe('the ledger — a D3 entry and no D2 conversion', () => {
  it('step 18 carries the D3 entry, judging no mechanical edit', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]!.semantic.find((e) => e.id === D3_ID);
    expect(entry, D3_ID).toBeDefined();
    expect(entry!.conversionIds ?? []).toEqual([]);
  });

  it('a STORED pair row replays unchanged — no conversion moves the details body — and the parse still refuses it', () => {
    const notices: ConversionNotice[] = [];
    const row = page({ details: DETAILS, tabs: TABS });
    const rehydrated = applyConversionsToStoredItem('page', row, { onNotice: (n) => notices.push(n) });
    expect(rehydrated).toEqual(row);
    expect(notices.map((n) => n.conversionId)).toEqual([]);
    expect(refusalOf(rehydrated).map((i) => i.path.join('.'))).toEqual(['slots.details']);
  });
});
