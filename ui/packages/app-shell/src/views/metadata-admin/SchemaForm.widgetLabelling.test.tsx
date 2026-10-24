// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4871 — metadata-admin's `WIDGETS` registry gains a labelling
 * declaration, and `SchemaForm` emits the channel it dictates.
 *
 * ## What was measured
 *
 * `FieldRow` wrote `<Label htmlFor={id}>` for EVERY field and handed the
 * same `id` down, on the convention "the wrapped control carries it". Probed on
 * real `SchemaForm` renders at `167ec42e7` — every registry key, both the
 * editable and the read-only state, three columns each (does the host `for`
 * resolve, and to a LABELABLE element / is the rendered face labelable at all /
 * does the group have an accessible name):
 *
 * ```
 *                     editable                              read-only
 * ref:object          for=RESOLVES-LABELABLE  button        for=RESOLVES-LABELABLE  button
 * filter-mode         for=DANGLING  hostIdEl=NONE           for=DANGLING  hostIdEl=NONE
 * field-multi         for=RESOLVES-LABELABLE  button        for=DANGLING  hostIdEl=NONE   <-
 * action-multi        for=RESOLVES-LABELABLE  button        for=DANGLING  hostIdEl=NONE   <-
 * filter-builder      for=DANGLING  hostIdEl=NONE           for=DANGLING  hostIdEl=NONE
 * color-picker/enum   for=DANGLING  group name="Probe"      for=DANGLING  group name="Probe"
 * color-picker/free   for=DANGLING  hostIdEl=NONE           for=DANGLING  hostIdEl=NONE
 * condition           for=DANGLING  hostIdEl=NONE           for=DANGLING  hostIdEl=NONE
 * master-detail       for=DANGLING  hostIdEl=NONE           for=DANGLING  hostIdEl=NONE
 * multiselect         for=DANGLING  group name=""           for=DANGLING  group name=""
 * code                for=DANGLING  hostIdEl=NONE           for=DANGLING  hostIdEl=NONE
 * dynamic-config      for=DANGLING  hostIdEl=NONE           for=DANGLING  hostIdEl=NONE
 * …(the remaining keys resolved to a labelable element in both states)
 * ```
 *
 * Two readings decided the shape of the fix:
 *
 *  - `hostIdEl=NONE` on eight keys — the `for` pointed at an id NO element in
 *    the document carried. A dangling IDREF is worse than a missing one: tooling
 *    reports an association that resolves to nothing, so it reads as closed;
 *  - the rows marked `<-`: `field-multi` / `action-multi` were labelable in ONE
 *    state. The element that carried the id — an auxiliary "add" picker — is
 *    gated behind `!readOnly`. A declaration that is conditionally true is
 *    exactly the runtime inference the #4871 ruling removed from `color-picker`,
 *    so those two are `'group'`, not `'control'`.
 *
 * ## What this file pins
 *
 * The ledger's three columns, re-measured through the same real renders and
 * asserted against each widget's DECLARATION rather than against a hand-listed
 * expectation — so the table in `widgets.tsx` and the DOM cannot drift apart.
 * A `'group'` case asserts the named surface EXISTS and answers the IDREF, not
 * merely that the `for` is gone: "no dangling `for`" is also true of a widget
 * that renders nothing, and that green would mean nothing.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

// The `code` widget reads the page's Monaco loader probe on mount
// (objectui#11858). Unstubbed, the real loader injects its CDN script, which
// this environment refuses, and the loader leaves a rejection that no browser
// listener is here to cancel. Monaco's loader fails (offline), as on an install
// without CDN access, so the widget renders its textarea fallback.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});
import { SchemaForm, type FormFieldSpec } from './SchemaForm';
import {
  WIDGETS,
  WIDGET_LABELLING,
  widgetLabelling,
  colorPaletteOptions,
  resolveColorWidgetKey,
  type RegisteredWidgetKey,
  type WidgetContext,
} from './widgets';
import { loaded } from './loadState';

afterEach(cleanup);

/** The HTML elements a `<label for>` can actually address. */
const LABELABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'METER', 'OUTPUT', 'PROGRESS']);

// `prettify('probe') === 'Probe'`, so `FieldRow` renders no machine-name
// `<code>` inside the label and the accessible name is the visible text alone.
const NAME = 'probe';
const HOST_ID = `mdf-${NAME}`;
const LABEL_ID = `${HOST_ID}-label`;
const TITLE = 'Probe';

