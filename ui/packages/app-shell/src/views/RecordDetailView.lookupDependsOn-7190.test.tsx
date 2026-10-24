/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7190 — a `dependsOn` field on the DETAIL page cascades off the
 * record it is editing.
 *
 * ## What this pins
 *
 * `@object-ui/fields` resolves the record a cascade gates on from ONE channel:
 * the `dependentValues` prop its host passes (`LookupField`'s
 * `resolvedDependentValues` and `useCascadingOptions` both read
 * `dependentValues ?? {}`; objectui#7206 retired the context tail that used to
 * follow it). `plugin-detail`'s `InlineFieldInput` is that host on the record
 * page, and it used to pass nothing — so a `dependsOn` lookup read "Select
 * region first", disabled, while the `region` it asked for sat on screen in the
 * same edit session. This file first pinned that defect (PR #7207); it now pins
 * the repair: both of `InlineFieldInput`'s call sites hand it the record, and it
 * forwards that record to every widget that reads one.
 *
 * ## Why this file mounts the whole record page and not the widget
 *
 * A bare `InlineFieldInput` mount answers whatever its test passes — gated when
 * the test passes nothing, enabled when it passes a record — which is an answer
 * about the harness, not about the product. The defect lived in the HOSTS: which
 * record reaches the input. So this file mounts `RecordDetailView`, the app-shell
 * record page, and drives it the way a user does: the record loads, a field is
 * double-clicked to enter inline edit (#2401), and each widget's own DOM is read.
 *
 * ## The control is load-bearing in both directions
 *
 * Every render carries a CONTROL beside the declared field — the same reference
 * (or the same options) over the same record, with no `dependsOn` and no option
 * rule. An enabled reading on the declared field is worthless if the control is
 * broken for an unrelated reason, and a gated reading is worthless if the
 * control is gated too — the shape objectui#6875 established and #7154 / #7165
 * reuse. The controls are asserted, never merely observed.
 *
 * ## Both of `InlineFieldInput`'s call sites are covered
 *
 * `InlineFieldInput` has exactly two non-test call sites — `DetailSection` (the
 * details body) and `HeaderHighlight` (the highlights strip). The canonical
 * record page routes a field to exactly one of them: `buildDefaultTabs` hands
 * the strip's field list to `buildDefaultDetails` as `hideFields`, so a
 * highlight is hidden from the body. Declaring `highlightFields` therefore
 * selects which call site renders the fields under test, with no classname
 * coupling and no double render.
 *
 * The two call sites build the record differently, which is why both are pinned
 * rather than one: `DetailView` hands `DetailSection` the saved record already
 * merged with the inline draft, while `HeaderHighlight` receives the saved
 * record and merges the draft itself.
 *
 * ## The record is the STAGED one
 *
 * The record handed down is the saved record overlaid with the edit session's
 * draft — the same answer the grid's inline editor gives (`pendingRow ?? row`,
 * objectui#7188). So editing the parent re-scopes the child before anything is
 * saved, and clearing the parent re-gates it. The staged cases below edit the
 * parent in the strip; the body case then reads it through `DetailView`'s merge
 * and the strip case through `HeaderHighlight`'s.
 *
 * ## The prune path must SETTLE
 *
 * Handing the record to an option widget arms its cascade clear: a stored value
 * the current parent no longer offers is dropped with `onChange(null)` as
 * soon as inline edit is entered. That stages exactly one prune — IF the host
 * then hands the widget the pruned value. A host that reads a field's own value
 * by a different rule than the record it passes (the saved value whenever the
 * draft entry is empty) prunes again on every render, forever; the strip
 * did exactly that at `cfd1f8c5`. The last describe pins one prune per field at
 * both call sites, through a probe whose circuit breaker makes the regression a
 * bounded failure rather than a hung runner.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
// Orthogonal chrome — stubbed so the only thing this file observes is the editors.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

/**
 * The prune probe. An option widget drops a stored value its current parent no
 * longer admits by calling `onChange(null)` from an effect keyed on its
 * offered `options`. If the host then hands the widget the SAVED value again,
 * the next render prunes again — forever, synchronously inside `act`, which
 * hangs the runner instead of failing it (measured on the highlights strip at
 * `cfd1f8c5`, contract review on PR objectui#10255).
 *
 * So the two widgets `InlineFieldInput` reaches an option widget through —
 * `SelectField` directly, `RadioField` / `CheckboxesField` via `FieldEditWidget`
 * — are wrapped, never replaced: the real widget renders with the real props,
 * and the wrapper only (a) counts prunes per field, (b) records the last value
 * the HOST handed the widget, and (c) stops forwarding past
 * `PRUNE_CIRCUIT_BREAKER`. (c) is what turns a would-be hang into a bounded,
 * readable failure — a count above 1 — and it never trips on a host that
 * settles, where the count is exactly 1.
 */
const probe = vi.hoisted(() => ({
  prunes: {} as Record<string, number>,
  lastValue: {} as Record<string, unknown>,
}));
const PRUNE_CIRCUIT_BREAKER = 20;
vi.mock('@object-ui/fields', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  const { createElement } = await import('react');
  const probed = (Real: any) =>
    function Probed(props: any) {
      const name = String(props.field?.name ?? '');
      probe.lastValue[name] = props.value;
      const onChange = (v: unknown) => {
        // `null` since objectui#10291 (it was `undefined`, which the wire
        // dropped). Both are counted, so a regression back to `undefined` still
        // trips the breaker instead of hanging the runner.
        if (v === null || v === undefined) {
          probe.prunes[name] = (probe.prunes[name] ?? 0) + 1;
          if (probe.prunes[name] > PRUNE_CIRCUIT_BREAKER) return;
        }
        props.onChange?.(v);
      };
      return createElement(Real, { ...props, onChange });
    };
  return {
    ...actual,
    SelectField: probed(actual.SelectField),
    FieldEditWidget: probed(actual.FieldEditWidget),
  };
});

import { RecordDetailView } from './RecordDetailView';

const OBJECT = 'os_7190_task';
const REF = 'os_7190_person';
const REC = 'rec-1';

/** The referenced records. `region` is what the dependent filter scopes on. */
const PEOPLE = [
  { id: 'p1', name: 'Ana EMEA', region: 'emea' },
  { id: 'p2', name: 'Bo APAC', region: 'apac' },
];

/** The record under test — it CARRIES the parent value the cascades ask for. */
const RECORD = { id: REC, title: 'Task one', region: 'emea', regional_owner: null, owner: null };

const LOOKUP_FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
  region: { type: 'text', label: 'Region' },
  /** DECLARED: gates until `region` is known, then queries by it. */
  regional_owner: { type: 'lookup', label: 'Regional owner', reference: REF, dependsOn: ['region'] },
  /** CONTROL: same reference, same record, no `dependsOn`. */
  owner: { type: 'lookup', label: 'Owner', reference: REF },
};

