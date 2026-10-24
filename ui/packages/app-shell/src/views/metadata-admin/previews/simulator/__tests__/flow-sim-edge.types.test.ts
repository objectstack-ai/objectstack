// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `SimEdge.condition` is the spec's EVALUATED expression input — the type of
 * the server's own edge slot — pinned at compile time (objectui#3216,
 * objectui#8946).
 *
 * This was the LAST copy of the restatement objectui#3202 removed from
 * `FlowDesignerEdge`: `string | { source?: string }`, a spelling wrong in both
 * directions at once. Too WIDE, because it describes an envelope with no
 * `dialect` — a shape the server's `FlowEdgeSchema` rejects outright. Too
 * NARROW, because excess-property checking then refuses the CANONICAL envelope
 * written as a literal: `condition: { dialect: 'cel', source }` fails with
 * "'dialect' does not exist in type '{ source?: string }'", so the one shape a
 * persisted flow actually carries was the one shape you could not write down.
 * Both errors come from the same act — writing the shape out by hand instead of
 * importing it — and correcting it by hand only moves the drift to the next
 * omitted member (`ast`, `meta`).
 *
 * The over-wide half is not academic: the simulator's readers took exactly the
 * branch that type invited (`typeof c === 'string'`, everything else
 * `undefined`) and skipped envelope guards the engine evaluates. The assertions
 * below make the local type incapable of describing either error again.
 *
 * objectui#8946 moved it once more, and not by hand: it still imports, but it
 * imports the type of the slot. `FlowEdgeSchema.condition` composes
 * `EvaluatedExpressionInputSchema` since objectstack#15807, and the spec's
 * `ExpressionInput`, which this member used to be, is the persistence contract
 * (`source` OR `ast`). That type admits an `ast`-only guard the edge slot
 * refuses at parse, so it had become wider than the slot it mirrored.
 *
 * The assertions ARE the file, and `packages/app-shell/tsconfig.test.json` is
 * what makes them a check: it compiles every `src/**\/*.test.ts` in the package,
 * this file included, chained off the package's `type-check` script. Uncompiled
 * they would be commentary — the package's build tsconfig excludes
 * `**\/*.test.ts` and vitest erases types before running (objectui#3181).
 * Coverage is by glob, not by a listing: the narrow `tsconfig.typetests.json`
 * that used to name this file was retired when the package graduated
 * (objectui#4040).
 */

import { describe, it, expect } from 'vitest';
import { FlowEdgeSchema } from '@objectstack/spec/automation';
import type { z } from 'zod';
import type { EvaluatedExpressionInput, ExpressionInput } from '@objectstack/spec/shared';
import type { SimEdge } from '../flow-sim-types';
import type { FlowDesignerEdge } from '../../flow-canvas-layout';

type Assert< T extends true > = T;
type Extends< A, B > = [A] extends [B] ? true : false;
type IsAny< T > = 0 extends 1 & T ? true : false;
type Equal< A, B > = (< T >() => T extends A ? 1 : 2) extends < T >() => T extends B ? 1 : 2
  ? true
  : false;

type Condition = NonNullable< SimEdge['condition'] >;
/** An edge as the server PERSISTS it — `FlowEdgeSchema`'s parsed output. */
type PersistedEdge = z.infer< typeof FlowEdgeSchema >;

describe('SimEdge.condition mirrors the spec EvaluatedExpressionInput', () => {
  it('is pinned at compile time', () => {
    // Guard against the probe lying: were either side `any`, every
    // assignability assertion below would pass while proving nothing.
    type _SpecNotAny = Assert< Equal< IsAny< EvaluatedExpressionInput >, false > >;
    type _LocalNotAny = Assert< Equal< IsAny< Condition >, false > >;

    // Not "compatible with" — the SAME type. Restating it is how they drift.
    type _IsExactlyTheSpecType = Assert< Equal< Condition, EvaluatedExpressionInput > >;

    // …and therefore the same type the designer canvas carries, so an edge can
    // cross from the canvas into the simulator with nothing to reconcile.
    type _AgreesWithTheCanvas = Assert< Equal< Condition, NonNullable< FlowDesignerEdge['condition'] > > >;

    // The authored shorthand (a bare CEL string) stays authorable…
    type _StringIsACondition = Assert< Extends< string, Condition > >;
    // …as does the envelope the spec canonicalises that string INTO — the form
    // the two readers used to report as "no condition".
    type _EnvelopeIsACondition = Assert< Extends< { dialect: 'cel'; source: string }, Condition > >;
    // …including the optional authorship `meta` the old restatement dropped.
    type _MetaIsACondition = Assert<
      Extends< { dialect: 'cel'; source: string; meta: { generatedBy: string } }, Condition >
    >;

    // The over-wide half of the regression: a `dialect`-less envelope is no
    // longer expressible. `FlowEdgeSchema` rejects it, so this type must too.
    type _DialectlessRejected = Assert< Equal< Extends< { source: string }, Condition >, false > >;
    // And `dialect` is closed over the spec's three dialects.
    type _DialectIsClosed = Assert< Equal< Extends< { dialect: 'sql'; source: string }, Condition >, false > >;
    // objectui#8946: an `ast`-only guard is not expressible, because the edge
    // slot refuses it at parse. The persistence contract still admits it, and
    // that is the control that keeps this assertion from passing vacuously.
    type _AstOnlyRejected = Assert< Equal< Extends< { dialect: 'cel'; ast: unknown }, Condition >, false > >;
    type _PersistenceNotAny = Assert< Equal< IsAny< ExpressionInput >, false > >;
    type _AstOnlyIsPersistable = Assert< Extends< { dialect: 'cel'; ast: unknown }, ExpressionInput > >;

    // The whole point, stated end to end: an edge the SERVER hands back is a
    // thing the simulator accepts, with no reconciliation and no cast. That is
    // what objectui#3216 was not — the simulator's own input type described a
    // guard shape the persisted edge never has.
    type _PersistedEdgeNotAny = Assert< Equal< IsAny< PersistedEdge >, false > >;
    type _PersistedEdgeIsASimEdge = Assert< Extends< PersistedEdge, SimEdge > >;

    expect(true).toBe(true);
  });

  it('accepts the canonical envelope written INLINE — the half `Extends` cannot see', () => {
    // The assertions above compare types; this one exercises excess-property
    // checking, which is where the old restatement failed in the NARROW
    // direction. Under `{ source?: string }` both consts below are compile
    // errors ("'dialect' does not exist in…"), which is why an edge fixture in
    // this repo could never spell the shape the spec canonicalises guards into.
    const guarded: SimEdge = {
      source: 'd',
      target: 'hi',
      condition: { dialect: 'cel', source: 'amount > 10' },
    };
    // …including the optional authorship `meta` that a "corrected" restatement
    // would be the next thing to drop.
    const annotated: SimEdge = {
      source: 'd',
      target: 'hi',
      condition: { dialect: 'cel', source: 'amount > 10', meta: { generatedBy: 'agent' } },
    };
    expect(guarded.condition).toBeTruthy();
    expect(annotated.condition).toBeTruthy();
  });
});
