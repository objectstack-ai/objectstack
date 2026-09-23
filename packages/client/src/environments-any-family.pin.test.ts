// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19383] The `environments.*` any-CONTAINING family, pinned by MEMBERSHIP.
 *
 * ## What was holding this family before this file
 *
 * A prose docblock, and nothing else. `index.ts` says, above `environments`,
 * that *every* unannotated method in this namespace and in the nested
 * `packages` block keeps its erased `any` deliberately (#12036, hardened when
 * ruling B on #16325 moved the control-plane contracts out of this repo —
 * `packages/spec/src/cloud` is absent here today). That sentence is a blanket
 * licence over an UNBOUNDED future population: a 15th such method inherits it
 * on arrival, with nothing for a reviewer to point at.
 *
 * Two mechanisms that look like they would hold it, and cannot:
 *
 *  - `check:exported-any-returns` (#11927) asks whether an awaited return type
 *    **IS** `any`, never whether it **CONTAINS** one. That scope is deliberate,
 *    documented in its ledger `$comment`, and is what buys the gate its
 *    zero-false-positive property. All 14 of these sites are `any`-CONTAINING,
 *    so the gate is silent about them BY DESIGN and correctly so.
 *  - any text search. These 21 callables carry NO return annotation at all, so
 *    `any`, `Promise` and `unwrapResponse` need never appear on a signature
 *    line. That is #11925's own thesis, and it is why the census behind this
 *    file used `ts.createProgram` + `TypeChecker` rather than a grep.
 *
 * ## The reading this file pins
 *
 * Census over `packages/client/src/index.ts` in `objectstack-ai/objectstack`
 * at `8ddefbc977da`, asking the two halves separately — (a) does the SOURCE
 * declaration node write an explicit return type (an AST property, invisible in
 * a built `.d.ts` because tsup always emits one: 318/318 annotated there against
 * 292/331 in source), and (b) does `checker.getAwaitedType` CONTAIN `any` (a
 * type property, invisible to text):
 *
 *     ObjectStackClient.environments.*     21 callables, 0 annotated
 *                                          14 CONTAINS-any, 7 clean
 *     package-wide, unannotated            39 callables
 *                                           2 IS-any (both already ledgered)
 *                                          16 CONTAINS-any
 *
 * The 2 unannotated any-CONTAINING sites outside this namespace are
 * `organizations.list` (better-auth organisation `metadata`) and
 * `oauth.applications.list` (`Record<string, any>[]`, the opaque OAuth client
 * row) — i.e. exactly the caller-shaped class the ratchet's ledger protects by
 * name. That is why this pin is scoped to the NAMESPACE and does not become a
 * package-wide CONTAINS-any rule: measured against the same census, a
 * package-wide rule flags 43 sites at a 4-hop bound and 57 at 6, and all but
 * these 14 are caller-shaped, lib-shaped (`Response.json()`, `AsyncIterable`'s
 * `TReturn`) or the `FilterCondition` operator bag.
 *
 * ## Why MEMBERSHIP and not a CONTAINS-any detector
 *
 * "Contains `any`" has no canonical boundary over this surface: the population
 * is a function of how many hops the walk is allowed (24 at 3, 43 at 4, 57 at
 * 5 and 6), an unbounded walk does not terminate in practice, and 144 callables
 * are still unexplored at 6 hops — so a CONTAINS-any gate's green would mean
 * "no `any` within N hops", never "no `any`". This file asks a bounded question
 * instead: WHICH KEYS are on the namespace, and which of their envelopes carry
 * `any` in their own top two levels. Both are stable across every bound
 * measured (3, 4, 5, 6).
 *
 * ## What goes red, and what it costs
 *
 * A 15th method on `environments` or `environments.packages` fails BOTH the
 * runtime key pin and — if its envelope carries `any` — the type pin. Cost to
 * land one: add its name to the union below, in a diff someone reads. Binding
 * one of the 14 to a real contract also goes red, in the shrink-only direction:
 * remove the name. Neither is a refusal; both are a sentence someone has to
 * write.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackClient } from './index';

