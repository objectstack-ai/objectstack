// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `CronExpressionInputSchema` / `TemplateExpressionInputSchema` — a TYPED slot
 * fixes its dialect on BOTH arms (#15028), and refuses a blank string the way
 * `EvaluatedExpressionSchema` does (#15035, the census's correction).
 *
 * Before: the envelope arm was the unrestricted `ExpressionSchema`, so a cron
 * slot parsed `{ dialect: 'cel', source }` green and whatever read it received
 * an envelope it could not run; and the string arm's `.min(1)` did not trim,
 * so `'   '` normalized to `{ dialect: 'cron', source: '   ' }` on all twelve
 * typed positions. Both were copy-paste artifacts of the untyped schema, never
 * a decision; the narrowing refuses zero measured author values (32 cron, 14
 * template — the #15035 census).
 *
 * Every refusal pin asserts the issue's `code`, `path` and message — never
 * `success === false` alone — and that it is the ONLY top-level issue. The
 * deliberate NON-verdict is pinned alongside: cron / template SYNTAX is still
 * not judged at parse time (`'not a cron'` normalizes), because no grammar is
 * restated in spec — `croner` judges the one wired slot where it is scheduled.
 * The control is the persistence contract itself: `ExpressionSchema` still
 * accepts every declared dialect, because it was not narrowed.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ObjectStackDefinitionSchema } from '../stack.zod.js';
import {
  CronExpressionInputSchema,
  ExpressionSchema,
  TemplateExpressionInputSchema,
  TYPED_EXPRESSION_DIALECT_ONLY,
  TYPED_EXPRESSION_SOURCE_REQUIRED,
  type CronExpressionInput,
  type TemplateExpressionInput,
  type TypedExpressionDialect,
} from './expression.zod.js';

const NEITHER_SOURCE_NOR_AST = 'Expression requires at least one of `source` or `ast`';

/** Parse `value` in a slot named `slot`, so the path is the slot's own. */
function slotIssues(schema: z.ZodType, value: unknown) {
  const result = z.object({ slot: schema.optional() }).safeParse({ slot: value });
  return result.success
    ? []
    : result.error.issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.'), message: i.message }));
}

function slotValue(schema: z.ZodType, value: unknown): unknown {
  const result = z.object({ slot: schema.optional() }).safeParse({ slot: value });
  expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  return result.success ? (result.data as { slot: unknown }).slot : undefined;
}

const TYPED: ReadonlyArray<{
  dialect: TypedExpressionDialect;
  schema: z.ZodType;
  good: string;
  unjudged: string;
  foreign: readonly ['cel', 'template'] | readonly ['cel', 'cron'];
}> = [
  { dialect: 'cron', schema: CronExpressionInputSchema, good: '0 9 * * 1-5', unjudged: 'not a cron', foreign: ['cel', 'template'] },
  { dialect: 'template', schema: TemplateExpressionInputSchema, good: '{{record.name}}', unjudged: 'not a template {{{', foreign: ['cel', 'cron'] },
];

describe.each(TYPED)('$dialect-typed slot — the dialect is fixed on both arms, and blank is refused (#15028 / #15035)', ({ dialect, schema, good, unjudged, foreign }) => {
  const dialectOnly = TYPED_EXPRESSION_DIALECT_ONLY[dialect];
  const sourceRequired = TYPED_EXPRESSION_SOURCE_REQUIRED[dialect];

  it('ACCEPTS a bare string and normalizes it to its own dialect', () => {
    expect(slotValue(schema, good)).toEqual({ dialect, source: good });
    // Surrounding whitespace is authored, not blank — the notion of blank is `.trim()`, and the source is kept as written.
    expect(slotValue(schema, `  ${good}  `)).toEqual({ dialect, source: `  ${good}  ` });
  });

  it('ACCEPTS a same-dialect envelope verbatim, authorship metadata included', () => {
    const envelope = { dialect, source: good, meta: { rationale: 'r', generatedBy: 'test' } };
    expect(slotValue(schema, envelope)).toEqual(envelope);
  });

  it('still ACCEPTS an `ast`-only envelope of its own dialect — a typed slot persists, it is not an evaluated slot', () => {
    const envelope = { dialect, ast: { kind: 'const' } };
    expect(slotValue(schema, envelope)).toEqual(envelope);
  });

  it.each(foreign)('REFUSES a `%s` envelope: one `invalid_union` at the slot, the dialect-only sentence', (other) => {
    expect(slotIssues(schema, { dialect: other, source: good })).toEqual([
      { code: 'invalid_union', path: 'slot', message: dialectOnly },
    ]);
  });

  it('REFUSES an envelope naming a dialect the protocol does not declare (`js`), with the same named issue', () => {
    expect(slotIssues(schema, { dialect: 'js', source: 'x' })).toEqual([
      { code: 'invalid_union', path: 'slot', message: dialectOnly },
    ]);
  });

  it('REFUSES a value that is neither a string nor an envelope, with the dialect-only sentence', () => {
    expect(slotIssues(schema, 42)).toEqual([{ code: 'invalid_union', path: 'slot', message: dialectOnly }]);
    expect(slotIssues(schema, { source: good })).toEqual([{ code: 'invalid_union', path: 'slot', message: dialectOnly }]);
  });

  it.each([
    ['the empty string', ''],
    ['three spaces', '   '],
    ['a tab and a newline', '\t\n'],
  ])('REFUSES a blank string (%s): one `invalid_union` at the slot, the source-required sentence', (_label, blank) => {
    expect(slotIssues(schema, blank)).toEqual([{ code: 'invalid_union', path: 'slot', message: sourceRequired }]);
  });

  it('KEEPS the refusal `ExpressionSchema` carries — an envelope with neither `source` nor `ast` — under its own message', () => {
    expect(slotIssues(schema, { dialect })).toEqual([{ code: 'custom', path: 'slot', message: NEITHER_SOURCE_NOR_AST }]);
  });

  it('does NOT judge syntax at parse time — the deliberate non-verdict: no grammar is restated in spec', () => {
    expect(slotValue(schema, unjudged)).toEqual({ dialect, source: unjudged });
  });

  it('the two sentences name the dialect in their first sentence and quote the fix', () => {
    for (const sentence of [dialectOnly, sourceRequired]) {
      expect(sentence.startsWith(`A ${dialect}-typed slot`)).toBe(true);
      expect(sentence).toContain(`dialect: '${dialect}'`);
      expect(sentence).toContain(`{ dialect: '${dialect}', source: '${good}' }`);
    }
    expect(dialectOnly).not.toBe(sourceRequired);
  });
});

describe('controls and the author-facing type', () => {
  it('control: `ExpressionSchema` itself was NOT narrowed — every declared dialect still parses as an envelope', () => {
    for (const dialect of ['cel', 'cron', 'template']) {
      expect(ExpressionSchema.safeParse({ dialect, source: 'x' }).success).toBe(true);
    }
  });

  it('the cron sentences say no cron syntax is judged here and name who judges it', () => {
    expect(TYPED_EXPRESSION_SOURCE_REQUIRED.cron).toContain('no cron syntax is judged here');
    expect(TYPED_EXPRESSION_SOURCE_REQUIRED.cron).toContain('`croner`');
  });

  it('narrows the author TYPE too: a foreign-dialect envelope is a compile error before it is a parse error', () => {
    const cronOk: CronExpressionInput = { dialect: 'cron', source: '0 9 * * *' };
    // @ts-expect-error — `cel` is not a cron-typed slot's dialect.
    const cronBad: CronExpressionInput = { dialect: 'cel', source: 'now()' };
    const templateOk: TemplateExpressionInput = { dialect: 'template', source: '{{x}}' };
    // @ts-expect-error — `cron` is not a template-typed slot's dialect.
    const templateBad: TemplateExpressionInput = { dialect: 'cron', source: '0 9 * * *' };
    const bare: CronExpressionInput = '0 9 * * *';
    expect([cronOk, cronBad, templateOk, templateBad, bare]).toHaveLength(5);
  });
});

/**
 * Through the stack: the three typed positions a `defineStack` manifest can
 * reach (`jobs[].schedule.expression`, `connectors[].syncConfig.schedule`,
 * `objects[].titleFormat`) refuse at the named path via
 * `ObjectStackDefinitionSchema` — the choke point `os validate` parses through.
 */
describe('through `ObjectStackDefinitionSchema` — the stack-reachable typed slots refuse at the named path', () => {
  const manifest = { id: 'com.example.typed', name: 'typed-slots', version: '1.0.0', type: 'app' as const };
  const job = (expression: unknown) => ({ name: 'nightly', schedule: { type: 'cron' as const, expression }, handler: 'nightly' });
  const connector = (schedule: unknown) => ({ name: 'sap', label: 'SAP', type: 'saas' as const, syncConfig: { schedule } });
  const object = (titleFormat: unknown) => ({ name: 'thing', fields: { name: { type: 'text' as const } }, titleFormat });

  function stackIssues(stack: unknown) {
    const result = ObjectStackDefinitionSchema.safeParse(stack);
    return result.success
      ? []
      : result.error.issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.'), message: i.message }));
  }

  it('control: the same stack with a bare string in every typed slot parses green and normalizes each to its envelope', () => {
    const result = ObjectStackDefinitionSchema.safeParse({
      manifest, jobs: [job('0 1 * * *')], connectors: [connector('*/15 * * * *')], objects: [object('{{record.name}}')],
    });
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
    if (!result.success) return;
    expect(result.data.jobs?.[0]?.schedule).toMatchObject({ expression: { dialect: 'cron', source: '0 1 * * *' } });
    expect(result.data.connectors?.[0]?.syncConfig?.schedule).toEqual({ dialect: 'cron', source: '*/15 * * * *' });
    expect(result.data.objects?.[0]?.titleFormat).toEqual({ dialect: 'template', source: '{{record.name}}' });
  });

  it('`jobs[].schedule.expression` refuses a `cel` envelope at `jobs.0.schedule.expression`', () => {
    expect(stackIssues({ manifest, jobs: [job({ dialect: 'cel', source: 'now()' })] })).toEqual([
      { code: 'invalid_union', path: 'jobs.0.schedule.expression', message: TYPED_EXPRESSION_DIALECT_ONLY.cron },
    ]);
  });

  it('`jobs[].schedule.expression` refuses a blank string at `jobs.0.schedule.expression`', () => {
    expect(stackIssues({ manifest, jobs: [job('   ')] })).toEqual([
      { code: 'invalid_union', path: 'jobs.0.schedule.expression', message: TYPED_EXPRESSION_SOURCE_REQUIRED.cron },
    ]);
  });

  it('`connectors[].syncConfig.schedule` refuses a `template` envelope at `connectors.0.syncConfig.schedule`', () => {
    expect(stackIssues({ manifest, connectors: [connector({ dialect: 'template', source: '{{x}}' })] })).toEqual([
      { code: 'invalid_union', path: 'connectors.0.syncConfig.schedule', message: TYPED_EXPRESSION_DIALECT_ONLY.cron },
    ]);
  });

  it('`objects[].titleFormat` refuses a `cron` envelope at `objects.0.titleFormat`', () => {
    expect(stackIssues({ manifest, objects: [object({ dialect: 'cron', source: '0 9 * * *' })] })).toEqual([
      { code: 'invalid_union', path: 'objects.0.titleFormat', message: TYPED_EXPRESSION_DIALECT_ONLY.template },
    ]);
  });

  it('the deliberate non-verdict holds through the stack: `\'not a cron\'` in a job schedule parses green', () => {
    const result = ObjectStackDefinitionSchema.safeParse({ manifest, jobs: [job('not a cron')] });
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });
});
