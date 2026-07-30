// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Compile-level pins for the hand-tied navigation types (#3786).
 *
 * `NavigationItem` / `NavigationItemInput` are the one part of the navigation
 * contract that does NOT derive from a schema — they are the annotation
 * `NavigationItemSchema`'s recursion needs, so they cannot be inferred back out
 * of it. Anything hand-written next to a schema is a second description of the
 * same key set, and a second description drifts.
 *
 * It already has, twice, both silently:
 *
 * 1. #4171 — the annotation was `z.ZodType<any>`, so the exported
 *    `NavigationItem` was `any`. A consumer importing it got a type that
 *    constrains nothing, which reads exactly like a type that works.
 * 2. The `Input` half of that same annotation stayed at its `unknown` default
 *    even after #4171 typed the `Output` half — so `z.input<typeof AppSchema>`
 *    left `navigation` unchecked, and `defineApp` (the documented authoring
 *    entry point, `config: z.input<typeof AppSchema>`) accepted
 *    `navigation: [{ totally: 'made up' }, 42, 'nonsense']` with a clean
 *    compile. The #4171 fix was verified through `z.infer`; nobody re-measured
 *    `z.input`, and half a fix looks identical to a whole one.
 *
 * Both failures share the shape this file exists to break: a type that accepts
 * too much reports nothing. A runtime test cannot catch either — the schema
 * parses correctly in both cases; it is the compile-time contract that lies.
 *
 * Why a plain src module and not a test: `packages/spec/tsconfig.json` EXCLUDES
 * every test file, and the CI gate for this package is `tsc --noEmit` over the
 * `src` tree (lint.yml), so probes must live in a non-test src file to be
 * checked at all. The file is referenced by no tsup entry and re-exported by no
 * barrel, so it adds nothing to any build; it exists purely to make
 * `tsc --noEmit` fail when the types and the schema drift apart again.
 *
 * The `@ts-expect-error` probes assert the NEGATIVE direction — if the type
 * ever starts accepting those shapes, the now-unused suppression becomes the
 * compile error. They are the half that catches "accepts too much", which is
 * the half both real failures landed in.
 */

import type { AppInput, NavigationItem, NavigationItemInput } from './app.zod';

/* ────────────────────────────────────────────────────────────────────────────
 * Output side (`z.infer`) — what a parse RETURNS.
 * Defaulted keys are present, so they are required here.
 * ──────────────────────────────────────────────────────────────────────────── */

const asItem = (x: NavigationItem): NavigationItem => x;

/** A group holding children, including a group nested under a group. */
export const groupWithChildren: NavigationItem = {
  id: 'group_probe',
  type: 'group',
  label: 'Probe',
  expanded: false,
  children: [
    { id: 'child_page', type: 'page', label: 'Child', pageName: 'probe_page' },
    { id: 'nested_group', type: 'group', label: 'Nested', expanded: true, children: [] },
  ],
};

/** An object item nesting its views — `children` stays OPTIONAL on this branch. */
export const objectWithChildren: NavigationItem = {
  id: 'obj_probe',
  type: 'object',
  label: 'Probe',
  objectName: 'probe_object',
  children: [{ id: 'obj_view', type: 'object', label: 'View', objectName: 'probe_object' }],
};

/** The same branch without children — legal, unlike `group`. */
export const objectWithoutChildren: NavigationItem = {
  id: 'obj_bare',
  type: 'object',
  label: 'Bare',
  objectName: 'probe_object',
};

/**
 * `expanded` is REQUIRED on the output side: `GroupNavItemSchema` declares it
 * `.default(false)`, so a parsed group always carries it. If this suppression
 * goes unused the default was dropped from the schema — and every consumer
 * reading `item.expanded` off a parsed app silently started getting
 * `undefined`.
 */
// @ts-expect-error — parsed groups always carry `expanded`
asItem({ id: 'group_bare', type: 'group', label: 'Bare', children: [] });

/** Only the `object` and `group` branches nest. */
// @ts-expect-error — `children` exists on no other branch
asItem({ id: 'page_probe', type: 'page', label: 'Probe', pageName: 'probe_page', children: [] });

/* ────────────────────────────────────────────────────────────────────────────
 * Input side (`z.input`) — what an AUTHOR writes.
 * Defaulted keys are omissible; everything else is still checked.
 * ──────────────────────────────────────────────────────────────────────────── */

