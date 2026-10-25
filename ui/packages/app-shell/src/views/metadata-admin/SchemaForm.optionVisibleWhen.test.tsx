// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';
import type { FormFieldSpec, FormViewSpec } from './form-spec';
import { WIDGETS, resolveColorWidgetKey } from './widgets';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { buildPredicateCtx, IDENTITY_ROOTS, resetPredicateWarnings } from './predicate';

afterEach(() => {
  cleanup();
  resetPredicateWarnings();
});

/**
 * objectui#6247 — a per-option `visibleWhen` written into a `*.form.ts` is
 * honoured by the metadata-admin renderer.
 *
 * `SelectOptionSchema` declares `visibleWhen` (ADR-0068 / objectui#2284) and is
 * `z.core.$strict`, so the key is a real declaration and a metadata form
 * carrying it parses clean. Until this fix the three controls that consume
 * `fieldSpec.options` mapped the list straight to items and never read the key:
 * accepted, stored, shipped, inert — ADR-0049's declared≠enforced.
 *
 * ## ⚠️ Why every pin here asserts an option ABSENT
 *
 * This evaluator fails OPEN by design (objectstack#6936): a parse error, an
 * unresolvable root, a predicate that never ran at all — every one of them
 * yields `true`. So "the option is shown" is the outcome of predicate-TRUE,
 * predicate-never-arrived AND predicate-faulted, and a pin that only checks the
 * true case distinguishes none of them; it passes just as happily against the
 * unfixed renderer. The load-bearing assertion is therefore always that an
 * option gated by a FALSE predicate is **not in the document**, with the
 * shown-when-true case kept only as the control.
 *
 * Maintainer ruling, affirmed three times (2026-08-25 batch 4 / 2026-08-25
 * upholding A2 over the A1 counter-proposal / 2026-08-27 declining A0):
 * **A2 + B1 + C1**, which is what the three sections below pin.
 */

/* ── shared fixtures ─────────────────────────────────────────────────────── */

const ADMIN = { id: 'u1', name: 'Ada', positions: ['admin'], role: 'admin' };
const VIEWER = { id: 'u2', name: 'Bob', positions: ['viewer'], role: 'viewer' };

const selectSchema = {
  type: 'object',
  properties: {
    tier: { type: 'string', title: 'Tier' },
    plan: { type: 'string', title: 'Plan' },
  },
};

/**
 * A form spec whose `plan` options carry per-option predicates.
 *
 * Typed as the real {@link FormViewSpec}, not a loose literal: this fixture is
 * the only place in the suite that exercises the widened
 * `FormFieldSpec.options`, so letting it be `Record<string, unknown>[]` would
 * have made the suite pass while proving nothing about the AUTHORING type the
 * card widened. `tsconfig.test.json` compiles this file, so the annotation is
 * itself a check.
 */
const planForm = (options: NonNullable<FormFieldSpec['options']>): FormViewSpec => ({
  sections: [
    {
      label: 'Billing',
      fields: [{ field: 'tier', label: 'Tier' }, { field: 'plan', label: 'Plan', options }],
    },
  ],
});

/** Open a Radix Select trigger the way the other suites in this repo do. */
async function openSelect(name: string) {
  const trigger = screen.getByRole('combobox', { name });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
}

/* ── control 1: the builtin Select (SchemaForm.tsx) ──────────────────────── */

