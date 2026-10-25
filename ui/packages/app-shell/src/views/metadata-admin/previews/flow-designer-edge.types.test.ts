// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FlowDesignerEdge.condition` is the spec's EVALUATED expression input — the
 * type of the server's own edge slot — pinned at compile time (objectui#3202,
 * objectui#8946).
 *
 * The designer's edge guard used to be typed `string | { source?: string }`,
 * which describes an envelope WITHOUT the ADR-0089 `dialect` discriminant — a
 * shape the server's own `FlowEdgeSchema` rejects, and one nothing in this repo
 * has ever produced. An over-wide read type costs something even when no
 * runtime path exercises it: objectui#3171 was filed as a defect against that
 * phantom envelope, investigated, and does not reproduce. A type that cannot
 * DESCRIBE a spec-rejected condition cannot send the next reader down that road
 * either — which is only true for as long as somebody checks, hence this file.
 *
 * Importing is not enough on its own; the import has to name the slot's type.
 * Until objectui#8946 this member was the spec's `ExpressionInput`, the input
 * type of the PERSISTENCE contract (`source` OR `ast`). When the spec narrowed
 * `FlowEdgeSchema.condition` to `EvaluatedExpressionInputSchema`
 * (objectstack#15807), that import became wider than the slot: an `ast`-only
 * envelope type-checked here and was refused at parse. The assertions below
 * now pin the evaluated type, and they pin the `ast`-only refusal by name. A
 * blank `source` is NOT pinned as refused, because no type can refuse it: the
 * non-blank rule is a `.refine` on a string, and it runs only at parse.
 *
 * The assertions below are the file's entire point, and what makes them a check
 * rather than commentary is `packages/app-shell/tsconfig.test.json`: it compiles
 * every `src/**\/*.test.ts` in the package, this file included, and is chained
 * off the package's `type-check` script. Without some such project they WOULD be
 * commentary — the package's build tsconfig excludes `**\/*.test.ts`, and vitest
 * erases types before running (objectui#3181 — the same trap
 * `src/__tests__/spec-symbol-parity.test.ts` documents in its header). Coverage
 * is by glob, so this file earns it by living under `src/`, not by appearing on
 * a list; the narrow `tsconfig.typetests.json` that used to name it was retired
 * when the package graduated (objectui#4040). The
 * runtime case at the bottom is real too: it walks an envelope through
 * `conditionText`, the reader every consumer of this type goes through.
 */

import { describe, it, expect } from 'vitest';
import { conditionText, type FlowDesignerEdge } from './flow-canvas-layout';
import type { EvaluatedExpressionInput, ExpressionInput } from '@objectstack/spec/shared';

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

type Condition = NonNullable<FlowDesignerEdge['condition']>;

describe('FlowDesignerEdge.condition mirrors the spec EvaluatedExpressionInput', () => {
  it('is pinned at compile time', () => {
    // Guard against the probe lying: were either side `any`, every
    // assignability assertion below would pass while proving nothing
    // (objectstack#4171 is exactly that failure mode for other symbols).
    type _SpecNotAny = Assert<Equal<IsAny<EvaluatedExpressionInput>, false>>;
    type _LocalNotAny = Assert<Equal<IsAny<Condition>, false>>;

    // Not "compatible with" — the SAME type. Restating the envelope locally is
    // how the two drift apart again.
    type _IsExactlyTheSpecType = Assert<Equal<Condition, EvaluatedExpressionInput>>;
    // And not the persistence contract's type, which is what this member was
    // until objectui#8946. Equality with the evaluated type does not imply
    // this: were the spec to widen the evaluated type back to the persistence
    // contract, the assertion above would stay green and this one would not.
    type _PersistenceNotAny = Assert<Equal<IsAny<ExpressionInput>, false>>;
    type _IsNotThePersistenceType = Assert<Equal<Equal<Condition, ExpressionInput>, false>>;

    // The authored shorthand (a bare CEL string) stays authorable…
    type _StringIsACondition = Assert<Extends<string, Condition>>;
    // …and the full envelope with its REQUIRED discriminant.
    type _EnvelopeIsACondition = Assert<Extends<{ dialect: 'cel'; source: string }, Condition>>;

    // The regression itself: a `dialect`-less envelope is no longer expressible.
    // `FlowEdgeSchema` rejects it, so this type must too.
    type _DialectlessRejected = Assert<Equal<Extends<{ source: string }, Condition>, false>>;
    // And `dialect` is closed over the spec's three dialects (`js` was retired
    // in objectstack#3278) — a free-form string is not a dialect.
    type _DialectIsClosed = Assert<Equal<Extends<{ dialect: 'sql'; source: string }, Condition>, false>>;

    // objectui#8946: an envelope carrying only a compiled `ast`, with no
    // `source`, is no longer expressible. `FlowEdgeSchema.condition` refuses
    // it at parse since objectstack#15807, so this type must too.
    type _AstOnlyRejected = Assert<Equal<Extends<{ dialect: 'cel'; ast: unknown }, Condition>, false>>;
    // …while the persistence contract still admits it. This is the control:
    // were the spec to stop admitting the shape anywhere, the assertion above
    // would pass for a reason that has nothing to do with this member.
    type _AstOnlyIsPersistable = Assert<Extends<{ dialect: 'cel'; ast: unknown }, ExpressionInput>>;

    expect(true).toBe(true);
  });

  it('refuses an `ast`-only condition written inline, and accepts the envelope with a `source`', () => {
    // The `Extends` assertions above compare types. These consts exercise
    // assignment of an object literal, which is where an author writes one.
    const withSource: FlowDesignerEdge = {
      source: 'a',
      target: 'b',
      condition: { dialect: 'cel', source: 'x > 1' },
    };
    const astOnly: FlowDesignerEdge = {
      source: 'a',
      target: 'b',
      // @ts-expect-error — an `ast`-only envelope has no `source`, and the edge slot requires one (objectui#8946).
      condition: { dialect: 'cel', ast: { op: 'gt' } },
    };
    expect(conditionText(withSource.condition)).toBe('x > 1');
    expect(astOnly.condition).toBeDefined();
  });

  it('reads both spellings at runtime, which is why both must type-check', () => {
    const bare: FlowDesignerEdge = { source: 'a', target: 'b', condition: 'amount > 10' };
    const envelope: FlowDesignerEdge = {
      source: 'a',
      target: 'b',
      condition: { dialect: 'cel', source: 'amount > 10' },
    };
    expect(conditionText(bare.condition)).toBe('amount > 10');
    expect(conditionText(envelope.condition)).toBe('amount > 10');
    // An envelope carrying only a compiled `ast` has no readable source yet
    // (spec phase M9.2) — the reader says so instead of inventing text. The
    // reader takes the persistence contract, which admits this shape, so the
    // call type-checks although no `FlowDesignerEdge` can carry the value.
    expect(conditionText({ dialect: 'cel', ast: { op: 'gt' } })).toBeUndefined();
  });
});