type Case = {
  key: RegisteredWidgetKey;
  variant?: string;
  schema: Record<string, unknown>;
  /**
   * Extra `FormFieldSpec` keys — typed as the authoring surface itself since
   * objectui#5040 closed the gap this comment used to record. `dependsOn`, which
   * two of the cases below set and two widgets read, was declared ONLY on
   * `widgets.tsx`'s inline copy of the contract, so these specs could not be
   * typed at all and were loosened here instead. There is one declaration now,
   * and a case that sets a key no author may write fails at this line.
   */
  spec?: Partial<FormFieldSpec>;
  /**
   * The CATALOGS this case's widget reads. `conditionScope` — required on
   * `WidgetContext` since objectui#8167 — is not a catalog and is not a case's
   * business here, so `renderCase` supplies `'flattened'`, the verdict every
   * mount ran under before that member existed.
   *
   * ⚠️ Omitting `ctx` entirely still means NO `WidgetContext` reaches the form,
   * which is a different thing and is load-bearing for the `condition` case: a
   * widget that receives no context at all makes no scope claim, and that case
   * pins the labelling of the builder it still renders.
   */
  ctx?: Omit<WidgetContext, 'conditionScope'>;
  value?: unknown;
  formData?: Record<string, unknown>;
};

function renderCase(c: Case, readOnly: boolean) {
  const spec: FormFieldSpec = { field: NAME, widget: c.key, ...c.spec };
  const properties: Record<string, unknown> = { [NAME]: c.schema };
  for (const k of Object.keys(c.formData ?? {})) properties[k] = { type: 'string' };
  return render(
    <SchemaForm
      schema={{ type: 'object', properties } as never}
      form={{ type: 'simple', sections: [{ label: 'S', fields: [spec] }] } as never}
      value={{ [NAME]: c.value, ...(c.formData ?? {}) }}
      onChange={() => {}}
      readOnly={readOnly}
      widgetContext={c.ctx ? { conditionScope: 'flattened', ...c.ctx } : undefined}
    />,
  );
}

/**
 * One probe case per registry key (plus the branch variants that made the old
 * single `color-picker` entry conditional, and `multiselect`'s option-less
 * degradation). Every key of `WIDGETS` must appear — asserted below, so a widget
 * added without a probe fails here as well as at the declaration.
 */
