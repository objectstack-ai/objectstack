// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8318] The union-branch selection policy has ONE implementation, and the two
 * walks that import it reach the SAME verdict on the same value.
 *
 * ## Why this file exists
 *
 * `shared/error-map.zod.ts` (the prose renderer, #4971/#5389) and
 * `api/zod-issues-to-fields.ts` (the ADR-0114 D3 wire mapper, #8124) used to
 * carry two copies of the ranking, the two limits and `CONTAINER_ISSUE_CODES`.
 * Nothing mechanical held them together: each module header asked whoever edits
 * one to edit the other in the same PR, and that was the whole enforcement.
 * #8318 extracted the policy into `./union-branch-policy.ts`; this file is the
 * enforcement the headers lacked.
 *
 * It is deliberately an END-TO-END comparison rather than a unit test of the
 * extracted module. A unit test would pass trivially — there is one
 * implementation now, so it agrees with itself. What can still regress is a
 * future author re-inlining a copy into one walk to tune its output, which is
 * exactly what the corpus below catches: both walks are driven from ONE
 * `safeParse` per fixture, and their outputs are compared after a normalisation
 * that removes formatting and nothing else.
 *
 * ## What "byte-identical" means here, precisely
 *
 * The two walks emit different things on purpose — indented `✗ path: message`
 * prose vs `{field, code, message}` entries — so the comparable projection is
 * the ordered list of `(path, message)` pairs each one visited. The
 * normalisation below removes exactly three formatting facts and asserts the
 * only deliberate asymmetry rather than hiding it:
 *
 * 1. the renderer's indent and `✗` glyph;
 * 2. its `(root)` spelling of the empty path, which the wire writes as `''`;
 * 3. its trailing "… and N more branches rejected this value" line, which the
 *    wire deliberately omits (a `fields[]` entry must name a real field and
 *    carry a catalog code; an omission count has neither). §4 pins that this
 *    line is present on the prose side and absent on the wire side for a capped
 *    fixture — the asymmetry is asserted, not normalised away silently.
 *
 * Everything else — which branches were selected, in which order, with which
 * messages, to which depth — must match pair for pair.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatZodIssue } from './error-map.zod';
import { zodIssuesToFields } from '../api/zod-issues-to-fields';
import {
  CONTAINER_ISSUE_CODES,
  NESTED_EXPANSION_DEPTH_LIMIT,
  UNION_BRANCH_SELECTION_LIMIT,
  selectUnionBranches,
} from './union-branch-policy';
import * as SharedBarrel from './index';
import * as ApiBarrel from '../api/index';

/** `(path, message)` — the projection both walks can be read as producing. */
type Visited = { path: string; message: string };

/** The prose renderer's output, normalised to {@link Visited} pairs. */
function renderedPairs(issues: readonly unknown[]): Visited[] {
  return issues
    .flatMap((issue) => formatZodIssue(issue as never).split('\n'))
    .filter((line) => line.includes('✗'))
    .map((line) => {
      const body = line.slice(line.indexOf('✗') + 1).trimStart();
      const split = body.indexOf(': ');
      const path = body.slice(0, split);
      return {
        // `(root)` is the CLI's spelling of the empty path; the wire writes ''.
        path: path === '(root)' ? '' : path,
        message: body.slice(split + 2),
      };
    });
}

/** The wire mapper's output, normalised to {@link Visited} pairs. */
function wirePairs(issues: readonly unknown[], input: unknown): Visited[] {
  return zodIssuesToFields(issues, input).map((entry) => ({
    field: entry.field,
    message: entry.message,
  })).map(({ field, message }) => ({ path: field, message }));
}

/** Every renderer line, including the ones §4 asserts are prose-only. */
function renderedLines(issues: readonly unknown[]): string[] {
  return issues.flatMap((issue) => formatZodIssue(issue as never).split('\n'));
}

/** Parse, assert the fixture really fails, and hand both walks one issue list. */
function issuesFor(schema: { safeParse: (v: unknown) => any }, value: unknown): readonly unknown[] {
  const result = schema.safeParse(value);
  expect(result.success, 'every parity fixture must actually fail to parse').toBe(false);
  return result.error.issues as readonly unknown[];
}

// ---------------------------------------------------------------------------
// The corpus. One fixture per rule of the policy, plus the container descent
// (#5389) both walks share and the junk shapes the wire has always tolerated.
// ---------------------------------------------------------------------------

/** A strict object member requiring exactly one key. */
const member = (key: string) => z.object({ [key]: z.string() }).strict();

/** A union nested `depth` levels deep, to drive the expansion limit. */
function nestedUnion(depth: number): z.ZodTypeAny {
  if (depth === 0) return z.object({ leaf: z.string() }).strict();
  return z.union([
    z.object({ next: nestedUnion(depth - 1) }).strict(),
    z.object({ sibling: z.number() }).strict(),
  ]);
}

const FIXTURES: Array<[string, { safeParse: (v: unknown) => any }, unknown]> = [
  [
    'kind-mismatch drop — the string member complains only about the kind, so it is not selected',
    z.object({ u: z.union([z.string(), z.object({ k: z.string() }).strict()]) }),
    { u: { kk: 1 } },
  ],
  [
    'all branches kind-mismatch — nothing is selected and the union stands alone',
    z.object({ u: z.union([z.string(), z.number()]) }),
    { u: {} },
  ],
  [
    'fewest issues wins — the near-miss member reports one key, the others report three',
    z.object({
      u: z.union([
        z.object({ kind: z.literal('a'), one: z.string(), two: z.string(), three: z.string() }).strict(),
        z.object({ kind: z.literal('b'), only: z.string() }).strict(),
      ]),
    }),
    { u: { kind: 'b' } },
  ],
  [
    'unrecognized_keys breaks a tie at equal issue counts',
    z.object({
      u: z.union([
        z.object({ needed: z.string() }).strict(),
        z.object({}).strict(),
      ]),
    }),
    { u: { surprise: 1 } },
  ],
  [
    'declaration order breaks a full tie — every tied branch is kept, in order',
    z.object({ u: z.union([member('alpha'), member('beta')]) }),
    { u: {} },
  ],
  [
    'the branch cap keeps three of five tied branches',
    z.object({
      u: z.union([member('one'), member('two'), member('three'), member('four'), member('five')]),
    }),
    { u: {} },
  ],
  [
    'a union nested inside a union, expanded to the shared depth limit',
    z.object({ u: nestedUnion(4) }),
    { u: { next: { next: { next: { next: { wrong: 1 } } } } } },
  ],
  [
    'container descent — invalid_key on a constrained z.record key (#5389)',
    z.object({ fields: z.record(z.string().regex(/^[a-z_]+$/, 'Must be snake_case.'), z.number()) }),
    { fields: { 'First Name': 1 } },
  ],
  [
    'container descent — invalid_element on a z.map with a non-PropertyKey key (#5389)',
    z.object({ m: z.map(z.object({ id: z.string() }), z.string()) }),
    { m: new Map([[{ id: 'a' }, 42]]) },
  ],
  [
    'a union whose branch is itself a record with a bad key — container under union',
    z.object({
      u: z.union([
        z.object({ fields: z.record(z.string().regex(/^[a-z_]+$/, 'Must be snake_case.'), z.number()) }).strict(),
        z.object({ other: z.string() }).strict(),
      ]),
    }),
    { u: { fields: { 'Bad Key': 1 } } },
  ],
];

describe('[#8318] the two walks reach the same union-branch verdict', () => {
  for (const [name, schema, value] of FIXTURES) {
    it(`agrees pair for pair — ${name}`, () => {
      const issues = issuesFor(schema, value);
      expect(wirePairs(issues, value)).toEqual(renderedPairs(issues));
    });

    it(`…and is deterministic across runs — ${name}`, () => {
      // Declaration order is the last tiebreak, so a second parse of the same
      // value must select the same branches in the same order. A ranking that
      // fell back on sort instability would show up here first.
      const first = renderedPairs(issuesFor(schema, value));
      const second = renderedPairs(issuesFor(schema, value));
      expect(second).toEqual(first);
    });
  }

  it('the corpus really exercises the union machinery, not just leaves', () => {
    // A corpus that stopped producing unions would make every assertion above
    // vacuously true — this is the guard against that silent failure.
    const withUnions = FIXTURES.filter(([, schema, value]) => {
      const issues = issuesFor(schema, value);
      return issues.some((i: any) => i.code === 'invalid_union'
        || JSON.stringify(i).includes('invalid_union'));
    });
    expect(withUnions.length).toBeGreaterThanOrEqual(7);
  });
});

describe('[#8318] the ONE deliberate asymmetry, asserted rather than assumed', () => {
  const [, cappedSchema, cappedValue] = FIXTURES.find(
    ([name]) => name.startsWith('the branch cap'),
  )!;

  it('the prose renderer says how many branches it dropped; the wire says nothing', () => {
    const issues = issuesFor(cappedSchema, cappedValue);

    const omission = renderedLines(issues).filter((line) => line.includes('more branch'));
    expect(omission).toHaveLength(1);
    expect(omission[0]).toContain('… and 2 more branches rejected this value');

    // The wire's entries name fields and carry catalog codes; no entry carries
    // the count. Nothing in `fields[]` mentions the omission at all.
    const entries = zodIssuesToFields(issues, cappedValue);
    expect(entries.some((e) => e.message.includes('more branch'))).toBe(false);
  });

  it('both keep exactly the same three branches, cap included', () => {
    const issues = issuesFor(cappedSchema, cappedValue);
    // Five tied branches in, three out, two omitted — the numbers the renderer
    // prints are the numbers the wire silently drops.
    const union: any = (issues as any[]).find((i) => i.code === 'invalid_union')
      ?? (issues as any[])[0];
    const { selected, omitted } = selectUnionBranches(union.errors as any[][]);
    expect(selected).toHaveLength(UNION_BRANCH_SELECTION_LIMIT);
    expect(omitted).toBe(2);
    expect(wirePairs(issues, cappedValue)).toEqual(renderedPairs(issues));
  });
});

describe('[#8318] the policy constants are the ones both walks were pinned on', () => {
  it('depth limit 3, branch cap 3', () => {
    expect(NESTED_EXPANSION_DEPTH_LIMIT).toBe(3);
    expect(UNION_BRANCH_SELECTION_LIMIT).toBe(3);
  });

  it('the container codes are exactly invalid_key and invalid_element', () => {
    expect([...CONTAINER_ISSUE_CODES].sort()).toEqual(['invalid_element', 'invalid_key']);
  });

  it('an empty branch list selects nothing and omits nothing', () => {
    expect(selectUnionBranches([])).toEqual({ selected: [], omitted: 0 });
  });
});

describe('[#8318] ⛔ the policy stays package-internal', () => {
  // The #4001 pitfall the card names: this module is machinery two siblings
  // need, not a contract anyone should author against. If a barrel ever
  // re-exports it, `api-surface/` and `export-origins/` move with it and this
  // goes red first — before the ledger drift reaches a reviewer.
  const INTERNAL = [
    'selectUnionBranches',
    'isKindMismatchOnly',
    'carriesUnknownKey',
    'unionIssuePath',
    'CONTAINER_ISSUE_CODES',
    'NESTED_EXPANSION_DEPTH_LIMIT',
    'UNION_BRANCH_SELECTION_LIMIT',
  ];

  it('no policy symbol reaches the `shared` entry point', () => {
    for (const name of INTERNAL) {
      expect(Object.keys(SharedBarrel), `${name} must not be public`).not.toContain(name);
    }
  });

  it('no policy symbol reaches the `api` entry point either', () => {
    for (const name of INTERNAL) {
      expect(Object.keys(ApiBarrel), `${name} must not be public`).not.toContain(name);
    }
  });
});
