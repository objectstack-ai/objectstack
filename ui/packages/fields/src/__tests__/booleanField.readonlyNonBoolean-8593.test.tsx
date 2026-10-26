/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8593 — `BooleanField`'s readonly branch read the value by
 * TRUTHINESS (`value ? 'Yes' : 'No'`), so the string `'false'`, the string
 * `'0'`, `{}` and `[]` all said "Yes".
 *
 * This is objectui#8582's defect one surface over. That card moved
 * `BooleanCellRenderer` off truthiness on `@objectstack/spec`'s value
 * contract; this file takes the read-only branch of the EDIT widget, which
 * `FieldEditWidget` registers for `boolean` and `toggle` and every generated
 * form renders for a readonly boolean. Measured on `21529629c` by rendering —
 * the "before" column is what THE DEFECT / THE OTHER DIRECTION legs of this
 * file were observed to fail on against that tree (failure modes per leg are
 * in the PR):
 *
 * | stored value                         | readonly widget said | why                      |
 * |--------------------------------------|----------------------|--------------------------|
 * | `'false'`, `'0'`, `'no'`, `{}`, `[]` | "Yes"                | truthy non-booleans      |
 * | `'true'`, `'1'`, `1`                 | "Yes"                | ingest spellings, truthy |
 * | `0`, `''`                            | "No"                 | falsy non-booleans       |
 * | `null`, `undefined`                  | "No"                 | absence read as false    |
 *
 * ── The ruling is the spec's, not this file's ─────────────────────────────
 * `@objectstack/spec`'s runtime value contract for `boolean` / `toggle` is a
 * bare `z.boolean()` (`data/field-value.zod.ts`, `valueSchemaFor`). The same
 * module declares the class "a JS boolean on the wire (driver read-coercion
 * repairs SQL 0/1)" and lists it under `NON_TEXT_STORED_VALUE_TYPES`: the
 * stored value "is never text on any backend". The truth table that turns
 * `'true'` / `1` / `'0'` into a boolean already lives at the producer
 * boundaries — objectql's `coerceBooleanFields` on the read path and its
 * `invalid_boolean` write-path refusal, `rest`'s `parseBooleanCell` on CSV
 * import — so a non-boolean that reaches this widget is a producer that
 * skipped its repair, and a second copy of that table here would be the
 * widget-side dialect AGENTS.md #0.1 forbids. Hence ONLY a real boolean is a
 * value of a boolean field; everything else is NO value.
 *
 * ── What a readonly WIDGET draws for no value ─────────────────────────────
 * `EmptyValue` — because that is this directory's own convention, not because
 * the cell renderer uses it. Every sibling widget with a readonly branch and
 * a nullable value renders `EmptyValue` for the absent case (`NumberField`,
 * `CurrencyField`, `PercentField`, `DateTimeField`, `EmailField`,
 * `PhoneField`, `RadioField`, `ObjectField`, `ObjectRefField`, `CodeField`,
 * `LocationField`, `QRCodeField`, `MultiSelectField`, `CheckboxesField`, …),
 * and `validation-feedback.test.tsx` already pins that dash for six of them.
 * `BooleanCellRenderer`'s answer happens to be the same component, so the two
 * surfaces agree by convention rather than by import.
 *
 * ── The second direction ──────────────────────────────────────────────────
 * objectui#8582 found fabricated FALSEHOOD as well as fabricated truth, and
 * on a status-named field it was a destructive badge, louder than the
 * positive. The widget has the fabricated falsehood (`0`, `''`, `null` and
 * `undefined` said "No") but no louder shape: its readonly branch is one text
 * span with no field-name conventions, so a "No" weighs exactly what a "Yes"
 * weighs. Both directions are swept here; there is no badge case because
 * there is no badge.
 *
 * ── Why the POPULATED cases are the load-bearing ones ─────────────────────
 * The caricature is a widget that says "Yes" for a literal `true` and draws
 * the affordance for everything else (`value !== true` in place of
 * `typeof value !== 'boolean'`). It satisfies every THE DEFECT, THE OTHER
 * DIRECTION and THE RULING case in this file. What refuses it is the
 * POPULATED block: a real `false` still says "No". Each was RUN against the
 * caricature, not predicted.
 *
 * ── Why each defect case asserts the fabrication's ABSENCE first ──────────
 * "a Yes here is a fabricated true" / "a No here is a fabricated false" are
 * the sentences that fail on the unfixed tree; "the shared EmptyValue
 * affordance must be present" is the one that fails on a widget that draws
 * nothing at all. They are textually distinct so the legs can be told apart
 * by failure MODE rather than by count.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BooleanField } from '../widgets/BooleanField';
