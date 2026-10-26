// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `DetailViewFieldSchema.options` is the spec's AUTHORING option schema, by
 * reference (objectui#10296, ruling F1 on objectui#7759).
 *
 * Before this card the mirror carried an inline option shape that admitted a
 * number or boolean `value` the declaration (`SelectOptionMetadata[]`) refuses,
 * and silently STRIPPED every other key. F1 rules that a structural mirror points
 * at the spec's authoring schema, ⛔ never at the declaration: the declaration here
 * is the runtime READ model, which admits `disabled` and `icon` — two keys the
 * spec refuses by name. The remaining difference between the two faces
 * (`visibleWhen`'s envelope) is recorded as an EXPECTED DIVERGENCE in the parity
 * ledgers, not repaired.
 *
 * Every refusal below is asserted on the issue `code` and the `path` it lands on,
 * each beside an accepting control, so a schema that refuses everything cannot
 * pass. On a revert to the inline shape the numeric/boolean `value` and the
 * by-name refusals turn green-to-red.
 */

import { describe, it, expect } from 'vitest';
import { SelectOptionSchema as SpecSelectOptionSchema } from '@objectstack/spec/data';
import { DetailViewFieldSchema } from '../zod/views.zod.js';

const field = (option: Record<string, unknown>) =>
  DetailViewFieldSchema.safeParse({ name: 'status', type: 'select', options: [option] });

const issuesOf = (r: ReturnType<typeof field>) =>
  r.success ? [] : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));

describe('DetailViewFieldSchema.options is the spec authoring option schema (objectui#10296)', () => {
  it('accepts an authored option carrying every spec key (accepting control)', () => {
    const r = field({
      label: 'Open',
      value: 'open',
      description: 'Not started yet',
      color: '#22c55e',
      default: true,
      visibleWhen: "record.kind == 'task'",
    });
    expect(issuesOf(r)).toEqual([]);
  });

  it.each([
    ['a number', 1],
    ['a boolean', true],
  ])('refuses %s as `value` — the spec value is a machine identifier string', (_label, value) => {
    const r = field({ label: 'One', value });
    expect(r.success).toBe(false);
    expect(issuesOf(r)).toContainEqual({ code: 'invalid_type', path: 'options.0.value' });
  });

  it.each(['icon', 'disabled'])('refuses the read-model-only key `%s` BY NAME', (key) => {
    const r = field({ label: 'Open', value: 'open', [key]: key === 'icon' ? 'circle' : true });
    expect(r.success).toBe(false);
    const issue = r.success ? undefined : r.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.path.join('.')).toBe('options.0');
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual([key]);
  });

  it.each(['Open', '1st', 'a-b', 'o'])(
    'refuses `value: %s` — the spec value is `^[a-z][a-z0-9_.]*$`, at least 2 characters',
    (value) => {
      const r = field({ label: 'Open', value });
      expect(r.success).toBe(false);
      expect(issuesOf(r).map((i) => i.path)).toContain('options.0.value');
    },
  );

  it.each(['ab', 'a.b', 'in_progress'])('accepts `value: %s` (accepting control for the rule above)', (value) => {
    expect(issuesOf(field({ label: 'Open', value }))).toEqual([]);
  });

  /**
   * OUTPUT SHAPE, declared rather than left implicit. `stripImportedDefaults`
   * removes defaults only, so the spec's expression-input PIPE survives on
   * `options[].visibleWhen`: the parsed output is the canonical envelope
   * whichever spelling was authored. One authored document therefore has two
   * input spellings and ONE output shape here. That differs from objectui's
   * own form `SelectOptionSchema`, which keeps objectui's wire and passes a
   * bare string through unchanged (objectui#7735 / #8317). The contract review
   * on objectui#10296 kept the spec's pipe (option A); these pins keep it
   * visible.
   */
  const optionOut = (visibleWhen: unknown) => {
    const r = field({ label: 'Open', value: 'open', visibleWhen });
    return r.success ? r.data.options?.[0] : r;
  };

  it('canonicalizes a bare-string `visibleWhen` to a `{ dialect: "cel", source }` envelope in OUTPUT', () => {
    expect(optionOut("record.kind == 'task'")).toEqual({
      label: 'Open',
      value: 'open',
      visibleWhen: { dialect: 'cel', source: "record.kind == 'task'" },
    });
  });

  it('passes an authored `{ dialect, source }` envelope through as the same envelope', () => {
    expect(optionOut({ dialect: 'cel', source: 'x == 1' })).toEqual({
      label: 'Open',
      value: 'open',
      visibleWhen: { dialect: 'cel', source: 'x == 1' },
    });
  });

  it('refuses an envelope without `dialect` — objectui wire spelling, not the spec envelope', () => {
    const r = field({ label: 'Open', value: 'open', visibleWhen: { source: 'x == 1' } });
    expect(r.success).toBe(false);
    expect(issuesOf(r)).toContainEqual({ code: 'invalid_union', path: 'options.0.visibleWhen' });
  });

  it('refuses an empty-string `visibleWhen`', () => {
    const r = field({ label: 'Open', value: 'open', visibleWhen: '' });
    expect(r.success).toBe(false);
    expect(issuesOf(r).map((i) => i.path)).toContain('options.0.visibleWhen');
  });

  /**
   * Flipped at the pin bump, as this row's 17.4.0 docblock instructed
   * (objectui#11073). On `@objectstack/spec` 17.4.0 a whitespace-only string
   * was ACCEPTED and canonicalized; 17.5.0 moved `visibleWhen` to
   * `EvaluatedExpressionInputSchema`, whose string arm refuses a blank string.
   * The mirror reads the spec by reference, so it refuses it too.
   */
  it('refuses a whitespace-only `visibleWhen` (spec 17.5.0 and later)', () => {
    const r = field({ label: 'Open', value: 'open', visibleWhen: '   ' });
    expect(r.success).toBe(false);
    expect(issuesOf(r)).toContainEqual({ code: 'invalid_union', path: 'options.0.visibleWhen' });
  });

  /**
   * The former TRIPWIRE for the spec-version gate `SpecEnvelopeAdmitsSourceless`,
   * retired at the pin bump as it instructed (objectui#11073). On
   * `@objectstack/spec` 17.4.0 the envelope's `source` was OPTIONAL and `ast`
   * alone satisfied its refine, so a source-less envelope parsed and
   * `options` and its two containers were ledgered WIDER. 17.5.0 requires a
   * non-blank `source`, so the envelope is refused: the gated rows, their
   * `WIDER_ARMS` entries and the gate are gone from `zod-mirror-parity.test.ts`.
   */
  it('refuses a source-less `{ dialect, ast }` envelope (spec 17.5.0 and later)', () => {
    const r = field({ label: 'Open', value: 'open', visibleWhen: { dialect: 'cel', ast: { kind: 'ident' } } });
    expect(r.success).toBe(false);
    expect(issuesOf(r)).toContainEqual({ code: 'invalid_union', path: 'options.0.visibleWhen' });
  });

  it('gives the same verdict as the spec schema itself, over a spread of options', () => {
    const samples: Record<string, unknown>[] = [
      { label: 'Open', value: 'open' },
      { label: 'Open', value: 'Open' },
      { label: 'Open', value: 'o' },
      { label: 'Open', value: 'in_progress', color: 'blue' },
      { value: 'open' },
      { label: 'Open', value: 'open', stray: 1 },
    ];
    for (const option of samples) {
      expect(field(option).success, JSON.stringify(option))
        .toBe(SpecSelectOptionSchema.safeParse(option).success);
    }
  });
});
