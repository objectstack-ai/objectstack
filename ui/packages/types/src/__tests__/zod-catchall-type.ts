/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "What a mirror member ACCEPTS, read without its catchall", spelled ONCE for
 * the type pins that compare a zod mirror's input type with the TypeScript
 * declaration it restates (objectstack#25923). Test-only: `__tests__/` is
 * excluded from this package's build, and nothing re-exports this module.
 *
 * Every object a mirror writes is `.passthrough()` (`z.looseObject`) or strict
 * since objectstack#25923: none of them strips an unknown key. zod 4 types the
 * passthrough catchall as a string index signature of `unknown` on the object's
 * input type, and a declared `interface` is NOT assignable to a type carrying
 * one (an interface has no implicit index signature), so a pin reading
 * `z.input` as it stands reports every nested object member as narrower than
 * its declaration — a difference in no value either side accepts, because the
 * catchall refuses nothing.
 *
 * `WithoutCatchall` removes exactly that index signature:
 *
 *  - only an index signature of `unknown` on an object that ALSO has literal
 *    keys — the catchall's shape. A declared record (`Record<string, any>`,
 *    `z.record(…)`) has no literal key and is kept as it is;
 *  - arrays, tuples and unions are walked (an array or tuple through a
 *    homomorphic map, which keeps its arity and `readonly`), and so are the
 *    members of an object that carries the catchall (a loose object nests in a
 *    loose object);
 *  - every other type — a function, a `Date`, an object with no catchall (a spec
 *    subschema imported by reference, a declared record, a
 *    `Partial< Record< … > >`) — is returned AS IT IS, so the operator is the
 *    identity everywhere the strip-mode reading already held, and an exact
 *    `Equal` pin over it compares what it compared before.
 *
 * ⚠️ That last case is a measured limit, not an oversight: a loose object held
 * inside an object WITHOUT a catchall keeps its signature. Walking into those
 * objects too was measured on objectstack#25923 and is "excessively deep" for
 * `tsc` (TS2589) over the node tree, which nests itself through every child
 * slot — even one bounded level of it. The residue is ledgered where it lands
 * (`reports.zod.ts`'s `exportConfigs`, a `Partial< Record< Format, Config > >`,
 * in `./zod-mirror-parity.test.ts`'s `KnownDrift`).
 *
 * It is NOT a licence to compare loosely: every literal key and every member
 * type still has to match, and a pin over it still goes red the moment a
 * mirror member narrows or widens on a declared key.
 */

type LiteralKeys< T > = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: 0;
};

type IsUnknown< T > = unknown extends T ? ([keyof T] extends [never] ? true : false) : false;

export type WithoutCatchall< T > =
  T extends (...args: never[]) => unknown ? T
  : T extends Date ? T
  : T extends readonly unknown[]
    ? { [K in keyof T]: WithoutCatchall< T[K] > }
  : T extends object
    ? string extends keyof T
      ? [LiteralKeys< T >] extends [never]
        ? T
        : IsUnknown< T[string & keyof T] > extends true
          ? { [K in keyof T as string extends K ? never : number extends K ? never : K]: WithoutCatchall< T[K] > }
          : T
      : T
  : T;
