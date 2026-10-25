/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7497 — `QueryParams` is a CLOSED key set. It carried
 * `[key: string]: any` ("additional custom parameters") while every reader in
 * the repository — `convertQueryParams` / `rawFindWithPopulate` in
 * `@object-ui/data-objectstack`, `queryParamsToRecord` in `@object-ui/core`,
 * `ValueDataSource.find` — copied exactly the declared `$`-prefixed members. So
 * a misspelled key type-checked and was dropped on the floor: `{ filter }` for
 * `$filter` (the published testing guide taught a test built on it, which could
 * never pass), `{ limit }` for `$top` (objectui#5458, four live sites, one of
 * which INVERTED "count only" into "fetch every row"), `{ options: { $top } }`
 * (objectui#4734). A census at the closing commit found zero non-`$` keys in
 * any `find` / `findOne` call or `QueryParams` literal across packages, apps,
 * examples, e2e and scripts, and no reader of one — the signature carried
 * nothing but typos.
 *
 * ## Why these pins are compile-time, and which one is load-bearing
 *
 * The defect never reached a runtime suite and could not: a dropped key changes
 * the query, not the type of the result, and the mocks in this repo answer any
 * params. So the regression signature is a `tsc` verdict, and this file is
 * compiled by `tsc -p tsconfig.test.json` (the package's `type-check` script),
 * where an unused `@ts-expect-error` is itself an error — every refusal below
 * is therefore asserted in BOTH directions.
 *
 * The `keyof` identity pin is the one that cannot be fooled. Every
 * `@ts-expect-error` pin goes red on a revert (the literal compiles again, the
 * directive is unused), which is enough — but a *weaker* reopening, such as an
 * index signature typed `unknown` or `never`, could keep some of them red for
 * the wrong reason. `keyof` separates the declarations cleanly: with any string
 * index signature it widens to `string | number`; closed, it is exactly the
 * nine declared names. Adding a tenth query option changes that pin too — on
 * purpose: a new member is only a member once every reader honours it, and the
 * list here is the checklist for that.
 *
 * ## What is deliberately NOT changed by the closing
 *
 * A type ASSERTION still compiles — `{ limit: 1 } as QueryParams` — because
 * assertions skip excess-property checking. That is not a hole this file can
 * close; it is why `object-ui/no-unprefixed-query-params` keeps its typed test
 * cases and runs at write time.
 */

import { describe, it, expect } from 'vitest';
import type { QueryParams } from '../data';

type Assert< T extends true > = T;
/** Exact type identity — NOT mutual assignability. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;

/** The nine members, spelled once here as the checklist a tenth must join. */
type DeclaredKeys =
  | '$select'
  | '$filter'
  | '$orderby'
  | '$skip'
  | '$top'
  | '$expand'
  | '$search'
  | '$searchFields'
  | '$count';

/** A typed finder, the shape every `DataSource.find` implementation has. */
declare function find(resource: string, params?: QueryParams): Promise<unknown>;

describe('QueryParams — a closed key set (#7497)', () => {
  it('is exactly the nine declared keys — no index signature (the load-bearing pin)', () => {
    // With `[key: string]: any` present, `keyof QueryParams` is
    // `string | number` and this line goes red. That is the whole regression
    // in one assertion; the pins below say WHICH spellings that reopening
    // would let back in.
    type _Closed = Assert< Equal< keyof QueryParams, DeclaredKeys > >;
    expect(true).toBe(true);
  });

  it('accepts every declared key together, with no cast', () => {
    const params: QueryParams = {
      $select: ['id', 'name'],
      $filter: { active: true },
      $orderby: { name: 'asc' },
      $skip: 0,
      $top: 50,
      $expand: ['owner'],
      $search: 'acme',
      $searchFields: ['name'],
      $count: true,
    };
    expect(Object.keys(params)).toHaveLength(9);
  });

  it('refuses the unprefixed spellings the readers drop', () => {
    // The testing guide's Pattern 7 (objectui#7494 / PR #7496): compiled,
    // dropped, and the assertion built on it could never pass.
    // @ts-expect-error `filter` is not a QueryParams key — write `$filter`
    const guide: QueryParams = { filter: { active: true } };
    // objectui#5458 — `limit: 0` that turned "count only" into "fetch all".
    // @ts-expect-error `limit` is not a QueryParams key — write `$top`
    const cap: QueryParams = { $filter: { active: true }, limit: 0 };
    // objectui#4734 — the cap nested under a key nothing reads. The lint rule
    // written for that shape fires here as designed; this pin writes the dead
    // shape on purpose, to prove `tsc` now refuses it too.
    // @ts-expect-error `options` is not a QueryParams key
    // eslint-disable-next-line object-ui/no-query-params-under-options
    const nested: QueryParams = { options: { $top: 100 } };
    expect([guide, cap, nested]).toHaveLength(3);
  });

  it('refuses a `$`-prefixed key nothing reads, too', () => {
    // The closing is "declared = enforced", not "starts with a dollar sign": a
    // `$`-prefixed template-literal key would have let this one compile and
    // then dropped it, which is the same defect with a different spelling.
    // @ts-expect-error `$limit` is not a QueryParams key — write `$top`
    const params: QueryParams = { $limit: 5 };
    expect(params).toBeDefined();
  });

  it('refuses the same spellings at a typed finder call site', () => {
    // Excess-property checking applies to a literal passed straight to the
    // parameter, so the call — the shape the guide taught — is refused where
    // it is written. `find` is only DECLARED above (no runtime binding), so the
    // call sits inside a function this test never invokes: the pin is the
    // compile-time verdict, not the call.
    // @ts-expect-error `filter` is not a QueryParams key — write `$filter`
    const call = () => find('contacts', { filter: { active: true } });
    expect(typeof call).toBe('function');
  });

  it('refuses reading an undeclared key off a QueryParams value (the reader side)', () => {
    // An adapter cannot quietly grow a consumer of an extra key either: the
    // read is refused, so a new option has to be declared here first.
    const read = (p?: QueryParams) => {
      // @ts-expect-error `filter` does not exist on QueryParams
      return p?.filter;
    };
    expect(read({ $top: 1 })).toBeUndefined();
  });
});
