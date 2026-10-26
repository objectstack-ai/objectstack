/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25926 — `BaseSchema.visibleOn` / `hiddenOn` / `disabledOn` are
 * RETIRED. Each is a NAMED ALIAS REFUSAL on the zod mirror pointing at the one
 * spelling that survives (`visibleWhen` / `hidden` / `disabled`), and a
 * `?: never` tombstone on the TypeScript face.
 *
 * ## The defect (measured on the base before this change)
 *
 * `BaseSchemaCore` is `.passthrough()`, and the three `On` keys were declared
 * members, so `{ type, visibleOn: 'x' }` parsed GREEN on every face, and the
 * renderer honoured it as a fourth / fifth / second spelling of a predicate it
 * already evaluates under another name. `@objectstack/spec` declares exactly
 * one conditional-visibility predicate at every layer, `visibleWhen`
 * (ADR-0089), and never a `*On` suffix on a node; the `On` family was
 * objectui's own dialect, the N-dialects hazard of AGENTS.md #0.1.
 *
 * ## The shape (the `chartType` → `type` precedent, same primitive)
 *
 * `aliasKeyRefusal()` (`../zod/tombstone.zod.ts`): `z.never({ error }).optional()`
 * with the SAME string as `.describe()`, so the issue an author reads and the
 * metadata a tool reads cannot drift. A `z.input` of `undefined` is what the
 * `?: never` twin declares, so the pair does not drift either.
 *
 * ## Predictions, written before the first run (red-first)
 *
 * On the base: every `refuses` case is red (`success: true`, key kept by the
 * passthrough); the `.describe()` cases are red (no description); the `Eq`
 * lines are `tsc` errors (the faces declared `string | …`). The CONTROLS —
 * the canonical keys parse, absence parses — are GREEN before and after.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { BaseSchema } from '../base';
import { BaseSchema as Mirror } from '../zod/base.zod';
import { AnyComponentSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** alias → the spelling the remedy points at. */
const RETIRED = [
  ['visibleOn', 'visibleWhen'],
  ['hiddenOn', 'hidden'],
  ['disabledOn', 'disabled'],
] as const;

type Issue = { code: string; path: string; message: string };
/** `null` when the document parses on the mirror; the issues otherwise. */
const issuesOf = (input: unknown): Issue[] | null => {
  const r = Mirror.safeParse(input);
  return r.success ? null : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
};

const shapeOf = (schema: unknown): Record<string, { description?: string }> =>
  (schema as { shape: Record<string, { description?: string }> }).shape;

/* ── Type level (judged by `tsc -p tsconfig.test.json`) ───────────────────── */

// The TypeScript face is a tombstone: the only value assignable is `undefined`.
export const _visibleOnIsNever: Eq<BaseSchema['visibleOn'], undefined> = true;
export const _hiddenOnIsNever: Eq<BaseSchema['hiddenOn'], undefined> = true;
export const _disabledOnIsNever: Eq<BaseSchema['disabledOn'], undefined> = true;

// The canonical spellings stay authorable on a node literal, no cast.
export const canonicalSpellings: BaseSchema = {
  type: 'test-component',
  visibleWhen: "record.status == 'open'",
  hidden: 'data.archived',
  disabled: { dialect: 'cel', source: 'data.readOnly' },
};

/* ── (a) refused by name, at its own path, with the remedy ────────────────── */

describe.each(RETIRED)('objectstack#25926 — `%s` is REFUSED by name on `BaseSchema` (it parsed green on the base)', (alias, canonical) => {
  it('refuses with one issue, `invalid_type` at the key', () => {
    const issues = issuesOf({ type: 'test-component', [alias]: 'data.ok' });
    expect(issues).not.toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues![0]).toMatchObject({ code: 'invalid_type', path: alias });
  });

  it('the message names the key, points at the canonical spelling, and says the value is unchanged', () => {
    const [issue] = issuesOf({ type: 'test-component', [alias]: 'data.ok' })!;
    expect(issue.message).toContain(`Did you mean \`${alias}\` → \`${canonical}\`?`);
    expect(issue.message).toContain('retired');
    expect(issue.message).toContain('same polarity');
    expect(issue.message).toContain('Rename the key; the value is unchanged.');
  });

  it.each(['data.ok', '${data.ok}', true, false, { dialect: 'cel', source: 'true' }, null, 0])(
    'every value is refused (%j) — the refusal is about the KEY, not a value domain',
    (value) => {
      const issues = issuesOf({ type: 'test-component', [alias]: value });
      expect(issues?.map((i) => i.path)).toEqual([alias]);
    },
  );

  it('ONE string feeds both channels — the issue message IS the `.describe()` metadata', () => {
    const [issue] = issuesOf({ type: 'test-component', [alias]: 'data.ok' })!;
    expect(shapeOf(Mirror)[alias]?.description).toBe(issue.message);
  });

  it('both spellings written → refused at the retired key alone; the canonical value is neither overwritten nor dropped', () => {
    const issues = issuesOf({ type: 'test-component', [canonical]: 'data.a', [alias]: 'data.b' });
    expect(issues?.map((i) => i.path)).toEqual([alias]);
  });

  it(`CONTROL — \`${canonical}\` alone parses, and the value survives the parse unchanged`, () => {
    const r = Mirror.safeParse({ type: 'test-component', [canonical]: 'data.a' });
    expect(r.success).toBe(true);
    expect((r as { data: Record<string, unknown> }).data[canonical]).toBe('data.a');
  });

  it('the arm\'s input type is exactly `undefined` — what the `?: never` twin declares', () => {
    type ArmInput = z.input<typeof Mirror>[typeof alias];
    const armIsUndefined: Eq<ArmInput, undefined> = true;
    expect(armIsUndefined).toBe(true);
  });
});

/* ── (b) the document faces answer the same way ───────────────────────────── */

describe('objectstack#25926 — the document faces refuse the retired spellings too', () => {
  const node = { type: 'text', content: 'Open' };

  it.each(RETIRED)('`AnyComponentSchema` refuses `%s` at its own path', (alias) => {
    const r = AnyComponentSchema.safeParse({ ...node, [alias]: 'data.ok' });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toContain(alias);
  });

  it.each(RETIRED)('`StrictAnyComponentSchema` (the `objectui validate` face) refuses `%s` with the remedy', (alias, canonical) => {
    const r = StrictAnyComponentSchema.safeParse({ ...node, [alias]: 'data.ok' });
    expect(r.success).toBe(false);
    const messages = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages.join('\n')).toContain(`Did you mean \`${alias}\` → \`${canonical}\`?`);
  });

  it('CONTROL — the same node spelled canonically parses on both faces', () => {
    const canonical = { ...node, visibleWhen: 'data.a', hidden: 'data.b', disabled: 'data.c' };
    expect(AnyComponentSchema.safeParse(canonical).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(canonical).success).toBe(true);
  });
});
