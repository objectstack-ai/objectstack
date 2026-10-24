// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4010, the third call site — the generic colour widget — CLOSED OUT by
 * objectui#4871.
 *
 * The shape this file used to pin: ONE registry entry, `color-picker`, rendering
 * two different surfaces chosen at runtime from `schema`/`fieldSpec` —
 *
 *  - an enum palette → `div[role="radiogroup"]`, a container no `<label for>`
 *    can name;
 *  - a free colour → `<input type="color">`, a labelable element —
 *
 * while `FieldRow` had already written `<Label htmlFor={id}>` above it. The
 * host could not publish an IDREF for the group to answer, because it did not
 * yet know which surface it was labelling. #4010 fixed the half it could reach
 * (the group carried its OWN name) and pinned the other half as a KNOWN
 * RESIDUAL: `for="mdf-colorVariant"` resolving to nothing at all.
 *
 * objectui#4871 removed the runtime choice instead of tolerating it. The two
 * surfaces are two registrations — `color-picker` (palette ⇒ radiogroup,
 * declared `labelling: 'group'`) and `color-input` (free colour ⇒ native
 * picker, declared `'control'`) — and the HOST picks between them from the
 * schema, BEFORE it writes the label. So each surface now gets the one naming
 * channel that works on it, and the three assertions below that used to pin the
 * residual pin its absence.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';

afterEach(cleanup);

const form = { type: 'simple' as const, sections: [{ label: 'Basics', fields: [{ field: 'colorVariant' }] }] };

/**
 * `detectColorWidget` resolves `colorVariant` to the colour widget; which of the
 * two registrations renders is then decided by `resolveRegisteredWidget` from
 * the schema — the split this file's residual was waiting on.
 */
function renderColorField(schema: Record<string, unknown>, value: unknown = 'blue') {
  return render(
    <SchemaForm
      schema={{ type: 'object', properties: { colorVariant: schema } } as never}
      form={form}
      value={{ colorVariant: value }}
      onChange={() => {}}
    />,
  );
}

describe('color-picker (palette ⇒ radiogroup) — named by the host, by IDREF', () => {
  it('announces the field label rather than nothing', () => {
    renderColorField({ type: 'string', title: 'Color Variant', enum: ['default', 'blue', 'teal'] });

    const group = screen.getByRole('radiogroup');
    // Pre-#4010: `''`. The swatches inside were named ("Blue"); the group was not.
    expect(group).toHaveAccessibleName('Color Variant');
    // Equal to the visible label — a generic stand-in ("Color") over a field
    // labelled "Color Variant" would fail WCAG 2.5.3 (Label in Name).
    expect(screen.getByText('Color Variant')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Color Variant' })).toBeInTheDocument();
  });

  it('is named by the host label’s IDREF, and the dangling `for` is GONE', () => {
    // The residual objectui#4010 pinned and objectui#4871 removed. Three facts,
    // and the third is the one that used to fail:
    renderColorField({ type: 'string', title: 'Color Variant', enum: ['default', 'blue'] });

    const group = screen.getByRole('radiogroup');
    const label = screen.getByText('Color Variant');

    // 1. The label publishes an id and emits NO `for`. Not merely redundant on a
    //    container — a `for` there activates nothing and names nothing, and
    //    beside a working `aria-labelledby` it is one label with two channels,
    //    one of them broken (objectui#3978).
    expect(label).not.toHaveAttribute('for');
    expect(label).toHaveAttribute('id', 'mdf-colorVariant-label');

    // 2. The group answers that id. This is the association channel that works
    //    on a non-labelable element.
    expect(group).toHaveAttribute('aria-labelledby', 'mdf-colorVariant-label');

    // 3. The host id is on NO element — and that is now correct rather than
    //    broken, because nothing points at it any more. The refused half-fix
    //    was to put it on the group instead: the IDREF would have resolved
    //    while the group stayed unnamed.
    expect(group).not.toHaveAttribute('id');
    expect(document.getElementById('mdf-colorVariant')).toBeNull();
  });

  it('keeps its self-owned name only when rendered without a host label', () => {
    // Through `SchemaForm` there is ALWAYS a visible label to reference, so the
    // host-IDREF arm is what this path takes — the widget's `ariaLabel` fallback
    // is for a caller that renders it standalone (pinned in
    // SchemaForm.widgetLabelling.test.tsx). With no `title`, `FieldRow`
    // prettifies the field name, and that prettified text is what names the
    // group: one fact, one author.
    renderColorField({ type: 'string', enum: ['default', 'blue'] });
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Color Variant');
  });
});

describe('color-input (free colour ⇒ native picker) — a labelable control', () => {
  it('takes the host id on the native picker, so the plain `for` resolves', () => {
    // `prettify('colorVariant') === 'Color Variant'`, so `FieldRow` shows no
    // machine-name `<code>` and the label's whole text is the field title.
    renderColorField({ type: 'string', title: 'Color Variant' }, '#112233');

    expect(screen.queryByRole('radiogroup')).toBeNull();
    const native = document.querySelector('input[type="color"]');
    expect(native).not.toBeNull();

    // `<label for>` → a real labelable element, the plain channel.
    const label = screen.getByText('Color Variant');
    expect(label).toHaveAttribute('for', 'mdf-colorVariant');
    expect(native).toHaveAttribute('id', 'mdf-colorVariant');
    expect(native).toHaveAccessibleName('Color Variant');

    // The old self-owned `aria-label="Color"` is GONE on this path: an
    // `aria-label` wins the accessible-name computation, so keeping it would
    // have overridden the visible field label with a generic constant.
    expect(native).not.toHaveAttribute('aria-label');
  });

  it('names the hex mirror beside it', () => {
    // Two inputs edit one value. The picker is named by the field's label; the
    // hex box had NO accessible name at all before objectui#4871.
    renderColorField({ type: 'string', title: 'Color Variant' }, '#112233');
    expect(screen.getByRole('textbox', { name: 'Hex value' })).toBeInTheDocument();
  });
});
