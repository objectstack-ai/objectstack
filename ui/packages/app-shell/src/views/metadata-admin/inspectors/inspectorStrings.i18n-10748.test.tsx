// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10748 — designer inspector words that were English literals with NO
 * catalogue row now read new `engine.*` rows, in en-US and zh-CN.
 *
 * objectui#10696 moved the literals whose English already had a row; this card
 * is the rest of that family: the widget-type select, the widget inspector's
 * empty states and untitled fallback, the lookup filter's operator words, the
 * decision-branch picker's default suffix, the nested-node breadcrumb's name
 * and loop-body crumb, the Advanced (JSON) refusal, the variable data-picker
 * (its button, search box, empty text, section headings and reference
 * details) and the client-side expression shape errors.
 *
 * ── How each site is read ────────────────────────────────────────────────────
 * The objectui#10696 harness: every case reads the RENDERED attribute or text,
 * never a label function in isolation. Each zh expectation is read back from
 * the catalogue behind `zhRow` — not the key echoed back, not the en row — so
 * no case passes on a missing row and none restates a translation.
 *
 * ── Lit controls ─────────────────────────────────────────────────────────────
 * Beside each site, a word on the SAME mount that already rendered its zh row
 * before this change, read by the same kind of probe. A site that stays English
 * beside a lit control is the defect; both staying English is a broken harness.
 *
 * ── en ───────────────────────────────────────────────────────────────────────
 * The en cases read the same key's en row. Each en row carries the English the
 * literal did, which is why en renders unchanged.
 *
 * ── Left literal on purpose (the objectui#10678 / objectui#10651 ruling) ─────
 * Tokens, type names, object names, the `≥` / `≤` / `=` symbols, the ` · `
 * separator and the code spans inside an expression message are code or author
 * data, and read the same in every locale; the cases below assert them as they
 * are rather than as translations.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

// Every roster in these inspectors comes through the shared metadata client
// (stable identity, like the real memoized client). The trigger object's field
// catalogue is the one roster a case needs: it feeds the data-picker's
// `record.FIELD` / `previous.FIELD` rows and the approval groups.
const state = vi.hoisted(() => ({
  metadataClient: {
    get: async () => undefined,
    list: async (): Promise<unknown[]> => [],
    listDrafts: async (): Promise<unknown[]> => [],
  },
  fields: [
    { name: 'amount', label: 'Amount', type: 'number', hidden: false },
    // No label and no type: its `previous.code` detail is the bare fallback.
    { name: 'code', hidden: false },
  ] as Array<{ name: string; label?: string; type?: string; hidden: boolean }>,
  noFields: [] as never[],
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: (objectName?: string) => ({
    fields: objectName === 'account' ? state.fields : state.noFields,
    loading: false,
    error: null,
  }),
}));

import { t, tFormat } from '../i18n';
import { DashboardWidgetInspector } from './DashboardWidgetInspector';
import { DashboardDefaultInspector } from './DashboardDefaultInspector';
import { ObjectFieldInspector } from './ObjectFieldInspector';
import { FlowEdgeInspector } from './FlowEdgeInspector';
import { FlowNodeInspector } from './FlowNodeInspector';
import { encodeNestedNodeId, NESTED_NODE_KIND } from './flow-nested-selection';

afterEach(cleanup);

type Lang = 'en' | 'zh';
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;

/** The console mounts every inspector under the i18n provider in its language. */
function inLang(lang: Lang, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>{ui}</I18nProvider>,
  );
}

/** Let mount-time effects and resolved fetches settle. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** A zh catalogue row that is really there: not the echoed key, not the en row. */
function zhRow(key: string): string {
  const zh = t(key, 'zh-CN');
  expect(zh, `${key}: a missing zh row echoes the key back`).not.toBe(key);
  expect(zh, `${key}: the zh row must not be the English one`).not.toBe(t(key, 'en-US'));
  return zh;
}

/** The row in `lang`: `zhRow` under zh, the en row under en. */
function row(lang: Lang, key: string): string {
  return lang === 'zh' ? zhRow(key) : t(key, 'en-US');
}

/** The `<label>` whose text is exactly `text` — a lit-control probe. */
function hasLabel(text: string): boolean {
  return Array.from(document.body.querySelectorAll('label')).some((l) => l.textContent === text);
}