/** One option per region, each offered only while the record is in it. */
const REGIONAL_OPTIONS = [
  { label: 'Gold', value: 'gold', visibleWhen: "record.region == 'emea'" },
  { label: 'Silver', value: 'silver', visibleWhen: "record.region == 'apac'" },
];
/** The same two values with no option rule — what the controls offer. */
const PLAIN_OPTIONS = [
  { label: 'Gold', value: 'gold' },
  { label: 'Silver', value: 'silver' },
];

const OPTION_FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
  region: { type: 'text', label: 'Region' },
  /** DECLARED single select: gated until `region` is known (`SelectField`). */
  tier: { type: 'select', label: 'Tier', dependsOn: ['region'], options: REGIONAL_OPTIONS },
  /** CONTROL single select: same values, no `dependsOn`, no option rule. */
  tier_any: { type: 'select', label: 'Tier (any)', options: PLAIN_OPTIONS },
  /**
   * DECLARED multi select: `SelectField` delegates to `MultiSelectField`, which
   * draws its offered options as chips — so the SCOPING by the record's value is
   * readable, not only the gate.
   */
  tags: { type: 'select', multiple: true, label: 'Tags', dependsOn: ['region'], options: REGIONAL_OPTIONS },
  /** CONTROL multi select: same values, no `dependsOn`, no option rule. */
  tags_any: { type: 'select', multiple: true, label: 'Tags (any)', options: PLAIN_OPTIONS },
};

