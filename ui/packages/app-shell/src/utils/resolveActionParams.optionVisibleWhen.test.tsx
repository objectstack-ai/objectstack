/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3559, end to end: a field's per-option `visibleWhen` narrows the
 * option list a dialog param actually renders.
 *
 * The unit half lives in `resolveActionParams.test.ts` (the resolved param keeps
 * the keys, and `resolveVisibleOptions()` filters on them). What that cannot show
 * is the CONSUMER half — whether the control the dialog builds evaluates the
 * predicate at all, or merely receives it. So this file drives the real widget
 * with the real field object, wired the way `ActionParamDialog` wires it:
 *
 *   field metadata → `resolveActionParams()` → `paramToField()` → `<SelectField>`
 *
 * `ActionParamDialog` renders `field={paramToField(param)}` and `id={param.name}`
 * through `getLazyFieldWidget(field.type)`; `SelectField` is what that resolves
 * to for a `select` param. It is imported here at MODULE scope rather than through
 * the lazy registry on purpose (AGENTS.md §测试纪律): a first dynamic `import()`
 * under a saturated transform pipeline can eat most of RTL's 1s budget, and the
 * assertions below are synchronous effects.
 *
 * Most cases below pass no `dependentValues`, which is now the NON-dialog wiring:
 * since objectui#3765 the dialog supplies its own in-progress values on that prop,
 * so a widget reached without one is a widget outside a dialog (the object form
 * before it threads the record, hand-written SDUI, the inline editor). Those cases
 * therefore exercise the predicates that need no record at all — scope-relative
 * (`current_user`), the role-gating case ADR-0058 opens — plus, in the last two
 * tests, what a record-relative predicate does on each side of that prop:
 * supplied (the dialog's values narrow the list) and absent (nothing narrows,
 * and no ambient context can stand in — see the note on `records` below, and
 * objectui#7206).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PredicateScopeProvider, SchemaRendererContext } from '@object-ui/react';
import { SelectField } from '@object-ui/fields';
import type { ActionParamOption } from '@object-ui/core';
import { resolveActionParams, type ResolveActionParamsContext } from '@object-ui/fields';
import { paramToField } from './paramToField';

/**
 * An object whose `tier` field gates one option on the viewer's positions.
 *
 * `options` carries the element type the runtime field declares
 * (`ActionParamOption | string`) rather than `Record< string, unknown > |
 * string`: the latter is wider than the field it is fed to — it admits an
 * option with no `label` / `value` at all — and only went unnoticed while this
 * file was not type-checked (objectui#4040). Every fixture below already
 * carries both keys; `visibleWhen` and friends ride along on the catch-all.
 */
const accountCtx = (
  options: Array<ActionParamOption | string>,
): ResolveActionParamsContext => ({
  objectName: 'account',
  objects: [{ name: 'account', fields: { tier: { type: 'select', label: 'Tier', options } } }],
  fieldLabel: (_o, _f, fallback) => fallback,
});

const ROLE_GATED = [
  { label: 'Standard', value: 'standard' },
  { label: 'Admin only', value: 'admin_only', visibleWhen: "'admin' in current_user.positions" },
];

/**
 * Render the `tier` param exactly as `ActionParamDialog` renders a select param:
 * resolve it from the field, adapt it with `paramToField()`, hand the result to
 * the widget as `field` with `id={param.name}`.
 */
function renderInheritedSelect(
  options: Array<ActionParamOption | string>,
  positions: string[],
  value?: string,
  /**
   * `dependentValues` is the ONE record channel `useCascadingOptions` reads —
   * what a HOST supplies (the dialog supplies its in-progress param values on
   * it, objectui#3765).
   *
   * `ctxFormValues` is not a second channel: it casts `formValues` onto the
   * `SchemaRendererContext` value, which is what the hook's retired
   * `?? ctx.formValues ?? ctx.data` tail used to read. That tail was never
   * reachable in production — `SchemaRendererContextType` declares exactly
   * `dataSource` / `debug` / `debugFlags` / `apiFetch` — and it was retired
   * under ADR-0049 enforce-or-remove (objectui#7206). The option is kept here
   * so the retirement stays OBSERVABLE: the last test renders that cast and
   * pins that it changes nothing. Both default to absent, which is the "no
   * record at all" case — and the PRODUCTION case whenever no host passes
   * `dependentValues`.
   */
  records?: { dependentValues?: Record<string, unknown>; ctxFormValues?: Record<string, unknown> },
) {
  const onChange = vi.fn();
  const param = resolveActionParams([{ field: 'tier' }], accountCtx(options))[0];
  const field = paramToField(param);
  // Same props the dialog passes a non-boolean param's widget. The cast is the
  // dialog's own seam: `paramToField()` returns `Record< string, unknown >`-shaped
  // field metadata and the widget is reached through a lazy `any` component there.
  const props = {
    id: param.name,
    value: value ?? null,
    onChange,
    field,
    ...(records?.dependentValues ? { dependentValues: records.dependentValues } : {}),
  } as unknown as React.ComponentProps<typeof SelectField>;
  const tree = (
    <PredicateScopeProvider scope={{ current_user: { positions } }}>
      <SelectField {...props} />
    </PredicateScopeProvider>
  );
  render(
    records?.ctxFormValues
      // The context type declares `dataSource` only; `formValues` is the key
      // `useCascadingOptions` / `LookupField` USED to read off it through an
      // `any` cast, so a host that tried to supply one is expressed the same
      // way here — which is what makes the retirement measurable below.
      ? <SchemaRendererContext.Provider value={{ dataSource: null, formValues: records.ctxFormValues } as never}>
          {tree}
        </SchemaRendererContext.Provider>
      : tree,
  );
  return { onChange, field };
}

describe('field-inherited option predicates reach the dialog control (objectui#3559)', () => {
  it('drops a role-gated option for a viewer who fails the predicate', () => {
    // Every option gated → the offered set is empty, and the widget says so
    // instead of rendering a dropdown of options the predicate excluded.
    renderInheritedSelect(
      [{ label: 'Admin only', value: 'admin_only', visibleWhen: "'admin' in current_user.positions" }],
      ['sales'],
    );
    expect(screen.getByTestId('select-empty-tier')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('offers the same list to a viewer who satisfies it', () => {
    renderInheritedSelect(
      [{ label: 'Admin only', value: 'admin_only', visibleWhen: "'admin' in current_user.positions" }],
      ['admin'],
    );
    expect(screen.queryByTestId('select-empty-tier')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('clears a pre-filled value the predicate hides (per-option, not whole-list)', () => {
    // The per-option proof: `standard` survives (so the list is not gated as a
    // whole — a combobox is still offered) while `admin_only` is not offered, so
    // the widget's cascade-clear drops the seeded value.
    const { onChange } = renderInheritedSelect(ROLE_GATED, ['sales'], 'admin_only');
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps that value for a viewer the predicate admits', () => {
    const { onChange } = renderInheritedSelect(ROLE_GATED, ['admin'], 'admin_only');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('leaves an unpredicated inherited list fully offered', () => {
    const { onChange, field } = renderInheritedSelect(
      [{ label: 'Standard', value: 'standard' }, 'won'],
      [],
      'standard',
    );
    expect(field.options).toEqual([
      { label: 'Standard', value: 'standard' },
      { label: 'won', value: 'won' },
    ]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  /**
   * The record half, which objectui#3765 settled. The predicate is the same
   * `record.country == 'cn'` in all three cases; only WHERE the record comes
   * from changes.
   *
   * This file's last case used to be a MEASUREMENT rather than an assertion —
   * "no record reaches a dialog option, so this fails open" — recorded that way
   * on purpose, because which record a dialog evaluates against was undecided
   * and the number could legitimately move. The maintainer ruled it on
   * 2026-08-11 (Option B: the dialog's own in-progress values ARE the record),
   * so the measurement becomes the three assertions below.
   */
  const PROVINCE = [{ label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" }];

  it('narrows a record-relative list against the record its HOST supplies', () => {
    // The channel the dialog now feeds. A satisfied predicate keeps the option…
    renderInheritedSelect(PROVINCE, ['admin'], undefined, { dependentValues: { country: 'cn' } });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByTestId('select-empty-tier')).not.toBeInTheDocument();
  });

  it('drops it when the supplied record fails the predicate', () => {
    // …and a failed one drops it — the whole (single-option) list here, so the
    // widget renders its empty state instead of a dropdown. This is the pair
    // that makes the dialog's own values load-bearing: `{ country: 'us' }` is a
    // value the user could have just picked in a sibling param.
    renderInheritedSelect(PROVINCE, ['admin'], undefined, { dependentValues: { country: 'us' } });
    expect(screen.getByTestId('select-empty-tier')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('ignores a record cast onto the context — the retired tail, with its channel as the control', () => {
    // objectui#7206, the retirement made observable. `useCascadingOptions` now
    // resolves `dependentValues ?? {}`; it used to end
    // `?? ctx.formValues ?? ctx.data ?? {}`, links no host could ever set
    // because `SchemaRendererContextType` declares exactly `dataSource` /
    // `debug` / `debugFlags` / `apiFetch`. This case used to pin that the
    // second link was "still consulted"; it now pins that it is gone.
    //
    // SUBJECT — a context carrying the exact member that tail named reaches
    // nothing: `record` is `{}`, `record.country` is UNRESOLVABLE rather than
    // false, and `resolveVisibleOptions()` fails OPEN by documented default, so
    // the option is offered. Before the retirement this identical call rendered
    // the empty state.
    renderInheritedSelect(PROVINCE, ['admin'], undefined, { ctxFormValues: { country: 'us' } });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByTestId('select-empty-tier')).not.toBeInTheDocument();

    // CONTROL, in the same case — the SAME predicate and the SAME record, moved
    // to the channel that survives, must still hide the option. Without it the
    // zero above is equally satisfied by a harness that narrows nothing.
    cleanup();
    renderInheritedSelect(PROVINCE, ['admin'], undefined, { dependentValues: { country: 'us' } });
    expect(screen.getByTestId('select-empty-tier')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('fails OPEN when no record exists at all', () => {
    // No prop, no context → `record` is `{}`, the predicate is unresolvable and
    // the option is offered rather than wrongly hidden. That is what a widget
    // outside a dialog now looks like, and it is the direction that makes this
    // whole surface safe to get wrong.
    renderInheritedSelect(PROVINCE, ['admin']);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });
});
