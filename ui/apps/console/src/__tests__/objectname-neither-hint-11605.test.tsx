/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11605 — a node that names its object in neither place (no
 * `objectName`, no `dataSource.object`) shows a "no object named" hint.
 *
 * The registrations these blocks publish stopped declaring `objectName`
 * required (`objectname-binding-required-11605.test.ts`, beside this file), so
 * the page compile accepts such a node, and the runtime's answer is now the
 * only signal. Measured before this card, through `SchemaRenderer` under a
 * provider with an adapter, each of these answered with a blank that reads as
 * an empty query: `list-view` "Nothing here yet", `object-kanban` "No cards",
 * `object-form` a field-less card, `embeddable-form` a form with no fields and
 * a Submit button, `object-master-detail-form` an empty parent, `object-metric`
 * a dash, `object-chart` an empty frame, `object-pivot` "its query returned no
 * records yet". `object-grid` already answered with its own "Object name
 * required for data fetching" error and is not opted in.
 *
 * Each member opts in through `ElementDataSourceGate`'s `requiresObject`, and
 * the gate draws the hint after the binding is applied. `list-view` and
 * `view:list` draw it themselves, after the same binding, because a page
 * `list-view` names its object in `data` rather than `objectName`
 * (objectui#12099): their hint names `data.object`. Rows per member:
 * 1. The neither node draws the hint, naming the member's object key, and asks
 *    the data layer for nothing.
 * 2. Control: the same node naming its object (`objectName`, or `data` on the
 *    two list rows) draws no hint. On those two rows the retired `objectName`
 *    names nothing: the hint is drawn and nothing is fetched.
 * 3. Control: the same node bound by `dataSource.object` draws no hint.
 * 4. Control, where the block has another record source: the neither node with
 *    that source draws no hint, so the hint is not painted over a block that
 *    is working. `object-kanban` has two such rows: inline `data`, and lanes
 *    that carry their own `cards`. `object-form` and `view:form` have two
 *    kinds: inline `customFields`, and, for each sectioned `formType`
 *    (`tabbed`, `wizard`, `split`, `drawer`, `modal`), sections whose every
 *    field is inline.
 */

import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// The graphs whose registrations this reads, at module scope: their cold
// transform is billed to the import phase (AGENTS.md test discipline).
import '@object-ui/components';
import '../register-plugins';

/** Run the console's lazy loaders, so each tag mounts its real renderer. */
async function resolveLazy(types: readonly string[]): Promise<void> {
  await Promise.all(
    types.map((type) => {
      const bare = type.includes(':') ? type.slice(type.indexOf(':') + 1) : type;
      return ComponentRegistry.loadLazy(type) ?? ComponentRegistry.loadLazy(bare) ?? Promise.resolve();
    }),
  );
}

const HINT = 'No object named: set objectName or dataSource.object.';
/** The page `list-view` key is `data` (objectui#12099), so its hint names `data.object`. */
const LIST_HINT = 'No object named: set data.object or dataSource.object.';
const LIST_NAMED = { data: { provider: 'object', object: 'account' } };

/**
 * Each member: the tag, the gate's `testId` stem, the props a complete node
 * carries beside its object, and the block's other record source where it has
 * one (row 4).
 */
const MEMBERS: ReadonlyArray<{
  type: string;
  testId: string;
  base: Record<string, unknown>;
  otherSource?: Record<string, unknown>;
  /** The keys that name the object, where they are not `objectName`. */
  named?: Record<string, unknown>;
  /** The hint, where it names another key than `objectName`. */
  hint?: string;
}> = [
  { type: 'list-view', testId: 'list-view', base: {}, otherSource: { data: { provider: 'value', items: [] } }, named: LIST_NAMED, hint: LIST_HINT },
  { type: 'view:list', testId: 'list-view', base: {}, otherSource: { data: { provider: 'value', items: [] } }, named: LIST_NAMED, hint: LIST_HINT },
  {
    type: 'object-form',
    testId: 'object-form',
    base: {},
    otherSource: { customFields: [{ name: 'title', label: 'Title', type: 'text' }] },
  },
  {
    type: 'view:form',
    testId: 'object-form',
    base: {},
    otherSource: { customFields: [{ name: 'title', label: 'Title', type: 'text' }] },
  },
  { type: 'embeddable-form', testId: 'embeddable-form', base: { formId: 'contact_us' } },
  {
    type: 'object-master-detail-form',
    testId: 'object-master-detail-form',
    base: { details: [{ childObject: 'order_line', title: 'Lines' }] },
  },
  { type: 'object-kanban', testId: 'object-kanban', base: { groupBy: 'stage' }, otherSource: { data: [] } },
  { type: 'object-metric', testId: 'object-metric', base: { label: 'Open deals' }, otherSource: { fallbackValue: '42' } },
  {
    type: 'object-chart',
    testId: 'object-chart',
    base: { chartType: 'bar' },
    otherSource: { data: [{ name: 'Jan', value: 1 }] },
  },
  {
    type: 'view:chart',
    testId: 'object-chart',
    base: { chartType: 'bar' },
    otherSource: { data: [{ name: 'Jan', value: 1 }] },
  },
  {
    type: 'object-pivot',
    testId: 'object-pivot',
    base: { rowField: 'region', columnField: 'stage', valueField: 'amount' },
    otherSource: { data: [{ region: 'EU', stage: 'won', amount: 1 }] },
  },
];

await resolveLazy(MEMBERS.map((member) => member.type));

/** A data source that records every call and answers each with nothing. */
function recordingAdapter(): { adapter: unknown; calls: string[] } {
  const calls: string[] = [];
  const record = (key: string) => (...args: unknown[]) => {
    calls.push(`${key}(${args.map((a) => JSON.stringify(a) ?? 'undefined').join(', ')})`);
    return /^on[A-Z]/.test(key) || key === 'subscribe' ? () => {} : Promise.resolve([]);
  };
  const seeded: Record<string, unknown> = {};
  for (const method of ['find', 'findOne', 'create', 'update', 'delete', 'aggregate', 'count', 'getObjectSchema', 'getObjects', 'getView', 'listViews', 'onMutation']) {
    seeded[method] = record(method);
  }
  const adapter = new Proxy(seeded, {
    get: (target, key: string) => (key in target ? target[key] : record(key)),
  });
  return { adapter, calls };
}

async function mount(schema: Record<string, unknown>) {
  const { adapter, calls } = recordingAdapter();
  const view = render(
    <SchemaRendererProvider dataSource={adapter as never}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>,
  );
  // Settle: a block may fetch from an effect, after a lazy renderer resolves.
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  const html = view.container.innerHTML;
  const text = view.container.textContent ?? '';
  // The drawer and modal form variants render into a portal, outside the
  // container, so the body is read too.
  const bodyText = document.body.textContent ?? '';
  try {
    view.unmount();
  } catch {
    /* teardown is not the subject */
  }
  return { html, text, bodyText, calls, hasHint: (testId: string) => html.includes(`data-testid="${testId}-no-object"`) };
}

/**
 * Sections whose every field is an inline runtime `FormField`: the sectioned
 * form variants read them as an inline field source, a target-less collector
 * whose `onSuccess` is the write (objectui#10254, `hasInlineFieldSource`).
 */
const INLINE_SECTIONS = [{ label: 'Contact', fields: [{ name: 'email', label: 'Email address', type: 'text' }] }];

/** The `formType`s `ObjectForm` dispatches to a sectioned renderer of its own. */
const SECTIONED_VARIANTS = ['tabbed', 'wizard', 'split', 'drawer', 'modal'] as const;

const SECTIONED_ROWS = (['object-form', 'view:form'] as const).flatMap((type) =>
  SECTIONED_VARIANTS.map((formType) => ({ type, formType })),
);

describe('objectui#11605 — a node naming its object in neither place shows the no-object hint', () => {
  it.each(MEMBERS)('$type — the neither node draws the hint and fetches nothing', async ({ type, testId, base, hint = HINT }) => {
    const r = await mount({ type, ...base });
    expect(r.html, `<${type}> crashed instead of answering`).not.toContain('failed to render');
    expect(r.hasHint(testId), `<${type}> drew no no-object hint:\n${r.text.slice(0, 300)}`).toBe(true);
    expect(r.text).toContain(hint);
    expect(r.calls).toEqual([]);
  });

  it.each(MEMBERS)('$type — control: naming its object, no hint', async ({ type, testId, base, named = { objectName: 'account' }, hint = HINT }) => {
    const r = await mount({ type, ...base, ...named });
    expect(r.html).not.toContain('failed to render');
    expect(r.hasHint(testId)).toBe(false);
    expect(r.text).not.toContain(hint);
  });

  it.each(MEMBERS.filter((member) => member.named))(
    '$type — the retired objectName names nothing: the hint is drawn and nothing is fetched',
    async ({ type, testId, base, hint }) => {
      const r = await mount({ type, ...base, objectName: 'account' });
      expect(r.html).not.toContain('failed to render');
      expect(r.hasHint(testId)).toBe(true);
      expect(r.text).toContain(hint);
      expect(r.calls).toEqual([]);
    },
  );

  it.each(MEMBERS)('$type — control: bound by dataSource.object, no hint', async ({ type, testId, base, hint = HINT }) => {
    const r = await mount({ type, ...base, dataSource: { object: 'account' } });
    expect(r.html).not.toContain('failed to render');
    expect(r.hasHint(testId)).toBe(false);
    expect(r.text).not.toContain(hint);
  });

  it.each(MEMBERS.filter((member) => member.otherSource))(
    '$type — control: another record source, no hint',
    async ({ type, testId, base, otherSource }) => {
      const r = await mount({ type, ...base, ...otherSource });
      expect(r.html).not.toContain('failed to render');
      expect(r.hasHint(testId)).toBe(false);
    },
  );

  it.each(SECTIONED_ROWS)(
    '$type formType $formType — control: fully-inline sections are a record source, the collector renders, no hint',
    async ({ type, formType }) => {
      // No `objectName`, no binding and no `customFields`: the inline sections
      // ARE the form, so the hint must not be painted over it.
      const r = await mount({ type, formType, sections: INLINE_SECTIONS });
      expect(r.html).not.toContain('failed to render');
      expect(r.hasHint('object-form'), `<${type} formType=${formType}> drew the no-object hint over an inline collector`).toBe(false);
      expect(r.bodyText).toContain('Email address');
    },
  );

  it('object-kanban — control: lanes that carry their own cards are a record source, no hint', async () => {
    // A static board: the board keeps a lane's own `cards` when it merges rows
    // into its lanes, so this node draws cards with no object and no `data`.
    const r = await mount({
      type: 'object-kanban',
      columns: [{ id: 'todo', title: 'To Do', cards: [{ id: '1', title: 'Static card' }] }],
    });
    expect(r.html).not.toContain('failed to render');
    expect(r.hasHint('object-kanban')).toBe(false);
    expect(r.text).toContain('Static card');
  });
});
