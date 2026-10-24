// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The Action designer's two panes agree on the param `type` vocabulary**
 * (objectui#6538).
 *
 * `ActionPreview`'s declared job is "a faux button / dialog rendered so authors
 * can see the visual weight before they ship it" — it shows what WILL render.
 * `ActionDefaultInspector`'s `PARAM_TYPE_OPTS` decides what an author can pick.
 * Until this card the two disagreed, and the preview lost: for three of the
 * eight offered spellings it drew a control the runtime dialog does not draw.
 *
 * ## Where "what the runtime draws" comes from
 *
 * `ActionParamDialog` renders every param through the shared form field widgets
 * (ADR-0059): `paramToField()` resolves the param's `type` to a widget key via
 * `resolveParamWidgetType`, `paramDegradesWithoutTarget()` decides whether a
 * picker collapses to a text box for want of a declared target, and
 * `getLazyFieldWidget(key)` renders it. So the runtime's answer for a spelling
 * is a pure function this file can call, and does — see {@link runtimeWidgetFor}.
 *
 * ## Why the expectations are hand-declared AND cross-checked
 *
 * `EXPECTED` below is read out of the runtime by a human: `datetime` renders
 * the platform date picker (`DateTimePickerField`, objectui#12642), so its mock
 * must be a date picker, not a plain text box. If
 * the test DERIVED each expectation from the same resolver the preview calls,
 * it could never catch the preview calling the resolver wrongly — the pin would
 * assert the implementation against itself. So the per-case expectation is
 * literal, and a separate drift guard asserts that the literal table still
 * matches what the resolver says. The first half is the pin; the second keeps
 * it honest as the widget map moves.
 *
 * ## The population is EIGHT, not forty-nine
 *
 * `PARAM_TYPE_OPTS` is the population, imported rather than restated: the
 * defect is that two panes of ONE designer disagree, not that the preview is
 * incomplete against the spec's whole 49-member `FieldType`. The coverage
 * guards below fail if a ninth spelling is offered without a case here, and if a
 * case names a spelling the inspector does not offer.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { ActionParam, ResolvableParamFieldType } from '@object-ui/types';

// ActionDefaultInspector calls useObjectOptions()/useObjectFields() at mount
// (objectui#4697) — stub the shared client so mounting escapes to no network.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('./useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { paramDegradesWithoutTarget } from '../../utils/paramToField.js';
import { resolveParamWidgetType } from '@object-ui/fields';
import { ActionPreview } from './previews/ActionPreview';
import { ActionDefaultInspector, PARAM_TYPE_OPTS } from './inspectors/ActionDefaultInspector';
import { __setCelFormulaLoader } from './celAuthoring';

beforeEach(() => {
  // Both ConditionBuilders mount unconditionally; give them a loader that
  // resolves so nothing reaches for the real CEL engine during these renders.
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
      introspectScope: () => ({ fields: [], roots: [], functions: [] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
});

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

/** The eight spellings the inspector offers — the population, by reference. */
const OFFERED: readonly string[] = PARAM_TYPE_OPTS.map((o) => o.value);

/**
 * A control the preview's dialog mock can draw, as a stable spelling.
 * `input:*` is the DOM `type` of the rendered `<input>`; `record-picker` is the
 * disabled combobox the preview mocks a `LookupField` with, the one that pops
 * a dialog; `select` is the shared `Select`'s trigger, the combobox that pops
 * none, which `SelectField` draws too (objectui#11865); `date-picker` is the
 * text box inside a `data-slot="date-picker"` wrapper, the shape the platform
 * date picker draws for `date` and `datetime` (objectui#12642).
 */
type MockControl =
  | 'input:text'
  | 'input:number'
  | 'date-picker'
  | 'input:checkbox'
  | 'textarea'
  | 'select'
  | 'record-picker';

/**
 * The faithful mock for each runtime widget key the eight can resolve to.
 * Hand-written on purpose (see the header): this is a human reading of what
 * `@object-ui/fields` renders, which is the thing the preview is supposed to
 * show. The drift guard below re-checks it against the resolver.
 */
const MOCK_FOR_RUNTIME_WIDGET: Readonly<Record<string, MockControl>> = {
  text: 'input:text',
  textarea: 'textarea',
  number: 'input:number',
  boolean: 'input:checkbox',
  select: 'select',
  date: 'date-picker',
  datetime: 'date-picker',
  lookup: 'record-picker',
};

interface Case {
  /** One of the eight `PARAM_TYPE_OPTS` spellings. */
  readonly spelling: ResolvableParamFieldType;
  /** Extra authored keys that change what the runtime does with the spelling. */
  readonly extra?: Partial<ActionParam>;
  /** What the RUNTIME dialog draws for this param — read out of the runtime. */
  readonly expected: MockControl;
  readonly why: string;
}

const CASES: readonly Case[] = [
  { spelling: 'text', expected: 'input:text', why: 'TextField' },
  {
    spelling: 'text',
    extra: { options: [{ label: 'Duplicate', value: 'dup' }] },
    expected: 'input:text',
    why: 'options on a `text` param are ignored by the runtime — it still renders TextField',
  },
  { spelling: 'textarea', expected: 'textarea', why: 'TextAreaField' },
  { spelling: 'number', expected: 'input:number', why: 'NumberField' },
  { spelling: 'boolean', expected: 'input:checkbox', why: 'BooleanField, widget `checkbox`' },
  {
    spelling: 'select',
    extra: { options: [{ label: 'Duplicate', value: 'dup' }, { label: 'Spam', value: 'spam' }] },
    expected: 'select',
    why: 'SelectField',
  },
  {
    spelling: 'select',
    expected: 'select',
    why: 'SelectField renders an EMPTY picker with a placeholder — not a text box',
  },
  { spelling: 'date', expected: 'date-picker', why: 'DatePickerField, the platform date picker' },
  { spelling: 'datetime', expected: 'date-picker', why: 'DateTimePickerField, the platform date picker' },
  {
    spelling: 'lookup',
    extra: { reference: 'account' },
    expected: 'record-picker',
    why: 'LookupField — a record picker, once a target is declared',
  },
  {
    spelling: 'lookup',
    expected: 'input:text',
    why: 'a targetless lookup DEGRADES to a record-id text box (paramDegradesWithoutTarget)',
  },
];

function paramFor(c: Case): ActionParam {
  return { name: 'p', label: 'P', type: c.spelling, ...c.extra };
}

function describeCase(c: Case): string {
  const extra = c.extra ? ` + ${Object.keys(c.extra).join('/')}` : '';
  return `${c.spelling}${extra}`;
}

/**
 * What `ActionParamDialog` would resolve this AUTHORED param to.
 *
 * The one rename this crossing needs: the authoring key is `reference`
 * (`ActionParamSchema`), the resolved key `paramToField` reads is `referenceTo`
 * — `resolveActionParams()` performs exactly that copy before the dialog sees a
 * param. Nothing else is restated; the membership tables stay where they are.
 */
function runtimeWidgetFor(param: ActionParam): string {
  const type = param.type as string;
  const resolved = { name: param.name ?? '', label: '', type, referenceTo: param.reference };
  return paramDegradesWithoutTarget(resolved) ? 'text' : resolveParamWidgetType(type);
}

function renderPreviewWith(param: ActionParam): HTMLElement {
  const { container } = render(
    <ActionPreview
      type="action"
      name="approve"
      draft={{ name: 'approve', label: 'Approve', type: 'script', target: 'true', params: [param] }}
    />,
  );
  return container as HTMLElement;
}

/**
 * The one control the dialog mock drew for the one param in the draft.
 *
 * Asserting the count is part of the instrument: an empty match would make
 * every `not.toBe('input:text')` pass vacuously, and two matches would mean the
 * query is picking up something outside the mock.
 */
function drawnControl(container: HTMLElement): MockControl {
  const controls = Array.from(
    container.querySelectorAll('input, textarea, select, button[role="combobox"]'),
  );
  expect(controls.map((el) => el.outerHTML), 'exactly one control per param mock').toHaveLength(1);
  const el = controls[0]!;
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'button') return el.getAttribute('aria-haspopup') === 'dialog' ? 'record-picker' : 'select';
  if (el.closest('[data-slot="date-picker"]')) return 'date-picker';
  return `input:${(el as HTMLInputElement).type}` as MockControl;
}

describe('Action designer — the preview draws what the runtime dialog will draw (#6538)', () => {
  it.each(CASES.map((c) => [describeCase(c), c] as const))(
    'previews an offered `%s` param as the control the runtime renders',
    (_name, c) => {
      const container = renderPreviewWith(paramFor(c));
      expect(
        drawnControl(container),
        `the inspector offers "${c.spelling}"; the runtime dialog draws ${c.why}`,
      ).toBe(c.expected);
    },
  );

  it('draws no offered spelling as a plain text box unless the runtime does', () => {
    // The disagreement, stated as one sentence rather than per case: a text box
    // in the preview is a CLAIM that the runtime shows a text box.
    const lying = CASES.filter((c) => {
      const drawn = drawnControl(renderPreviewWith(paramFor(c)));
      cleanup();
      return drawn === 'input:text' && MOCK_FOR_RUNTIME_WIDGET[runtimeWidgetFor(paramFor(c))] !== 'input:text';
    }).map(describeCase);
    expect(lying, 'these spellings preview as a text box the runtime dialog will not draw').toEqual([]);
  });

  // ── Guards on the instrument itself ──────────────────────────────────────

  it('covers every spelling the inspector offers, and no other', () => {
    const covered = [...new Set(CASES.map((c) => c.spelling as string))].sort();
    expect(covered, 'PARAM_TYPE_OPTS is the population — a ninth entry needs a case here').toEqual(
      [...OFFERED].sort(),
    );
  });

  it('the hand-declared expectations still match what the runtime resolver says', () => {
    const drifted = CASES.filter((c) => MOCK_FOR_RUNTIME_WIDGET[runtimeWidgetFor(paramFor(c))] !== c.expected).map(
      (c) => `${describeCase(c)} → ${runtimeWidgetFor(paramFor(c))} (expected mock ${c.expected})`,
    );
    expect(drifted, 'the widget map moved under this table — re-read the runtime before editing').toEqual([]);
  });

  it('every runtime widget the eight resolve to has a declared mock', () => {
    const unmapped = CASES.map((c) => runtimeWidgetFor(paramFor(c))).filter(
      (w) => MOCK_FOR_RUNTIME_WIDGET[w] === undefined,
    );
    expect([...new Set(unmapped)]).toEqual([]);
  });

  it('an untyped (field-backed) param keeps inferring from its options', () => {
    // Not one of the eight: a `{ field: … }` param carries no `type` in the
    // draft and the designer does not resolve object metadata here, so options
    // are the only evidence the preview has. Pinned so the type-driven
    // switch above cannot quietly take this case with it.
    const withOptions = renderPreviewWith({ field: 'status', options: [{ label: 'Open', value: 'open' }] });
    expect(drawnControl(withOptions)).toBe('select');
    cleanup();
    expect(drawnControl(renderPreviewWith({ field: 'status' }))).toBe('input:text');
  });
});

/* ─────────────── The other half of the same seam ─────────────── */

/**
 * Stateful harness — the inspector is CONTROLLED, so a committed patch has to
 * round-trip through the draft or the next commit reverts the last one.
 */
function InspectorHarness({ onDraft, params }: {
  onDraft: (d: Record<string, unknown>) => void;
  params: ActionParam[];
}) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'approve',
    label: 'Approve',
    type: 'script',
    params,
  });
  React.useEffect(() => onDraft(draft), [draft, onDraft]);
  return (
    <ActionDefaultInspector
      type="action"
      name="approve"
      draft={draft}
      onPatch={(patch: Record<string, unknown>) => setDraft((d) => ({ ...d, ...patch }))}
      readOnly={false}
      locale={'en-US' as never}
    />
  );
}

