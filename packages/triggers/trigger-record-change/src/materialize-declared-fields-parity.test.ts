// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4953 (services half), PM follow-up — a drift guard for the duplicated
 * `materializeDeclaredFields`.
 *
 * `record-change-trigger.ts` carries a STRUCTURAL MIRROR of
 * `@objectstack/objectql`'s `materializeDeclaredFields`
 * (`packages/objectql/src/declared-fields.ts`), duplicated rather than
 * imported so this package keeps its zero BUILD-TIME dependency on objectql
 * (`@objectstack/objectql` is a devDependency only — see that package's own
 * `package.json`). A doc comment saying "same algorithm, see the canonical
 * copy" is a convention, not a mechanism: nothing stops the two from
 * silently diverging if objectql's copy changes and this one doesn't (or
 * vice versa) — a flow condition would then evaluate a field differently
 * from a validation rule for the SAME field on the SAME object, with
 * nothing red anywhere. This file is the mechanism.
 *
 * ## Why the canonical import is `@objectstack/objectql/core`, not a relative path
 *
 * `@objectstack/objectql`'s `package.json` `exports` map did not publish
 * `declared-fields.ts` before this PR (it was an internal module, imported by
 * relative path from objectql's OWN other modules, e.g.
 * `validation/rule-validator.ts`). Two ways to reach it from a sibling
 * package's TEST file:
 *
 *   1. Publish it from objectql's `./core` entry (already the home of other
 *      internal-tooling exports like `evaluateValidationRules`) and import
 *      the bare specifier `@objectstack/objectql/core` — a devDependency
 *      already. This is what this file does.
 *   2. A relative import straight into `packages/objectql/src/`. MEASURED
 *      and rejected: `tsc --noEmit` over this package's tests (the
 *      `check:type-check-debt` TEST_DEBT re-measure, which — unlike this
 *      package's own `pnpm typecheck` — does NOT exclude `*.test.ts`) reports
 *      **TS6059**, because the package's `tsconfig.json` sets
 *      `rootDir: "./src"` and a file physically outside that directory
 *      cannot be part of its program. That is a repo-wide, mechanically
 *      enforced rule, not a style call this file gets to make locally.
 *
 * (1)'s residual risk — `@objectstack/objectql` resolves through `exports` to
 * `dist/`, so the comparison is "does the local copy match objectql's LAST
 * BUILD", not its live source — is the SAME risk this package already
 * accepts for every other `@objectstack/objectql` import its tests make (it
 * is grandfathered in `scripts/check-test-source-alias.mjs`'s
 * `KNOWN_UNALIASED_TEST_IMPORTS`, unlike `@objectstack/formula`, which THIS
 * package's own `vitest.config.ts` aliases to source for exactly this
 * reason). Adding one more named export from an already-dist-resolved
 * package does not create a new category of risk, and turbo's
 * `test` `dependsOn: ["^build"]` means the risk is dormant in every path CI
 * actually runs — only a bare `vitest run` against an unbuilt tree could see
 * it stale, the same as every other `@objectstack/objectql` symbol this
 * package's tests already read.
 *
 * ## What "demonstrate it's a real tripwire" means here
 *
 * A parity check that only ever compares two calls to functions that happen
 * to behave identically proves nothing about whether the COMPARISON itself
 * would catch a real divergence — it could pass just as easily if both
 * sides were broken in the same way, or if a copy-paste bug made both
 * variables reference the SAME function. The last `it` below manufactures a
 * SYNTHETIC divergence (a hand-written third implementation with one
 * deliberately wrong line) and asserts the comparison disagrees with it —
 * proving the harness discriminates a real difference, not just tautology.
 */
import { describe, it, expect } from 'vitest';
import { materializeDeclaredFields as localMaterialize } from './record-change-trigger.js';
// The published `@objectstack/objectql/core` entry — see the file doc above
// for why this is a bare specifier and not a relative source import.
import { materializeDeclaredFields as canonicalMaterialize } from '@objectstack/objectql/core';

