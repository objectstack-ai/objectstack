// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10586 (PR 1 of 2) — three designer inspectors render their own
 * words in the designer's locale: `DatasetDefaultInspector`,
 * `FlowReferenceField` (its `ReferenceCombobox`) and `ConditionBuilder`.
 *
 * Their section titles, field labels, placeholders, hints, option labels and
 * accessible names were English literals, so a zh-CN author read an English
 * form inside an otherwise Chinese designer. They now resolve through the
 * designer's own catalogue (`../i18n`) under `engine.inspector.*` and
 * `engine.form.*`, the way the translated sibling inspectors do.
 *
 * ── The probe ────────────────────────────────────────────────────────────────
 * `surface()` collects every string an author can read off the rendered tree:
 * each element's whole text, each text node, and every `aria-label`, `title`
 * and `placeholder`. Membership is EXACT, so a short word (`sum`, `Name`)
 * cannot pass by occurring inside some unrelated sentence.
 *
 * ── Why each fixture is read twice ───────────────────────────────────────────
 * Every list below is the pre-fix English the fixture renders. Under `en` each
 * entry must be present, which proves the fixture really reaches that branch
 * and that the English wording did not move; under `zh` none may be, which is
 * the defect. The zh half alone could pass on a fixture that renders nothing,
 * so it is only meaningful beside the en half, plus a named zh sample per
 * inspector read back from the catalogue.
 *
 * ── Lit controls ─────────────────────────────────────────────────────────────
 * The same probe sees a translation that was already there before this change,
 * once per locale channel: `ObjectDefaultInspector` through the host's
 * `locale` prop (the channel `DatasetDefaultInspector` now reads), and the
 * `I18nProvider` language through `useMetadataLocale()` (the channel the other
 * two read) — the membership-tier flag and the raw CEL editor's label.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

const state = vi.hoisted(() => ({
  usage: { reports: 0, dashboards: 0, loading: false },
  adapter: null as unknown,
  // STABLE identity, like the real memoized client — a fresh object per render
  // would setState → re-render → setState forever.
  metadataClient: { get: async () => undefined, list: async () => [] as unknown[] },
}));

vi.mock('./useDatasetFields', () => ({
  useObjectOptions: () => ({ options: [], loading: false }),
  useDatasetFieldCatalog: () => ({ relationships: [], fieldOptions: [], loading: false }),
  useDatasetUsage: () => state.usage,
  fieldTypeToDimensionType: (t: string) => (t === 'date' ? 'date' : 'string'),
}));
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => state.adapter,
  // @object-ui/components wires this at module scope (related-count-store).
  subscribeDataChanges: () => () => {},
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  LookupField: () => <div data-testid="record-lookup" />,
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [] }),
}));

import { t } from '../i18n';
import { DatasetDefaultInspector } from './DatasetDefaultInspector';
import { ObjectDefaultInspector } from './ObjectDefaultInspector';
import { FlowReferenceField } from './FlowReferenceField';
import { ConditionBuilder } from './ConditionBuilder';

afterEach(() => {
  cleanup();
  state.usage = { reports: 0, dashboards: 0, loading: false };
  state.adapter = null;
});

// The connector pickers read the runtime registry with a relative `fetch`.
// ONE double for the whole file, never torn down, so no read can reach the
// network after a test body returns (the network-escape guard's own advice).
const CONNECTORS = [
  { name: 'billing', label: 'Billing API', origin: 'declarative', actions: [{ key: 'charge', label: 'Charge' }] },
  { name: 'slack', actions: [{ key: 'post', label: 'Post' }] },
];
vi.stubGlobal(
  'fetch',
  (async (url: string) =>
    String(url).includes('/api/v1/automation/connectors')
      ? { ok: true, json: async () => ({ data: { connectors: CONNECTORS } }) }
      : { ok: false, json: async () => null }) as unknown as typeof globalThis.fetch,
);

type Lang = 'en' | 'zh';
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;

/** Every string an author can read off the rendered document. */
function surface(): Set<string> {
  const out = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const v = n.nodeValue?.trim();
      if (v) out.add(v);
      continue;
    }
    const el = n as Element;
    const text = el.textContent?.trim();
    if (text) out.add(text);
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v) out.add(v);
    }
  }
  return out;
}

function inLang(lang: Lang, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>{ui}</I18nProvider>,
  );
}

/** Render each fixture in `lang` and union what the author can read. */
async function readAll(lang: Lang, fixtures: Array<(lang: Lang) => Promise<void> | void>): Promise<Set<string>> {
  const all = new Set<string>();
  for (const fixture of fixtures) {
    await fixture(lang);
    for (const s of surface()) all.add(s);
    cleanup();
  }
  return all;
}

