// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10586 (PR 2 of 2) — the hook and action inspectors, and the shared
 * inspector atoms' own defaults, render their words in the designer's locale.
 *
 * `HookDefaultInspector` and `ActionDefaultInspector` drew their section
 * titles, field labels, placeholders, hints, option labels and accessible
 * names as English literals, and `InspectorComboField` / `_shared.tsx` fell
 * back to English defaults wherever a caller passed none. So a zh-CN author
 * read English inside an otherwise Chinese designer. The inspectors now read
 * the designer catalogue (`../i18n`) under `engine.inspector.hook.*` and
 * `engine.inspector.action.*`; the atoms resolve their defaults through
 * `useMetadataLocale()`, the channel `InspectorSelectField`'s default flag
 * already reads (objectui#9652).
 *
 * ── The probe ────────────────────────────────────────────────────────────────
 * `surface()` collects every string an author can read off the rendered tree:
 * each element's whole text, each text node, and every `aria-label`, `title`
 * and `placeholder`. Membership is EXACT, so a short word (`Name`, `Type`)
 * cannot pass by occurring inside some unrelated sentence.
 *
 * ── Why each fixture is read twice ───────────────────────────────────────────
 * Every list below is the pre-fix English the fixtures render. Under `en` each
 * entry must be present, which proves the fixture really reaches that branch
 * and that the English wording did not move; under `zh` none may be, which is
 * the defect. The zh half alone could pass on a fixture that renders nothing,
 * so it is only meaningful beside the en half, plus named zh samples read back
 * from the catalogue.
 *
 * ── Hosts of the shared defaults ─────────────────────────────────────────────
 * Each default is read through a real host where one reaches it:
 * `AppNavInspector`'s object picker passes no `placeholder` /
 * `searchPlaceholder` / `emptyText`, and `ObjectFieldInspector`'s header passes
 * no reorder labels. No in-tree host reaches the shell's close label or the
 * roster-failure notice (every caller passes its own or hides the button), so
 * those two are read off the primitive itself.
 *
 * ── Lit controls ─────────────────────────────────────────────────────────────
 * The same probe sees a translation that was already there before this change,
 * once per locale channel: `ObjectDefaultInspector` through the host's
 * `locale` prop (the channel both inspectors read), and
 * `InspectorSelectField`'s default flag through `useMetadataLocale()` (the
 * channel the atoms read).
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

const state = vi.hoisted(() => ({
  objectOptions: {
    options: [] as Array<{ value: string; label: string }>,
    loading: false,
    error: null as string | null,
  },
  fields: [] as Array<{ name: string; label?: string; type?: string }>,
  held: undefined as string[] | undefined,
  // STABLE identity, like the real memoized client — a fresh object per render
  // would setState → re-render → setState forever. Fixtures swap `list`.
  metadataClient: {
    get: async () => undefined,
    list: async (): Promise<unknown[]> => [],
    listDrafts: async (): Promise<unknown[]> => [],
  },
}));

vi.mock('../previews/useObjectOptions', () => ({
  useObjectOptions: () => state.objectOptions,
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: state.fields, loading: false, error: null }),
}));
vi.mock('../previews/useMetaOptions', () => ({
  useMetaOptions: () => ({ options: [], loading: false }),
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePermissions: () => ({ systemPermissions: state.held }),
}));

import { t } from '../i18n';
import { HookDefaultInspector } from './HookDefaultInspector';
import { ActionDefaultInspector } from './ActionDefaultInspector';
import { AppNavInspector } from './AppNavInspector';
import { ObjectFieldInspector } from './ObjectFieldInspector';
import { ObjectDefaultInspector } from './ObjectDefaultInspector';
import { InspectorShell, InspectorSelectField, flagUnknownValue } from './_shared';
import { InspectorComboField } from './InspectorComboField';

/** Each fixture starts from the same catalog, fields and held set. */
function resetState() {
  state.objectOptions = { options: [], loading: false, error: null };
  state.fields = [];
  state.held = undefined;
  state.metadataClient.list = async () => [];
}

afterEach(() => {
  cleanup();
  resetState();
});

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