const CASES: Case[] = [
  { key: 'ref:object', schema: { type: 'string', title: TITLE }, ctx: { objectNames: loaded(['account']) }, value: 'account' },
  { key: 'ref:object', variant: 'no-objects', schema: { type: 'string', title: TITLE }, ctx: {}, value: 'x' },
  { key: 'ref:component', schema: { type: 'string', title: TITLE }, ctx: { componentIds: [{ id: 'c1' }] }, value: 'c1' },
  { key: 'ref:component', variant: 'no-components', schema: { type: 'string', title: TITLE }, ctx: {}, value: 'c1' },
  { key: 'ref:dataset', schema: { type: 'string', title: TITLE }, ctx: { datasets: loaded([{ name: 'sales_metrics', label: 'Sales metrics', dimensions: [], measures: [] }]) }, value: 'sales_metrics' },
  // No `ctx` at all: the hosts that feed no catalog get the labelled text input (objectui#11601).
  { key: 'ref:dataset', variant: 'no-catalog', schema: { type: 'string', title: TITLE }, value: 'sales_metrics' },
  { key: 'ref-multi:permission', schema: { type: 'array', title: TITLE, items: { type: 'string' } }, ctx: { permissionSets: loaded([{ name: 'sales_rep' }, { name: 'support_agent' }]) }, value: ['sales_rep'] },
  // No `ctx` at all: the hosts that feed no catalog get the typed-name box inside the same named list (objectui#12126).
  { key: 'ref-multi:permission', variant: 'no-catalog', schema: { type: 'array', title: TITLE, items: { type: 'string' } }, value: ['sales_rep'] },
  { key: 'filter-mode', schema: { type: 'object', title: TITLE }, ctx: { objectFields: loaded([{ name: 'status' }]) }, value: { element: 'dropdown' } },
  { key: 'object-selector', schema: { type: 'string', title: TITLE }, ctx: { objectNames: loaded(['account']) }, value: 'account' },
  { key: 'object-selector', variant: 'multiple', schema: { type: 'array', title: TITLE }, spec: { multiple: true }, ctx: { objectNames: loaded(['account', 'contact']) }, value: ['account'] },
  { key: 'field-selector', schema: { type: 'string', title: TITLE }, spec: { dependsOn: 'objectName' }, formData: { objectName: '' }, value: '' },
  { key: 'field-ref', schema: { type: 'string', title: TITLE }, ctx: { objectFields: loaded([{ name: 'status' }]) }, value: 'status' },
  { key: 'field-multi', schema: { type: 'array', title: TITLE }, ctx: { objectFields: loaded([{ name: 'status' }, { name: 'owner' }]) }, value: ['status'] },
  { key: 'action-multi', schema: { type: 'array', title: TITLE }, ctx: { objectActions: loaded([{ name: 'approve' }, { name: 'reject' }]) }, value: ['approve'] },
  { key: 'filter-builder', schema: { type: 'array', title: TITLE }, ctx: { objectFields: loaded([{ name: 'status' }]) }, value: [] },
  { key: 'view-ref', schema: { type: 'string', title: TITLE }, ctx: { objectViews: loaded([{ name: 'all' }]) }, value: 'all' },
  { key: 'icon', schema: { type: 'string', title: TITLE }, value: 'check' },
  { key: 'color-picker', schema: { type: 'string', title: TITLE, enum: ['default', 'blue'] }, value: 'blue' },
  { key: 'color-input', schema: { type: 'string', title: TITLE }, value: '#112233' },
  { key: 'condition', schema: { type: 'string', title: TITLE }, value: 'a == 1' },
  { key: 'master-detail', schema: { type: 'array', title: TITLE, items: { type: 'object', properties: { name: { type: 'string' } } } }, value: [{ name: 'a' }] },
  { key: 'master-detail', variant: 'untyped-items', schema: { type: 'array', title: TITLE, items: {} }, value: [] },
  { key: 'string-tags', schema: { type: 'array', title: TITLE, items: { type: 'string' } }, value: ['a'] },
  { key: 'multiselect', schema: { type: 'array', title: TITLE, items: { type: 'string', enum: ['grid', 'kanban'] } }, value: ['grid'] },
  { key: 'multiselect', variant: 'no-options', schema: { type: 'array', title: TITLE, items: { type: 'string' } }, value: ['a'] },
  { key: 'code', schema: { type: 'string', title: TITLE }, spec: { language: 'javascript' }, value: 'x = 1' },
  { key: 'secret', schema: { type: 'string', title: TITLE }, value: 's3cr3t' },
  { key: 'dynamic-config', schema: { type: 'object', title: TITLE }, spec: { dependsOn: 'driver' }, formData: { driver: 'pg' }, ctx: { dynamicSchemas: { pg: { properties: { host: { type: 'string' } } } } }, value: {} },
  { key: 'dynamic-config', variant: 'unconfigured', schema: { type: 'object', title: TITLE }, spec: { dependsOn: 'driver' }, formData: { driver: '' }, value: {} },
];

describe('registered ⇒ declared (objectui#4871 / #4857 registry gate)', () => {
  // The compile-time half is `WIDGET_LABELLING`'s `Record<RegisteredWidgetKey, …>`
  // type: registering a widget without a labelling decision does not compile.
  // These runtime assertions guard the SHAPE that makes it work — re-annotating
  // `WIDGETS` as `Record<string, WidgetRenderer>` would silently dissolve the
  // literal key union and with it the compile error, while leaving both objects
  // looking correct.
  it('declares exactly the registered keys, no more and no fewer', () => {
    expect(Object.keys(WIDGET_LABELLING).sort()).toEqual(Object.keys(WIDGETS).sort());
  });

  it('declares only the repo-wide vocabulary', () => {
    for (const [key, value] of Object.entries(WIDGET_LABELLING)) {
      expect(['control', 'group'], `${key} declares an unknown labelling`).toContain(value);
    }
  });

  it('resolves an UNREGISTERED widget name to the control path', () => {
    // Passthrough hints (`text`, `json`) and third-party names keep exactly the
    // pre-declaration behaviour: a plain `<label for>`.
    expect(widgetLabelling('json')).toBe('control');
    expect(widgetLabelling('not-a-widget')).toBe('control');
    expect(widgetLabelling(undefined)).toBe('control');
  });

  it('probes every registered key', () => {
    expect([...new Set(CASES.map((c) => c.key))].sort()).toEqual(Object.keys(WIDGETS).sort());
  });
});