// ─── DashboardWidgetInspector ───────────────────────────────────────────────

function mountWidget(lang: Lang, draft: Record<string, unknown>, selection: { kind: string; id: string; label?: string }) {
  inLang(lang, (
    <DashboardWidgetInspector
      type="dashboard"
      name="sales"
      draft={draft}
      selection={selection}
      onPatch={() => {}}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
    />
  ));
}

/** Stored widget `type` → the row its option label reads. */
const WIDGET_TYPE_KEYS: ReadonlyArray<[string, string]> = [
  ['metric', 'engine.inspector.widget.type.metric'],
  ['bar', 'engine.inspector.widget.type.bar'],
  ['horizontal-bar', 'engine.inspector.widget.type.horizontalBar'],
  ['line', 'engine.inspector.widget.type.line'],
  ['area', 'engine.inspector.widget.type.area'],
  ['pie', 'engine.inspector.widget.type.pie'],
  ['donut', 'engine.inspector.widget.type.donut'],
  ['funnel', 'engine.inspector.widget.type.funnel'],
  ['table', 'engine.inspector.widget.type.table'],
  ['pivot', 'engine.inspector.widget.type.pivot'],
];

/** The widget-type select's trigger text, for a widget stored with `type`. */
function widgetTypeTrigger(lang: Lang, type: string): string | null {
  mountWidget(lang, { widgets: [{ id: 'w1', type, title: 'Revenue' }] }, { kind: 'widget', id: 'w1' });
  const trigger = document.getElementById('widget-type');
  expect(trigger?.getAttribute('role'), 'the widget-type select trigger').toBe('combobox');
  return trigger!.textContent;
}

/** The `InspectorEmpty` message paragraph. */
function emptyMessage(): string | null {
  const p = document.body.querySelector('.border-dashed p');
  expect(p, 'the empty-state message').toBeTruthy();
  return p!.textContent;
}

/** The widget header's title line (the element after the kind caption). */
function widgetHeaderTitle(): string | null {
  const title = document.body.querySelector('.truncate.text-sm.font-semibold');
  expect(title, 'the widget header title').toBeTruthy();
  return title!.textContent;
}

describe('DashboardWidgetInspector — the widget-type select’s options (objectui#10748)', () => {
  it('zh: every option a stored type selects reads its engine.inspector.widget.type.* row', () => {
    for (const [type, key] of WIDGET_TYPE_KEYS) {
      expect(widgetTypeTrigger('zh', type), type).toBe(zhRow(key));
      cleanup();
    }
  });

  it('zh, lit control: the same mount’s Type label already read its row', () => {
    widgetTypeTrigger('zh', 'bar');
    expect(hasLabel(zhRow('engine.inspector.widget.type'))).toBe(true);
  });

  it('en: every option reads the en row of the same key', () => {
    for (const [type, key] of WIDGET_TYPE_KEYS) {
      expect(widgetTypeTrigger('en', type), type).toBe(t(key, 'en-US'));
      cleanup();
    }
  });
});

