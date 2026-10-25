// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `BaseSchema.visibleWhen` is the spec's evaluated-slot INPUT, by reference, on
 * both faces (objectui#8347, ruled Q6 = B).
 *
 * `@objectstack/spec` types every evaluated `visibleWhen` it declares,
 * `PageComponentSchema`'s included, as `EvaluatedExpressionInputSchema`: a
 * predicate string, or a `{ dialect, source }` envelope whose dialect is
 * `cel` / `cron` / `template` and whose `source` is not blank. Its parse
 * rewrites a string into the envelope, so a spec-parsed component carries the
 * envelope here, and `SchemaRenderer` evaluates it. Both faces of this key read
 * `string` before, so the envelope a spec parse produces was refused on the zod
 * face and was not assignable on the TypeScript face.
 *
 * ## What is pinned
 *
 *   - TYPE level (judged by `tsc -p tsconfig.test.json`): the TypeScript face
 *     IS the spec's `EvaluatedExpressionInput`, with nothing restated, and both
 *     the string and the envelope are authorable on a node literal.
 *   - RUNTIME: the zod twin returns the spec's verdict on every probe value,
 *     AND it does not take the spec's transform — a string parses to the same
 *     string. The probe set's controls are the spec schema itself, read on the
 *     same values in the same run.
 *
 * ⚠️ The envelope here is NARROWER than `ExpressionWire`, the wire `visible` /
 * `hidden` / `disabled` carry (objectui#7530): a dialect-less envelope and an
 * unknown dialect are refused on this key, because the spec refuses them.
 */

import { describe, it, expect } from 'vitest';
import {
  EvaluatedExpressionInputSchema as SpecEvaluatedExpressionInputSchema,
  type EvaluatedExpressionInput,
} from '@objectstack/spec/shared';
import { PageComponentSchema as SpecPageComponentSchema } from '@objectstack/spec/ui';
import type { BaseSchema } from '../base';
import { BaseSchema as Mirror } from '../zod/base.zod';
import { AnyComponentSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';

/* ── Type level ───────────────────────────────────────────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// By reference: the member IS the spec's input type. A local restatement that
// drifted from the spec (a dialect added, `source` made optional) turns this red.
export type _VisibleWhenIsTheSpecInput = Expect<Equal<NonNullable<BaseSchema['visibleWhen']>, EvaluatedExpressionInput>>;

export const stringPredicateIsAuthorable: BaseSchema = { type: 'test-component', visibleWhen: "record.status == 'open'" };
export const envelopeIsAuthorable: BaseSchema = {
  type: 'test-component',
  visibleWhen: { dialect: 'cel', source: "record.status == 'open'" },
};
export const dialectlessEnvelopeIsRefused: BaseSchema = {
  type: 'test-component',
  // @ts-expect-error the spec's envelope requires `dialect`; `ExpressionWire`'s optional one does not reach this key
  visibleWhen: { source: "record.status == 'open'" },
};

/* ── Runtime ──────────────────────────────────────────────────────────────── */

const ENVELOPE = { dialect: 'cel', source: "record.status == 'open'" };

const PROBES: Array<{ label: string; value: unknown }> = [
  { label: 'a predicate string', value: "record.status == 'open'" },
  { label: 'a template string', value: "${data.role === 'admin'}" },
  { label: 'a cel envelope', value: ENVELOPE },
  { label: 'a template envelope', value: { dialect: 'template', source: '${data.ready}' } },
  { label: 'an envelope with meta', value: { dialect: 'cel', source: 'true', meta: { rationale: 'why' } } },
  { label: 'a blank string', value: '   ' },
  { label: 'an empty string', value: '' },
  { label: 'a dialect-less envelope', value: { source: "record.status == 'open'" } },
  { label: 'an unknown dialect', value: { dialect: 'sql', source: 'x' } },
  { label: 'an envelope with a blank source', value: { dialect: 'cel', source: '  ' } },
  { label: 'an ast-only envelope', value: { dialect: 'cel', ast: {} } },
  { label: 'a number', value: 42 },
  { label: 'a boolean', value: true },
];

const mirrorVerdict = (value: unknown) => Mirror.safeParse({ type: 'test-component', visibleWhen: value });

describe('BaseSchema.visibleWhen is the spec\'s evaluated-slot input on the zod face (objectui#8347)', () => {
  it('the probe set reads both verdicts on the spec schema itself (lit control)', () => {
    const verdicts = PROBES.map(({ value }) => SpecEvaluatedExpressionInputSchema.safeParse(value).success);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it.each(PROBES)('$label: the mirror answers what the spec answers', ({ value }) => {
    expect(mirrorVerdict(value).success).toBe(SpecEvaluatedExpressionInputSchema.safeParse(value).success);
  });

  it('…and what `PageComponentSchema.visibleWhen` answers, the key this one mirrors', () => {
    for (const { value } of PROBES) {
      const spec = SpecPageComponentSchema.safeParse({ type: 'element:text', visibleWhen: value });
      const specIssueAtKey = spec.success ? false : spec.error.issues.some((i) => i.path[0] === 'visibleWhen');
      expect(mirrorVerdict(value).success, JSON.stringify(value)).toBe(!specIssueAtKey);
    }
  });

  it('a blank predicate string is refused with the spec\'s own sentence', () => {
    const mine = mirrorVerdict('   ');
    const spec = SpecEvaluatedExpressionInputSchema.safeParse('   ');
    expect(mine.success).toBe(false);
    expect(spec.success).toBe(false);
    if (mine.success || spec.success) return;
    expect(mine.error.issues.map((i) => i.message)).toEqual(spec.error.issues.map((i) => i.message));
  });

  it('does NOT take the spec\'s transform: a string parses to the same string', () => {
    const predicate = "record.status == 'open'";
    // The spec rewrites it — the control that the transform exists.
    expect(SpecEvaluatedExpressionInputSchema.parse(predicate)).toEqual({ dialect: 'cel', source: predicate });
    const mine = mirrorVerdict(predicate);
    expect(mine.success).toBe(true);
    if (!mine.success) return;
    expect(mine.data.visibleWhen).toBe(predicate);
  });

  it('an envelope parses to the same envelope', () => {
    const mine = mirrorVerdict(ENVELOPE);
    expect(mine.success).toBe(true);
    if (!mine.success) return;
    expect(mine.data.visibleWhen).toEqual(ENVELOPE);
  });

  it('the envelope a spec parse writes is accepted by both component faces', () => {
    const parsed = SpecEvaluatedExpressionInputSchema.parse("record.status == 'open'");
    const node = { type: 'text', content: 'Open', visibleWhen: parsed };
    expect(AnyComponentSchema.safeParse(node).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(node).success).toBe(true);
    // Control: the same node with a dialect-less envelope is refused at the key.
    const refused = StrictAnyComponentSchema.safeParse({ ...node, visibleWhen: { source: 'x' } });
    expect(refused.success).toBe(false);
  });
});