describe('consuming control 1 — builtin Select honours per-option visibleWhen', () => {
  it('⭐ withdraws the option whose predicate is FALSE against the draft', async () => {
    render(
      <SchemaForm
        schema={selectSchema}
        form={planForm([
          { label: 'Free', value: 'free' },
          { label: 'Enterprise', value: 'ent', visibleWhen: "data.tier == 'business'" },
        ])}
        value={{ tier: 'personal' }}
        onChange={() => {}}
      />,
    );
    await openSelect('Plan');
    // The control: an option with no predicate is always offered.
    expect(screen.getByRole('option', { name: 'Free' })).toBeInTheDocument();
    // ⭐ The load-bearing assertion — fail-open makes the positive case blind.
    expect(screen.queryByRole('option', { name: 'Enterprise' })).toBeNull();
  });

  it('offers the same option once the draft satisfies the predicate', async () => {
    render(
      <SchemaForm
        schema={selectSchema}
        form={planForm([
          { label: 'Free', value: 'free' },
          { label: 'Enterprise', value: 'ent', visibleWhen: "data.tier == 'business'" },
        ])}
        value={{ tier: 'business' }}
        onChange={() => {}}
      />,
    );
    await openSelect('Plan');
    expect(screen.getByRole('option', { name: 'Enterprise' })).toBeInTheDocument();
  });

  it('⭐ FORK A / A2 — an identity gate discriminates under an ExpressionProvider', async () => {
    const view = (user: Record<string, unknown>) => (
      <ExpressionProvider user={user}>
        <SchemaForm
          schema={selectSchema}
          form={planForm([
            { label: 'Free', value: 'free' },
            { label: 'Danger Zone', value: 'danger', visibleWhen: "current_user.role == 'admin'" },
          ])}
          value={{ tier: 'personal' }}
          onChange={() => {}}
        />
      </ExpressionProvider>
    );

    // ⭐ The security case the ruling exists for: an admin-only option must NOT
    // render for a viewer. Before `current_user` was bound this root was
    // unresolvable, and an unresolvable root fails OPEN — so this option
    // rendered for everybody.
    const { unmount } = render(view(VIEWER));
    await openSelect('Plan');
    expect(screen.queryByRole('option', { name: 'Danger Zone' })).toBeNull();
    unmount();
    cleanup();

    render(view(ADMIN));
    await openSelect('Plan');
    expect(screen.getByRole('option', { name: 'Danger Zone' })).toBeInTheDocument();
  });

  it('⭐ FORK B / B1 — withdrawing EVERY option renders an empty picker, not a text box', async () => {
    render(
      <SchemaForm
        schema={selectSchema}
        form={planForm([
          { label: 'Free', value: 'free', visibleWhen: "data.tier == 'business'" },
          { label: 'Enterprise', value: 'ent', visibleWhen: "data.tier == 'business'" },
        ])}
        value={{ tier: 'personal' }}
        onChange={() => {}}
      />,
    );
    // The FACE is decided on the RAW list, so the control is still a combobox.
    // Were the branch condition to read the filtered list, this field would fall
    // through to `string → Input` and render a FREE-TEXT box — "withdraw every
    // option" displayed as "type whatever you like".
    expect(screen.getByRole('combobox', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Plan' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Plan' }), { key: 'ArrowDown' });
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Free' })).toBeNull());
    expect(screen.queryByRole('option', { name: 'Enterprise' })).toBeNull();
  });
});

/* ── control 2: MultiSelectWidget (widgets.tsx) ──────────────────────────── */