describe('DashboardWidgetInspector — the empty states and the untitled fallback (objectui#10748)', () => {
  const closeButton = (lang: Lang) => screen.getByRole('button', { name: row(lang, 'engine.inspector.widget.close') });

  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: a selection of another kind reads engine.inspector.widget.unsupportedSelection; the Close button beside it is the lit control`, () => {
      mountWidget(lang, { widgets: [] }, { kind: 'field', id: 'x' });
      expect(closeButton(lang)).toBeTruthy();
      if (lang === 'zh') zhRow('engine.inspector.widget.unsupportedSelection');
      expect(emptyMessage()).toBe(tFormat('engine.inspector.widget.unsupportedSelection', LOCALE[lang], { kind: 'field' }));
    });

    it(`${lang}: a widget no longer in the draft reads engine.inspector.widget.removed; the Close button beside it is the lit control`, () => {
      mountWidget(lang, { widgets: [] }, { kind: 'widget', id: 'gone' });
      expect(closeButton(lang)).toBeTruthy();
      expect(emptyMessage()).toBe(row(lang, 'engine.inspector.widget.removed'));
    });

    it(`${lang}: an untitled widget is named by engine.inspector.widget.untitledN; the kind caption above it is the lit control`, () => {
      mountWidget(lang, { widgets: [{ id: 'w9', type: 'bar' }] }, { kind: 'widget', id: 'w9' });
      expect(screen.getByText(row(lang, 'engine.inspector.widget.kind'))).toBeTruthy();
      if (lang === 'zh') zhRow('engine.inspector.widget.untitledN');
      expect(widgetHeaderTitle()).toBe(tFormat('engine.inspector.widget.untitledN', LOCALE[lang], { n: 1 }));
    });
  }
});

// ─── DashboardDefaultInspector — the widget list ────────────────────────────
//
// Its `selectWidget` label carries the same fallback, but only behind
// `widget.id ||` after an early return on a missing id, so no mount reaches it;
// it reads the same row and is not pinned.

function mountDashboard(lang: Lang) {
  inLang(lang, (
    <DashboardDefaultInspector
      type="dashboard"
      name="sales"
      locale={LOCALE[lang]}
      draft={{ name: 'sales', label: 'Sales', widgets: [{ type: 'bar' }] }}
      onPatch={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
    />
  ));
}

describe('DashboardDefaultInspector — an untitled widget in the list (objectui#10748)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: a widget with no title and no id is named by engine.inspector.widget.untitledN; its remove button is the lit control`, () => {
      mountDashboard(lang);
      expect(screen.getAllByRole('button', { name: row(lang, 'engine.inspector.dashboard.removeWidget') })).toHaveLength(1);
      if (lang === 'zh') zhRow('engine.inspector.widget.untitledN');
      // The row's select button: the one beside the (lit) remove button.
      const selectButton = screen.getAllByRole('button').find((b) => b.classList.contains('text-left'));
      expect(selectButton?.textContent).toBe(tFormat('engine.inspector.widget.untitledN', LOCALE[lang], { n: 1 }));
    });
  }
});

// ─── ObjectFieldInspector — the lookup and roll-up filter operators ─────────

/** Stored operator → the leading symbol (none for the worded ones) and the row. */
const OPERATORS: ReadonlyArray<[string, string | undefined, string]> = [
  ['eq', '=', 'engine.inspector.condition.op.equals'],
  ['ne', '≠', 'engine.inspector.condition.op.notEquals'],
  ['gt', '>', 'engine.inspector.condition.op.greaterThan'],
  ['lt', '<', 'engine.inspector.condition.op.lessThan'],
  ['gte', '≥', 'engine.inspector.condition.op.atLeast'],
  ['lte', '≤', 'engine.inspector.condition.op.atMost'],
  ['contains', undefined, 'engine.inspector.condition.op.contains'],
  ['in', undefined, 'engine.inspector.condition.op.inAnyOf'],
  ['notIn', undefined, 'engine.inspector.condition.op.notIn'],
];

const opLabel = (lang: Lang, symbol: string | undefined, key: string) =>
  symbol ? `${symbol} ${row(lang, key)}` : row(lang, key);

const LOOKUP_FIELDS = {
  owner: {
    type: 'lookup',
    label: 'Owner',
    reference: 'user',
    lookupFilters: OPERATORS.map(([operator]) => ({ field: 'status', operator, value: '' })),
  },
  total: {
    type: 'summary',
    label: 'Total',
    summaryOperations: {
      object: 'opportunity',
      function: 'count',
      filter: { stage: 'won', amount: { $gte: 100 }, region: { $nin: ['EMEA'] } },
    },
  },
};

