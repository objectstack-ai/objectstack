// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10804 (objectui#10805 folded in) — designer words that stayed
 * English under zh-CN after objectui#10748: the flow expression notes, the
 * Problems panel's expression messages, the screen `visibleWhen` picker's
 * heading and note, and the dashboard add-widget picker.
 *
 * Two shapes of the same family:
 * - the row existed and the caller passed no locale (the objectui#10696
 *   class): `FlowExprIssue`'s flow-scope note, and the Problems panel's
 *   `checkCel` / `checkScreenVisibleWhen` messages;
 * - the words had no row: the `Screen fields` heading, the screen
 *   `visibleWhen` note, and the add-widget picker. Each en row is the English
 *   the literal carried.
 *
 * ── How each site is read ────────────────────────────────────────────────────
 * The objectui#10696 / objectui#10748 harness: every case reads the RENDERED
 * text or attribute of the real component, never a label function in
 * isolation. Each zh expectation is read back from the catalogue and then
 * guarded by `zhRow` — not the key echoed back, not the en row — so no case
 * passes on a missing row and none restates a translation.
 *
 * ── Lit controls ─────────────────────────────────────────────────────────────
 * Beside each site, a word that already rendered in zh before this change, on
 * the same mount — or, for the flow-scope note, the sibling `FlowEdgeInspector`
 * showing the same message. A site that stays English beside a lit control is
 * the defect; both staying English would be a broken harness.
 *
 * ── en ───────────────────────────────────────────────────────────────────────
 * Where the site reads a row it already had, the en case reads that row. Where
 * the row is new, the en case asserts the English the literal rendered, so it
 * holds on the base as well as the head: en does not move. The exception is the
 * `engine.flowRef.notAScreenField*` note, a hint sentence: its en cases read
 * the en row through `tFormat(key, 'en-US', …)` rather than pin its wording
 * (the objectui#10832 review, carried by objectui#10835).
 *
 * ── Left literal on purpose (the objectui#10678 / objectui#10651 ruling) ─────
 * A new widget's default `New TYPE` title is stored author data: it keeps
 * writing the English `WIDGET_TYPE_META[].label` under zh (a control that holds
 * on the base and the head), and the stored `type` does not move. Tokens,
 * author row labels and the code spans inside a message read the same in every
 * locale.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

// Every roster in these inspectors comes through the shared metadata client
// (stable identity, like the real memoized client). Nothing here needs a
// roster to answer.
const state = vi.hoisted(() => ({
  metadataClient: {
    get: async () => undefined,
    list: async (): Promise<unknown[]> => [],
    listDrafts: async (): Promise<unknown[]> => [],
  },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { t, tFormat } from '../i18n';
import { FlowEdgeInspector } from './FlowEdgeInspector';
import { FlowNodeInspector } from './FlowNodeInspector';
import { DashboardDefaultInspector } from './DashboardDefaultInspector';
import { fieldsForNodeType, localizeFlowFields } from './flow-node-config';
import { FlowPreview } from '../previews/FlowPreview';
import { WIDGET_TYPE_META } from '../previews/widget-types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Lang = 'en' | 'zh';
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;

/** The console mounts every designer surface under the i18n provider in its language. */
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

/**
 * The zh row `key`, formatted with `vars`, UNGUARDED: a case compares the
 * rendered text to it first and calls `zhRow(key)` after, so a red run shows
 * the text the site rendered rather than the guard's message.
 */
function zh(key: string, vars?: Record<string, string>): string {
  return vars ? tFormat(key, 'zh-CN', vars) : t(key, 'zh-CN');
}

const notes = () => screen.queryAllByRole('note').map((n) => n.textContent);

// ─── Site 1: FlowExprIssue — the flow-scope note on a repeater cell ─────────

/** A decision whose branch and outgoing edge both misspell the flow variable `amount`. */
const REF_DRAFT = {
  variables: [{ name: 'amount', type: 'number' }],
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'd1', type: 'decision', label: 'Route', config: { conditions: [{ label: 'Big', expression: 'amout > 1' }] } },
    { id: 'end', type: 'end' },
  ],
  edges: [
    { id: 'e0', source: 'start', target: 'd1' },
    { id: 'e1', source: 'd1', target: 'end', condition: 'amout > 1' },
  ],
};
const TYPO = { token: 'amout', suggestion: 'amount' };

function mountBranch(lang: Lang) {
  inLang(lang, (
    <FlowNodeInspector
      type="flow"
      name="route"
      draft={REF_DRAFT}
      selection={{ kind: 'node', id: 'd1' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
    />
  ));
}

describe('FlowExprIssue — the flow-scope note on a decision branch (objectui#10804)', () => {
  it('zh: the unknown reference reads engine.flowRef.unknownWithSuggestion', async () => {
    mountBranch('zh');
    await flush();
    expect(screen.getAllByText(zhRow('engine.inspector.flowNode.kind')).length).toBeGreaterThan(0);
    expect(notes()).toEqual([zh('engine.flowRef.unknownWithSuggestion', TYPO)]);
    zhRow('engine.flowRef.unknownWithSuggestion');
  });

  it('zh, lit control: the sibling FlowEdgeInspector already named the same reference in zh', async () => {
    inLang('zh', (
      <FlowEdgeInspector
        type="flow"
        name="route"
        draft={REF_DRAFT}
        selection={{ kind: 'edge', id: 'e1' }}
        onPatch={() => {}}
        onClearSelection={() => {}}
        onSelectionChange={() => {}}
        readOnly={false}
        locale="zh-CN"
      />
    ));
    await flush();
    expect(notes()).toEqual([zh('engine.flowRef.unknownWithSuggestion', TYPO)]);
    zhRow('engine.flowRef.unknownWithSuggestion');
  });

  it('en: reads the en row of the same key', async () => {
    mountBranch('en');
    await flush();
    expect(notes()).toEqual([tFormat('engine.flowRef.unknownWithSuggestion', 'en-US', TYPO)]);
  });
});

// ─── Site 3: the screen `visibleWhen` cell — its picker heading and its note ─

/** A screen whose `visibleWhen` cells name a run variable and a misspelt sibling field. */
const SCREEN_FIELDS = [
  { name: 'discount', label: 'Discount', type: 'number' },
  { name: 'reason', label: 'Reason', type: 'text', visibleWhen: 'needsApproval == true' },
  { name: 'code', label: 'Code', type: 'text', visibleWhen: 'dicount > 0' },
];
const SCREEN_DRAFT = {
  variables: [{ name: 'needsApproval', type: 'boolean' }],
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'form', type: 'screen', label: 'Form', config: { title: 'Details', fields: SCREEN_FIELDS } },
  ],
  edges: [{ id: 'e0', source: 'start', target: 'form' }],
};
const RUN_VAR = { token: 'needsApproval' };
const MISSPELT = { token: 'dicount', suggestion: 'discount' };

function mountScreen(lang: Lang) {
  inLang(lang, (
    <FlowNodeInspector
      type="flow"
      name="intake"
      draft={SCREEN_DRAFT}
      selection={{ kind: 'node', id: 'form' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
    />
  ));
}

/** Open the data-picker beside the input showing `value`; return its section headings. */
async function pickerHeadingsBeside(value: string): Promise<Array<string | null>> {
  const input = screen.getByDisplayValue(value);
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')).find(
    (b) => b.previousElementSibling === input,
  );
  expect(button, `the data-picker beside ${value}`).toBeTruthy();
  fireEvent.click(button!);
  await flush();
  const list = document.body.querySelector<HTMLElement>('[cmdk-root]');
  expect(list, 'the picker popover').toBeTruthy();
  return Array.from(list!.querySelectorAll('[cmdk-group-heading]')).map((h) => h.textContent);
}

describe('the screen visibleWhen cell — its picker heading (objectui#10804)', () => {
  it('zh: the one section reads engine.flowScope.group.screenFields', async () => {
    mountScreen('zh');
    await flush();
    expect(screen.getAllByText(zhRow('engine.inspector.flowNode.kind')).length).toBeGreaterThan(0);
    expect(await pickerHeadingsBeside('needsApproval == true')).toEqual([zh('engine.flowScope.group.screenFields')]);
    zhRow('engine.flowScope.group.screenFields');
  });

  it('en: the heading reads Screen fields, as the literal did', async () => {
    mountScreen('en');
    await flush();
    expect(await pickerHeadingsBeside('needsApproval == true')).toEqual(['Screen fields']);
  });
});

describe('the screen visibleWhen cell — its note (objectui#10804)', () => {
  it('zh: a run variable reads engine.flowRef.notAScreenField; a misspelt sibling reads …WithSuggestion', async () => {
    mountScreen('zh');
    await flush();
    expect(screen.getAllByText(zhRow('engine.inspector.flowNode.kind')).length).toBeGreaterThan(0);
    expect(notes()).toEqual([
      zh('engine.flowRef.notAScreenField', RUN_VAR),
      zh('engine.flowRef.notAScreenFieldWithSuggestion', MISSPELT),
    ]);
    zhRow('engine.flowRef.notAScreenField');
    zhRow('engine.flowRef.notAScreenFieldWithSuggestion');
  });

  it('en: both read the en rows of the same keys', async () => {
    mountScreen('en');
    await flush();
    expect(notes()).toEqual([
      tFormat('engine.flowRef.notAScreenField', 'en-US', RUN_VAR),
      tFormat('engine.flowRef.notAScreenFieldWithSuggestion', 'en-US', MISSPELT),
    ]);
  });
});

// ─── Site 2: the Problems panel's expression messages ───────────────────────

/**
 * One edge guard with an unbalanced parenthesis (`checkCel`), and a screen whose
 * `visibleWhen` column has a labelled brace row, a labelled run-variable row
 * and an UNLABELLED run-variable row (`checkScreenVisibleWhen`).
 */
const PROBLEMS_DRAFT = {
  name: 'intake',
  variables: [{ name: 'amount', type: 'number' }, { name: 'needsApproval', type: 'boolean' }],
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'fetch', type: 'get_record', label: 'Fetch', config: { outputVariable: 'acct' } },
    {
      id: 'form',
      type: 'screen',
      label: 'Form',
      config: {
        fields: [
          { name: 'discount', label: 'Discount', type: 'number' },
          { name: 'reason', label: 'Reason', type: 'text', visibleWhen: '{discount} > 0' },
          { name: 'approval', label: 'Approval', type: 'text', visibleWhen: 'needsApproval == true' },
          { name: 'memo', type: 'text', visibleWhen: 'needsApproval == true' },
        ],
      },
    },
    { id: 'end', type: 'end' },
  ],
  edges: [
    { source: 'start', target: 'fetch' },
    { source: 'fetch', target: 'form', condition: '(amount > 1' },
    { source: 'form', target: 'end' },
  ],
};

/** Mount the flow designer, open its Problems panel, and return every row's message. */
async function problemMessages(lang: Lang): Promise<Array<string | null>> {
  // The canvas palette fetches the action catalogue; a 404 is its normal offline answer.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
  inLang(lang, <FlowPreview type="flow" name="intake" draft={PROBLEMS_DRAFT} locale={LOCALE[lang]} />);
  await flush();
  fireEvent.click(screen.getByTitle(t('engine.flowPreview.problemsTitle', LOCALE[lang])));
  await flush();
  // The panel's title is a span; the toolbar toggle beside it can read the same word.
  const title = screen.getAllByText(t('engine.flowProblems.title', LOCALE[lang])).find((el) => el.tagName === 'SPAN');
  expect(title, 'the Problems panel title').toBeTruthy();
  const panel = title!.parentElement!.parentElement as HTMLElement;
  return Array.from(within(panel).getAllByRole('listitem')).map((li) => li.querySelector('span.block')?.textContent ?? null);
}

/** The `visibleWhen` column's label in `locale`, as the inspector shows it. */
function visibleWhenColumn(locale: string): string {
  const field = localizeFlowFields('screen', fieldsForNodeType('screen'), locale).find((f) => f.id === 'fields');
  const col = field?.columns?.find((c) => c.key === 'visibleWhen');
  expect(col?.label, 'the visibleWhen column').toBeTruthy();
  return col!.label;
}

describe('the Problems panel — expression messages (objectui#10804)', () => {
  it('zh, lit control: the panel title already read its row', async () => {
    expect((await problemMessages('zh')).length).toBeGreaterThan(0);
    zhRow('engine.flowProblems.title');
  });

  it('zh: a checkCel hit on an edge guard reads engine.flowExpr.unbalancedParens', async () => {
    const messages = await problemMessages('zh');
    expect(messages).toContain(zh('engine.flowExpr.unbalancedParens', { source: '(amount > 1' }));
    zhRow('engine.flowExpr.unbalancedParens');
  });

  it('zh: a screen visibleWhen brace reads engine.flowExpr.braceInCondition after its row label', async () => {
    const messages = await problemMessages('zh');
    expect(messages).toContain(`Reason: ${zh('engine.flowExpr.braceInCondition', { ref: 'discount' })}`);
    zhRow('engine.flowExpr.braceInCondition');
  });

  it('zh: a screen visibleWhen run variable reads engine.flowRef.notAScreenField after its row label', async () => {
    const messages = await problemMessages('zh');
    expect(messages).toContain(`Approval: ${zh('engine.flowRef.notAScreenField', RUN_VAR)}`);
    zhRow('engine.flowRef.notAScreenField');
  });

  it('zh: an unlabelled row is prefixed by the visibleWhen column label the inspector shows', async () => {
    const column = visibleWhenColumn('zh-CN');
    expect(column, 'the zh column label is not the English one').not.toBe(visibleWhenColumn('en-US'));
    const messages = await problemMessages('zh');
    expect(messages).toContain(`${column}: ${zh('engine.flowRef.notAScreenField', RUN_VAR)}`);
  });

  it('en: every message reads the English it did', async () => {
    const messages = await problemMessages('en');
    expect(messages).toContain(tFormat('engine.flowExpr.unbalancedParens', 'en-US', { source: '(amount > 1' }));
    expect(messages).toContain(`Reason: ${tFormat('engine.flowExpr.braceInCondition', 'en-US', { ref: 'discount' })}`);
    expect(messages).toContain(`Approval: ${tFormat('engine.flowRef.notAScreenField', 'en-US', RUN_VAR)}`);
    expect(messages).toContain(`Visible when: ${tFormat('engine.flowRef.notAScreenField', 'en-US', RUN_VAR)}`);
  });
});

// ─── Site 4: the dashboard add-widget picker (objectui#10805) ────────────────

/** Stored `type` → the catalogue row its picker entry displays. */
const WIDGET_TYPE_KEYS: ReadonlyArray<[string, string]> = [
  ['metric', 'engine.widgetPicker.type.metric'],
  ['bar', 'engine.widgetPicker.type.bar'],
  ['horizontal-bar', 'engine.widgetPicker.type.horizontalBar'],
  ['line', 'engine.widgetPicker.type.line'],
  ['area', 'engine.widgetPicker.type.area'],
  ['pie', 'engine.widgetPicker.type.pie'],
  ['donut', 'engine.widgetPicker.type.donut'],
  ['scatter', 'engine.widgetPicker.type.scatter'],
  ['funnel', 'engine.widgetPicker.type.funnel'],
  ['table', 'engine.widgetPicker.type.table'],
  ['pivot', 'engine.widgetPicker.type.pivot'],
];
const CATEGORIES = ['kpi', 'chart', 'data'] as const;

/** Mount the dashboard inspector with no widgets and open its add-widget picker. */
async function openWidgetPicker(lang: Lang, onPatch: (patch: Record<string, unknown>) => void = () => {}) {
  inLang(lang, (
    <DashboardDefaultInspector
      type="dashboard"
      name="sales"
      locale={LOCALE[lang]}
      draft={{ name: 'sales', label: 'Sales', widgets: [] }}
      onPatch={onPatch}
      onSelectionChange={() => {}}
      readOnly={false}
    />
  ));
  // The trigger is the lit control: its label already read its row.
  fireEvent.click(screen.getByRole('button', { name: row(lang, 'engine.inspector.add.widget') }));
  await flush();
  return screen.getByRole('dialog');
}

const searchBox = (picker: HTMLElement) => picker.querySelector<HTMLInputElement>('input')!;
const categoryHeadings = (picker: HTMLElement) =>
  Array.from(picker.querySelectorAll('div.uppercase')).map((h) => h.textContent);
/** stored `type` → the name its entry shows. */
function typeNames(picker: HTMLElement): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const b of Array.from(picker.querySelectorAll('button'))) {
    const id = b.querySelector('code')?.textContent;
    if (id) out.set(id, b.querySelector('span')?.textContent ?? null);
  }
  return out;
}

