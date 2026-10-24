/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "A retired key's type", spelled ONCE for the type pins that assert a spec
 * retirement (objectui#11330). Test-only: `__tests__/` is excluded from this
 * package's build, and nothing re-exports this module.
 *
 * `@objectstack/spec` declares a removed key with `retiredKey()`, and the type
 * that tombstone gives the key has had two spellings. These pins were written
 * to compile against both — the pinned spec in every ordinary job, and the
 * spec built from objectstack `main` in `Spec Main Shape Gate` — while the two
 * disagreed:
 *
 *  - **Through 17.5.0: bare `undefined`** — the input type of
 *    `z.never().optional()`. The key admits nothing but absence.
 *  - **objectstack `main` since `d830d71f` (objectstack#21023), and the pinned
 *    17.6.0 (objectui#11438): a branded
 *    mark** — an inline, anonymous object type whose ONE property is named by
 *    the retirement sentence and typed `never`, under the optional wrapper:
 *    MARK or `undefined`, where MARK reads
 *    `{ '[REMOVED] Key retired: run `os validate` for its migration.': never }`.
 *    It still admits nothing but absence (no value can carry a `never`
 *    property); it exists so `tsc` names the retirement in the diagnostic.
 *    The spec does not export the mark — it is inline on purpose, so that
 *    the diagnostic prints the sentence rather than an alias name — so it is
 *    matched here by its STRUCTURE: one property, named with the `[REMOVED] `
 *    prefix, typed `never`. The prefix, not the whole sentence, so a reworded
 *    sentence upstream does not turn every objectui pull request red again.
 *
 * {@link IsRetiredKeyType} is `true` for exactly those two spellings and
 * `false` for everything else: `any`, `unknown`, `never`, a live member type,
 * the mark WITHOUT its `undefined` arm, and any near-miss of the mark (a
 * second property, a property that admits a value, a name without the
 * prefix). The direction proofs at the foot of this module are what hold that
 * line: loosen the helper toward "anything" and one of them stops compiling.
 *
 * The pin moved past a release that carries the mark at 17.6.0, so the bare
 * `undefined` arm describes no installed spec any more and can be dropped. The
 * bump that moved the pin (objectui#11438) kept it: dropping it tightens the
 * helper every retirement pin reads, which is a change of its own.
 */

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type IsAny<T> = 0 extends 1 & T ? true : false;

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;
type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;

/** The prefix the mark's one property name carries. */
type RemovedMarkKey = `[REMOVED] ${string}`;

/**
 * `true` when `M` is the retirement mark: exactly one property, named with
 * the `[REMOVED] ` prefix (a literal name, not a template index signature),
 * and typed `never`.
 */
type IsRetirementMark<M> = [M] extends [never]
  ? false
  : IsAny<M> extends true
    ? false
    : [keyof M] extends [never]
      ? false
      : RemovedMarkKey extends keyof M
        ? false
        : IsUnion<keyof M> extends true
          ? false
          : Equal<M, { [K in keyof M & RemovedMarkKey]: never }>;

/**
 * `true` when `X` is the type a `retiredKey()` tombstone gives a key, in
 * either spelling the module docblock names; `false` otherwise.
 */
export type IsRetiredKeyType<X> = IsAny<X> extends true
  ? false
  : Equal<X, undefined> extends true
    ? true
    : [undefined] extends [X]
      ? IsRetirementMark<Exclude<X, undefined>>
      : false;

/* ── Direction proofs: a helper loosened toward "anything" makes this module red ── */
// Type-level, erased at runtime, and compiled by every program that imports
// this module (each pin's `type-check`). `Expect` refuses anything but `true`,
// and `Equal` is invariant, so a helper that answered `true` — or `boolean` —
// where a row says `false` is a compile error here.

type Expect<T extends true> = T;
type Mark = { '[REMOVED] Key retired: run `os validate` for its migration.': never };

type _PinnedSpelling = Expect<Equal<IsRetiredKeyType<undefined>, true>>;
type _MainSpelling = Expect<Equal<IsRetiredKeyType<Mark | undefined>, true>>;
type _RewordedSentence = Expect<Equal<IsRetiredKeyType<{ '[REMOVED] Some other sentence.': never } | undefined>, true>>;

// `any` is the probe's INPUT here: the row proves the helper refuses it.
type _NotAny = Expect<Equal<IsRetiredKeyType<any>, false>>;
type _NotUnknown = Expect<Equal<IsRetiredKeyType<unknown>, false>>;
type _NotNever = Expect<Equal<IsRetiredKeyType<never>, false>>;
type _NotALiveMember = Expect<Equal<IsRetiredKeyType<string | undefined>, false>>;
type _NotALiveObjectMember = Expect<Equal<IsRetiredKeyType<{ ariaLabel?: string } | undefined>, false>>;
type _NotTheMarkAlone = Expect<Equal<IsRetiredKeyType<Mark>, false>>;
type _NotTheMarkWidened = Expect<Equal<IsRetiredKeyType<Mark | string | undefined>, false>>;
type _NotAMarkThatAdmitsAValue = Expect<Equal<IsRetiredKeyType<{ '[REMOVED] Key retired.': string } | undefined>, false>>;
type _NotAMarkWithASecondProperty = Expect<Equal<IsRetiredKeyType<(Mark & { title: never }) | undefined>, false>>;
type _NotAMarkWithoutThePrefix = Expect<Equal<IsRetiredKeyType<{ removed: never } | undefined>, false>>;
type _NotAnEmptyObject = Expect<Equal<IsRetiredKeyType<Record<never, never> | undefined>, false>>;
type _NotATemplateIndexSignature = Expect<Equal<IsRetiredKeyType<{ [k: RemovedMarkKey]: never } | undefined>, false>>;