function mountField(lang: Lang, id: keyof typeof LOOKUP_FIELDS) {
  inLang(lang, (
    <ObjectFieldInspector
      type="object"
      name="account"
      draft={{ name: 'account', fields: LOOKUP_FIELDS }}
      selection={{ kind: 'field', id }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
    />
  ));
}

/** Every filter row's operator select trigger text, in row order. */
const operatorTriggers = (lang: Lang) =>
  screen
    .getAllByRole('combobox', { name: t('designer.field.lookup.filterOperator', LOCALE[lang]) })
    .map((c) => c.textContent);

describe('ObjectFieldInspector — the filter operators’ labels (objectui#10748)', () => {
  it('zh: every lookup operator reads its engine.inspector.condition.op.* row, the symbol outside the word', async () => {
    mountField('zh', 'owner');
    await flush();
    expect(operatorTriggers('zh')).toEqual(OPERATORS.map(([, symbol, key]) => opLabel('zh', symbol, key)));
  });

  it('zh, lit control: the same mount’s Operator label already read its row', async () => {
    mountField('zh', 'owner');
    await flush();
    expect(operatorTriggers('zh')).toHaveLength(OPERATORS.length);
    zhRow('designer.field.lookup.filterOperator');
  });

  it('zh: the roll-up filter’s operators read the same rows', async () => {
    mountField('zh', 'total');
    await flush();
    const pick = (op: string) => OPERATORS.find(([o]) => o === op)!;
    expect(operatorTriggers('zh')).toEqual(['eq', 'gte', 'notIn'].map((op) => opLabel('zh', pick(op)[1], pick(op)[2])));
  });

  it('en: both read the en rows of the same keys', async () => {
    mountField('en', 'owner');
    await flush();
    expect(operatorTriggers('en')).toEqual(OPERATORS.map(([, symbol, key]) => opLabel('en', symbol, key)));
  });
});

// ─── FlowEdgeInspector — the default branch's suffix ────────────────────────

const EXPR = 'record.amount > 100';

function mountEdge(lang: Lang, edge: Record<string, unknown>): HTMLElement {
  inLang(lang, (
    <FlowEdgeInspector
      type="flow"
      name="route"
      draft={{
        nodes: [
          { id: 'd1', type: 'decision', label: 'Route', config: { conditions: [{ expression: EXPR }, { label: 'Otherwise', expression: 'true' }] } },
          { id: 'n2', type: 'end', label: 'Done' },
        ],
        edges: [{ id: 'e1', source: 'd1', target: 'n2', ...edge }],
      }}
      selection={{ kind: 'edge', id: 'e1' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
    />
  ));
  // Found by its accessible name — the picker's own label read in `lang`, the
  // lit control on this mount, translated before this change.
  return screen.getByRole('combobox', { name: t('engine.inspector.flowEdge.branch', LOCALE[lang]) });
}

describe('FlowEdgeInspector — the default branch’s suffix (objectui#10748)', () => {
  it('zh: the catch-all branch reads engine.inspector.flowEdge.branchDefault after the separator', () => {
    expect(mountEdge('zh', { isDefault: true }).textContent).toBe(`Otherwise · ${zhRow('engine.inspector.flowEdge.branchDefault')}`);
  });

  it('zh, lit control: the picker is named by its zh label', () => {
    expect(mountEdge('zh', { isDefault: true })).toBeTruthy();
    zhRow('engine.inspector.flowEdge.branch');
  });

  it('en: reads the en row of the same key', () => {
    expect(mountEdge('en', { isDefault: true }).textContent).toBe(
      `Otherwise · ${t('engine.inspector.flowEdge.branchDefault', 'en-US')}`,
    );
  });
});

// ─── FlowNodeInspector — the nested breadcrumb and the Advanced (JSON) box ──

const LOOP_DRAFT = {
  nodes: [
    { id: 'start', type: 'start' },
    {
      id: 'each',
      type: 'loop',
      label: 'For each',
      config: {
        collection: '{items}',
        iteratorVariable: 'item',
        body: { nodes: [{ id: 'call', type: 'http', label: 'Call' }], edges: [] },
      },
    },
    { id: 'patchy', type: 'http', label: 'Patchy', config: { customKey: 1 } },
  ],
  edges: [{ source: 'start', target: 'each' }],
};

function mountNode(lang: Lang, selection: { kind: string; id: string }) {
  inLang(lang, (
    <FlowNodeInspector
      type="flow"
      name="renewal"
      draft={LOOP_DRAFT}
      selection={selection}
      onPatch={() => {}}
      onClearSelection={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
    />
  ));
}

const BODY_NODE = { kind: NESTED_NODE_KIND, id: encodeNestedNodeId({ containerId: 'each', regionKey: 'body', nodeId: 'call' }) };

/**
 * The breadcrumb, found by its container crumb (author data, the same in every
 * locale) so each case below reads one site without leaning on the other.
 */
function crumb(): Element {
  const el = screen.getByText('For each').parentElement;
  // container › region › node — the separators are aria-hidden.
  expect(el?.querySelectorAll('span:not([aria-hidden])'), 'three crumb segments').toHaveLength(3);
  return el!;
}

describe('FlowNodeInspector — the nested-node breadcrumb (objectui#10748)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: the breadcrumb is named by engine.inspector.flowNode.nestedLocation`, () => {
      mountNode(lang, BODY_NODE);
      expect(crumb().getAttribute('aria-label')).toBe(row(lang, 'engine.inspector.flowNode.nestedLocation'));
    });

    it(`${lang}: a loop body’s region crumb reads engine.flowRegion.body`, () => {
      mountNode(lang, BODY_NODE);
      const segments = Array.from(crumb().querySelectorAll('span:not([aria-hidden])'));
      expect(segments.map((s) => s.textContent)).toEqual(['For each', row(lang, 'engine.flowRegion.body'), 'Call']);
    });
  }

  it('zh, lit control: the nested-id hint on the same mount already read its row', () => {
    mountNode('zh', BODY_NODE);
    expect(screen.getByText(zhRow('engine.inspector.flowNode.nestedIdHint'))).toBeTruthy();
  });
});