describe('the ledger, re-measured: every widget gets the channel it declares', () => {
  for (const c of CASES) {
    const tag = `${c.key}${c.variant ? ` (${c.variant})` : ''}`;
    const declared = WIDGET_LABELLING[c.key];

    for (const readOnly of [false, true]) {
      const state = readOnly ? 'read-only' : 'editable';

      it(`${tag} — ${declared}, ${state}`, () => {
        renderCase(c, readOnly);
        const label = screen.getByText(TITLE);
        expect(label.tagName).toBe('LABEL');

        if (declared === 'control') {
          // Column 1: the `for` resolves, AND to a LABELABLE element. Splitting
          // those apart is the point — "the id is on SOME element" is the
          // deceptive green that a half-fix (id parked on a container) produces.
          expect(label).toHaveAttribute('for', HOST_ID);
          expect(label).not.toHaveAttribute('id');
          const target = document.getElementById(HOST_ID);
          expect(target, `${tag}: host id is on no element in the ${state} state`).not.toBeNull();
          expect(
            LABELABLE.has(target!.tagName),
            `${tag}: host id landed on <${target!.tagName.toLowerCase()}>, which no <label for> can address`,
          ).toBe(true);
          // Column 3: the named surface IS that control, and it is named by the
          // visible label rather than by some self-owned string.
          expect(target).toHaveAccessibleName(TITLE);
          return;
        }

        // `'group'`. Column 1: no `for` at all — not a `for` pointing somewhere
        // harmless. On a container it activates nothing and names nothing, and
        // beside the working IDREF it is a second, broken channel (#3978/#4010).
        expect(label).not.toHaveAttribute('for');
        expect(label).toHaveAttribute('id', LABEL_ID);
        expect(document.getElementById(HOST_ID)).toBeNull();

        // Columns 2 + 3: the face EXISTS, answers the IDREF, and is a group.
        // Asserted positively on purpose — a widget that rendered nothing would
        // satisfy every "is absent" assertion above.
        const named = document.querySelector(`[aria-labelledby="${LABEL_ID}"]`);
        expect(named, `${tag}: nothing answers the host label's IDREF in the ${state} state`).not.toBeNull();
        expect(['group', 'radiogroup']).toContain(named!.getAttribute('role'));
        expect(named).toHaveAccessibleName(TITLE);
      });
    }
  }
});

describe('the two colour registrations (ruling point 4 — the host picks, not the widget)', () => {
  it('routes a declared palette to the radiogroup registration', () => {
    expect(resolveColorWidgetKey({ type: 'string', enum: ['default', 'blue'] }, undefined)).toBe('color-picker');
    // `fieldSpec.options` takes precedence over `schema.enum`, as the widget's
    // own palette lookup always did.
    expect(
      resolveColorWidgetKey({ type: 'string' }, { field: 'c', options: [{ label: 'Blue', value: 'blue' }] }),
    ).toBe('color-picker');
  });

  it('routes a free colour to the input registration — including the near-misses', () => {
    expect(resolveColorWidgetKey({ type: 'string' }, undefined)).toBe('color-input');
    // An `enum` present but empty, and an `enum` of non-strings, both left the
    // OLD single widget on its free-colour branch. Host and widget read the same
    // palette function, so they cannot disagree about which surface renders.
    expect(resolveColorWidgetKey({ type: 'string', enum: [] }, undefined)).toBe('color-input');
    expect(resolveColorWidgetKey({ type: 'string', enum: [1, 2] }, undefined)).toBe('color-input');
    expect(colorPaletteOptions({ type: 'string', enum: [1, 2] }, undefined)).toEqual([]);
  });

  it('re-routes an AUTHORED `widget: color-picker` on a free-colour field', () => {
    // A spec that pins the palette registration on a field with no palette must
    // still land on the surface that actually renders — otherwise the
    // declaration would describe a different DOM than the one on screen, which
    // is the whole failure this split removes.
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { [NAME]: { type: 'string', title: TITLE } } } as never}
        form={{ type: 'simple', sections: [{ label: 'S', fields: [{ field: NAME, widget: 'color-picker' }] }] } as never}
        value={{ [NAME]: '#112233' }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();
    const native = document.querySelector('input[type="color"]');
    expect(native).toHaveAttribute('id', HOST_ID);
    expect(screen.getByText(TITLE)).toHaveAttribute('for', HOST_ID);
  });

  it('keeps the swatch group self-named when rendered with no host label', () => {
    // The `ariaLabel` arm of `ColorVariantPickerNaming` (objectui#4010). Reached
    // by any caller that renders a registry widget directly — the shape
    // `IconPickerWidget.test.tsx` / `SecretWidget.test.tsx` already use — where
    // there is no visible label in a position to publish an id.
    const Swatches = WIDGETS['color-picker'];
    render(
      <Swatches
        schema={{ type: 'string', title: 'Badge Tone', enum: ['default', 'blue'] }}
        value="blue"
        onChange={() => {}}
      />,
    );
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveAccessibleName('Badge Tone');
    expect(group).not.toHaveAttribute('aria-labelledby');
  });
});