type Fields = Record<string, Record<string, unknown>>;

/** `highlightFields` selects which `InlineFieldInput` call site renders the fields. */
function objectsWith(fields: Fields, highlightFields: string[]) {
  return [{ name: OBJECT, label: 'Task', managedBy: 'platform', highlightFields, fields }];
}

function makeDataSource(fields: Fields, record: Record<string, unknown> = RECORD) {
  return {
    find: vi.fn(async (objectName: string, params: any) => {
      if (objectName === REF) {
        let recs = PEOPLE;
        const f = params?.$filter;
        if (f && typeof f === 'object' && f.region) recs = recs.filter((p) => p.region === f.region);
        return { data: recs, total: recs.length, hasMore: false, pageSize: 50 };
      }
      return { data: [] };
    }),
    findOne: vi.fn(async (objectName: string, id: string) =>
      objectName === REF ? (PEOPLE.find((p) => p.id === id) ?? null) : { ...record, id }),
    create: vi.fn(async (_o: string, row: any) => row),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: async (name: string) =>
      name === REF
        ? { name, fields: { id: { type: 'text' }, name: { type: 'text' }, region: { type: 'text' } } }
        : { name, fields },
  } as any;
}

function makeMetadata() {
  const pages: any[] = [];
  return {
    objects: [], pages, loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => pages, getItem: async () => null,
    getItemsByType: () => pages,
  } as any;
}