describe('FlowNodeInspector — the Advanced (JSON) box refuses a non-object (objectui#10748)', () => {
  function commitAdvanced(value: string) {
    const box = document.body.querySelector('details textarea') as HTMLTextAreaElement;
    expect(box, 'the Advanced (JSON) box').toBeTruthy();
    fireEvent.change(box, { target: { value } });
    fireEvent.blur(box);
  }
  const advError = () => document.body.querySelector('details .text-destructive')?.textContent;

  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: an array reads engine.inspector.flowNode.advancedNotObject; the box’s own hint is the lit control`, () => {
      mountNode(lang, { kind: 'node', id: 'patchy' });
      expect(screen.getByText(row(lang, 'engine.inspector.flowNode.advancedHint'))).toBeTruthy();
      commitAdvanced('[1, 2]');
      expect(advError()).toBe(row(lang, 'engine.inspector.flowNode.advancedNotObject'));
    });
  }
});

// ─── The variable data-picker — button, search box, empty text, headings, details

/**
 * A record-updated flow whose decision has, in scope: two flow variables (one
 * typed), an upstream output, a loop item, and the trigger record with its
 * `previous` values; the approval node below reads the approval groups.
 */
const SCOPE_DRAFT = {
  variables: [{ name: 'daysBefore', type: 'number' }, { name: 'note' }],
  nodes: [
    { id: 'start', type: 'start', config: { triggerType: 'record-after-update', objectName: 'account' } },
    { id: 'fetch', type: 'get_record', label: 'Fetch', config: { outputVariable: 'acct' } },
    { id: 'each', type: 'loop', label: 'Each', config: { iteratorVariable: 'item' } },
    { id: 'd1', type: 'decision', label: 'Route', config: { conditions: [{ label: 'Big', expression: EXPR }] } },
    { id: 'appr', type: 'approval', label: 'Approve', config: { approvers: [{ type: 'expression', value: 'current.amount > 1' }] } },
  ],
  edges: [
    { id: 'e0', source: 'start', target: 'fetch' },
    { id: 'e1', source: 'fetch', target: 'each' },
    { id: 'e2', source: 'each', target: 'd1' },
    { id: 'e3', source: 'd1', target: 'appr' },
  ],
};

function mountScopedEdge(lang: Lang) {
  inLang(lang, (
    <FlowEdgeInspector
      type="flow"
      name="route"
      draft={SCOPE_DRAFT}
      selection={{ kind: 'edge', id: 'e3' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
    />
  ));
}

/**
 * The data-picker buttons on the mount, found by structure — the popover
 * trigger that sits beside the value input — so a case about the popover's
 * contents does not lean on the button's own name.
 */
function pickerButtons(): HTMLButtonElement[] {
  const found = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')).filter(
    (b) => b.previousElementSibling?.matches('input, textarea'),
  );
  expect(found.length, 'a data-picker button').toBeGreaterThan(0);
  return found;
}

/** Open the (only, or the last) picker on the mount; return its popover. */
async function openPicker(): Promise<HTMLElement> {
  fireEvent.click(pickerButtons().at(-1)!);
  await flush();
  const list = document.body.querySelector<HTMLElement>('[cmdk-root]');
  expect(list, 'the picker popover').toBeTruthy();
  return list!;
}

const headings = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('[cmdk-group-heading]')).map((h) => h.textContent);

/** token → its muted detail, for every row in the open picker. */
function details(root: HTMLElement): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const item of Array.from(root.querySelectorAll('[cmdk-item]'))) {
    const spans = item.querySelectorAll('span');
    out.set(spans[0]?.textContent ?? '', spans[1]?.textContent ?? null);
  }
  return out;
}

describe('the variable data-picker — its own words (objectui#10748)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: the button is named, and titled, by engine.flowScope.picker.insert`, () => {
      mountScopedEdge(lang);
      const button = pickerButtons().at(-1)!;
      expect(button.getAttribute('aria-label')).toBe(row(lang, 'engine.flowScope.picker.insert'));
      expect(button.getAttribute('title')).toBe(row(lang, 'engine.flowScope.picker.insert'));
    });

    it(`${lang}: the search box reads engine.flowScope.picker.search`, async () => {
      mountScopedEdge(lang);
      const search = (await openPicker()).querySelector<HTMLInputElement>('[cmdk-input]');
      expect(search, 'the picker search box').toBeTruthy();
      expect(search!.getAttribute('placeholder')).toBe(row(lang, 'engine.flowScope.picker.search'));
    });

    it(`${lang}: a search that matches nothing reads engine.flowScope.picker.empty`, async () => {
      mountScopedEdge(lang);
      const root = await openPicker();
      fireEvent.change(root.querySelector<HTMLInputElement>('[cmdk-input]')!, { target: { value: 'zzzz-no-such-reference' } });
      await flush();
      expect(root.querySelector('[cmdk-empty]')?.textContent).toBe(row(lang, 'engine.flowScope.picker.empty'));
    });
  }

  it('zh, lit control: the condition field beside the picker already read its label', async () => {
    mountScopedEdge('zh');
    expect(screen.getByText(zhRow('engine.inspector.flowEdge.condition'))).toBeTruthy();
  });
});