describe('consuming control 2 — MultiSelectWidget honours per-option visibleWhen', () => {
  const MultiSelect = WIDGETS['multiselect'];
  const opts = [
    { label: 'Grid', value: 'grid' },
    { label: 'Kanban', value: 'kanban', visibleWhen: "data.mode == 'advanced'" },
  ];

  it('⭐ withdraws the option whose predicate is FALSE against the draft', () => {
    render(
      <MultiSelect
        value={[]}
        onChange={() => {}}
        schema={{ type: 'array', items: { type: 'string' } }}
        fieldSpec={{ field: 'viz', options: opts }}
        formData={{ mode: 'basic' }}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Grid' })).toBeInTheDocument();
    // ⭐ The load-bearing assertion.
    expect(screen.queryByRole('checkbox', { name: 'Kanban' })).toBeNull();
  });

  it('offers the same option once the draft satisfies the predicate', () => {
    render(
      <MultiSelect
        value={[]}
        onChange={() => {}}
        schema={{ type: 'array', items: { type: 'string' } }}
        fieldSpec={{ field: 'viz', options: opts }}
        formData={{ mode: 'advanced' }}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Kanban' })).toBeInTheDocument();
  });

  it('⭐ FORK B / B1 — withdrawing every option keeps the group, not the tag editor', () => {
    render(
      <MultiSelect
        value={[]}
        onChange={() => {}}
        schema={{ type: 'array', items: { type: 'string' } }}
        fieldSpec={{
          field: 'viz',
          options: [
            { label: 'Grid', value: 'grid', visibleWhen: "data.mode == 'advanced'" },
            { label: 'Kanban', value: 'kanban', visibleWhen: "data.mode == 'advanced'" },
          ],
        }}
        formData={{ mode: 'basic' }}
        ariaLabelledBy="lbl"
      />,
    );
    // Still this widget's own group; the comma-tag free-text editor is the
    // degradation B1 forbids, and it would be a `textbox`.
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('⭐ FORK C / C1 — a selected value whose option is hidden SURVIVES a toggle', () => {
    const onChange = vi.fn();
    render(
      <MultiSelect
        value={['grid', 'kanban']}
        onChange={onChange}
        schema={{ type: 'array', items: { type: 'string' } }}
        fieldSpec={{ field: 'viz', options: opts }}
        formData={{ mode: 'basic' }}
      />,
    );
    // `kanban` is stored but currently withdrawn. Clicking an unrelated option
    // must not silently prune it — this renderer edits SOURCE metadata, and
    // C1 rules that a hidden-but-selected value survives.
    expect(screen.queryByRole('checkbox', { name: 'Kanban' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Grid' }));
    expect(onChange).toHaveBeenCalledWith(['kanban']);
  });
});

/* ── control 3: colorPaletteOptions → ColorSwatchGroupWidget (widgets.tsx) ── */

describe('consuming control 3 — colour swatches honour per-option visibleWhen', () => {
  const ColorPicker = WIDGETS['color-picker'];
  const palette = [
    { label: 'Red', value: 'red' },
    { label: 'Gold', value: 'gold', visibleWhen: "data.theme == 'premium'" },
  ];

  it('⭐ withdraws the swatch whose predicate is FALSE against the draft', () => {
    render(
      <ColorPicker
        value={undefined}
        onChange={() => {}}
        schema={{ type: 'string' }}
        fieldSpec={{ field: 'color', options: palette }}
        formData={{ theme: 'basic' }}
        ariaLabelledBy="lbl"
      />,
    );
    const names = screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.textContent);
    expect(names).toContain('Red');
    // ⭐ The load-bearing assertion.
    expect(names).not.toContain('Gold');
  });

  it('offers the same swatch once the draft satisfies the predicate', () => {
    render(
      <ColorPicker
        value={undefined}
        onChange={() => {}}
        schema={{ type: 'string' }}
        fieldSpec={{ field: 'color', options: palette }}
        formData={{ theme: 'premium' }}
        ariaLabelledBy="lbl"
      />,
    );
    const names = screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.textContent);
    expect(names).toContain('Gold');
  });

  it('⭐ FORK B / B1 — the widget REGISTRATION never moves with the predicate', () => {
    const allHidden = [
      { label: 'Red', value: 'red', visibleWhen: "data.theme == 'premium'" },
      { label: 'Gold', value: 'gold', visibleWhen: "data.theme == 'premium'" },
    ];
    // `resolveColorWidgetKey` is the HOST's choice of registration, made from
    // the schema BEFORE the label is written (objectui#4871 point 4). It reads
    // the RAW palette, so withdrawing every swatch must NOT flip the field to
    // `color-input` — that would move the field's accessible name onto a
    // different element mid-render.
    expect(resolveColorWidgetKey({ type: 'string' }, { field: 'color', options: allHidden })).toBe(
      'color-picker',
    );
    render(
      <ColorPicker
        value={undefined}
        onChange={() => {}}
        schema={{ type: 'string' }}
        fieldSpec={{ field: 'color', options: allHidden }}
        formData={{ theme: 'basic' }}
        ariaLabelledBy="lbl"
      />,
    );
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});

/* ── the scope itself (FORK A / A2) ──────────────────────────────────────── */

describe('buildPredicateCtx — what this surface binds, and what it refuses to', () => {
  it('binds the four ADR-0068 identity spellings to the SAME object', () => {
    const host = { current_user: ADMIN, user: ADMIN, ctx: { user: ADMIN }, os: { user: ADMIN }, data: { NOT: 'the draft' } };
    const ctx = buildPredicateCtx({ tier: 'business' }, host);
    for (const root of IDENTITY_ROOTS) expect(ctx).toHaveProperty(root);
    expect(ctx.current_user).toBe(ADMIN);
    expect(ctx.user).toBe(ADMIN);
    expect((ctx.ctx as { user: unknown }).user).toBe(ADMIN);
    expect((ctx.os as { user: unknown }).user).toBe(ADMIN);
  });

  it('⛔ `data` is the DRAFT — never the host provider\'s own `data` scope', () => {
    // objectui#5926 gap 2 is "same key, opposite meanings" one nesting level
    // apart. The A2 ruling binds the identity roots ALONGSIDE `data` and keeps
    // `data` = the draft, explicitly excluding the provider's conflicting key.
    const ctx = buildPredicateCtx({ tier: 'business' }, { data: { tier: 'WRONG' }, current_user: ADMIN });
    expect(ctx.data).toEqual({ tier: 'business' });
  });

  it('⛔ leaves un-published roots ABSENT so they stay loudly diagnosed', () => {
    // Binding `record` / `app` / `features` to `{}` would convert an
    // unresolved-root WARNING into a silent `undefined`-compares-false. The
    // sibling runtime surface binds `record` because it edits a record; this
    // one edits source metadata and has none.
    const ctx = buildPredicateCtx({ tier: 'business' }, { current_user: ADMIN });
    expect(Object.prototype.hasOwnProperty.call(ctx, 'record')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(ctx, 'app')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(ctx, 'features')).toBe(false);
  });

  it('with no provider mounted, only `data` is bound', () => {
    const ctx = buildPredicateCtx({ tier: 'business' }, {});
    expect(Object.keys(ctx)).toEqual(['data']);
  });
});