/** One shared table of cases, run through BOTH implementations. */
const CASES: Array<{
    name: string;
    record: Record<string, unknown>;
    fields: Record<string, unknown> | undefined | null;
}> = [
    {
        name: 'fills a genuinely-missing declared field with null',
        record: { b: 'x' },
        fields: { a: { type: 'text' }, b: { type: 'text' } },
    },
    {
        name: 'an already-present value (including a falsy one) is left untouched',
        record: { a: 0, b: '', c: false },
        fields: { a: { type: 'number' }, b: { type: 'text' }, c: { type: 'boolean' } },
    },
    {
        name: 'an own key holding `undefined` counts as absent, same as a missing key',
        record: { a: undefined, b: 'x' },
        fields: { a: { type: 'text' }, b: { type: 'text' } },
    },
    {
        name: 'a key already holding null stays null (not re-materialized into something else)',
        record: { a: null },
        fields: { a: { type: 'text' } },
    },
    {
        name: 'scope is declared-fields-only — an undeclared key on the record is untouched',
        record: { undeclared: 'x' },
        fields: { a: { type: 'text' } },
    },
    {
        name: 'no fields declared at all → no-op',
        record: { a: 'x' },
        fields: {},
    },
    {
        name: 'fields is undefined → no-op (record returned as-is)',
        record: { a: 'x' },
        fields: undefined,
    },
    {
        name: 'fields is null → no-op (record returned as-is)',
        record: { a: 'x' },
        fields: null,
    },
    {
        name: 'empty record, several declared fields → all materialize to null',
        record: {},
        fields: { a: {}, b: {}, c: {} },
    },
];

describe('materializeDeclaredFields parity: local mirror vs @objectstack/objectql canonical (#4953)', () => {
    for (const { name, record, fields } of CASES) {
        it(`agree: ${name}`, () => {
            // Independent copies — each function mutates its argument in
            // place, and the two must not be run over the SAME object.
            const localInput = { ...record };
            const canonicalInput = { ...record };

            const localResult = localMaterialize(localInput, fields);
            const canonicalResult = canonicalMaterialize(canonicalInput, fields);

            expect(localResult).toEqual(canonicalResult);
        });
    }

    it('agree on the RETURN-VALUE IDENTITY contract too (both return the same object they mutated)', () => {
        const localInput = { a: 'x' };
        const canonicalInput = { a: 'x' };
        expect(localMaterialize(localInput, { a: {}, b: {} })).toBe(localInput);
        expect(canonicalMaterialize(canonicalInput, { a: {}, b: {} })).toBe(canonicalInput);
    });

    // ── the harness is a real tripwire, not a tautology ─────────────────
    it('DEMONSTRATION: a synthetic divergence is actually caught by this comparison', () => {
        // A deliberately WRONG third implementation: defaults a missing
        // declared field to the STRING `'null'` instead of the value
        // `null` — the kind of one-character regression a future edit to
        // either copy could introduce unnoticed.
        function brokenMaterialize(
            record: Record<string, unknown>,
            fields: Record<string, unknown> | undefined | null,
        ): Record<string, unknown> {
            if (!fields || typeof fields !== 'object') return record;
            for (const name of Object.keys(fields)) {
                if (record[name] === undefined) record[name] = 'null'; // <- the injected bug
            }
            return record;
        }

        const fields = { a: {}, b: {} };
        // Widened explicitly: the canonical signature is generic
        // (`<T extends Record<string, unknown>>(record: T, …): T`, preserving
        // the exact input shape) precisely so a caller who DOES know its
        // object's real field set gets it back typed — `rule-validator.ts`
        // relies on that. An inline `{ b: 'x' }` literal would otherwise infer
        // `T = { b: string }`, and `.a` below would be a compile error despite
        // being genuinely present at runtime after materialization.
        const canonicalResult = canonicalMaterialize({ b: 'x' } as Record<string, unknown>, fields);
        const brokenResult = brokenMaterialize({ b: 'x' }, fields);

        // If this assertion ever failed to hold, the parity `it`s above
        // would not be trustworthy evidence of anything — they would pass
        // regardless of what either real implementation did.
        expect(brokenResult).not.toEqual(canonicalResult);
        expect(brokenResult.a).toBe('null');
        expect(canonicalResult.a).toBeNull();
    });
});