type EnvironmentsNamespace = ObjectStackClient['environments'];
type EnvironmentPackagesNamespace = EnvironmentsNamespace['packages'];

// ── The predicate ───────────────────────────────────────────────────────────

/**
 * `any` absorbs every intersection, so `1 & T` is `any` exactly when `T` is,
 * and only `any` makes `0 extends …` true. A caller-supplied `<T = any>` is
 * NOT `any` here for the same reason the #11927 ratchet gives: the default is
 * what an absent type ARGUMENT resolves to at a call site, and no call site is
 * read.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** The element of an array type; anything else unchanged. */
type Unwrap<T> = T extends readonly (infer E)[] ? E : T;

/** Assertion carrier: a `false` here is a compile error, which is the point. */
type Assert<T extends true> = T;

/** Both directions, so a wider OR narrower union is equally red. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Does this envelope carry `any` in its own top two levels — the envelope
 * itself, or one of its members, or the element of a member array?
 *
 * The 2-hop bound is DECLARED, not accidental: the control battery below pins
 * that a 3-hop `any` reads `false`. Every one of the 14 sites carries its `any`
 * at hop 1 or 2, written directly into the method's own `unwrapResponse<…>`
 * type argument, which is what makes the bound safe here and is exactly the
 * property that separates them from the deep caller-shaped hits.
 */
type EnvelopeCarriesAny<T> = IsAny<T> extends true
    ? true
    : T extends object
      ? true extends { [K in keyof T]-?: IsAny<Unwrap<NonNullable<T[K]>>> }[keyof T]
          ? true
          : false
      : false;

/** The keys of a namespace whose awaited envelope carries `any`. */
type AnyCarryingKeys<N> = {
    [K in keyof N]-?: N[K] extends (...args: never[]) => unknown
        ? EnvelopeCarriesAny<Awaited<ReturnType<N[K]>>> extends true
            ? K
            : never
        : never;
}[keyof N];

// ── CONTROL ─────────────────────────────────────────────────────────────────
//
// A pin that only inspects its own hits cannot find its own false negatives,
// and a predicate that collapsed to a constant would hold every assertion below
// it green forever. These are compiled by `tsconfig.test.json` (which `package
// .json`'s `typecheck` script names), so they are real checks rather than the
// phantom class AGENTS.md warns about. Both verdicts are exercised.

/** TRUE side — including the mapped-type shape a `typeArguments`-only walk misses. */
export type ControlDirectAny = Assert<Exact<EnvelopeCarriesAny<any>, true>>;
export type ControlMemberAny = Assert<Exact<EnvelopeCarriesAny<{ environment: any }>, true>>;
export type ControlMemberAnyArray = Assert<Exact<EnvelopeCarriesAny<{ environments: any[]; total: number }>, true>>;
export type ControlOptionalMemberAny = Assert<Exact<EnvelopeCarriesAny<{ a: string; b?: any }>, true>>;
export type ControlIndexSignatureAny = Assert<Exact<EnvelopeCarriesAny<Record<string, any>>, true>>;

/** FALSE side — a predicate stuck on `true` dies here. */
export type ControlConcrete = Assert<Exact<EnvelopeCarriesAny<{ id: string; total: number }>, false>>;
export type ControlConcreteArray = Assert<Exact<EnvelopeCarriesAny<{ items: { id: string }[] }>, false>>;
export type ControlUnknown = Assert<Exact<EnvelopeCarriesAny<{ payload: unknown }>, false>>;
export type ControlGenericParam = Assert<Exact<EnvelopeCarriesAny<{ rows: unknown[] }>, false>>;
/** The declared 2-hop bound: `any` three levels down reads FALSE, on purpose. */
export type ControlBeyondTheBound = Assert<Exact<EnvelopeCarriesAny<{ a: { b: any } }>, false>>;

// ── The pins ────────────────────────────────────────────────────────────────

/**
 * Every key on `client.environments`. `packages` is the nested namespace
 * object, not a method; the other 14 are the callables.
 */
