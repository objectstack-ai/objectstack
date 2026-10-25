/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11355 round 2 — two declarations the seat ruled on that card.
 *
 * - `ActionBarSchema` (ruling B) is the `action:bar` node, declared here in the
 *   protocol package and imported by `@object-ui/components`' renderer. It has
 *   NO index signature: a key it does not declare is refused on a typed
 *   literal. `actions` and `location` take `UIActionSchema` and the spec's
 *   `ActionLocation` by reference.
 * - `ObjectChartSchema.isAnimationActive` (ruling A) is a host-composed render
 *   flag, declared on the TypeScript face only. The zod mirror has no member
 *   for it; `zod-mirror-parity` files it as runtime-only.
 *
 * The rows below are compile-time (`tsc -p tsconfig.test.json`), except the
 * last block, which reads the mirror at runtime beside a control.
 */

import { describe, it, expect } from 'vitest';
import type { ActionLocation } from '@objectstack/spec/ui';
import { ObjectChartSchema } from '../zod/objectql.zod';
import type { ObjectChartSchema as TsObjectChartSchema } from '../objectql';
import type { ActionBarSchema, UIActionSchema } from '../index';

/** Compile-time truth assertion, erased at runtime — only `tsc` checks these. */
type Expect<T extends true> = T;
/** Compile-time equality, exact in both directions; `any` equals nothing but `any`. */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

/* ── action:bar ──────────────────────────────────────────────────────────── */

/** No string index signature: `keyof` stays the declared members. */
export type _ActionBarHasNoIndexSignature = Expect<Equal<string extends keyof ActionBarSchema ? true : false, false>>;
/** The members, as the renderer reads them. */
export type _ActionBarMembers = Expect<
  Equal<
    keyof ActionBarSchema,
    | 'type' | 'actions' | 'systemActions' | 'location' | 'maxVisible' | 'mobileMaxVisible'
    | 'visible' | 'direction' | 'gap' | 'variant' | 'size' | 'className'
  >
>;
/** By reference, not restated. */
export type _ActionBarActionsAreUIActions = Expect<Equal<ActionBarSchema['actions'], UIActionSchema[] | undefined>>;
export type _ActionBarSystemActionsAreUIActions = Expect<Equal<ActionBarSchema['systemActions'], UIActionSchema[] | undefined>>;
export type _ActionBarLocationIsTheSpecs = Expect<Equal<ActionBarSchema['location'], ActionLocation | undefined>>;

/** CONTROL — the declared spelling compiles. */
export const _actionBarAccepted: ActionBarSchema = { type: 'action:bar', location: 'list_toolbar', actions: [] };
/** The same literal with the key misspelt is refused, which is what the missing signature buys. */
// @ts-expect-error -- `locaton` is not a member of `ActionBarSchema`
export const _actionBarRefused: ActionBarSchema = { type: 'action:bar', locaton: 'list_toolbar', actions: [] };

/* ── object-chart isAnimationActive ──────────────────────────────────────── */

export type _IsAnimationActiveIsABoolean = Expect<Equal<TsObjectChartSchema['isAnimationActive'], boolean | undefined>>;

describe('object-chart isAnimationActive stays off the zod mirror (objectui#11355)', () => {
  it('the mirror declares no member for it', () => {
    expect(Object.keys(ObjectChartSchema.shape)).not.toContain('isAnimationActive');
  });

  it('CONTROL — the mirror does declare a sibling member the TS face also has', () => {
    expect(Object.keys(ObjectChartSchema.shape)).toContain('xAxisKey');
  });
});