/** A zh catalogue row that is really there: not the echoed key, not the en row. */
function zhRow(key: string): string {
  const zh = t(key, 'zh-CN');
  expect(zh, `${key}: a missing zh row echoes the key back`).not.toBe(key);
  expect(zh, `${key}: the zh row must not be the en one`).not.toBe(t(key, 'en-US'));
  return zh;
}

function expectAll(seen: Set<string>, literals: readonly string[]) {
  const missing = literals.filter((l) => !seen.has(l));
  expect(missing, 'en: pre-fix wording the fixture no longer renders').toEqual([]);
}

function expectNone(seen: Set<string>, literals: readonly string[]) {
  const leaked = literals.filter((l) => seen.has(l));
  expect(leaked, 'zh: English still rendered').toEqual([]);
}

// ─── DatasetDefaultInspector ────────────────────────────────────────────────

const datasetProps = (lang: Lang) => ({ type: 'dataset', locale: LOCALE[lang], onPatch: () => {}, readOnly: false });

const DATASET_FIXTURES: Array<(lang: Lang) => void> = [
  (lang) => {
    state.usage = { reports: 2, dashboards: 1, loading: false };
    inLang(lang, (
      <DatasetDefaultInspector
        {...datasetProps(lang)}
        name="sales"
        draft={{
          name: 'sales',
          label: 'Sales',
          object: 'opportunity',
          include: ['account'],
          filter: { $or: [{ a: 1 }, { b: 2 }] },
          dimensions: [
            { name: 'region', field: 'account.region', type: 'string' },
            { name: 'close', field: 'owner.close_date', type: 'date', dateGranularity: 'month' },
            { name: 'won', field: 'is_won', type: 'boolean' },
          ],
          measures: [
            { name: 'revenue', aggregate: 'sum', field: 'amount', format: '0,0.00', currency: 'USD', filter: { stage: 'won' } },
            { name: 'cnt', aggregate: 'count' },
            { name: 'r', aggregate: 'avg', derived: { op: 'ratio', of: ['revenue'] } },
          ],
        }}
      />
    ));
  },
  (lang) => {
    inLang(lang, (
      <DatasetDefaultInspector
        {...datasetProps(lang)}
        name=""
        draft={{
          name: '',
          object: '',
          dimensions: [{ name: '', field: '', type: 'lookup' }, { name: 'd', type: 'date' }],
          measures: [{ name: '', aggregate: 'count_distinct', derived: { op: 'sum', of: [] } }],
        }}
      />
    ));
  },
  (lang) => {
    state.usage = { reports: 1, dashboards: 0, loading: false };
    inLang(lang, (
      <DatasetDefaultInspector
        {...datasetProps(lang)}
        name="s2"
        draft={{
          name: 's2',
          object: 'opportunity',
          include: [],
          filter: { status: 'open' },
          dimensions: [{ name: 'q', type: 'number' }],
          measures: [
            { name: 'p', aggregate: 'max', format: '0.0%' },
            { name: 'n', aggregate: 'min', format: '0,0', filter: { $and: [{ a: 1 }, { b: 2 }] } },
            { name: 'd', aggregate: 'sum', derived: { op: 'difference', of: ['p'] } },
            { name: 'x', aggregate: 'sum', derived: { op: 'product', of: ['p'] } },
          ],
        }}
      />
    ));
  },
  (lang) => {
    state.usage = { reports: 0, dashboards: 0, loading: false };
    inLang(lang, <DatasetDefaultInspector {...datasetProps(lang)} name="s3" draft={{ name: 's3', object: 'opportunity' }} />);
    // The scope-filter trigger is the one button reading as an empty filter.
    const trigger = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent === '+ Add filter…' || b.textContent === t('engine.inspector.dataset.addFilter', LOCALE[lang]),
    );
    expect(trigger, 'the scope-filter trigger').toBeTruthy();
    fireEvent.click(trigger!);
  },
];

