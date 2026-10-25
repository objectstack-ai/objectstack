// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `disabled` is inherited from `BaseSchema` — `boolean | string` — on every
 * concrete schema that used to narrow it back to `boolean` (objectui#7087,
 * maintainer ruling 2026-09-01: option 1, scoped to `disabled`).
 *
 * ## What was narrowed, and why the narrowing was wrong
 *
 * `visible` and `disabled` are twins. objectui#4581 widened both on `BaseSchema`
 * to `boolean | string` on the same evidence: `SchemaRenderer` reads neither key
 * as a boolean, it routes both through `evaluator.evaluateCondition`, declared
 * `(condition: string | boolean | undefined, context?) => boolean`. After that
 * widening, 0 of the 124 `extends BaseSchema` interfaces redeclared `visible`,
 * while 18 kept a pre-widening `disabled?: boolean` of their own — 15 in
 * `form.ts`, `ActionSchema` in `crud.ts`, `CollapsibleSchema` and
 * `ToggleGroupSchema` in `disclosure.ts` — and their zod mirrors carried the
 * matching `z.boolean()`. So `disabled: "${data.status === 'locked'}"`, the
 * capability the renderer implements and `BaseSchema` advertises, was a type
 * error and a zod refusal on exactly the schemas an author reaches for first.
 *
 * The fix is the one `ChatbotSchema` already took (objectui#6169): the key is
 * not redeclared at all. The TS interface inherits the member the way `visible`
 * always has, and `.extend()`'s `.shape` merges the parent's fields into the
 * child's, so the base union reaches every mirror without a second spelling of
 * it that could drift.
 *
 * ## What this file pins
 *
 *   1. Type level — for each of the 18, `X['disabled']` is EXACTLY
 *      `boolean | string | undefined`, invariantly. `Equal`, not `extends`: the
 *      narrow `boolean` is assignable to the wide union, so a one-way check
 *      stays green on a narrowing that was never removed; and `BaseSchema`'s
 *      `[key: string]: any` index signature meant an interface that LOST the
 *      member read `any` (until objectui#8347), which a one-way check also
 *      accepts. `visible` is
 *      asserted beside it as the twin control, so a schema that dropped both
 *      keys cannot pass vacuously.
 *   2. Runtime — each of the 18 zod mirrors `safeParse`s a predicate string on
 *      `disabled` (and on `visible`, the control) and still refuses a number at
 *      path `disabled`. Every fixture is also parsed WITHOUT `disabled`, so a
 *      refusal cannot be a broken fixture wearing a green.
 *   3. Scope guard — the ruling widens NARROWINGS, not independent
 *      declarations. The six `disabled?: boolean` shapes in these same three
 *      files that do not extend `BaseSchema` (`SelectOption`, `RadioOption`,
 *      `FormField`, `ComboboxOption`, `AccordionItem`, `ToggleGroupItem`) stay
 *      `boolean` on both faces.
 *
 * ## Predictions, written before the first run (red-first)
 *
 * With any one of the three source files (or its mirror) reverted to its
 * `origin/main` @ `67dadd602` blob and this file in place:
 *
 *   - TS face reverted: `tsc -p packages/types/tsconfig.test.json` reports
 *     TS2344 on `assertionDisabledIsBaseUnion`, naming that file's interfaces;
 *     `assertionVisibleTwinControl` stays clean (nothing narrowed `visible`).
 *   - zod face reverted: the `accepts a predicate string on disabled` cases for
 *     that file's mirrors fail (`success: false`), the `visible` control and the
 *     `refuses a number` cases for the same mirrors stay green, and every other
 *     file's cases stay green.
 *
 * The measured counts are in the PR that landed this file.
 */

import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import type { BaseSchema } from '../base';
import type { ActionSchema } from '../crud';
import type {
  AccordionItem,
  CollapsibleSchema,
  ToggleGroupItem,
  ToggleGroupSchema,
} from '../disclosure';
import type {
  ButtonSchema,
  CalendarSchema,
  CheckboxSchema,
  ComboboxOption,
  ComboboxSchema,
  DatePickerSchema,
  FileUploadSchema,
  FormField,
  FormSchema,
  InputOTPSchema,
  InputSchema,
  RadioGroupSchema,
  RadioOption,
  SelectOption,
  SelectSchema,
  SliderSchema,
  SwitchSchema,
  TextareaSchema,
  ToggleSchema,
} from '../form';

import { ActionSchema as ActionMirror } from '../zod/crud.zod';
import {
  AccordionItemSchema,
  CollapsibleSchema as CollapsibleMirror,
  ToggleGroupItemSchema,
  ToggleGroupSchema as ToggleGroupMirror,
} from '../zod/disclosure.zod';
import * as FormMirrors from '../zod/form.zod';
import type { ExpressionWire } from '../expression';

/* ── Type-level helpers ──────────────────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/**
 * The union both twins carry on `BaseSchema`, pinned here so the checks below
 * cannot drift from it. `boolean | string | undefined` until objectui#7530
 * (ruled 2026-09-04) declared the CEL envelope on all three predicate keys
 * through the shared `ExpressionWire`; the 18 formerly-narrowed interfaces
 * inherit the wider union exactly as they inherited the narrower one.
 */
type BasePredicate = boolean | ExpressionWire | undefined;
export type assertionBaseDisabled = Expect< Equal< BaseSchema['disabled'], BasePredicate > >;
export type assertionBaseVisible = Expect< Equal< BaseSchema['visible'], BasePredicate > >;

/* ── 1. The 18 formerly-narrowed interfaces inherit the base union ───────── */

type InScope = {
  ButtonSchema: ButtonSchema;
  InputSchema: InputSchema;
  TextareaSchema: TextareaSchema;
  SelectSchema: SelectSchema;
  CheckboxSchema: CheckboxSchema;
  RadioGroupSchema: RadioGroupSchema;
  SwitchSchema: SwitchSchema;
  ToggleSchema: ToggleSchema;
  SliderSchema: SliderSchema;
  FileUploadSchema: FileUploadSchema;
  DatePickerSchema: DatePickerSchema;
  CalendarSchema: CalendarSchema;
  InputOTPSchema: InputOTPSchema;
  FormSchema: FormSchema;
  ComboboxSchema: ComboboxSchema;
  ActionSchema: ActionSchema;
  CollapsibleSchema: CollapsibleSchema;
  ToggleGroupSchema: ToggleGroupSchema;
};

/** The names whose `K` is NOT exactly the base union — `never` when nothing narrows (or loses) it. */
type NotBaseUnion< K extends 'disabled' | 'visible' > = {
  [N in keyof InScope]: Equal< InScope[N][K], BasePredicate > extends true ? never : N;
}[keyof InScope];

export type assertionDisabledIsBaseUnion = Expect< Equal< NotBaseUnion<'disabled'>, never > >;
/** Twin control: `visible` was never narrowed, so this stays `never` on every tree. */
export type assertionVisibleTwinControl = Expect< Equal< NotBaseUnion<'visible'>, never > >;

/* ── 3. Scope guard: independent declarations are not narrowings ─────────── */

type OutOfScope = {
  SelectOption: SelectOption;
  RadioOption: RadioOption;
  FormField: FormField;
  ComboboxOption: ComboboxOption;
  AccordionItem: AccordionItem;
  ToggleGroupItem: ToggleGroupItem;
};

type Widened = {
  [N in keyof OutOfScope]: Equal< OutOfScope[N]['disabled'], boolean | undefined > extends true ? never : N;
}[keyof OutOfScope];

export type assertionIndependentDeclarationsStayBoolean = Expect< Equal< Widened, never > >;

/* ── 2. Runtime: the zod mirrors accept what the interfaces now declare ──── */

const PREDICATE = '${data.status === "locked"}';

interface MirrorCase {
  name: string;
  mirror: ZodType;
  /** Minimal valid node — every required key, nothing optional. */
  fixture: Record<string, unknown>;
}

const IN_SCOPE: readonly MirrorCase[] = [
  { name: 'form.zod.ts#ButtonSchema', mirror: FormMirrors.ButtonSchema, fixture: { type: 'button' } },
  { name: 'form.zod.ts#InputSchema', mirror: FormMirrors.InputSchema, fixture: { type: 'input' } },
  { name: 'form.zod.ts#TextareaSchema', mirror: FormMirrors.TextareaSchema, fixture: { type: 'textarea' } },
  { name: 'form.zod.ts#SelectSchema', mirror: FormMirrors.SelectSchema, fixture: { type: 'select', options: [{ label: 'A', value: 'a' }] } },
  { name: 'form.zod.ts#CheckboxSchema', mirror: FormMirrors.CheckboxSchema, fixture: { type: 'checkbox' } },
  { name: 'form.zod.ts#RadioGroupSchema', mirror: FormMirrors.RadioGroupSchema, fixture: { type: 'radio-group', options: [{ label: 'A', value: 'a' }] } },
  { name: 'form.zod.ts#SwitchSchema', mirror: FormMirrors.SwitchSchema, fixture: { type: 'switch' } },
  { name: 'form.zod.ts#ToggleSchema', mirror: FormMirrors.ToggleSchema, fixture: { type: 'toggle' } },
  { name: 'form.zod.ts#SliderSchema', mirror: FormMirrors.SliderSchema, fixture: { type: 'slider' } },
  { name: 'form.zod.ts#FileUploadSchema', mirror: FormMirrors.FileUploadSchema, fixture: { type: 'file-upload' } },
  { name: 'form.zod.ts#DatePickerSchema', mirror: FormMirrors.DatePickerSchema, fixture: { type: 'date-picker' } },
  { name: 'form.zod.ts#CalendarSchema', mirror: FormMirrors.CalendarSchema, fixture: { type: 'calendar' } },
  { name: 'form.zod.ts#InputOTPSchema', mirror: FormMirrors.InputOTPSchema, fixture: { type: 'input-otp' } },
  { name: 'form.zod.ts#FormSchema', mirror: FormMirrors.FormSchema, fixture: { type: 'form', fields: [{ name: 'title', type: 'text' }] } },
  { name: 'form.zod.ts#ComboboxSchema', mirror: FormMirrors.ComboboxSchema, fixture: { type: 'combobox', options: [{ label: 'A', value: 'a' }] } },
  { name: 'crud.zod.ts#ActionSchema', mirror: ActionMirror, fixture: { type: 'action', label: 'Save' } },
  {
    name: 'disclosure.zod.ts#CollapsibleSchema',
    mirror: CollapsibleMirror,
    fixture: { type: 'collapsible', trigger: { type: 'button', label: 'More' }, content: { type: 'text', text: 'Body' } },
  },
  { name: 'disclosure.zod.ts#ToggleGroupSchema', mirror: ToggleGroupMirror, fixture: { type: 'toggle-group' } },
];

const OUT_OF_SCOPE: readonly MirrorCase[] = [
  { name: 'form.zod.ts#SelectOptionSchema', mirror: FormMirrors.SelectOptionSchema, fixture: { label: 'A', value: 'a' } },
  { name: 'form.zod.ts#RadioOptionSchema', mirror: FormMirrors.RadioOptionSchema, fixture: { label: 'A', value: 'a' } },
  { name: 'form.zod.ts#ComboboxOptionSchema', mirror: FormMirrors.ComboboxOptionSchema, fixture: { label: 'A', value: 'a' } },
  { name: 'form.zod.ts#FormFieldSchema', mirror: FormMirrors.FormFieldSchema, fixture: { name: 'title' } },
  { name: 'disclosure.zod.ts#AccordionItemSchema', mirror: AccordionItemSchema, fixture: { value: 'a', title: 'A', content: { type: 'text', text: 'Body' } } },
  { name: 'disclosure.zod.ts#ToggleGroupItemSchema', mirror: ToggleGroupItemSchema, fixture: { value: 'a', label: 'A' } },
];

const issuePaths = (r: ReturnType<ZodType['safeParse']>): string[] =>
  r.success ? [] : r.error.issues.map((issue) => issue.path.map(String).join('.'));

describe('`disabled` is the BaseSchema union on every formerly-narrowed mirror (objectui#7087)', () => {
  it('covers the 18 interfaces the ruling names, and the 6 it excludes', () => {
    // The census the ruling was made on. A mirror added to or dropped from
    // either list changes the ruling's population and must say so here.
    expect(IN_SCOPE).toHaveLength(18);
    expect(OUT_OF_SCOPE).toHaveLength(6);
  });

  it.each(IN_SCOPE)('$name: the fixture is valid on its own', ({ mirror, fixture }) => {
    // Control: the refusals below are about `disabled`, not about a fixture
    // that never parsed.
    expect(issuePaths(mirror.safeParse(fixture))).toEqual([]);
  });

  it.each(IN_SCOPE)('$name accepts a predicate string on `disabled`', ({ mirror, fixture }) => {
    const r = mirror.safeParse({ ...fixture, disabled: PREDICATE });
    expect(issuePaths(r)).toEqual([]);
    expect(r.success && (r.data as { disabled?: unknown }).disabled).toBe(PREDICATE);
  });

  it.each(IN_SCOPE)('$name accepts a predicate string on `visible` — the twin control', ({ mirror, fixture }) => {
    const r = mirror.safeParse({ ...fixture, visible: PREDICATE });
    expect(issuePaths(r)).toEqual([]);
    expect(r.success && (r.data as { visible?: unknown }).visible).toBe(PREDICATE);
  });

  it.each(IN_SCOPE)('$name still refuses a number on `disabled`', ({ mirror, fixture }) => {
    const r = mirror.safeParse({ ...fixture, disabled: 1 });
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain('disabled');
  });

  it.each(IN_SCOPE)('$name still accepts the boolean form — a widening, not a replacement', ({ mirror, fixture }) => {
    const r = mirror.safeParse({ ...fixture, disabled: true });
    expect(issuePaths(r)).toEqual([]);
    expect(r.success && (r.data as { disabled?: unknown }).disabled).toBe(true);
  });
});

describe('scope guard: the independent `disabled?: boolean` declarations are not narrowings (objectui#7087)', () => {
  it.each(OUT_OF_SCOPE)('$name: the fixture is valid on its own', ({ mirror, fixture }) => {
    expect(issuePaths(mirror.safeParse(fixture))).toEqual([]);
  });

  it.each(OUT_OF_SCOPE)('$name still refuses a string on `disabled`', ({ mirror, fixture }) => {
    const r = mirror.safeParse({ ...fixture, disabled: PREDICATE });
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain('disabled');
  });
});