import { FieldEditWidget } from '../FieldEditWidget';

afterEach(() => cleanup());

const noop = () => {};

type BooleanType = 'boolean' | 'toggle';

/** Render the widget exactly the way a readonly form row does: `readonly`, a stored value. */
function renderReadonly(type: BooleanType, value: unknown, field: Record<string, unknown> = {}) {
  return render(
    <BooleanField
      value={value as never}
      onChange={noop}
      field={{ type, name: type, ...field } as never}
      readonly={true}
    />,
  );
}

/** The same, through the `boolean` / `toggle` registration a host resolves. */
function renderThroughHost(type: BooleanType, value: unknown) {
  return render(
    <FieldEditWidget
      value={value}
      onChange={noop}
      field={{ type, name: type } as never}
      readonly={true}
    />,
  );
}

const affordance = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="empty-value"]');
/**
 * Text-node locators, scoped to the render's own container. `queryAllByText`
 * rather than `queryByText`: the latter THROWS on a second match, which would
 * read as a harness death instead of a fabricated value.
 */
const yesCount = (root: HTMLElement) => within(root).queryAllByText('Yes').length;
const noCount = (root: HTMLElement) => within(root).queryAllByText('No').length;

function expectAffordance(root: HTMLElement, label: string) {
  const empty = affordance(root);
  expect(empty, `${label}: the shared EmptyValue affordance must be present`).not.toBeNull();
  expect(
    empty?.getAttribute('aria-label'),
    `${label}: the affordance must carry its accessible name`,
  ).toBe('No value');
}

/** Non-booleans that are TRUTHY — the values the old branch said "Yes" for. */
const FABRICATED_TRUE: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ["the string 'false'", 'false'],
  ["the string '0'", '0'],
  ["the string 'no'", 'no'],
  ['an empty object {}', {}],
  ['an empty array []', []],
];

/** Non-booleans that are FALSY — the values the old branch said "No" for. */
const FABRICATED_FALSE: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ['the number 0', 0],
  ["the empty string ''", ''],
];

/** No value at all — which the old branch ALSO said "No" for. */
const ABSENT: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ['null', null],
  ['undefined', undefined],
];

/**
 * Spellings the platform's INGEST boundaries accept and repair (objectql's
 * `coerceBooleanFields`, `rest`'s `parseBooleanCell`). On the wire they are
 * still not booleans, and this widget owns no copy of that table.
 */
const INGEST_SPELLINGS: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ["the string 'true'", 'true'],
  ["the string '1'", '1'],
  ['the number 1', 1],
];

const TYPES: ReadonlyArray<BooleanType> = ['boolean', 'toggle'];