describe('the variable data-picker — section headings and reference details (objectui#10748)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: the four flow-scope headings read engine.flowScope.group.*`, async () => {
      mountScopedEdge(lang);
      expect(screen.getByText(row(lang, 'engine.inspector.flowEdge.condition'))).toBeTruthy();
      const root = await openPicker();
      expect(headings(root)).toEqual(
        ['variables', 'outputs', 'loop', 'trigger'].map((g) => row(lang, `engine.flowScope.group.${g}`)),
      );
    });

    it(`${lang}: a reference’s detail reads engine.flowScope.detail.*; tokens, type and object names stay as they are`, async () => {
      mountScopedEdge(lang);
      expect(screen.getByText(row(lang, 'engine.inspector.flowEdge.condition'))).toBeTruthy();
      const d = details(await openPicker());
      const L = LOCALE[lang];
      if (lang === 'zh') {
        for (const k of ['variable', 'variableTyped', 'triggerRecord', 'previousRecord', 'priorOf', 'priorValue']) zhRow(`engine.flowScope.detail.${k}`);
      }
      expect(d.get('daysBefore')).toBe(tFormat('engine.flowScope.detail.variableTyped', L, { type: 'number' }));
      expect(d.get('note')).toBe(t('engine.flowScope.detail.variable', L));
      expect(d.get('record')).toBe(tFormat('engine.flowScope.detail.triggerRecord', L, { object: 'account' }));
      expect(d.get('previous')).toBe(t('engine.flowScope.detail.previousRecord', L));
      expect(d.get('previous.amount')).toBe(tFormat('engine.flowScope.detail.priorOf', L, { detail: 'Amount' }));
      expect(d.get('previous.code')).toBe(t('engine.flowScope.detail.priorValue', L));
      // Lit control on the same list: author data passes through as it was.
      expect(d.get('record.amount')).toBe('Amount');
      expect(d.get('acct')).toBe('Fetch');
    });
  }
});

describe('the approval expression picker — its headings and the pre-update detail (objectui#10748)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: the approval groups read engine.flowScope.group.*, and vars.previous reads engine.flowScope.detail.preUpdateRow`, async () => {
      inLang(lang, (
        <FlowNodeInspector
          type="flow"
          name="renewal"
          draft={SCOPE_DRAFT}
          selection={{ kind: 'node', id: 'appr' }}
          onPatch={() => {}}
          onClearSelection={() => {}}
          readOnly={false}
          locale={LOCALE[lang]}
        />
      ));
      await flush();
      expect(screen.getAllByText(row(lang, 'engine.inspector.flowNode.kind')).length).toBeGreaterThan(0);
      const root = await openPicker();
      expect(headings(root)).toEqual(
        ['approvalCurrent', 'approvalTrigger', 'variables'].map((g) => row(lang, `engine.flowScope.group.${g}`)),
      );
      expect(details(root).get('vars.previous')).toBe(row(lang, 'engine.flowScope.detail.preUpdateRow'));
    });
  }
});

