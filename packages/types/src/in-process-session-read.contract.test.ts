// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22384] The in-process session-read input stays inside the contract that
 * declares it.
 *
 * Every in-process reader calls `api.getSession(inProcessSessionReadInput(headers))`
 * with `api` typed by `AuthSessionApi` (`@objectstack/spec/contracts`), so the
 * helper's return IS what that declaration receives. This file holds the two
 * together: every key the helper returns is a key the declaration names. It
 * lives in this package because only here are both visible — the helper is
 * this package's, the contract is its dependency's, and `@objectstack/spec`
 * must not import this package.
 *
 * ## Why plain assignability is not the check
 *
 * TypeScript refuses an undeclared key only on an object LITERAL. A
 * non-literal carrying an extra optional key is assignable to a type that
 * omits it, so `const input: DeclaredInput = inProcessSessionReadInput(headers)`
 * compiles against a declaration of `{ headers: unknown }` alone — which is how
 * the readers compiled while the declaration did not describe what they sent.
 * `FitsDeclared` applies the literal's rule to a type: assignable, and no key
 * the declaration does not name, at every depth where the declaration names a
 * shape (`headers` is declared `unknown`, so it is not looked into).
 *
 * ## Where it bites
 *
 * At compile time. This package's `typecheck` (`tsc --noEmit`) compiles this
 * file, reading the contract from `@objectstack/spec`'s BUILT `.d.ts`. A
 * declaration that stops naming `query` or `disableRefresh`, or a helper that
 * starts sending a key the declaration does not name, turns a `holds` below
 * into TS2344, and reading `query` off the declared input in the runtime case
 * into TS2339. The `@ts-expect-error` controls prove the instrument can fail at
 * all: if `FitsDeclared` went vacuous, each directive would stop matching an
 * error and tsc would report TS2578.
 */

import { expect, it } from 'vitest';
import type { AuthSessionApi } from '@objectstack/spec/contracts';
import { inProcessSessionReadInput } from './in-process-session-read.js';

/** What `AuthSessionApi.getSession` declares it accepts. */
type DeclaredInput = Parameters<NonNullable<AuthSessionApi['getSession']>>[0];

/** What the helper returns for a reader's headers of type `H`. */
type HelperInput<H> = ReturnType<typeof inProcessSessionReadInput<H>>;

/** `Out` fits `In` the way an object literal must; `true` or `false`, never both. */
type FitsDeclared<Out, In> = [Fits<Out, In>] extends [true] ? true : false;

/**
 * One verdict per union member of `Out` — a union is judged member by member,
 * never by its common keys — and per declared key below it. The verdicts union
 * together, and `FitsDeclared` reads a single `false` among them as a miss.
 */
type Fits<Out, In> = Out extends unknown
    ? [Out] extends [In]
        ? unknown extends In
            ? true
            : [Out] extends [object]
                ? [Exclude<keyof Out, keyof In>] extends [never]
                    ? { [K in keyof Out & keyof In]-?: Fits<Exclude<Out[K], undefined>, Exclude<In[K], undefined>> }[keyof Out & keyof In]
                    : false
                : true
        : false
    : never;

/** Compiles only when its type argument is `true`. */
function holds<T extends true>(verdict: T): T {
    return verdict;
}

// The pin, for each header shape the readers hand the helper: a Web `Headers`
// (`c.req.raw.headers`, the dispatcher's), a Node header record (`req.headers`
// on the Node adapters), and an untyped one.
holds<FitsDeclared<HelperInput<Headers>, DeclaredInput>>(true);
holds<FitsDeclared<HelperInput<Record<string, string | string[] | undefined>>, DeclaredInput>>(true);
holds<FitsDeclared<HelperInput<unknown>, DeclaredInput>>(true);

// The instrument's controls: each of these MUST fail to compile.
// @ts-expect-error a top-level key the declaration does not name
holds<FitsDeclared<{ headers: unknown; cookie: string }, DeclaredInput>>(true);
// @ts-expect-error a key under `query` the declaration does not name
holds<FitsDeclared<{ headers: unknown; query: { disableRefresh: true; notDeclared: true } }, DeclaredInput>>(true);
// @ts-expect-error a union member with an undeclared key, beside one without
holds<FitsDeclared<{ headers: unknown } | { headers: unknown; cookie: string }, DeclaredInput>>(true);
// @ts-expect-error a declared key with a value the declaration does not accept
holds<FitsDeclared<{ headers: unknown; query: { disableRefresh: 'yes' } }, DeclaredInput>>(true);

it('[#22384] an implementer typed by the contract reads the renewal decision the helper made', async () => {
    const renews: boolean[] = [];
    const api: AuthSessionApi = {
        async getSession(input) {
            // `input` is the DECLARED input: on a declaration without `query`
            // this read is a compile error, not an `undefined`.
            renews.push(input.query?.disableRefresh !== true);
            return undefined;
        },
    };

    await api.getSession?.(inProcessSessionReadInput(new Headers({ cookie: 'better-auth.session_token=tok3n.c2ln' })));
    await api.getSession?.(inProcessSessionReadInput(new Headers({ authorization: 'Bearer tok3n.c2ln' })));

    // A browser's read does not renew; a bearer-only read renews as before.
    expect(renews).toEqual([false, true]);
});