/** The pre-fix English the four dataset fixtures render. */
const DATASET_EN = [
  'Dataset',
  'Bound by 2 reports · 1 dashboard — changes affect them.',
  'Bound by 1 report · 0 dashboards — changes affect them.',
  'Not yet bound by any report or dashboard.',
  'Name',
  'snake_case identifier',
  'Label',
  'Description',
  'Base object',
  'Select an object…',
  'Changing the base object clears its dimensions, field measures, joins & filters; a row count is kept.',
  'Included relationships',
  'Add',
  'No joins. Add a relationship (a lookup field on the base object) to use relationship.field dimensions/measures.',
  'No joins. Add a relationship (a lookup field on opportunity) to use relationship.field dimensions/measures.',
  'Included relationship',
  'Remove relationship',
  'Scope filter',
  'Intrinsic scope, ANDed into every query (e.g. exclude soft-deleted records).',
  'Advanced filter (nested / OR) — edit it in the Source tab.',
  '1 condition',
  '2 conditions',
  '+ Add filter…',
  'Pick a base object to add filter conditions.',
  'Dimensions',
  'Add dimension',
  'Dimension 1',
  'Remove dimension',
  'e.g. region',
  'Field',
  'field or relationship.field',
  "Relationship owner isn't in Included relationships.",
  'Add it',
  'Type',
  'Advanced',
  'Label (optional)',
  'Display label',
  'Date bucket',
  'Measures',
  'Add measure',
  'Measure 1',
  'Remove measure',
  'e.g. revenue',
  'Aggregate',
  'field (optional for count)',
  'Display format',
  'Decimals',
  'Currency',
  'Filter (measure-scoped)',
  'Only rows matching this filter feed this measure (e.g. won_amount = sum(amount) where stage = won).',
  'Derived — computed from other measures',
  'Operation',
  'Operands (other measures)',
  'Select exactly 2 measures for difference.',
  'Select at least 1 measure for sum.',
  'Add other measures first.',
  // option labels — one fixture or another selects each of them
  'count', 'sum', 'avg', 'min', 'max', 'count distinct',
  'string', 'number', 'date', 'boolean', 'lookup',
  '— none —', 'month',
  'ratio (a ÷ b)', 'sum (a + b)', 'difference (a − b)', 'product (a × b)',
  'Raw number', 'Number — 1,234.5', 'Currency — $1,234.50', 'Percent — 12.3%',
] as const;

describe('DatasetDefaultInspector reads its words in the designer locale (objectui#10586)', () => {
  it('zh: none of the pre-fix English renders, and a named sample is the catalogue row', async () => {
    const seen = await readAll('zh', DATASET_FIXTURES);
    expectNone(seen, DATASET_EN);
    expect(seen.has(zhRow('engine.inspector.dataset.baseObject'))).toBe(true);
    expect(seen.has(zhRow('engine.inspector.dataset.usage.unbound'))).toBe(true);
    expect(seen.has(zhRow('engine.inspector.dataset.aggregate.sum'))).toBe(true);
  });

  it('en: every pre-fix string still renders, word for word', async () => {
    expectAll(await readAll('en', DATASET_FIXTURES), DATASET_EN);
  });

  it('the format sample keeps its value in a slot the locale words around', () => {
    for (const lang of ['en', 'zh'] as const) {
      DATASET_FIXTURES[0](lang);
      const value = document.body.querySelector('span.font-mono.tabular-nums');
      expect(value, 'the sample value span').toBeTruthy();
      const lead = value!.parentElement!.firstChild?.nodeValue;
      expect(lead).toBe(lang === 'en' ? 'Sample: ' : t('engine.inspector.dataset.sample', 'zh-CN').split('{sample}')[0]);
      cleanup();
    }
    expect(zhRow('engine.inspector.dataset.sample')).toContain('{sample}');
  });

  it('lit control: the same probe reads ObjectDefaultInspector’s existing zh (the host `locale` channel)', () => {
    inLang('zh', <ObjectDefaultInspector type="object" name="" locale="zh-CN" draft={{}} onPatch={() => {}} readOnly={false} />);
    const seen = surface();
    expect(seen.has(zhRow('designer.object.section.basic'))).toBe(true);
    expect(seen.has(t('designer.object.section.basic', 'en-US'))).toBe(false);
  });
});

// ─── FlowReferenceField / ReferenceCombobox ─────────────────────────────────

const flowDraft = {
  nodes: [
    { id: 'start', type: 'start', config: { objectName: 'account' } },
    { id: 'n1', type: 'connector_action', label: 'Call' },
  ],
};

function mountRef(lang: Lang, ref: Record<string, unknown>, context?: Record<string, unknown>, value = '') {
  inLang(lang, (
    <FlowReferenceField field={{ label: 'Ref', ref: ref as never }} value={value} onCommit={() => {}} context={context as never} />
  ));
}

const REFERENCE_FIXTURES: Array<(lang: Lang) => Promise<void> | void> = [
  (lang) => mountRef(lang, { kind: 'manager' }),
  (lang) => mountRef(lang, { kind: 'queue' }),
  (lang) => mountRef(lang, { kind: 'object-field' }, { draft: flowDraft, node: null }),
  (lang) => mountRef(lang, { kind: 'object-field' }, { draft: { nodes: [] }, node: null }),
  async (lang) => {
    mountRef(lang, { kind: 'connector-action' }, { draft: flowDraft, node: { id: 'n1', connectorConfig: { connectorId: 'slack' } } });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  },
  (lang) => mountRef(lang, { kind: 'connector-action' }, { draft: flowDraft, node: { id: 'n1' } }),
  async (lang) => {
    mountRef(lang, { kind: 'connector' }, { draft: flowDraft, node: null });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(document.body.querySelector('datalist option'), 'the connector registry answered').toBeTruthy();
  },
  (lang) => {
    state.adapter = { find: async () => ({ data: [] }) };
    mountRef(lang, { kind: 'user' }, undefined, 'u1');
    // Collect the lookup half's toggle, then flip to manual entry for the other.
    for (const s of surface()) extra.add(s);
    fireEvent.click(document.body.querySelector('button[aria-label]')!);
  },
];
// The record-lookup fixture reads two states of one mount; `readAll` only sees the last.
const extra = new Set<string>();

