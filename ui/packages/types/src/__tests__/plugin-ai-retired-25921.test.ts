/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The three `@object-ui/plugin-ai` NODE TYPES are retired with their package,
 * and a document naming one is refused BY NAME, with its remedy
 * (objectstack#25921, ruling A).
 *
 * The package registered `ai-form-assist`, `ai-recommendations` and `nl-query`,
 * and nothing loaded it: the console registered it neither eagerly nor lazily
 * and no workspace package imported it. The literals were declared on both
 * faces, so the retirement keeps a `retiredNodeType()` arm for each in
 * `AnyComponentSchema` — the shape `cloud-plan-status-retired-12954.test.ts`
 * pins, whose suites this file follows — and the published mirror NAMES stay as
 * `@deprecated` `never` tombstones until objectstack#25912's sunset rule.
 *
 * Suite 1 measures the named refusal; suite 2 its firing control; suite 3 that
 * an unknown literal still takes the generic path; suite 4 that the published
 * zod names accept nothing.
 */

import { describe, it, expect } from 'vitest';
import * as ZodFace from '../zod/index.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type { AnySchema, AIFormAssistSchema, AIRecommendationsSchema, NLQuerySchema } from '../index';

/* -------------------------------------------------------------------------- */
/* Compile-time pins — read by tsc -p tsconfig.test.json, not by vitest.       */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;

// The TypeScript half: `AnySchema` has no member for any of the three literals.
type _NoFormAssistArm = Assert<Equal<IsNever<Extract<AnySchema, { type: 'ai-form-assist' }>>, true>>;
type _NoRecommendationsArm = Assert<Equal<IsNever<Extract<AnySchema, { type: 'ai-recommendations' }>>, true>>;
type _NoNLQueryArm = Assert<Equal<IsNever<Extract<AnySchema, { type: 'nl-query' }>>, true>>;
// Non-vacuity on the same instrument: a surviving arm IS selectable.
type _KeepsButton = Assert<Equal<IsNever<Extract<AnySchema, { type: 'button' }>>, false>>;

// The published names are `never` tombstones: still importable, assignable from nothing.
type _FormAssistIsNever = Assert<IsNever<AIFormAssistSchema>>;
type _RecommendationsIsNever = Assert<IsNever<AIRecommendationsSchema>>;
type _NLQueryIsNever = Assert<IsNever<NLQuerySchema>>;

// @ts-expect-error objectstack#25921 — a node literal annotated with a retired name is refused at the authoring site.
const _authored: AIFormAssistSchema = { type: 'ai-form-assist' };
void _authored;

/* -------------------------------------------------------------------------- */
/* Runtime — through `safeValidateSchema`, the tolerant node union.           */
/* -------------------------------------------------------------------------- */

interface IssueLike {
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
  readonly code?: string;
  readonly errors?: readonly (readonly IssueLike[])[];
}

/** Flatten zod's nested union issues into `{ path, message, code }` rows. */
function flattenIssues(issues: readonly IssueLike[]): Array<{ path: string; message: string; code: string }> {
  return issues.flatMap((issue) => [
    { path: (issue.path ?? []).join('.'), message: issue.message ?? '', code: issue.code ?? '' },
    ...(issue.errors ?? []).flatMap((nested) => flattenIssues(nested)),
  ]);
}

function refusals(schema: unknown) {
  const result = safeValidateSchema(schema);
  return result.success ? [] : flattenIssues(result.error.issues as unknown as IssueLike[]);
}

/** One document per retired literal, each in a shape its old arm accepted. */
const RETIRED_NODES = [
  { type: 'ai-form-assist', suggestions: [], showConfidence: true },
  { type: 'ai-recommendations', recommendations: [], layout: 'grid' },
  { type: 'nl-query', placeholder: 'Ask anything', showHistory: false },
] as const;

describe('suite 1 — each retired literal is REFUSED, by name (objectstack#25921)', () => {
  it.each(RETIRED_NODES)('refuses `$type` with one `custom` issue at `type`', (node) => {
    expect(refusals(node).filter((f) => f.code === 'custom' && f.path === 'type')).toHaveLength(1);
  });

  it.each(RETIRED_NODES)('the `$type` refusal names the retirement and the remedy', (node) => {
    const [issue] = refusals(node).filter((f) => f.code === 'custom' && f.path === 'type');
    expect(issue?.message).toContain(`\`${node.type}\` is a RETIRED node type`);
    expect(issue?.message).toContain('@object-ui/plugin-ai');
    expect(issue?.message).toContain('Remove the node from the page');
    // Runtime refusal prose carries no tracker number (root AGENTS.md).
    expect(issue?.message).not.toMatch(/#\d/);
  });
});

describe('suite 2 — the refusal is not a validator that turned strict', () => {
  it('a surviving node on the same call is still accepted', () => {
    expect(refusals({ type: 'button', label: 'Save' })).toEqual([]);
  });
});

describe('suite 3 — control: an unknown literal takes the GENERIC path', () => {
  it('a name no arm claims is refused without the remedy text', () => {
    const found = refusals({ type: 'ai-no-such-node-25921' });
    const text = found.map((r) => r.message).join('\n');
    expect(text).not.toEqual('');
    expect(found.some((f) => f.code === 'custom')).toBe(false);
    expect(text).not.toContain('@object-ui/plugin-ai');
  });
});

describe('suite 4 — the published zod names are `never` tombstones', () => {
  const NAMES = [
    'AIConfigSchema',
    'AIFieldSuggestionSchema',
    'AIFormAssistSchema',
    'AIRecommendationItemSchema',
    'AIRecommendationsSchema',
    'NLQueryResultSchema',
    'NLQuerySchema',
    'AIComponentSchema',
  ] as const;

  it.each(NAMES)('`%s` is still exported, and accepts nothing — the message names the retirement', (name) => {
    const schema = (ZodFace as Record<string, unknown>)[name] as { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } };
    expect(schema, name).toBeDefined();
    for (const value of [{}, { type: 'ai-form-assist' }, 'x']) {
      const result = schema.safeParse(value);
      expect(result.success).toBe(false);
      const message = result.error?.issues[0]?.message;
      expect(message).toContain(`\`${name}\` mirrored a node type of \`@object-ui/plugin-ai\`, which retired`);
      expect(message).toContain('Remove the reference');
      expect(message).not.toMatch(/#\d/);
    }
  });

  it('the refusal arms themselves are NOT on the barrel (nothing outside this package parses against one)', () => {
    for (const name of ['RetiredAIFormAssistNodeSchema', 'RetiredAIRecommendationsNodeSchema', 'RetiredNLQueryNodeSchema']) {
      expect(name in ZodFace, name).toBe(false);
    }
    // Lit control: the same probe answers yes for a name the barrel does carry.
    expect('AnyComponentSchema' in ZodFace).toBe(true);
  });
});