export type EnvironmentsKeysArePinned = Assert<
    Exact<
        keyof EnvironmentsNamespace,
        | 'list'
        | 'get'
        | 'create'
        | 'update'
        | 'delete'
        | 'activate'
        | 'rotateCredential'
        | 'updateHostname'
        | 'listRevisions'
        | 'listBranches'
        | 'renameBranch'
        | 'deleteBranch'
        | 'retryProvisioning'
        | 'listDrivers'
        | 'packages'
    >
>;

/** Every key on the environment-scoped `client.environments.packages`. */
export type EnvironmentPackagesKeysArePinned = Assert<
    Exact<
        keyof EnvironmentPackagesNamespace,
        'list' | 'install' | 'get' | 'enable' | 'disable' | 'uninstall' | 'upgrade'
    >
>;

/**
 * The 8 `environments.*` methods whose envelope carries `any`. The 6 absentees
 * — `delete`, `listRevisions`, `listBranches`, `renameBranch`, `deleteBranch`,
 * `listDrivers` — are unannotated too, and are concrete anyway: they are what
 * proves this pin is not simply "the whole namespace".
 */
export type EnvironmentsAnyFamilyIsPinned = Assert<
    Exact<
        AnyCarryingKeys<EnvironmentsNamespace>,
        | 'list'
        | 'get'
        | 'create'
        | 'update'
        | 'activate'
        | 'rotateCredential'
        | 'updateHostname'
        | 'retryProvisioning'
    >
>;

/**
 * The 6 `environments.packages.*` methods whose envelope carries `any`.
 * `uninstall` is the absentee: it answers `{ id, success }`.
 */
export type EnvironmentPackagesAnyFamilyIsPinned = Assert<
    Exact<
        AnyCarryingKeys<EnvironmentPackagesNamespace>,
        'list' | 'install' | 'get' | 'enable' | 'disable' | 'upgrade'
    >
>;

describe('[#19383] the environments.* any-CONTAINING family is pinned by membership', () => {
    /**
     * The runtime half. It catches what the type half deliberately does not: a
     * 15th method that is fully bound to a concrete contract still changes this
     * namespace, and this repo's reason for reading the namespace as one family
     * is #12036's blanket licence, which such a method would also inherit.
     *
     * `environments` is a class property holding an object literal, so
     * `Object.keys` on an instance is exactly the literal's own keys — no
     * prototype walk, no inherited members.
     */
    it('exposes exactly the 15 environments keys and the 7 packages keys', () => {
        const client = new ObjectStackClient({ baseUrl: 'http://pin.invalid' });

        expect(Object.keys(client.environments).sort()).toEqual(
            [
                'activate',
                'create',
                'delete',
                'deleteBranch',
                'get',
                'list',
                'listBranches',
                'listDrivers',
                'listRevisions',
                'packages',
                'renameBranch',
                'retryProvisioning',
                'rotateCredential',
                'update',
                'updateHostname',
            ],
        );
        expect(Object.keys(client.environments.packages).sort()).toEqual(
            ['disable', 'enable', 'get', 'install', 'list', 'uninstall', 'upgrade'],
        );
    });

    /**
     * Anti-vacuity for the half tsc owns: name the assertion aliases so a
     * reader can see the file really carries them, and state the count this
     * round measured. A `describe` block with no reference to them would leave
     * the type pins looking like commentary.
     */
    it('carries 14 pinned any-carrying sites across the two namespaces', () => {
        const pinned: Record<string, readonly string[]> = {
            environments: [
                'list',
                'get',
                'create',
                'update',
                'activate',
                'rotateCredential',
                'updateHostname',
                'retryProvisioning',
            ],
            'environments.packages': ['list', 'install', 'get', 'enable', 'disable', 'upgrade'],
        };
        expect(pinned.environments.length + pinned['environments.packages'].length).toBe(14);

        // Every pinned name is a real callable on the namespace it names — so a
        // rename cannot leave the prose list above pointing at nothing.
        const client = new ObjectStackClient({ baseUrl: 'http://pin.invalid' });
        for (const key of pinned.environments) {
            expect(typeof (client.environments as Record<string, unknown>)[key]).toBe('function');
        }
        for (const key of pinned['environments.packages']) {
            expect(typeof (client.environments.packages as Record<string, unknown>)[key]).toBe('function');
        }
    });
});