function renderInspector(params: ActionParam[]) {
  const seen: Record<string, unknown>[] = [];
  const onDraft = (d: Record<string, unknown>) => { seen.push(d); };
  render(<InspectorHarness onDraft={onDraft} params={params} />);
  return { latestParams: () => (seen.at(-1)?.params ?? []) as ActionParam[] };
}

describe('Action designer — the panel that offers `select` can author its options (#6538)', () => {
  it('offers an options editor for a select param', () => {
    renderInspector([{ name: 'reason', label: 'Reason', type: 'select' }]);
    // Before this card the per-param editor had controls for field, name,
    // label, type, placeholder, required and defaultFromRow — and no way at all
    // to author `options`. `params` is in CURATED_FIELDS, so the collapsed
    // "More fields" SchemaForm hides the whole array too: there was nowhere in
    // this panel to put them.
    expect(screen.getByRole('group', { name: 'Options' })).toBeInTheDocument();
  });

  it('writes an authored option onto the param the preview reads', () => {
    const { latestParams } = renderInspector([{ name: 'reason', label: 'Reason', type: 'select' }]);
    const group = () => screen.getByRole('group', { name: 'Options' });
    fireEvent.click(within(group()).getByRole('button', { name: /add option/i }));
    fireEvent.change(within(group()).getByLabelText('Label'), { target: { value: 'Duplicate' } });
    fireEvent.change(within(group()).getByLabelText('Value'), { target: { value: 'dup' } });
    expect(latestParams()[0]?.options).toEqual([{ label: 'Duplicate', value: 'dup' }]);
  });

  it('shows no options editor for a spelling the runtime does not read options for', () => {
    renderInspector([{ name: 'note', label: 'Note', type: 'text' }]);
    expect(screen.queryByRole('group', { name: 'Options' })).toBeNull();
  });
});