const asInput = (x: NavigationItemInput): NavigationItemInput => x;

/**
 * The authoring shape: defaulted keys omitted. This is what cloud's admin app
 * and every downstream `defineApp` caller writes. Under the `unknown` input
 * this compiled for the uninteresting reason — everything did.
 */
export const inputOmitsDefaults: NavigationItemInput = {
  id: 'group_probe',
  type: 'group',
  label: 'Probe',
  children: [
    // `target` is `.default('_self')`, so it is omissible here and required above.
    { id: 'link', type: 'url', label: 'Link', url: 'https://example.com' },
  ],
};

/** Supplying a defaulted key explicitly stays legal. */
export const inputStatesDefaults: NavigationItemInput = {
  id: 'group_probe2',
  type: 'group',
  label: 'Probe',
  expanded: true,
  children: [],
};

/**
 * The load-bearing negatives. Each of these compiled clean while `Input` sat at
 * `unknown` — that is the whole bug, so these are the assertions that would
 * have caught it.
 */
// @ts-expect-error — a nav item is not an arbitrary record
asInput({ totally: 'made up', not: 'a nav item' });

// @ts-expect-error — a nav item is not a number
asInput(42);

// @ts-expect-error — a nav item is not a string
asInput('nonsense');

// @ts-expect-error — `type` must be one of the nine declared discriminants
asInput({ id: 'bad_type', type: 'not_a_variant', label: 'X' });

// @ts-expect-error — `group` requires `children` on both sides
asInput({ id: 'group_bare', type: 'group', label: 'Bare' });

// @ts-expect-error — the members are `.strict()`; an undeclared key is not authoring
asInput({ id: 'grp', type: 'group', label: 'G', children: [], defaultOpen: true });

// @ts-expect-error — only `object` and `group` nest, on this side too
asInput({ id: 'page_probe', type: 'page', label: 'P', pageName: 'probe_page', children: [] });

/* ────────────────────────────────────────────────────────────────────────────
 * The halves must stay DIFFERENT.
 *
 * If someone "simplifies" by pointing both parameters at one union, the
 * defaulted keys go wrong in one direction or the other: authors are forced to
 * write `expanded`, or consumers stop being able to read it. These two pin the
 * asymmetry itself.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Output is assignable to input — a parsed tree can be re-authored. */
export const outputFeedsInput: NavigationItemInput = groupWithChildren;

/** Input is NOT assignable to output: the defaults have not been applied yet. */
// @ts-expect-error — `NavigationItemInput` is the looser half, by design
asItem(inputOmitsDefaults);

/* ────────────────────────────────────────────────────────────────────────────
 * The WIRING — the assertions that actually catch the #4171 half-fix.
 *
 * Everything above pins the two unions. None of it pins the thing that broke:
 * whether `NavigationItemSchema` is annotated with `NavigationItemInput` at
 * all. A perfectly-written `NavigationItemInput` that no schema references
 * leaves `z.input<typeof AppSchema>` at `unknown` and every authoring path
 * unchecked — which is precisely the state this file was written to end.
 *
 * These go through `AppInput`, the type `defineApp` takes, so they fail the
 * moment the annotation loses its second parameter (verified by mutation:
 * dropping it back to `z.ZodType<NavigationItem>` turns all three into unused
 * suppressions).
 * ──────────────────────────────────────────────────────────────────────────── */

const asAppInput = (x: AppInput): AppInput => x;

/** The shape every downstream author writes — defaulted keys omitted. */
export const appInputOmitsDefaults: AppInput = {
  name: 'probe_app',
  label: 'Probe',
  navigation: [{ id: 'grp', type: 'group', label: 'G', children: [] }],
};

// @ts-expect-error — nav entries are checked; `unknown` would swallow this
asAppInput({ name: 'probe_app', label: 'Probe', navigation: [42] });

// @ts-expect-error — …and this
asAppInput({ name: 'probe_app', label: 'Probe', navigation: [{ totally: 'made up' }] });

// NOTE: kept on one line — `@ts-expect-error` suppresses the NEXT LINE only, and
// the excess-property error lands on the nav entry, not on the opening `asAppInput(`.
// @ts-expect-error — …and this, the strictness the nav members declare
asAppInput({ name: 'p', label: 'P', navigation: [{ id: 'grp', type: 'group', label: 'G', children: [], defaultOpen: true }] });