describe('objectui#8593 — a readonly BooleanField says Yes / No only for a real boolean', () => {
  describe('THE DEFECT — a truthy non-boolean said "Yes", an affirmative the record never made', () => {
    for (const type of TYPES) {
      for (const [label, value] of FABRICATED_TRUE) {
        it(`THE DEFECT — readonly \`${type}\` holding ${label} says no "Yes" and draws the No-value affordance`, () => {
          const { container } = renderReadonly(type, value);
          expect(
            yesCount(container),
            `${type} holding ${label}: a "Yes" here is a fabricated true`,
          ).toBe(0);
          expectAffordance(container, `${type} holding ${label}`);
        });
      }
    }
  });

  describe('THE OTHER DIRECTION — a falsy non-boolean, or no value at all, said "No", a false the record never stored', () => {
    for (const type of TYPES) {
      for (const [label, value] of [...FABRICATED_FALSE, ...ABSENT]) {
        it(`THE OTHER DIRECTION — readonly \`${type}\` holding ${label} says no "No" and draws the No-value affordance`, () => {
          const { container } = renderReadonly(type, value);
          expect(
            noCount(container),
            `${type} holding ${label}: a "No" here is a fabricated false`,
          ).toBe(0);
          expectAffordance(container, `${type} holding ${label}`);
        });
      }
    }
  });

  describe('THE RULING — the widget owns no truth table: an ingest spelling is still not a boolean on the wire', () => {
    for (const [label, value] of INGEST_SPELLINGS) {
      it(`THE RULING — readonly \`boolean\` holding ${label} says no "Yes" and draws the No-value affordance`, () => {
        const { container } = renderReadonly('boolean', value);
        expect(
          yesCount(container),
          `boolean holding ${label}: the widget owns no truth table, so a "Yes" here is a coercion the spec assigns to the producer`,
        ).toBe(0);
        expectAffordance(container, `boolean holding ${label}`);
      });
    }
  });

  describe('POPULATED — a real boolean still says exactly what it said before (the load-bearing block)', () => {
    // The readonly branch precedes the `widget` split, so the checkbox and
    // switch variants must read the same; both are pinned so a future
    // per-variant readonly face cannot drift on one side only.
    const VARIANTS: ReadonlyArray<readonly [label: string, field: Record<string, unknown>]> = [
      ['the default (switch) variant', {}],
      ['the checkbox variant', { widget: 'checkbox' }],
    ];
    for (const type of TYPES) {
      for (const [variant, field] of VARIANTS) {
        it(`POPULATED — readonly \`${type}\` (${variant}) holding a real \`true\` still says "Yes"`, () => {
          const { container } = renderReadonly(type, true, field);
          expect(yesCount(container), `${type}: a real true must still say Yes`).toBe(1);
          expect(noCount(container), `${type}: a real true must not say No`).toBe(0);
          expect(affordance(container), `${type}: a real true must NOT render the affordance`).toBeNull();
          expect(container.textContent, `${type}: the readonly face of a real true is the bare word`).toBe('Yes');
        });

        it(`POPULATED — readonly \`${type}\` (${variant}) holding a real \`false\` still says "No" (false is a value, not an absence)`, () => {
          const { container } = renderReadonly(type, false, field);
          expect(noCount(container), `${type}: a real false must still say No`).toBe(1);
          expect(yesCount(container), `${type}: a real false must not say Yes`).toBe(0);
          expect(affordance(container), `${type}: a real false must NOT render the affordance`).toBeNull();
          expect(container.textContent, `${type}: the readonly face of a real false is the bare word`).toBe('No');
        });
      }
    }
  });

  describe('THE HOST PATH — the `boolean` / `toggle` registration reaches the same branch', () => {
    for (const type of TYPES) {
      it(`THE HOST PATH — \`FieldEditWidget\` readonly \`${type}\` holding the string 'false' draws the affordance, not "Yes"`, () => {
        const { container } = renderThroughHost(type, 'false');
        expect(
          yesCount(container),
          `${type} via FieldEditWidget holding 'false': a "Yes" here is a fabricated true`,
        ).toBe(0);
        expectAffordance(container, `${type} via FieldEditWidget holding 'false'`);
      });

      it(`THE HOST PATH — \`FieldEditWidget\` readonly \`${type}\` holding a real \`false\` still says "No"`, () => {
        const { container } = renderThroughHost(type, false);
        expect(noCount(container), `${type} via FieldEditWidget: a real false must still say No`).toBe(1);
        expect(affordance(container), `${type} via FieldEditWidget: a real false must NOT render the affordance`).toBeNull();
      });
    }
  });
});
