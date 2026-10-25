/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The group-labelling DECLARATION, at the registration boundary (objectui#3961).
 *
 * A widget whose labelled surface is not a labelable HTML element cannot be
 * reached by a host's `<label for>` — the association has to go by IDREF
 * (`aria-labelledby`). Which widgets those are is a fact only the widget package
 * knows, so it is DECLARED (`ComponentMeta.labelling`) rather than guessed by the
 * form renderer from whatever DOM a widget happens to render.
 *
 * This file pins the declaration itself, separately from the rendered outcome
 * (`composite-group-label-e2e.test.tsx`), because the two can fail apart:
 *
 *   • declared but not rendered → the widget's container never answers with a
 *     role, so the name lands on a bare `div` (the e2e file catches that);
 *   • rendered but not declared → the host keeps emitting `for`, the widget never
 *     receives an `aria-labelledby`, and the group semantics are dead code. THIS
 *     file is what fails then — an omission from the set is otherwise invisible,
 *     since a missing declaration degrades silently to the single-control path.
 *
 * Nothing renders here, so `registerField`'s `React.lazy` wrapper is never
 * resolved: this reads metadata only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import {
  registerAllFields,
  mapFieldTypeToFormType,
  FIELD_WIDGET_LABELLING,
  FORM_FIELD_TYPES,
} from '../index';

/**
 * Every field type whose host label must be associated by IDREF. Two shapes, one
 * declaration — see `FIELD_WIDGET_LABELLING` in `../index`:
 * real composites, plus `file`, whose single control is a `div[role="button"]`.
 *
 * `multiselect` (objectui#3975) is the seventh, added after #3961 shipped: its
 * chip row is the same wrapper `div` holding the host id that `checkboxes` had.
 * It is listed here rather than left to the e2e file alone because the omission
 * of a declaration is exactly the failure that degrades silently.
 *
 * `slider` and `signature` (objectui#3318) are the eighth and ninth, and both
 * are `file`'s shape rather than a composite: ONE surface, which happens not to
 * be labelable. A slider's control is Radix's `span[role="slider"]` thumb; a
 * signature's is a `<canvas>`. `<label for>` reaches neither.
 *
 * `grid` (objectui#4857) is the tenth, and it is the COMPOSITE shape, measured
 * before being classified: its bare config offers exactly one focusable — the
 * auxiliary "Add line" button, which a `for` could reach but must not (the
 * label would name the add-row action, and clicking the label would insert a
 * row) — and every realistic config is a table of per-cell inputs and row
 * actions under one container, `address`'s shape at larger scale.
 */
const GROUP_LABELLED = [
  'address',
  'geolocation',
  'checkboxes',
  'radio',
  'rating',
  'file',
  'multiselect',
  'slider',
  'signature',
  'grid',
] as const;

/**
 * Widgets whose whole surface is a pure display in EVERY state — no editable
 * branch, no focusable control, nothing a `<label for>` could ever reach
 * (objectui#4857). Declared `'display'` so the form renderer wraps their output
 * in its own named container (the objectui#4788 channel) in the editable state
 * too — on the real object-form path these arrive `disabled`, never `readonly`,
 * so the readonly-keyed gate alone could not cover them.
 */
const DISPLAY_LABELLED = ['formula', 'summary', 'auto_number', 'vector'] as const;

/**
 * Single-control widgets: the host's `<label for>` reaches a real labelable
 * element, so they must NOT be declared — that is the default path, and a stray
 * `labelling: 'group'` here would take a working `for` association away from a
 * control that needs it and hand it an `aria-labelledby` its markup ignores.
 */
const CONTROL_LABELLED = [
  'text',
  'textarea',
  'number',
  'boolean',
  'date',
  'datetime',
  'email',
  'phone',
  'url',
  'currency',
  'percent',
  'password',
  'tags',
  'color',
  'code',
  'user',
  'lookup',
  'select',
] as const;

beforeAll(() => {
  registerAllFields();
});

describe('field widgets declare how their label must be associated (objectui#3961)', () => {
  it.each(GROUP_LABELLED)('%s declares labelling: "group"', (type) => {
    expect(ComponentRegistry.getMeta(type, 'field')?.labelling).toBe('group');
  });

  it.each(DISPLAY_LABELLED)('%s declares labelling: "display" (objectui#4857)', (type) => {
    expect(ComponentRegistry.getMeta(type, 'field')?.labelling).toBe('display');
  });

  it.each(CONTROL_LABELLED)('%s leaves labelling undeclared (⇒ "control")', (type) => {
    // Absent, not `'control'`: one spelling of the default, and the form
    // renderer reads any non-`'group'`/-`'display'` value as the single-control
    // path. The DECISION is still mandatory — `FIELD_WIDGET_LABELLING` spells
    // `'control'` for every one of these, and its exhaustive `Record` key makes
    // omission a compile error; absence here is that record's runtime spelling
    // of the default, not a widget that skipped the question.
    expect(ComponentRegistry.getMeta(type, 'field')?.labelling).toBeUndefined();
  });

  it('declares group labelling for exactly the audited set — no more', () => {
    // A widget added to `fieldWidgetMap` later inherits the single-control path,
    // which is the safe default; if it is in fact a composite, the e2e pins
    // (objectui#3952's "every label resolves to a real control") go red rather
    // than this list quietly growing. This assertion is the other direction: it
    // fails if someone declares a widget `group` without an audited group
    // container to carry the name.
    const declared = ComponentRegistry.getKnownTypes()
      .filter((key) => key.startsWith('field:'))
      .filter((key) => ComponentRegistry.getMeta(key.slice('field:'.length), 'field')?.labelling === 'group')
      .map((key) => key.slice('field:'.length))
      .sort();

    expect(declared).toEqual([...GROUP_LABELLED].sort());
  });

  it('declares display labelling for exactly the audited set — no more (objectui#4857)', () => {
    // Same both-directions discipline as the group set: a widget declared
    // `'display'` without actually BEING a pure display would have the host
    // wrap a live control inside a group and drop its `for` — so growth of this
    // set must be a deliberate, audited act.
    const declared = ComponentRegistry.getKnownTypes()
      .filter((key) => key.startsWith('field:'))
      .filter((key) => ComponentRegistry.getMeta(key.slice('field:'.length), 'field')?.labelling === 'display')
      .map((key) => key.slice('field:'.length))
      .sort();

    expect(declared).toEqual([...DISPLAY_LABELLED].sort());
  });
});

describe('registered ⇒ declared (objectui#4857 registry gate)', () => {
  it('every registered field widget carries a labelling decision', () => {
    // The load-bearing half of this gate is COMPILE-time: `FIELD_WIDGET_LABELLING`
    // is a `Record` keyed by the widget map's own literal key union, so an entry
    // missing for a registered widget (or left over for an unregistered one) is
    // a type-check failure, not a runtime discovery. This runtime restatement
    // exists so the parity is also visible to a mutation that bypasses tsc, and
    // so the failure NAMES the widget.
    expect(Object.keys(FIELD_WIDGET_LABELLING).sort()).toEqual([...FORM_FIELD_TYPES].sort());

    for (const [type, labelling] of Object.entries(FIELD_WIDGET_LABELLING)) {
      expect(
        ['control', 'group', 'display'],
        `widget "${type}" must declare a labelling value from the closed vocabulary`,
      ).toContain(labelling);
    }
  });

  it('the runtime meta agrees with the declaration record, key by key', () => {
    // `'control'` is spelled as ABSENCE in the registry meta (one spelling of
    // the default, objectui#3961); `'group'` / `'display'` must be present and
    // exact. This is the join that catches a `registerField` regression which
    // reads the record but writes the wrong meta.
    for (const [type, labelling] of Object.entries(FIELD_WIDGET_LABELLING)) {
      const meta = ComponentRegistry.getMeta(type, 'field')?.labelling;
      if (labelling === 'control') {
        expect(meta, `widget "${type}" (control) must leave the meta key absent`).toBeUndefined();
      } else {
        expect(meta, `widget "${type}" must register labelling: "${labelling}"`).toBe(labelling);
      }
    }
  });
});

/**
 * The join between the two halves (objectui#3986). The declaration above is
 * per-WIDGET; a form asks for a widget by the id its producer emitted. So the
 * declaration only reaches the right widget if the producer names the widget that
 * will actually render — and for `select` that depends on `multiple`, not on the
 * type string alone.
 *
 * Asserting the pair here, rather than in either half alone, is what makes the
 * failure visible: `mapFieldTypeToFormType`'s own test cannot know what
 * `labelling` the id it returns carries, and the declaration test cannot know
 * which id a `multiple: true` select resolves to. The gap between those two blind
 * spots is exactly where this bug lived.
 */
describe('the widget id the object form emits carries the right declaration (objectui#3986)', () => {
  const labellingOf = (formType: string) =>
    ComponentRegistry.getMeta(formType.replace(/^field:/, ''), 'field')?.labelling;

  it('select + multiple resolves to a widget declared `group`', () => {
    // Before the producer fix this resolved to `field:select`, whose declaration
    // is (correctly) absent — so the host kept emitting a `for` at the chip row's
    // wrapper `div`, and the visible label named nothing.
    const formType = mapFieldTypeToFormType('select', { multiple: true });
    expect(formType).toBe('field:multiselect');
    expect(labellingOf(formType)).toBe('group');
  });

  it('a single-value select still resolves to an UNDECLARED widget', () => {
    // The guard direction. `select`'s trigger is a labelable
    // `button[role=combobox]`; declaring it `group` would strip a working `for`.
    const formType = mapFieldTypeToFormType('select');
    expect(formType).toBe('field:select');
    expect(labellingOf(formType)).toBeUndefined();
  });
});
