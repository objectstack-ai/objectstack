/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ComboboxSchema } from '@object-ui/types';
import { Combobox } from '../../custom';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';

/**
 * The `combobox` NODE renderer (objectui#8140).
 *
 * ## What this node is, measured — and what that decides
 *
 * `combobox` is a STANDALONE node type only. It is registered in the `ui`
 * namespace, it is not in `renderFieldComponent`'s `BUILTIN_FIELD_TYPES`
 * (`input` / `textarea` / `checkbox` / `switch` / `select`), and no
 * `field:combobox` widget exists anywhere in the tree — so a form FIELD
 * authored `type: 'combobox'` (or `field:combobox`, or `ui:combobox`) never
 * reaches this file at all: it falls to that switch's `default:` arm and
 * renders a plain text `<input>`. Measured on this branch's base, all three
 * spellings.
 *
 * That is why `ComboboxSchema.defaultValue` is an ADR-0049 RETIREMENT TOMBSTONE
 * rather than a key this renderer forwards. The reasoning is written out at the
 * tombstone (`@object-ui/types` `packages/types/src/form.ts`); the half that
 * belongs HERE is the mechanism it rests on: this renderer passes no
 * `onValueChange`, and `toFormControlDomProps` forwards neither `onChange` nor
 * `onValueChange`, so no host can supply one either. A standalone combobox
 * node's selection is therefore FROZEN at `schema.value` — measured by
 * selecting a different option and reading the trigger back unchanged. On a
 * control the user cannot change, "the value it starts at" and "the value it
 * shows" are the same question, and `defaultValue` could only ever have been a
 * second spelling of `value` (AGENTS.md #0.1 — one contract, not two dialects).
 *
 * ## `name` is delivered ALREADY — do not add a second carrier
 *
 * There is no `schema.name` read site in this file and there must not be one. A
 * grep for that spelling reports the key unread, and it is not: `SchemaRenderer`
 * spreads every non-metadata top-level schema key as a React prop, and `name`
 * is one of the two keys `FORM_CONTROL_DOM_PASS_THROUGH_KEYS` adds to the SDUI
 * baseline precisely so that form controls keep it. It arrives in
 * `comboboxProps`, survives `toFormControlDomProps`, and lands on the focusable
 * `role="combobox"` trigger. Measured: an authored `name: 'country'` renders
 * `<button … name="country">` today, with this file unchanged. Spelling
 * `name={schema.name}` on top would be the two-carriers-for-one-question shape
 * `input.tsx` writes out for `disabled` (objectui#7238). The delivery is pinned
 * in `__tests__/combobox-schema-members-8140.test.tsx` so it cannot regress
 * silently the way an unread key would.
 *
 * ## `description` is rendered here, not by `<Combobox>`
 *
 * Help text sits BELOW the control, so it belongs to the node's own output and
 * not to the button `<Combobox>` renders — no widening of the published
 * `ComboboxProps` is involved. It is wired with `aria-describedby` rather than
 * left as a loose paragraph, the shape objectui#5735 established for
 * `element:text_input`: an unassociated `<p>` is decoration a screen reader
 * moving to the control never announces.
 */
const ComboboxRenderer = ({ schema, disabled: hostDisabled, ...props }: { schema: ComboboxSchema; disabled?: boolean; [key: string]: any }) => {
  // `hostDisabled` is `SchemaRenderer`'s EVALUATED verdict on `disabled` /
  // `disabledOn`, not the raw authored key — which may be a predicate STRING,
  // truthy however it evaluates (objectui#7238, precedent objectui#6169).
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...comboboxProps
    } = props;

    // Minted per instance and NOT derived from `schema.id`, for the reason
    // `element:text_input` states (objectui#5735): the id `aria-describedby`
    // needs sits on the PARAGRAPH, an element this renderer wholly owns, so the
    // association must not inherit the author's obligation to supply an `id` —
    // and two nodes sharing an authored id would publish two paragraphs sharing
    // one, resolving both fields to whichever came first in the document.
    const instanceId = React.useId();
    // Emitted only when a paragraph is actually rendered: an `aria-describedby`
    // that outlives an absent description is a DANGLING reference, which
    // assistive tech reports as broken rather than falling through.
    const descriptionId = schema.description ? `${instanceId}-description` : undefined;

    // COMPOSED, never overwritten. `aria-describedby` is authorable on any node
    // (`AriaPropsSchema`) and `SchemaRenderer` injects it into these props, so
    // assigning ours would silently drop whatever the author pointed at. HTML
    // takes a space-separated id list; both descriptions get announced.
    //
    // Read off `comboboxProps` rather than off the filtered bag: the filter
    // keeps the whole `aria-*` family, so the two carry the same value, and
    // `FormControlDomProps<P>` narrows to `{}` for this renderer's open `P`
    // (`Extract<string, \`aria-${string}\`>` is `never`) — a bag you cannot
    // index without widening the prop type.
    const authoredDescribedBy = comboboxProps['aria-describedby'];
    const describedBy = [authoredDescribedBy, descriptionId].filter(Boolean).join(' ') || undefined;

    const trigger = (
    <Combobox 
        options={schema.options || []}
        placeholder={schema.placeholder}
        value={schema.value}
        disabled={hostDisabled}
        className={schema.className}
        {...toFormControlDomProps(comboboxProps)}
        aria-describedby={describedBy}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
    />
  );

    // No description authored ⇒ the node's DOM is byte-for-byte what it was
    // before this card. The wrapper exists ONLY to give the paragraph a home,
    // so it is not paid for by nodes that render no paragraph — and the
    // designer's handles (`data-obj-id` / `data-obj-type`) and the authored
    // `style` stay on the trigger in BOTH arms, where this renderer has always
    // put them. Relocating them onto a wrapper the way `input` / `select` do is
    // a change to the designer's hit target, not to this card's subject.
    if (!descriptionId) return trigger;

    return (
      // `grid gap-1.5` deliberately without the siblings' `w-full`: their
      // controls are `w-full` themselves, whereas the combobox trigger is a
      // fixed `w-[200px]`, so `w-full` here would stretch the node's footprint
      // in a flex parent to serve the paragraph alone.
      <div className="grid gap-1.5">
        {trigger}
        <p id={descriptionId} className="text-sm text-muted-foreground">{schema.description}</p>
      </div>
    );
};

ComponentRegistry.register('combobox', ComboboxRenderer,
  {
    namespace: 'ui',
    label: 'Combobox',
    inputs: [
      { name: 'placeholder', type: 'string' },
      { name: 'value', type: 'string' },
      { name: 'disabled', type: 'boolean' },
      { name: 'className', type: 'string' },
      // Declared here because both are READ on this path: `name` by the
      // form-control DOM pass-through (see the docblock above), `description`
      // by this renderer. `defaultValue` is deliberately absent — it is a
      // retirement tombstone on both faces of `ComboboxSchema`.
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' }
    ],
    defaultProps: {
      placeholder: 'Select option...',
      options: []
    }
  }
);