const REFERENCE_EN = [
  'Resolved automatically',
  "Resolved at runtime from the submitter's manager — no value needed.",
  'Queue approvers are not supported by the runtime yet — this slot resolves to nobody.',
  'Fields of account.',
  'Set the flow’s trigger object (on the Start node) to list fields.',
  'Actions of slack.',
  'Choose a Connector above to list its actions.',
  'Billing API (billing) · declarative',
  'Enter value manually',
  'Pick from records',
] as const;

async function readReference(lang: Lang): Promise<Set<string>> {
  extra.clear();
  const seen = await readAll(lang, REFERENCE_FIXTURES);
  for (const s of extra) seen.add(s);
  return seen;
}

describe('FlowReferenceField reads its words in the designer locale (objectui#10586)', () => {
  it('zh: none of the pre-fix English renders, and a named sample is the catalogue row', async () => {
    const seen = await readReference('zh');
    expectNone(seen, REFERENCE_EN);
    expect(seen.has(zhRow('engine.inspector.reference.managerPlaceholder'))).toBe(true);
    expect(seen.has(`Billing API (billing) · ${zhRow('engine.inspector.reference.declarative')}`)).toBe(true);
  });

  it('en: every pre-fix string still renders, word for word', async () => {
    expectAll(await readReference('en'), REFERENCE_EN);
  });

  it('lit control: the same probe reads the membership-tier flag’s existing zh (the `I18nProvider` channel)', () => {
    mountRef('zh', { kind: 'org-membership-level' }, undefined, 'sales_manager');
    expect(surface().has(`sales_manager${zhRow('engine.form.invalid')}`)).toBe(true);
  });
});

// ─── ConditionBuilder ───────────────────────────────────────────────────────

const CONDITION_FIELDS = [{ name: 'a' }, { name: 'b' }];

function mountCondition(lang: Lang, value: string) {
  inLang(lang, <ConditionBuilder label="When" value={value} onCommit={() => {}} fields={CONDITION_FIELDS} />);
}

const CONDITION_FIXTURES: Array<(lang: Lang) => void> = [
  (lang) => {
    mountCondition(lang, '');
    for (const s of surface()) extra.add(s);
    // Adding a row: the empty state gives way to a row with no subject yet.
    const add = Array.from(document.body.querySelectorAll('button')).at(-1)!;
    fireEvent.click(add);
  },
  (lang) => mountCondition(lang, "record.a == 'x' && record.b"),
  (lang) => mountCondition(lang, "record.a != 'x' || record.b > 1 || record.a < 2 || !record.b"),
  (lang) => mountCondition(lang, 'record.a >= 1 && record.b <= 2'),
  // Mixed joins do not round-trip, so this one opens the raw CEL editor.
  (lang) => mountCondition(lang, "record.a == 'x' && record.b || record.a"),
];

const CONDITION_EN = [
  'Always — no condition.',
  'Expression',
  'Add condition',
  'field / context',
  'Remove condition',
  'value',
  'equals',
  'not equals',
  'greater than',
  'less than',
  'is set / true',
  'is empty / false',
  'AND',
  'OR',
  'Builder',
] as const;

async function readCondition(lang: Lang): Promise<Set<string>> {
  extra.clear();
  const seen = await readAll(lang, CONDITION_FIXTURES);
  for (const s of extra) seen.add(s);
  return seen;
}

describe('ConditionBuilder reads its words in the designer locale (objectui#10586)', () => {
  it('zh: none of the pre-fix English renders, and a named sample is the catalogue row', async () => {
    const seen = await readCondition('zh');
    expectNone(seen, CONDITION_EN);
    expect(seen.has(zhRow('engine.inspector.condition.always'))).toBe(true);
    expect(seen.has(zhRow('engine.inspector.condition.op.notEquals'))).toBe(true);
    // `≥` / `≤` are symbols, deliberately the same in every locale.
    expect(seen.has('≥') && seen.has('≤')).toBe(true);
  });

  it('en: every pre-fix string still renders, word for word', async () => {
    expectAll(await readCondition('en'), CONDITION_EN);
  });

  it('lit control: the same probe reads the raw editor’s existing zh label (the `I18nProvider` channel)', () => {
    mountCondition('zh', "record.a == 'x' && record.b || record.a");
    expect(surface().has(zhRow('engine.condition.celLabel'))).toBe(true);
  });
});