/** The picker's empty text, shown when a search matches nothing. */
const emptyText = (picker: HTMLElement) => picker.querySelector('div.text-center')?.textContent ?? null;

async function search(picker: HTMLElement, q: string) {
  fireEvent.change(searchBox(picker), { target: { value: q } });
  await flush();
}

describe('AddWidgetPicker — its words (objectui#10804, objectui#10805)', () => {
  it('zh: the search box reads engine.widgetPicker.search', async () => {
    const picker = await openWidgetPicker('zh');
    expect(searchBox(picker).getAttribute('placeholder')).toBe(zh('engine.widgetPicker.search'));
    zhRow('engine.widgetPicker.search');
  });

  it('zh: the category headings read engine.widgetPicker.category.*', async () => {
    const picker = await openWidgetPicker('zh');
    expect(categoryHeadings(picker)).toEqual(CATEGORIES.map((c) => zh(`engine.widgetPicker.category.${c}`)));
    for (const c of CATEGORIES) zhRow(`engine.widgetPicker.category.${c}`);
  });

  it('zh: every type entry reads its engine.widgetPicker.type.* row; the stored type beside it stays as it is', async () => {
    const picker = await openWidgetPicker('zh');
    expect(Object.fromEntries(typeNames(picker))).toEqual(
      Object.fromEntries(WIDGET_TYPE_KEYS.map(([id, key]) => [id, zh(key)])),
    );
    for (const [, key] of WIDGET_TYPE_KEYS) zhRow(key);
  });

  it('zh: a search that matches nothing reads engine.widgetPicker.noMatches', async () => {
    const picker = await openWidgetPicker('zh');
    await search(picker, 'zzzz-no-such-widget');
    expect(emptyText(picker)).toBe(zh('engine.widgetPicker.noMatches'));
    zhRow('engine.widgetPicker.noMatches');
  });

  it('zh: the search matches the name the entry shows and the stored type beside it, not a name it hides', async () => {
    const picker = await openWidgetPicker('zh');
    const bar = zhRow('engine.widgetPicker.type.bar');
    await search(picker, bar);
    expect([...typeNames(picker).keys()]).toEqual(['bar']);
    await search(picker, 'pivot');
    expect([...typeNames(picker).keys()]).toEqual(['pivot']);
    // `chart` is in no zh name and no stored type: the hidden English does not match.
    await search(picker, 'chart');
    expect([...typeNames(picker).keys()]).toEqual([]);
  });

  it('en: every word reads the English the literals did', async () => {
    const picker = await openWidgetPicker('en');
    expect(searchBox(picker).getAttribute('placeholder')).toBe('Search widgets…');
    expect(categoryHeadings(picker)).toEqual(['Single value', 'Charts', 'Tabular']);
    expect(Object.fromEntries(typeNames(picker))).toEqual(
      Object.fromEntries(WIDGET_TYPE_KEYS.map(([id]) => [id, WIDGET_TYPE_META[id].label])),
    );
    await search(picker, 'bar chart');
    expect([...typeNames(picker).keys()]).toEqual(['bar']);
    await search(picker, 'zzzz-no-such-widget');
    expect(emptyText(picker)).toBe('No matches.');
  });
});

describe('AddWidgetPicker — the stored default title stays English (objectui#10804 control)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: picking a bar chart writes type bar and the title New bar chart`, async () => {
      const onPatch = vi.fn();
      const picker = await openWidgetPicker(lang, onPatch);
      const entry = Array.from(picker.querySelectorAll('button')).find((b) => b.querySelector('code')?.textContent === 'bar');
      expect(entry, 'the bar entry').toBeTruthy();
      fireEvent.click(entry!);
      const patch = onPatch.mock.calls.at(-1)?.[0] as { widgets?: Array<Record<string, unknown>> } | undefined;
      expect(patch?.widgets?.[0]).toMatchObject({ type: 'bar', title: 'New bar chart' });
    });
  }
});
