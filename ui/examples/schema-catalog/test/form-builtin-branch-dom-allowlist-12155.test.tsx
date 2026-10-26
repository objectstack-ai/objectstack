/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every built-in branch of the form renderer hands its control an ALLOWLIST,
 * not the entry's leftover keys (objectui#12155), measured through the real
 * `SchemaRenderer` and the real `form` renderer.
 *
 * ## The defect
 *
 * `renderFieldComponent` (`packages/components/src/renderers/form/form.tsx`)
 * renders a field whose type no `field:` widget claims through a `switch` of
 * built-in branches and a `default` arm. Each spread the entry's leftover keys
 * onto its native control, minus a blocklist. A key the blocklist did not name
 * reached the DOM, and two of them did damage: a field-level `defaultValue`
 * was DRAWN by the `textarea` branch and the `default` arm while the submit
 * carried no value for the field, and `defaultChecked` checked the hidden
 * input behind a Radix box that stayed unchecked. A form's initial values are
 * `FormSchema.defaultValues`. This is the fourth instance of the DOM
 * pass-through family, after objectui#3291, #5574 and #5632.
 *
 * ## The instrument
 *
 *   - The arms are DERIVED from `renderFieldComponent` itself: its `switch`
 *     over `type` is read from the source with the TypeScript parser, every
 *     `case` label and the `default` arm. {@link EXITS} must name exactly that
 *     set, so an arm added without a fixture here turns this file red.
 *   - Each arm is measured in both registry sets: with `@object-ui/fields`
 *     registered, and with components only. The second set is the first with
 *     every `field:` registration removed for the duration of its block; each
 *     set has a registry control that says the set is the one it claims.
 *   - Each arm is fed a canary key, a `defaultValue` and a `defaultChecked`,
 *     and none of the three may reach the DOM.
 *   - Each arm's LEGITIMATE set is asserted beside that, because a branch that
 *     forwards nothing also reads zero leaks (#5632's PM review measured it):
 *     the control carries the field's `name`, its `aria-required`, each
 *     attribute `BUILTIN_HOST_ATTRIBUTES` in `form.tsx` forwards for its host,
 *     the resolved `maxLength`, `readOnly` (or `disabled`, for a toggle or a
 *     select, where `readonly` falls back to it) and `disabled`; it shows a
 *     value seeded through `FormSchema.defaultValues`; and an edit reaches the
 *     submit, which is `value` and `onChange` arriving by name.
 *
 * ## Bounds (said per AGENTS.md #9)
 *
 *   - An arm's EXITS are written here by hand: the `input` arm's file picker,
 *     the `textarea` arm's fullscreen surface. Two exits draw no control and
 *     receive no pass-through, so they are not measured: the `default` arm's
 *     refusal of an unregistered `field:password` / `field:secret`, and the
 *     `select` arm's empty-options state.
 *   - The file picker's value and `readonly` are not measured: the control
 *     cannot be controlled, so the branch never hands it a value, and it has
 *     never handed it `readOnly`, an attribute HTML does not apply to a file
 *     input.
 *   - `default` is reached here by a type id nothing registers in either set.
 *     With components only, the ordinary types (`email`, `text`, `number`, …)
 *     take the same arm; `form-field-channel-components-only-12130.test.tsx`
 *     measures their submits.
 *
 * Module-scope import of `@object-ui/fields`, not `beforeAll` (AGENTS.md
 * §测试纪律): registering the widgets is an unbounded module load.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { render, act, fireEvent, screen } from '@testing-library/react';
import '@object-ui/components';
import '@object-ui/fields';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';

// Radix Select opens on pointer events happy-dom does not implement; the same
// stand-ins `option-value-round-trip.test.tsx` in `@object-ui/components` uses.
beforeAll(() => {
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: { button?: number; ctrlKey?: boolean; pointerType?: string } & EventInit = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = MockPointerEvent;
  Object.assign(HTMLElement.prototype, {
    hasPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    scrollIntoView: vi.fn(),
  });
});

/* ── the arms, read from `renderFieldComponent` ──────────────────────────── */

/**
 * Spelled in string operations, copying the landed precedent of objectui#7791
 * (PR #7796) and objectui#7799 (PR #7806): only BARE `import.meta.url` is read.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 4; // examples / schema-catalog / test / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');
const FORM_RENDERER = `${REPO_ROOT}/packages/components/src/renderers/form/form.tsx`;

/** The `switch (type)` arms of `renderFieldComponent`: each `case` label, and `default`. */
function deriveArms(): string[] {
  const source = ts.createSourceFile(
    FORM_RENDERER,
    readFileSync(FORM_RENDERER, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const fn = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'renderFieldComponent',
  );
  if (!fn?.body) throw new Error('renderFieldComponent not found in form.tsx');
  const switches = fn.body.statements.filter(
    (node): node is ts.SwitchStatement =>
      ts.isSwitchStatement(node) && ts.isIdentifier(node.expression) && node.expression.text === 'type',
  );
  if (switches.length !== 1) throw new Error(`expected one switch over \`type\`, found ${switches.length}`);
  return switches[0].caseBlock.clauses.map((clause) => {
    if (ts.isDefaultClause(clause)) return 'default';
    if (!ts.isStringLiteral(clause.expression)) throw new Error('a case label that is not a string literal');
    return clause.expression.text;
  });
}

/* ── mounting ────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
};

/** Render a one-field form; `submit()` clicks its button and returns what the form submitted. */
async function mount(field: Row, defaultValues?: Row) {
  let submitted: Row | undefined;
  const node = {
    type: 'form',
    showSubmit: true,
    submitLabel: 'Go',
    ...(defaultValues ? { defaultValues } : {}),
    fields: [{ name: 'f', label: 'F', ...field }],
    onSubmit: (data: Row) => { submitted = data; },
  };
  const utils = render(<SchemaRenderer schema={node as never} />);
  await settle();
  const row = () => utils.container.querySelector('[data-field="f"]') as HTMLElement;
  const submit = async () => {
    fireEvent.click(utils.getByRole('button', { name: 'Go' }));
    await settle();
    return submitted;
  };
  return { ...utils, row, submit };
}
type Mounted = Awaited<ReturnType<typeof mount>>;

/* ── the canaries ────────────────────────────────────────────────────────── */

const CANARY_KEY = 'zzcanary12155';
const CANARY_TEXT = 'canary-text-12155';
const DEFAULT_VALUE_TEXT = 'drawn-default-12155';

/** The three keys no branch may put on the DOM. */
const CANARIES: Row = { [CANARY_KEY]: CANARY_TEXT, defaultValue: DEFAULT_VALUE_TEXT, defaultChecked: true };

/* ── the exits, one or more per arm ──────────────────────────────────────── */

/** A type id nothing registers, in either registry set: it takes the `default` arm. */
const UNREGISTERED_TYPE = 'zz-unregistered-12155';

/** The attributes `BUILTIN_HOST_ATTRIBUTES` forwards, as written on the entry and as read off the control. */
const INPUT_HOST_KEYS: Row = { min: 1, max: 9, step: 2, minLength: 2, pattern: '[a-z]+', multiple: true, accept: 'image/*' };
const INPUT_HOST_ATTRS: Record<string, string> = { min: '1', max: '9', step: '2', minlength: '2', pattern: '[a-z]+', multiple: '', accept: 'image/*' };
const TEXTAREA_HOST_KEYS: Row = { rows: 3, minLength: 2 };
const TEXTAREA_HOST_ATTRS: Record<string, string> = { rows: '3', minlength: '2' };

const OPTIONS = [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }];

interface Exit {
  /** The entry keys, past `type`, that route the field to this exit. */
  readonly route: Row;
  /** The legitimate keys written on the entry, and the attributes they must put on the control. */
  readonly keys: Row;
  readonly attrs: Record<string, string>;
  /** The control: the element the branch renders and spreads onto. */
  readonly control: (row: HTMLElement) => HTMLElement | null;
  /**
   * How `readonly` reaches the control: as `readonly`, or as `disabled` (a
   * toggle, a select). `null` for the file picker, which the branch has never
   * handed `readOnly`, an attribute HTML does not apply to a file input.
   */
  readonly readonlyAs: 'readonly' | 'disabled' | null;
  /** Whether the branch hands this control `maxLength` and `placeholder` by name. */
  readonly textLike: boolean;
  /** The value seeded through `FormSchema.defaultValues` for the round trip. */
  readonly seed?: unknown;
  /** Read the seeded value back, edit it, and return what the edit should submit. Absent: not measured. */
  readonly roundTrip?: (m: Mounted) => Promise<{ seeded: boolean; edited: unknown }>;
}

/** The seed each round trip expects, by control kind. */
const SEEDS = { text: 'seeded-12155', toggle: true, select: 'a' } as const;

const textRoundTrip = async (m: Mounted) => {
  const control = m.row().querySelector('input, textarea') as HTMLInputElement;
  const seeded = control.value === SEEDS.text;
  await act(async () => { fireEvent.change(control, { target: { value: 'typed-12155' } }); });
  return { seeded, edited: 'typed-12155' };
};

const toggleRoundTrip = async (m: Mounted) => {
  const control = m.row().querySelector('[role=checkbox],[role=switch]') as HTMLElement;
  const seeded = control.getAttribute('aria-checked') === 'true';
  await act(async () => { fireEvent.click(control); });
  return { seeded, edited: false };
};

const selectRoundTrip = async (m: Mounted) => {
  const trigger = m.row().querySelector('[role=combobox]') as HTMLElement;
  const seeded = trigger.textContent?.includes('Alpha') === true;
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.click(await screen.findByRole('option', { name: 'Beta' }));
  await settle();
  return { seeded, edited: 'b' };
};

const textInput = (row: HTMLElement) => row.querySelector('input') as HTMLElement | null;
const textArea = (row: HTMLElement) => row.querySelector('textarea') as HTMLElement | null;
const toggleControl = (row: HTMLElement) => row.querySelector('[role=checkbox],[role=switch]') as HTMLElement | null;

/**
 * Keyed by arm. Must name exactly the arms {@link deriveArms} reads; an arm's
 * `type` is the arm's own `case` label, and `default` is reached through
 * {@link UNREGISTERED_TYPE}.
 */
const TEXT = { control: textInput, readonlyAs: 'readonly', textLike: true, roundTrip: textRoundTrip, seed: SEEDS.text } as const;
const LONG_TEXT = { ...TEXT, control: textArea, keys: TEXTAREA_HOST_KEYS, attrs: TEXTAREA_HOST_ATTRS } as const;
const TOGGLE = { route: {}, keys: {}, attrs: {}, control: toggleControl, readonlyAs: 'disabled', textLike: false, roundTrip: toggleRoundTrip, seed: SEEDS.toggle } as const;

const EXITS: Readonly<Record<string, ReadonlyArray<readonly [string, Exit]>>> = {
  input: [
    ['text', { ...TEXT, route: {}, keys: INPUT_HOST_KEYS, attrs: INPUT_HOST_ATTRS }],
    // No value and no cap reach a file picker; `placeholder` does.
    ['file picker', { route: { inputType: 'file' }, keys: INPUT_HOST_KEYS, attrs: { ...INPUT_HOST_ATTRS, placeholder: 'Type here' }, control: textInput, readonlyAs: null, textLike: false }],
  ],
  textarea: [
    ['inline', { ...LONG_TEXT, route: {} }],
    ['fullscreen', { ...LONG_TEXT, route: { mobile_fullscreen: true } }],
  ],
  checkbox: [['box', TOGGLE]],
  switch: [['switch', TOGGLE]],
  select: [
    ['options', { route: { options: OPTIONS }, keys: {}, attrs: {}, control: (row) => row.querySelector('[role=combobox]'), readonlyAs: 'disabled', textLike: false, roundTrip: selectRoundTrip, seed: SEEDS.select }],
  ],
  default: [
    ['unregistered type', { ...TEXT, route: {}, keys: INPUT_HOST_KEYS, attrs: INPUT_HOST_ATTRS }],
  ],
};

const typeOf = (arm: string) => (arm === 'default' ? UNREGISTERED_TYPE : arm);

const CASES = Object.entries(EXITS).flatMap(([arm, exits]) =>
  exits.map(([exit, spec]) => [`${arm} · ${exit}`, arm, spec] as const),
);

/* ── the assertions, one arm-exit at a time ──────────────────────────────── */

/** Every element of the row, the row included. */
const everyElement = (row: HTMLElement): Element[] => [row, ...row.querySelectorAll('*')];

async function measure(arm: string, spec: Exit) {
  const type = typeOf(arm);
  const MAX_LENGTH = 20;

  // 1. The canaries reach nothing, and the legitimate set reaches the control.
  const leak = await mount({ type, ...spec.route, ...CANARIES, ...spec.keys, maxLength: MAX_LENGTH, placeholder: 'Type here', required: true });
  const row = leak.row();
  expect(row, 'the form renders the field').toBeTruthy();
  const control = spec.control(row);
  expect(control, 'the branch renders its control').toBeTruthy();
  expect(everyElement(row).filter((el) => el.hasAttribute(CANARY_KEY)), 'the canary key').toEqual([]);
  expect(row.innerHTML, 'the canary value').not.toContain(CANARY_TEXT);
  expect(row.innerHTML, 'the field-level defaultValue').not.toContain(DEFAULT_VALUE_TEXT);
  const inputs = [...row.querySelectorAll('input, textarea')] as HTMLInputElement[];
  expect(inputs.map((el) => el.value), 'no control holds the field-level defaultValue').not.toContain(DEFAULT_VALUE_TEXT);
  expect(inputs.filter((el) => el.checked || el.hasAttribute('checked')), 'no input is checked by defaultChecked').toEqual([]);

  expect(row.querySelector('[name="f"]'), 'the field name reaches a form control').toBeTruthy();
  expect(control!.getAttribute('aria-required'), 'aria-* reaches the control').toBe('true');
  for (const [attr, expected] of Object.entries(spec.attrs)) {
    expect(control!.getAttribute(attr), `\`${attr}\` reaches the control`).toBe(expected);
  }
  if (spec.textLike) {
    expect(control!.getAttribute('maxlength'), 'the resolved maxLength').toBe(String(MAX_LENGTH));
    expect(control!.getAttribute('placeholder'), 'placeholder').toBe('Type here');
  }
  leak.unmount();

  // 2. `value` and `onChange`, by name: a seeded value shows, and an edit is submitted.
  if (spec.roundTrip) {
    const trip = await mount({ type, ...spec.route }, { f: spec.seed });
    const { seeded, edited } = await spec.roundTrip(trip);
    expect(seeded, 'the seeded value shows').toBe(true);
    expect((await trip.submit())?.f, 'the edit is submitted').toEqual(edited);
    trip.unmount();
  }

  // 3. `readonly`, and 4. `disabled`.
  if (spec.readonlyAs) {
    const readonly = await mount({ type, ...spec.route, readonly: true });
    expect(spec.control(readonly.row())!.hasAttribute(spec.readonlyAs), `readonly reaches the control as \`${spec.readonlyAs}\``).toBe(true);
    readonly.unmount();
  }
  const disabled = await mount({ type, ...spec.route, disabled: true });
  expect(spec.control(disabled.row())!.hasAttribute('disabled'), 'disabled reaches the control').toBe(true);
  disabled.unmount();
}

describe('the built-in branches this file measures are the ones `renderFieldComponent` has (objectui#12155)', () => {
  it('EXITS names exactly the derived arms', () => {
    const arms = deriveArms();
    expect(arms).toContain('default');
    expect(Object.keys(EXITS).sort()).toEqual([...arms].sort());
  });
});

describe('with `@object-ui/fields` registered, no built-in branch draws a leftover entry key (objectui#12155)', () => {
  it('CONTROL: the field widgets are registered, and none claims the default arm\'s type', () => {
    expect(ComponentRegistry.get('email', 'field')).toBeDefined();
    expect(ComponentRegistry.get(UNREGISTERED_TYPE, 'field')).toBeUndefined();
  });

  it.each(CASES)('%s', async (_name, arm, spec) => {
    await measure(arm, spec);
  });
});

describe('with components only, no built-in branch draws a leftover entry key (objectui#12155)', () => {
  type Config = ReturnType<typeof ComponentRegistry.getNamespaceComponents>[number];
  let removed: Config[] = [];

  beforeAll(() => {
    removed = ComponentRegistry.getNamespaceComponents('field');
    for (const config of removed) ComponentRegistry.unregister(config.type.slice('field:'.length), 'field');
  });

  afterAll(() => {
    for (const { type, component, ...meta } of removed) {
      ComponentRegistry.register(type.slice('field:'.length), component, meta);
    }
  });

  it('CONTROL: no field widget is registered in this block', () => {
    expect(removed.length).toBeGreaterThan(0);
    expect(ComponentRegistry.getNamespaceComponents('field')).toEqual([]);
    expect(ComponentRegistry.get('email', 'field')).toBeUndefined();
  });

  it.each(CASES)('%s', async (_name, arm, spec) => {
    await measure(arm, spec);
  });
});