/** Let mount-time effects and resolved fetches settle. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

type Fixture = (lang: Lang) => Promise<void> | void;

/** Render each fixture in `lang` and union what the author can read. */
async function readAll(lang: Lang, fixtures: readonly Fixture[]): Promise<Set<string>> {
  const all = new Set<string>();
  for (const fixture of fixtures) {
    resetState();
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

// ─── HookDefaultInspector ───────────────────────────────────────────────────

const SCHEMA = { type: 'object', properties: {} };

function mountHook(lang: Lang, draft: Record<string, unknown>) {
  inLang(lang, (
    <HookDefaultInspector
      type="hook"
      name={String(draft.name)}
      draft={draft}
      onPatch={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
      serverSchema={SCHEMA}
    />
  ));
}

const HOOK_FIXTURES: readonly Fixture[] = [
  // An answered, empty roster; nothing picked; the expression body.
  (lang) => mountHook(lang, { name: 'h1', events: [], body: { language: 'expression' } }),
  // An answered roster with the object picked; an event; the JS body.
  (lang) => {
    state.objectOptions = { options: [{ value: 'account', label: 'Account' }], loading: false, error: null };
    mountHook(lang, { name: 'h2', object: 'account', events: ['beforeInsert'], body: { language: 'js' }, async: true, priority: 5 });
  },
];

/** The pre-fix English the hook fixtures render. */
const HOOK_EN = [
  'Basics',
  'Label',
  'Human-readable name',
  'Name',
  'snake_case identifier',
  'Object(s) this hook fires on',
  'All objects (*)',
  'No objects found — publish an object, then pick it here.',
  'Pick at least one object (or All objects).',
  'Events',
  'Which lifecycle events invoke this hook.',
  'Write',
  'Query',
  'Select at least one event.',
  'Function',
  'The handler that runs when the hook fires.',
  'Language',
  'Expression (L1)',
  'Sandboxed JS (L2)',
  'Handler body',
  'A single L1 expression evaluated against the record / ctx.',
  'Runs in the sandbox as (ctx) => Promise<void>.',
  'Options',
  'Priority',
  'Run asynchronously (after commit)',
  'Run only when (optional CEL)',
  'Advanced / rarely-used properties.',
] as const;

describe('HookDefaultInspector reads its words in the designer locale (objectui#10586)', () => {
  it('zh: none of the pre-fix English renders, and named samples are the catalogue rows', async () => {
    const seen = await readAll('zh', HOOK_FIXTURES);
    expectNone(seen, HOOK_EN);
    expect(seen.has(zhRow('engine.inspector.hook.basics'))).toBe(true);
    expect(seen.has(zhRow('engine.inspector.hook.noObjects'))).toBe(true);
    expect(seen.has(zhRow('engine.inspector.hook.bodyLang.js'))).toBe(true);
    // Lifecycle event names are identifiers, deliberately the same in every locale.
    expect(seen.has('beforeInsert')).toBe(true);
  });

  it('en: every pre-fix string still renders, word for word', async () => {
    expectAll(await readAll('en', HOOK_FIXTURES), HOOK_EN);
  });
});

// ─── ActionDefaultInspector ─────────────────────────────────────────────────

function mountAction(lang: Lang, draft: Record<string, unknown>) {
  inLang(lang, (
    <ActionDefaultInspector
      type="action"
      name={String(draft.name)}
      draft={draft}
      onPatch={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
      serverSchema={SCHEMA}
    />
  ));
}

/** Every offered param type but `select`, which two params below carry. */
const PARAM_TYPES_BUT_SELECT = ['text', 'textarea', 'number', 'boolean', 'date', 'datetime', 'lookup'].map((type, i) => ({ name: `p${i}`, type }));

const ACTION_FIXTURES: readonly Fixture[] = [
  // A global script action: no object catalog, every param type, a select
  // param with and without options, no placement, a capability the session
  // lacks, and a too-short AI description.
  (lang) => {
    state.held = ['x.y'];
    mountAction(lang, {
      name: 'a1', label: 'A1', type: 'script', variant: 'primary', component: 'action:button', mode: 'create',
      body: { language: 'expression' },
      params: [
        ...PARAM_TYPES_BUT_SELECT,
        { name: 's0', type: 'select' },
        { name: 's1', type: 'select', options: [{ label: 'One', value: 'one' }] },
      ],
      locations: [],
      requiredPermissions: ['a.b'],
      aiExposed: true,
      aiDescription: 'short',
    });
  },
  // An API action against an object catalog with none picked, gated on two
  // capabilities the session holds.
  (lang) => {
    state.objectOptions = { options: [{ value: 'account', label: 'Account' }], loading: false, error: null };
    state.held = ['a.b', 'c.d'];
    mountAction(lang, {
      name: 'a2', type: 'api', method: 'PATCH', variant: 'secondary', component: 'action:icon', mode: 'edit',
      locations: ['record_header'], requiredPermissions: ['a.b', 'c.d'],
    });
  },
  // A bound flow action with a field-backed input.
  (lang) => {
    state.fields = [{ name: 'amount', label: 'Amount' }];
    mountAction(lang, {
      name: 'a3', type: 'flow', objectName: 'account', variant: 'danger', component: 'action:menu', mode: 'delete',
      params: [{ field: 'amount' }], locations: ['list_item'],
    });
  },
  (lang) => mountAction(lang, { name: 'a4', type: 'modal', variant: 'ghost', component: 'action:group', mode: 'custom', locations: ['record_more'] }),
  (lang) => mountAction(lang, { name: 'a5', type: 'form', variant: 'link', locations: ['record_more'] }),
  (lang) => mountAction(lang, { name: 'a6', type: 'url', locations: ['record_more'] }),
  (lang) => mountAction(lang, { name: 'a7', type: 'script', body: { language: 'js' }, locations: ['record_more'] }),
  // The declarative single-record write, empty and with one row.
  (lang) => mountAction(lang, { name: 'a8', type: 'script', operation: 'update', patch: {}, locations: ['record_more'] }),
  (lang) => mountAction(lang, { name: 'a9', type: 'script', operation: 'update', patch: { status: 'done' }, locations: ['record_more'] }),
];

/** The pre-fix English the action fixtures render. */
const ACTION_EN = [
  // Basics
  'Basics',
  'Label',
  'Button text shown to users',
  'Name',
  'snake_case identifier',
  'Object',
  'snake_case object',
  '— None (global) —',
  'Bound action — surfaces in this object’s views per the placement below.',
  'Empty = global action — must be referenced by a page’s quick actions, global nav, a flow, or AI to appear.',
  'Icon',
  'Variant',
  // Behavior
  'Behavior',
  'What happens when the action is triggered.',
  'Type',
  'Pinned to script: the field write is performed on the platform action route, which is this type’s own route. Any other type is refused beside it.',
  'What it does',
  'Field values',
  'No field values yet — add one, or collect the value as an input below.',
  'Field',
  'Value',
  'Remove field value',
  'Add field value',
  'Written to the current record as the caller — object permissions, hooks and validations fire as for a user edit. An input collected below with the same name overrides the fixed value here.',
  'Script language',
  'Script body',
  'Runs in the sandbox as (input, ctx) => Promise<output>.',
  'Method',
  'URL *',
  'https://… or /path?x=${param.x}',
  'Supports ${param.x} and ${ctx.x} interpolation.',
  'Flow name *',
  'snake_case flow',
  'The flow to invoke when clicked.',
  'Modal / page name *',
  'snake_case page',
  'The modal or page to open.',
  'Form view name *',
  'Opens /console/forms/<name>.',
  'API endpoint *',
  'Endpoint called with the request body below.',
  // Inputs
  'Inputs',
  'Collected from the user in a dialog before the action runs.',
  'No inputs — the action runs immediately on click.',
  'Move up',
  'Move down',
  'Remove input',
  'Bind to field',
  'request-body key',
  'Placeholder',
  'Required',
  'Pre-fill from row',
  'Add input',
  'Options',
  'No choices yet — a Select with no options opens an empty picker in the dialog.',
  'Remove option 1',
  'Add option',
  // Placement
  'Placement',
  'Where this action surfaces in the UI.',
  'No placement selected — this action will not appear on any record or list surface. Tick a placement above, or place it from a view’s bulk actions.',
  'Capability-gated on a.b — every placement ticked above hides this action from anyone who does not hold it. Not greyed out and not an error: the button is simply absent, and the server refuses the invocation with a 403 either way. This session does not hold a.b, so the button is hidden from you too — grant it through a permission set to see it in the app.',
  'This session does not hold a.b, so the button is hidden from you too — grant it through a permission set to see it in the app.',
  'Capability-gated on a.b + c.d — every placement ticked above hides this action from anyone who does not hold all of them. Not greyed out and not an error: the button is simply absent, and the server refuses the invocation with a 403 either way.',
  'Component',
  // Feedback
  'Feedback',
  'Confirmation and post-run messaging.',
  'Confirm prompt',
  'Ask before running (leave blank to skip)',
  'Success message',
  'Error message',
  'Mode',
  'Refresh view after',
  'Offer undo',
  // Conditions
  'Conditions',
  'No-code predicates over the record / user / ctx (compiled to CEL).',
  'Visible when',
  'Disabled when',
  // AI exposure
  'AI exposure',
  'Opt-in: expose this action to AI agents as a callable tool.',
  'Expose to AI agents',
  'Tool description (required, ≥40 chars)',
  'When and why an agent should call this action…',
  'A ≥40-character description is required while exposed.',
  'Advanced / rarely-used properties.',
  // option labels — one fixture or another selects or lists each of them
  'Script — run an expression / sandboxed JS',
  'API — call an endpoint',
  'Flow — invoke a flow',
  'Modal — open a modal/page',
  'Form — open a FormView',
  'URL — navigate to a link',
  'Primary', 'Secondary', 'Danger', 'Ghost', 'Link',
  'Button', 'Icon only', 'Menu item', 'Button group',
  'Create', 'Edit', 'Delete', 'Custom',
  'Expression (L1)', 'Sandboxed JS (L2)',
  'Text', 'Long text', 'Number', 'Checkbox', 'Select', 'Date', 'Date/time', 'Lookup',
  'Run a script — sandboxed JS / expression body',
  'Update fields on this record — no code',
  'Record header', 'Record · more menu', 'Record · section', 'Record · related list', 'List toolbar', 'List · row',
] as const;

describe('ActionDefaultInspector reads its words in the designer locale (objectui#10586)', () => {
  it('zh: none of the pre-fix English renders, and named samples are the catalogue rows', async () => {
    const seen = await readAll('zh', ACTION_FIXTURES);
    expectNone(seen, ACTION_EN);
    expect(seen.has(zhRow('engine.inspector.action.behavior'))).toBe(true);
    expect(seen.has(zhRow('engine.inspector.action.type.script'))).toBe(true);
    expect(seen.has(zhRow('engine.inspector.action.location.record_header'))).toBe(true);
    // A slotted sentence keeps its node: the capability list sits inside the zh words.
    const [lead] = zhRow('engine.inspector.action.capabilityGateSelf').split('{capabilities}');
    expect(lead.trim().length, 'the zh self clause opens with words').toBeGreaterThan(0);
    expect([...seen].some((s) => s.startsWith(lead.trim()) && s.includes('a.b'))).toBe(true);
    // Protocol tokens and sample values are not words, and stay as they were.
    for (const literal of ['PATCH', 'object.viewKey', '/api/v1/…', 'status', 'done']) {
      expect(seen.has(literal), literal).toBe(true);
    }
  });

  it('en: every pre-fix string still renders, word for word', async () => {
    expectAll(await readAll('en', ACTION_FIXTURES), ACTION_EN);
  });
});

// ─── The shared atoms' defaults, through their hosts ────────────────────────

function mountNav(lang: Lang) {
  inLang(lang, (
    <AppNavInspector
      type="app"
      name="app"
      draft={{ name: 'app', navigation: [{ id: 'n1', type: 'object', label: 'Accounts', objectName: '' }] }}
      selection={{ kind: 'nav', id: 'navigation[0]' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
    />
  ));
}

/**
 * The combo's trigger, found through the `<Label htmlFor>` it owns. A bare
 * `button[role=combobox]` query would also match every `InspectorSelectField`
 * trigger, which Radix renders with the same role.
 */
function comboTrigger(labelText: string): HTMLButtonElement {
  const label = Array.from(document.body.querySelectorAll('label')).find((l) => l.textContent === labelText);
  expect(label, `the combo label ${labelText}`).toBeTruthy();
  const trigger = document.getElementById(label!.htmlFor);
  expect(trigger?.getAttribute('role'), 'the label names a combobox').toBe('combobox');
  return trigger as HTMLButtonElement;
}

const COMBO_FIXTURES: readonly Fixture[] = [
  // The object roster still in flight: the trigger's loading text.
  async (lang) => {
    state.metadataClient.list = () => new Promise<unknown[]>(() => {});
    mountNav(lang);
    await flush();
  },
  // The roster answered empty: the placeholder, then the open popover's search
  // box and empty state, then a typed value's custom row.
  async (lang) => {
    mountNav(lang);
    await flush();
    for (const s of surface()) comboExtra.add(s);
    fireEvent.click(comboTrigger(t('engine.inspector.appNav.object', LOCALE[lang])));
    await flush();
    for (const s of surface()) comboExtra.add(s);
    const input = document.body.querySelector<HTMLInputElement>('[cmdk-input]');
    expect(input, 'the combo search box').toBeTruthy();
    fireEvent.change(input!, { target: { value: 'custom_obj' } });
    await flush();
  },
];
// The combo fixture reads three states of one mount; `readAll` only sees the last.
const comboExtra = new Set<string>();

const COMBO_EN = [
  'Loading…',
  'Select…',
  'Search or type…',
  'No match — keep typing to use a custom value.',
  'Use “custom_obj”',
] as const;

async function readCombo(lang: Lang): Promise<Set<string>> {
  comboExtra.clear();
  const seen = await readAll(lang, COMBO_FIXTURES);
  for (const s of comboExtra) seen.add(s);
  return seen;
}

function mountFields(lang: Lang) {
  inLang(lang, (
    <ObjectFieldInspector
      type="object"
      name="account"
      draft={{ name: 'account', fields: { a: { type: 'text', label: 'A' }, b: { type: 'text', label: 'B' } } }}
      selection={{ kind: 'field', id: 'a' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
    />
  ));
}

const SHARED_FIXTURES: readonly Fixture[] = [
  // The one host whose header passes no reorder labels.
  async (lang) => {
    mountFields(lang);
    await flush();
  },
  // No in-tree host reaches these two defaults, so the primitive is read directly.
  (lang) => {
    inLang(lang, <InspectorShell kindLabel="K" title="T" onClose={() => {}}><div /></InspectorShell>);
  },
  (lang) => {
    inLang(lang, (
      <InspectorSelectField label="L" value="" options={[]} onCommit={() => {}} roster={{ status: 'error', message: 'boom' }} />
    ));
  },
];

const SHARED_EN = ['Move up', 'Move down', 'Close', 'Options could not be loaded'] as const;

describe('the shared inspector atoms read their default words in the designer locale (objectui#10586)', () => {
  it('zh: InspectorComboField (through AppNavInspector) renders none of its English defaults', async () => {
    const seen = await readCombo('zh');
    expectNone(seen, COMBO_EN);
    expect(seen.has(zhRow('engine.inspector.combo.loading'))).toBe(true);
    expect(seen.has(zhRow('engine.inspector.combo.search'))).toBe(true);
    expect(seen.has(zhRow('engine.inspector.combo.noMatch'))).toBe(true);
    expect(seen.has(zhRow('engine.form.selectEllipsis'))).toBe(true);
    const [lead, tail] = zhRow('engine.inspector.combo.useCustom').split('{value}');
    expect(seen.has(`${lead}“custom_obj”${tail}`.trim())).toBe(true);
  });

  it('en: InspectorComboField (through AppNavInspector) renders its defaults as before', async () => {
    expectAll(await readCombo('en'), COMBO_EN);
  });

  it('zh: the reorder pair (through ObjectFieldInspector), the close label and the roster-failure notice', async () => {
    const seen = await readAll('zh', SHARED_FIXTURES);
    expectNone(seen, SHARED_EN);
    expect(seen.has(zhRow('engine.inspector.reorder.up'))).toBe(true);
    expect(seen.has(zhRow('engine.inspector.reorder.down'))).toBe(true);
    expect(seen.has(zhRow('engine.close'))).toBe(true);
    expect(seen.has(zhRow('engine.form.optionsLoadFailedTitle'))).toBe(true);
  });

  it('en: the reorder pair, the close label and the roster-failure notice render as before', async () => {
    expectAll(await readAll('en', SHARED_FIXTURES), SHARED_EN);
  });

  it('zh: a label the caller passes still wins over the localized default', async () => {
    inLang('zh', (
      <>
        <InspectorShell kindLabel="K" title="T" onClose={() => {}} closeLabel="caller close"><div /></InspectorShell>
        <InspectorSelectField label="L" value="" options={[]} onCommit={() => {}} roster={{ status: 'error', message: '' }} rosterFailureLabel="caller failure" />
        <InspectorComboField label="C" value="" onCommit={() => {}} options={[]} placeholder="caller placeholder" searchPlaceholder="caller search" emptyText="caller empty" />
      </>
    ));
    fireEvent.click(comboTrigger('C'));
    await flush();
    const seen = surface();
    for (const own of ['caller close', 'caller failure', 'caller placeholder', 'caller search', 'caller empty']) {
      expect(seen.has(own), own).toBe(true);
    }
  });
});

// ─── Lit controls ───────────────────────────────────────────────────────────

describe('lit controls: the same probe reads translations that were already there (objectui#10586)', () => {
  it('ObjectDefaultInspector’s existing zh, through the host `locale` channel', () => {
    inLang('zh', <ObjectDefaultInspector type="object" name="" locale="zh-CN" draft={{}} onPatch={() => {}} readOnly={false} />);
    const seen = surface();
    expect(seen.has(zhRow('designer.object.section.basic'))).toBe(true);
    expect(seen.has(t('designer.object.section.basic', 'en-US'))).toBe(false);
  });

  it('InspectorSelectField’s existing zh flag, through the `useMetadataLocale()` channel', () => {
    inLang('zh', <InspectorSelectField label="L" value="ghost" options={[]} onCommit={() => {}} />);
    expect(surface().has(flagUnknownValue('ghost', zhRow('engine.form.notFound'), 'zh-CN'))).toBe(true);
  });
});