// ─── The client-side expression shape errors ────────────────────────────────
//
// Three render sites, one case each: the edge condition (FlowEdgeInspector), an
// expression config field (FlowNodeConfigField, the start node's entry
// condition) and a repeater cell (FlowExprIssue, a decision branch). The two
// template-role messages have no render site — every caller passes a CEL role —
// so they read their rows without a pin.

function mountConditionEdge(lang: Lang, condition: unknown) {
  inLang(lang, (
    <FlowEdgeInspector
      type="flow"
      name="route"
      draft={{
        nodes: [
          { id: 'a', type: 'http', label: 'A' },
          { id: 'b', type: 'end', label: 'B' },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b', condition }],
      }}
      selection={{ kind: 'edge', id: 'e1' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
    />
  ));
}

const alerts = () => screen.queryAllByRole('alert').map((a) => a.textContent);

describe('the client-side expression shape errors (objectui#10748)', () => {
  for (const lang of ['zh', 'en'] as const) {
    const L = LOCALE[lang];

    it(`${lang}: the edge condition — a brace inside CEL reads engine.flowExpr.braceInCondition, beside its lit Condition label`, () => {
      mountConditionEdge(lang, '{record.rating} >= 4');
      expect(screen.getByText(row(lang, 'engine.inspector.flowEdge.condition'))).toBeTruthy();
      if (lang === 'zh') zhRow('engine.flowExpr.braceInCondition');
      expect(alerts()).toEqual([tFormat('engine.flowExpr.braceInCondition', L, { ref: 'record.rating' })]);
    });

    it(`${lang}: the edge condition — a non-CEL envelope reads engine.flowExpr.celDialect`, () => {
      mountConditionEdge(lang, { dialect: 'template', source: 'Hi {x}' });
      expect(screen.getByText(row(lang, 'engine.inspector.flowEdge.condition'))).toBeTruthy();
      if (lang === 'zh') zhRow('engine.flowExpr.celDialect');
      expect(alerts()).toEqual([tFormat('engine.flowExpr.celDialect', L, { dialect: 'template' })]);
    });

    it(`${lang}: an expression config field — unbalanced parentheses read engine.flowExpr.unbalancedParens`, () => {
      inLang(lang, (
        <FlowNodeInspector
          type="flow"
          name="renewal"
          draft={{ nodes: [{ id: 'start', type: 'start', label: 'Start', config: { condition: '(record.a > 1' } }], edges: [] }}
          selection={{ kind: 'node', id: 'start' }}
          onPatch={() => {}}
          onClearSelection={() => {}}
          readOnly={false}
          locale={L}
        />
      ));
      expect(screen.getAllByText(row(lang, 'engine.inspector.flowNode.kind')).length).toBeGreaterThan(0);
      if (lang === 'zh') zhRow('engine.flowExpr.unbalancedParens');
      expect(alerts()).toContain(tFormat('engine.flowExpr.unbalancedParens', L, { source: '(record.a > 1' }));
    });

    it(`${lang}: a decision branch cell — unbalanced brackets read engine.flowExpr.unbalancedBrackets`, () => {
      inLang(lang, (
        <FlowNodeInspector
          type="flow"
          name="renewal"
          draft={{ nodes: [{ id: 'd1', type: 'decision', label: 'Route', config: { conditions: [{ label: 'Big', expression: 'record.tags[0' }] } }], edges: [] }}
          selection={{ kind: 'node', id: 'd1' }}
          onPatch={() => {}}
          onClearSelection={() => {}}
          readOnly={false}
          locale={L}
        />
      ));
      expect(screen.getAllByText(row(lang, 'engine.inspector.flowNode.kind')).length).toBeGreaterThan(0);
      if (lang === 'zh') zhRow('engine.flowExpr.unbalancedBrackets');
      expect(alerts()).toContain(tFormat('engine.flowExpr.unbalancedBrackets', L, { source: 'record.tags[0' }));
    });
  }
});