describe('the two channels name a field identically', () => {
  // The accessible name comes from the SAME visible label either way — via `for`
  // on the control path, via `aria-labelledby` on the group path. Pinned on a
  // field whose machine name IS offered (`prettify('colorVariant')` is "Color
  // Variant", so a title of "Tone" makes `FieldRow` give the label a
  // machine-name tooltip). Until objectui#13352 that was an inline `<code>`
  // inside the label, so both computations had to read the label's whole
  // subtree; since #13352 the row shows the label only and the name rides on
  // the label's `title`, which neither computation may fold into the name
  // (a label with text content is named by that content, never its title).
  // The two names are compared to EACH OTHER rather than to a hand-spelled
  // string — the claim is parity, and a literal would only pin whichever
  // channel the author looked at first.
  const field = 'colorVariant';
  const renderWith = (schema: Record<string, unknown>) =>
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { [field]: schema } } as never}
        form={{ type: 'simple', sections: [{ label: 'S', fields: [{ field }] }] } as never}
        value={{ [field]: schema.enum ? 'blue' : '#112233' }}
        onChange={() => {}}
      />,
    );

  it('both channels resolve to the same visible label element', () => {
    // Group path — the enum branch. The IDREF names the label.
    const { container: groupTree } = renderWith({ type: 'string', title: 'Tone', enum: ['default', 'blue'] });
    const group = screen.getByRole('radiogroup');
    const groupLabel = document.getElementById(group.getAttribute('aria-labelledby')!)!;
    expect(groupLabel).toBe(within(groupTree).getByText('Tone').closest('label'));
    cleanup();

    // Control path — the same field with no palette. The `for` names the label.
    const { container: controlTree } = renderWith({ type: 'string', title: 'Tone' });
    const native = document.querySelector('input[type="color"]') as HTMLInputElement;
    const controlLabel = document.querySelector(`label[for="${native.id}"]`)!;
    expect(controlLabel).toBe(within(controlTree).getByText('Tone').closest('label'));

    // Same rendered text on both paths — so the channel a field takes cannot
    // change what it is called. The label shows the label only, and offers the
    // machine name on demand, alike on both paths (objectui#13352).
    expect(groupLabel.textContent).toBe(controlLabel.textContent);
    expect(groupLabel.textContent).toBe('Tone');
    expect(groupLabel.getAttribute('title')).toBe(controlLabel.getAttribute('title'));
    expect(groupLabel.getAttribute('title')).toContain(field);
  });

  it('and the accessibility tree agrees — each surface is findable BY that name', () => {
    // The check above says the two channels point at ONE label; this says the
    // computed accessible name follows, which is what a user actually gets.
    renderWith({ type: 'string', title: 'Tone', enum: ['default', 'blue'] });
    expect(screen.getByRole('radiogroup', { name: 'Tone' })).toBeInTheDocument();
    cleanup();

    renderWith({ type: 'string', title: 'Tone' });
    expect(document.querySelector('input[type="color"]')).toHaveAccessibleName(
      // The visible label verbatim — the machine-name tooltip on the label
      // is not part of it (objectui#13352).
      'Tone',
    );
  });
});