function tree(ds: any, objects: any[]) {
  return (
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT}/${REC}`]}>
      <MetadataCtx.Provider value={makeMetadata()}>
        <RecordDetailView
          dataSource={ds}
          objects={objects}
          onEdit={() => {}}
          objectNameOverride={OBJECT}
          recordIdOverride={REC}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>
  );
}

/**
 * Load the record page and enter inline edit off the `region` field. The strip
 * and the details body share ONE inline-edit session, so entering it anywhere
 * puts both surfaces into edit mode.
 */
async function openInlineEdit(
  fields: Fields,
  highlightFields: string[],
  record: Record<string, unknown> = RECORD,
) {
  const ds = makeDataSource(fields, record);
  const { container } = render(tree(ds, objectsWith(fields, highlightFields)));
  await screen.findByText('Task one');
  fireEvent.doubleClick(screen.getByText('emea'));
  await waitFor(() => {
    expect(regionInput(container)).toBeTruthy();
  });
  return { ds, container };
}

/** The `region` editor: a text field, so it is the one plain text input. */
function regionInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('[data-testid="inline-plain-text-input"]') as HTMLInputElement;
}

/** Stage a new `region` into the edit session's draft, as typing does. */
function stageRegion(container: HTMLElement, value: string) {
  fireEvent.change(regionInput(container), { target: { value } });
}

function lookupTriggers(container: HTMLElement) {
  return {
    all: Array.from(container.querySelectorAll('[data-testid^="lookup-trigger"]')) as HTMLButtonElement[],
    gated: container.querySelector('[data-testid="lookup-trigger-gated"]') as HTMLButtonElement | null,
    declared: container.querySelector('[data-testid="lookup-trigger-regional_owner"]') as HTMLButtonElement | null,
    control: container.querySelector('[data-testid="lookup-trigger-owner"]') as HTMLButtonElement | null,
  };
}

/** The `$filter` of every query the pickers issued against the referenced object. */
function refFilters(ds: any): unknown[] {
  return ds.find.mock.calls
    .filter(([objectName]: any[]) => objectName === REF)
    .map(([, params]: any[]) => params?.$filter ?? null);
}

/** Open the declared picker and hand back the `$filter` its query carried. */
async function openDeclaredPicker(ds: any, declared: HTMLButtonElement): Promise<unknown> {
  const before = refFilters(ds).length;
  fireEvent.click(declared);
  await waitFor(() => {
    expect(refFilters(ds).length).toBeGreaterThan(before);
  });
  const filters = refFilters(ds);
  return filters[filters.length - 1];
}

function chipValues(container: HTMLElement, fieldName: string): string[] {
  const group = container.querySelector(`[data-testid="multiselect-${fieldName}"]`);
  if (!group) return [];
  return Array.from(group.querySelectorAll('[data-testid^="multiselect-option-"]')).map((el) =>
    (el.getAttribute('data-testid') ?? '').replace('multiselect-option-', ''),
  );
}

beforeAll(() => {
  // useIsMobile() keys off innerWidth (< 768 == mobile); pin a desktop width so
  // the desktop row carrying the double-click affordance renders.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

beforeEach(() => {
  cleanup();
  probe.prunes = {};
  probe.lastValue = {};
  // Unrelated chrome (approvals, favourites…) reaches for the platform API; in
  // jsdom that is a real socket. Answer it locally.
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
});

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

/**
 * The two call sites. `region` is a highlight in both, so the staged cases
 * always edit the parent in the strip; what differs is where the dependent
 * field renders, and therefore which host merged the draft into its record.
 */
const LOOKUP_CALL_SITES = [
  { site: 'DETAILS BODY (DetailSection)', highlights: ['region'] },
  { site: 'HIGHLIGHTS STRIP (HeaderHighlight)', highlights: ['region', 'regional_owner', 'owner'] },
];

describe('objectui#7190 — a `dependsOn` lookup on the app-shell record page', () => {
  it.each(LOOKUP_CALL_SITES)(
    '$site: the declared lookup is enabled and queries by the record, beside an enabled control',
    async ({ highlights }) => {
      const { ds, container } = await openInlineEdit(LOOKUP_FIELDS, highlights);
      await waitFor(() => {
        expect(lookupTriggers(container).all.length).toBe(2);
      });
      const { all, gated, declared, control } = lookupTriggers(container);

      // Exactly two pickers: one per declared column, no double render.
      expect(all.length).toBe(2);

      // CONTROL — the same reference over the same record with no `dependsOn`.
      expect(control).toBeTruthy();
      expect(control!.disabled).toBe(false);

      // The parent value the cascade asks for is on screen in this edit session.
      expect(regionInput(container).value).toBe('emea');

      // THE REPAIR: the declared lookup is not gated…
      expect(gated).toBeNull();
      expect(declared).toBeTruthy();
      expect(declared!.disabled).toBe(false);

      // …and its query is scoped by the RECORD's value, not merely unlocked.
      expect(await openDeclaredPicker(ds, declared!)).toEqual({ region: 'emea' });
    },
  );

  it.each(LOOKUP_CALL_SITES)(
    '$site: the lookup reads the STAGED draft — clearing the parent re-gates it, a new parent re-scopes it',
    async ({ highlights }) => {
      const { ds, container } = await openInlineEdit(LOOKUP_FIELDS, highlights);
      await waitFor(() => {
        expect(lookupTriggers(container).declared).toBeTruthy();
      });

      // Clear the parent in the draft only — nothing is saved.
      stageRegion(container, '');
      await waitFor(() => {
        expect(lookupTriggers(container).gated).toBeTruthy();
      });
      expect(lookupTriggers(container).gated!.disabled).toBe(true);
      expect(lookupTriggers(container).gated!.textContent).toContain('Select region first');
      // The control is untouched by the parent.
      expect(lookupTriggers(container).control!.disabled).toBe(false);

      // Stage a different parent: the declared lookup unlocks and scopes by it.
      stageRegion(container, 'apac');
      await waitFor(() => {
        expect(lookupTriggers(container).declared).toBeTruthy();
      });
      const declared = lookupTriggers(container).declared!;
      expect(declared.disabled).toBe(false);
      expect(await openDeclaredPicker(ds, declared)).toEqual({ region: 'apac' });

      // Staged only: the record itself was never written.
      expect(ds.update).not.toHaveBeenCalled();
    },
  );
});

const OPTION_CALL_SITES = [
  { site: 'DETAILS BODY (DetailSection)', highlights: ['region'] },
  { site: 'HIGHLIGHTS STRIP (HeaderHighlight)', highlights: ['region', 'tier', 'tier_any', 'tags', 'tags_any'] },
];

describe('objectui#7190 — a `dependsOn` option list (select / multiselect) on the app-shell record page', () => {
  it.each(OPTION_CALL_SITES)(
    '$site: the declared option lists open and are scoped by the record, beside ungated controls',
    async ({ highlights }) => {
      const { container } = await openInlineEdit(OPTION_FIELDS, highlights);

      // CONTROLS — same values, no `dependsOn`, no option rule.
      await waitFor(() => {
        expect(container.querySelector('[data-testid="select-trigger-tier_any"]')).toBeTruthy();
      });
      expect(chipValues(container, 'tags_any')).toEqual(['gold', 'silver']);

      // DECLARED single select: not gated.
      expect(container.querySelector('[data-testid="select-empty-tier"]')).toBeNull();
      expect(container.querySelector('[data-testid="select-trigger-tier"]')).toBeTruthy();

      // DECLARED multi select: not gated, and offering ONLY the record's region.
      expect(container.querySelector('[data-testid="multiselect-empty-tags"]')).toBeNull();
      expect(chipValues(container, 'tags')).toEqual(['gold']);
    },
  );

  it.each(OPTION_CALL_SITES)(
    '$site: the option lists read the STAGED draft — a new parent re-scopes them, clearing it re-gates them',
    async ({ highlights }) => {
      const { container } = await openInlineEdit(OPTION_FIELDS, highlights);
      await waitFor(() => {
        expect(chipValues(container, 'tags')).toEqual(['gold']);
      });

      stageRegion(container, 'apac');
      await waitFor(() => {
        expect(chipValues(container, 'tags')).toEqual(['silver']);
      });
      expect(chipValues(container, 'tags_any')).toEqual(['gold', 'silver']);

      stageRegion(container, '');
      await waitFor(() => {
        expect(container.querySelector('[data-testid="multiselect-empty-tags"]')).toBeTruthy();
      });
      expect(container.querySelector('[data-testid="select-empty-tier"]')).toBeTruthy();
      // The controls do not depend on the parent.
      expect(container.querySelector('[data-testid="select-trigger-tier_any"]')).toBeTruthy();
      expect(chipValues(container, 'tags_any')).toEqual(['gold', 'silver']);
    },
  );
});

/**
 * The radio reaches its widget through `FieldEditWidget`, the fourth forward in
 * `InlineFieldInput`. Its control uses DIFFERENT values (`g2` / `s2`) because a
 * radio option's test id is `radio-option-VALUE`, not namespaced by field.
 */
const RADIO_FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
  region: { type: 'text', label: 'Region' },
  /** DECLARED: offered per region, gated while `region` is empty. */
  band: { type: 'radio', label: 'Band', dependsOn: ['region'], options: REGIONAL_OPTIONS },
  /** CONTROL: no `dependsOn`, no option rule. */
  band_any: {
    type: 'radio',
    label: 'Band (any)',
    options: [
      { label: 'Gold (any)', value: 'g2' },
      { label: 'Silver (any)', value: 's2' },
    ],
  },
};

function radioValues(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="radio-option-"]')).map((el) =>
    (el.getAttribute('data-testid') ?? '').replace('radio-option-', ''),
  );
}

const RADIO_CALL_SITES = [
  { site: 'DETAILS BODY (DetailSection)', highlights: ['region'] },
  { site: 'HIGHLIGHTS STRIP (HeaderHighlight)', highlights: ['region', 'band', 'band_any'] },
];

describe('objectui#7190 — a `dependsOn` radio, through the `FieldEditWidget` forward', () => {
  it.each(RADIO_CALL_SITES)(
    '$site: the declared radio is scoped by the staged record, beside a live control',
    async ({ highlights }) => {
      const { container } = await openInlineEdit(RADIO_FIELDS, highlights);

      // CONTROL first: the radio path renders in this host at all.
      await waitFor(() => {
        expect(radioValues(container)).toEqual(expect.arrayContaining(['g2', 's2']));
      });

      // DECLARED: ungated, and offering only the record's region.
      expect(container.querySelector('[data-testid="radio-empty-band"]')).toBeNull();
      expect(radioValues(container)).toContain('gold');
      expect(radioValues(container)).not.toContain('silver');

      // Staged parent: re-scoped before anything is saved.
      stageRegion(container, 'apac');
      await waitFor(() => {
        expect(radioValues(container)).toContain('silver');
      });
      expect(radioValues(container)).not.toContain('gold');
      expect(radioValues(container)).toEqual(expect.arrayContaining(['g2', 's2']));
    },
  );
});

/**
 * A stored option value its CURRENT parent does not admit: `silver` is offered
 * only under `apac`, and the record sits in `emea`. Entering inline edit hands
 * the widgets the record, their cascade-clear effect prunes the value once,
 * and the host must then hand the widget the PRUNED (empty) value so the effect
 * finds nothing left to prune. A host that re-reads the saved value instead
 * prunes forever — the loop the circuit breaker in the `@object-ui/fields` probe
 * turns into a count above 1.
 */
const PRUNE_FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
  region: { type: 'text', label: 'Region' },
  /** Single select → `InlineFieldInput`'s own `SelectField` branch. */
  tier: { type: 'select', label: 'Tier', dependsOn: ['region'], options: REGIONAL_OPTIONS },
  /** Radio → the `FieldEditWidget` branch. */
  band: { type: 'radio', label: 'Band', dependsOn: ['region'], options: REGIONAL_OPTIONS },
};
const INADMISSIBLE = { ...RECORD, tier: 'silver', band: 'silver' };
const ADMISSIBLE = { ...RECORD, tier: 'gold', band: 'gold' };

/**
 * A bounded settle window: long enough for every effect the entry scheduled to
 * run, and bounded, so a host that does not settle fails on the counts below
 * instead of holding the runner.
 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('objectui#7190 — a stored option the current parent no longer admits', () => {
  it('HIGHLIGHTS STRIP: each inadmissible value is pruned exactly ONCE and its editor settles empty', async () => {
    const { container } = await openInlineEdit(PRUNE_FIELDS, ['region', 'tier', 'band'], INADMISSIBLE);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="select-trigger-tier"]')).toBeTruthy();
    });
    await settle();

    expect(probe.prunes.tier).toBe(1);
    expect(probe.prunes.band).toBe(1);
    // The host now hands each widget the pruned value: the single-select branch
    // spells an empty value `''`, the `FieldEditWidget` branch passes it as is.
    expect(probe.lastValue.tier).toBe('');
    expect(probe.lastValue.band).toBeNull();
  });

  it('HIGHLIGHTS STRIP control: an ADMISSIBLE stored value is never pruned', async () => {
    const { container } = await openInlineEdit(PRUNE_FIELDS, ['region', 'tier', 'band'], ADMISSIBLE);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="select-trigger-tier"]')).toBeTruthy();
    });
    await settle();

    expect(probe.prunes.tier ?? 0).toBe(0);
    expect(probe.prunes.band ?? 0).toBe(0);
    expect(probe.lastValue.tier).toBe('gold');
    expect(probe.lastValue.band).toBe('gold');
  });

  it('DETAILS BODY: the same inadmissible record settles after exactly ONE prune per field', async () => {
    const { container } = await openInlineEdit(PRUNE_FIELDS, ['region'], INADMISSIBLE);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="select-trigger-tier"]')).toBeTruthy();
    });
    await settle();

    expect(probe.prunes.tier).toBe(1);
    expect(probe.prunes.band).toBe(1);
    expect(probe.lastValue.tier).toBe('');
    // The body reads a field's value as `data[name] ?? field.value`, so the
    // staged `null` reaches the radio as `undefined` — empty either way, which
    // is what stops the second prune. The WRITE still carries `null`: that is
    // pinned on the wire in plugin-detail (objectui#10291).
    expect(probe.lastValue.band).toBeUndefined();
  });
});
