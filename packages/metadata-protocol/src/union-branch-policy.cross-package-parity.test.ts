// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8660] The union-branch selection VERDICT is the same in this package as it
 * is in `@objectstack/spec` — asserted mechanically, across the package
 * boundary, for the copy #8318 could not reach.
 *
 * ## Why this file exists
 *
 * When a `z.union` rejects a value, zod folds every branch's issues into ONE
 * top-level `invalid_union` whose own message is the literal `"Invalid input"`.
 * Something has to decide WHICH branches actually explain the failure: drop the
 * branches that only complain about the kind, rank the rest by fewest issues,
 * break ties on `unrecognized_keys` and then on declaration order, cap the
 * result at three, and stop descending after three levels. That decision is a
 * POLICY, and #5014 ruled that it must not fork: the same body has to get the
 * same verdict whether the author published from the terminal, POSTed to the
 * data API, or saved from Studio.
 *
 * There are three implementations of it. #8318 (PR #8659) consolidated the two
 * that live inside `packages/spec` into `spec/src/shared/union-branch-policy.ts`
 * and pinned them against each other with a shared-fixture parity test. The
 * THIRD copy is `zodIssuesToMetadataIssues` in `./protocol.ts` — the walk behind
 * `saveMetaItem`'s `422 INVALID_METADATA` (#5364) and the read path's
 * diagnostics (#5598) — and the consolidation could not take it in: the shared
 * module is deliberately package-internal (the #4001 export pitfall), so a
 * consumer in another package cannot import it. That left this copy exactly
 * where the spec pair was BEFORE #8318 — held in step by a header comment and
 * nothing else, which is the condition #8318 was funded to end.
 *
 * This file is the enforcement that header stands in for. It changes no
 * production line and adds no export; it drives both sides through their
 * PUBLIC surfaces over one shared corpus and compares the verdicts.
 *
 * ## What it will catch, which is the only thing worth catching here
 *
 * The three copies agree today, so nothing here fails on the current tree. What
 * fails is DIVERGENCE: a future tweak to the spec-side policy — a new tie-break,
 * a different cap — lands in `union-branch-policy.ts` for both spec walks at
 * once and silently not for this one. Then the same authored metadata is
 * accepted-with-one-prescription by one door and another by the next, which is
 * the "N dialects" shape #5014 named.
 *
 * ## The two sides are genuinely independent, and §1 proves it
 *
 * A parity test whose halves share a code path proves nothing. These do not,
 * and it is structural rather than a matter of care: §1 asserts that not one of
 * the seven policy symbols is reachable from ANY public entry point of
 * `@objectstack/spec`, so `protocol.ts` cannot be importing the shared module
 * even if a future author wanted it to. Its copy is the only thing it can run.
 *
 * §1 is also the tripwire for the other outcome. If the policy is ever promoted
 * to a public export — a public-surface decision #4001 defaults to NO and #8318
 * declined once — §1 goes red and says the right next move is to REWIRE this
 * package onto the shared module, not to leave a third copy behind a green
 * parity test.
 *
 * ## ⚠️ Which spec this file is a verdict about
 *
 * `@objectstack/metadata-protocol` resolves `@objectstack/spec` through
 * `exports` to `packages/spec/dist/` — it is one of the packages registered as
 * unaliased in `scripts/check-test-source-alias.mjs`. So the spec half of every
 * assertion below is the BUILT artifact, not `packages/spec/src`. That is the
 * honest reading for a cross-package parity pin (it is what this consumer
 * actually links against, and `turbo.json` has `test` dependsOn `^build`), but
 * it has one consequence worth stating: perturbing `packages/spec/src` alone
 * will NOT redden this file. Rebuild `@objectstack/spec` first, or the run is
 * reporting on the previous build.
 *
 * ## What is deliberately NOT compared
 *
 * - **Container descent** (`invalid_key` / `invalid_element`, #5389). The spec
 *   walks descend those; this package's copy expands `invalid_union` only. That
 *   is a difference in REACH, not in the ranking, and it is not what #5014 bound
 *   together — so the corpus stays inside `invalid_union`, where all three
 *   copies make the same claim. Widening it is a separate card.
 * - **The `code` vocabulary.** This package emits zod's raw code, the wire emits
 *   the ADR-0114 catalog code (#5364 records why they are not aligned). §4
 *   asserts that divergence in place rather than normalising it away, so it
 *   stays a decision instead of becoming an accident.
 * - **The prose renderer's trailing omission line.** `formatZodIssue` prints
 *   "… and N more branches rejected this value"; both machine-readable walks
 *   emit nothing, because an entry there must name a slot and carry a code and
 *   an omission count has neither. §4 pins that asymmetry in both directions.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
// The spec side, through its PUBLIC surfaces only — the root barrel's prose
// renderer (#4971) and `/api`'s ADR-0114 wire mapper (#8124). Both delegate
// branch selection to the package-internal policy module #8318 extracted.
import { formatZodIssue } from '@objectstack/spec';
import { zodIssuesToFields } from '@objectstack/spec/api';
// This package's own copy of the ranking, at the surface every producer here
// calls: `saveMetaItem`'s 422 (#5364) and `computeMetadataDiagnostics` (#5598).
import { zodIssuesToMetadataIssues } from './protocol.js';

// ---------------------------------------------------------------------------
// Normalisation: the projection all three walks can be read as producing.
// ---------------------------------------------------------------------------

/** `(path, message)` — what each walk says about which slot, in which order. */
interface Visited {
    path: string;
    message: string;
}

/** This package's `422 INVALID_METADATA` `issues[]`, as {@link Visited} pairs. */
function metadataPairs(issues: readonly unknown[]): Visited[] {
    return zodIssuesToMetadataIssues(issues).map((entry) => ({
        path: entry.path,
        message: entry.message,
    }));
}

/** The spec wire mapper's `fields[]`, as {@link Visited} pairs. */
function wirePairs(issues: readonly unknown[], input: unknown): Visited[] {
    return zodIssuesToFields(issues, input).map((entry) => ({
        path: entry.field,
        message: entry.message,
    }));
}

/** Every line the prose renderer emits, expansion included. */
function proseLines(issues: readonly unknown[]): string[] {
    return issues.flatMap((issue) => formatZodIssue(issue as never).split('\n'));
}

/**
 * The prose renderer's output, as {@link Visited} pairs.
 *
 * Exactly three formatting facts are removed and nothing else: the indent, the
 * `✗` glyph, and the `(root)` spelling of the empty path (both machine walks
 * write `''`). The omission line carries no `✗` and so is dropped here — §4
 * asserts it separately rather than letting it vanish silently.
 */
function prosePairs(issues: readonly unknown[]): Visited[] {
    return proseLines(issues)
        .filter((line) => line.includes('✗'))
        .map((line) => {
            const body = line.slice(line.indexOf('✗') + 1).trimStart();
            // The FIRST `': '` splits path from message: a path segment never
            // contains one, while a zod message routinely does ("Invalid input:
            // expected string, received undefined").
            const split = body.indexOf(': ');
            const path = body.slice(0, split);
            return { path: path === '(root)' ? '' : path, message: body.slice(split + 2) };
        });
}

/** Parse, assert the fixture really fails, and hand all three walks one list. */
function issuesFor(schema: z.ZodTypeAny, value: unknown): readonly unknown[] {
    const result = schema.safeParse(value);
    expect(result.success, 'every parity fixture must actually fail to parse').toBe(false);
    return (result as { error: { issues: readonly unknown[] } }).error.issues;
}

// ---------------------------------------------------------------------------
// The corpus. One fixture per element of the policy #5014 bound together, each
// driven from ONE `safeParse` so all three walks judge the identical input.
// ---------------------------------------------------------------------------

/** A strict object member requiring exactly one string key. */
const strictMember = (key: string) => z.object({ [key]: z.string() }).strict();

/** A loose object member requiring `keys`, so branch issue COUNTS are steerable. */
const looseMember = (...keys: string[]) =>
    z.object(Object.fromEntries(keys.map((k) => [k, z.string()])));

/** A union nested `depth` levels deep, to drive the expansion limit. */
function nestedUnion(depth: number): z.ZodTypeAny {
    if (depth === 0) return z.object({ leaf: z.string() }).strict();
    return z.union([
        z.object({ next: nestedUnion(depth - 1) }).strict(),
        z.object({ sibling: z.number() }).strict(),
    ]);
}

interface Fixture {
    /** The rule of the policy this fixture exercises. */
    readonly rule: string;
    readonly schema: z.ZodTypeAny;
    readonly value: unknown;
    /**
     * The ordered paths the verdict visits — a THIRD, hand-authored statement
     * of the rule, so the corpus still says something if both sides ever drift
     * the same way, and so each fixture's name is checkable rather than
     * decorative.
     */
    readonly expectedPaths: readonly string[];
}

const FIXTURES: readonly Fixture[] = [
    {
        rule: 'kind-mismatch drop — the string member complains only about the kind, so it is not selected',
        schema: z.object({ u: z.union([z.string(), strictMember('a')]) }),
        value: { u: {} },
        expectedPaths: ['u', 'u.a'],
    },
    {
        rule: 'every branch a bare kind mismatch — nothing is selected, the union stands alone',
        schema: z.object({ u: z.union([z.string(), z.number()]) }),
        value: { u: {} },
        expectedPaths: ['u'],
    },
    {
        rule: 'fewest issues wins — the branch the author was closest to hitting complains least',
        schema: z.object({ u: z.union([looseMember('a'), looseMember('b', 'c', 'd')]) }),
        value: { u: { a: 1 } },
        expectedPaths: ['u', 'u.a'],
    },
    {
        rule: 'unrecognized_keys breaks a tie at equal issue counts — the curated prose wins',
        schema: z.object({ u: z.union([strictMember('a'), looseMember('k', 'j')]) }),
        value: { u: { k: 1 } },
        // Both branches produce two issues; only the strict one carries the
        // #4001 unknown-key prescription, so it is the one that is emitted.
        expectedPaths: ['u', 'u.a', 'u'],
    },
    {
        rule: 'declaration order breaks a full tie, and every tied branch is emitted',
        schema: z.object({ u: z.union([looseMember('a'), looseMember('b'), looseMember('c')]) }),
        value: { u: {} },
        expectedPaths: ['u', 'u.a', 'u.b', 'u.c'],
    },
    {
        rule: 'the branch cap keeps three of five tied branches',
        schema: z.object({
            u: z.union([
                looseMember('a'), looseMember('b'), looseMember('c'),
                looseMember('d'), looseMember('e'),
            ]),
        }),
        value: { u: {} },
        expectedPaths: ['u', 'u.a', 'u.b', 'u.c'],
    },
    {
        rule: 'the depth limit stops the descent after three levels of nested union',
        schema: z.object({ u: nestedUnion(4) }),
        value: { u: { next: { next: { next: { next: { leaf: 1 } } } } } },
        // u → u.next → u.next.next → u.next.next.next, and there it stops: the
        // fourth union is emitted as a head and never expanded, so `leaf` — the
        // thing actually wrong with the value — is not reached by ANY of the
        // three walks. They agree on where to stop, which is the assertion.
        expectedPaths: ['u', 'u.next', 'u.next.next', 'u.next.next.next'],
    },
    {
        rule: 'a union one level down has its branch paths resolved against the union above it',
        schema: z.object({ outer: z.union([z.object({ inner: z.union([strictMember('a'), strictMember('b')]) }).strict(), z.number()]) }),
        value: { outer: { inner: { a: 1 } } },
        expectedPaths: ['outer', 'outer.inner', 'outer.inner.a'],
    },
];

describe('#8660 §1 the two sides cannot be sharing an implementation', () => {
    /** The seven symbols `spec/src/shared/union-branch-policy.ts` declares. */
    const POLICY_SYMBOLS = [
        'selectUnionBranches',
        'isKindMismatchOnly',
        'carriesUnknownKey',
        'unionIssuePath',
        'CONTAINER_ISSUE_CODES',
        'NESTED_EXPANSION_DEPTH_LIMIT',
        'UNION_BRANCH_SELECTION_LIMIT',
    ] as const;

    /**
     * Every PUBLIC entry point of `@objectstack/spec` that could plausibly carry
     * the policy, loaded dynamically.
     *
     * ⛔ The natural spelling of the root case — `import * as SpecRoot from
     * '@objectstack/spec'` — is refused by this repo's `no-restricted-imports`
     * rule, and the refusal is correct rather than an obstacle: a static
     * namespace binding on the root keeps all fifteen domain namespaces
     * (`Data`, `UI`, `Kernel`, …) reachable, which Node ESM cannot tree-shake,
     * and that is the ~1.2GB RSS regression the rule exists to prevent. The
     * lint run uses `--no-inline-config`, so there is no per-site opt-out — by
     * design.
     *
     * Loading dynamically is not an evasion dressed up as a fix. This file
     * already loads the root module for `formatZodIssue` above, so nothing
     * extra is pulled in; what the dynamic form drops is the long-lived
     * namespace BINDING the rule targets. {@link policySymbolsReachableFrom}
     * reduces each namespace to the handful of names §1 asks about and lets the
     * object go, so the assertion below is strictly LESS retentive than the
     * static spelling it replaces — while making exactly the same claim about
     * exactly the same public surface.
     */
    const SPEC_ENTRY_POINTS: ReadonlyArray<readonly [string, () => Promise<object>]> = [
        ['@objectstack/spec', () => import('@objectstack/spec')],
        ['@objectstack/spec/api', () => import('@objectstack/spec/api')],
        ['@objectstack/spec/shared', () => import('@objectstack/spec/shared')],
    ];

    /**
     * Which policy symbols one entry point actually exports.
     *
     * `in` against the module namespace, which is what "publicly reachable"
     * means for an ESM consumer — the same test the static spelling ran, on the
     * same object, without keeping it.
     */
    async function policySymbolsReachableFrom(load: () => Promise<object>): Promise<string[]> {
        const mod = (await load()) as Record<string, unknown>;
        return POLICY_SYMBOLS.filter((name) => name in mod);
    }

    // If this goes red, the policy became reachable from outside `packages/spec`
    // and the right response is to REWIRE `protocol.ts` onto it — deleting its
    // copy — not to keep three copies with a parity test over two of them.
    it.each(SPEC_ENTRY_POINTS)(
        '%s exports none of the policy symbols, so this package must run its own copy',
        async (_entry, load) => {
            expect(await policySymbolsReachableFrom(load)).toEqual([]);
        },
    );

    it('drives the spec side through public surfaces that DO exist', () => {
        // The other half of the same claim: the comparison below is not green
        // because both imports were undefined and both walks emitted nothing.
        expect(typeof formatZodIssue).toBe('function');
        expect(typeof zodIssuesToFields).toBe('function');
        expect(typeof zodIssuesToMetadataIssues).toBe('function');
    });
});

describe('#8660 §2 one verdict, three implementations, one fixture corpus', () => {
    it.each(FIXTURES.map((f) => [f.rule, f] as const))('%s', (_rule, fixture) => {
        const issues = issuesFor(fixture.schema, fixture.value);
        const mine = metadataPairs(issues);

        // The hand-authored statement of the rule, so both sides drifting the
        // same way is still a failure.
        expect(mine.map((v) => v.path)).toEqual([...fixture.expectedPaths]);

        // The parity assertions themselves: same slots, same messages, same
        // order, against each public spec walk in turn.
        expect(mine).toEqual(wirePairs(issues, fixture.value));
        expect(mine).toEqual(prosePairs(issues));
    });
});

describe('#8660 §3 the corpus cannot be passing vacuously', () => {
    it('every fixture really produces a union that really gets expanded', () => {
        for (const fixture of FIXTURES) {
            const issues = issuesFor(fixture.schema, fixture.value);
            expect(issues, fixture.rule).toHaveLength(1);
            expect((issues[0] as { code?: unknown }).code, fixture.rule).toBe('invalid_union');
        }
    });

    it('the corpus exercises expansion, not just the union head', () => {
        // Six of the eight fixtures must reach BELOW the top-level issue; if a
        // future edit flattened them, every parity assertion above would still
        // pass while asserting nothing about branch selection.
        const expanded = FIXTURES.filter((f) => f.expectedPaths.length > 1);
        expect(expanded.length).toBeGreaterThanOrEqual(6);
    });

    it('the corpus covers every element of the policy by name', () => {
        const rules = FIXTURES.map((f) => f.rule).join(' | ');
        for (const element of [
            'kind-mismatch drop',
            'fewest issues',
            'unrecognized_keys breaks a tie',
            'declaration order',
            'branch cap',
            'depth limit',
        ]) {
            expect(rules, `no fixture exercises: ${element}`).toContain(element);
        }
    });
});

describe('#8660 §4 the deliberate asymmetries, asserted rather than normalised away', () => {
    /** Five tied branches, three kept — the fixture the omission line describes. */
    const capped = FIXTURES.find((f) => f.rule.includes('branch cap'))!;

    it('the trailing omission line is prose-only, in both directions', () => {
        const issues = issuesFor(capped.schema, capped.value);

        // Present in the terminal rendering...
        expect(proseLines(issues).some((line) => line.includes('and 2 more branches rejected this value')))
            .toBe(true);

        // ...and absent from both machine-readable walks, which have nowhere to
        // put a count that names no slot and carries no code.
        expect(metadataPairs(issues).some((v) => v.message.includes('more branches'))).toBe(false);
        expect(wirePairs(issues, capped.value).some((v) => v.message.includes('more branches'))).toBe(false);
    });

    it('the code vocabularies differ on purpose — raw zod here, ADR-0114 on the wire', () => {
        const fixture = FIXTURES[0]!;
        const issues = issuesFor(fixture.schema, fixture.value);

        // #5364: this envelope passes zod's own code through verbatim, because
        // its consumers (Studio's designer) already read raw zod codes.
        expect(zodIssuesToMetadataIssues(issues).map((e) => e.code))
            .toEqual(['invalid_union', 'invalid_type']);

        // ADR-0114: the data surface speaks its own catalog. Same verdict, same
        // slots, different vocabulary — aligning them is #5364's separate call.
        expect(zodIssuesToFields(issues, fixture.value).map((e) => e.code))
            .toEqual(['invalid_shape', 'required']);
    });
});
