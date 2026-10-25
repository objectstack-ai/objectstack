/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `PageNodeSchema` ↔ `@objectstack/spec` page-layer contract.
 *
 * Two pins, one contract: the authored page DOCUMENT and the SDUI page NODE are
 * different types at different layers, and the node's discriminant is exactly
 * `'page'`.
 *
 *  - `Page` in `@objectstack/spec/ui` is the page DOCUMENT — the authored
 *    metadata record, identified by `name`.
 *  - {@link PageNodeSchema} here is the SDUI NODE the renderer walks, tagged
 *    `type: 'page'`. That tag is not decoration: it is the `ComponentRegistry`
 *    key `@object-ui/components` registers `PageRenderer` under
 *    (`packages/components/src/renderers/layout/page.tsx`) — the WIRE key every
 *    producer of page metadata emits. Change it and authored JSON silently
 *    stops resolving to a renderer at runtime; nothing else in the repo
 *    complains at build time.
 *
 * Collapse the two types back together and the next renderer named after the
 * wrong layer compiles clean.
 *
 * ## Do not delete or relax these pins
 *
 * This is the ONLY place in the repo that pins `PageNodeSchema['type']` to
 * exactly `'page'`. `p1-spec-alignment.test.ts` writes
 * `const page: PageNodeSchema = { type: 'page', … }`, which looks equivalent
 * and is not: assignability only proves `'page'` is *admitted*, so widening the
 * discriminant to `string` — or to any union that still contains `'page'` —
 * leaves every one of those green. Only `Equal<…>` fails on a widening, which
 * is why `Equal` here must never be softened to `Extends`.
 *
 * ## Why this file, and not `packages/layout`
 *
 * These pins were written in
 * `packages/layout/src/__tests__/spec-symbol-batch7.test.ts` (objectui#3161,
 * objectstack#4115 ledger batch 7) and deliberately survived the deletion of
 * that package's `PageNodeRenderer` (objectui#3223): the component died, the
 * wire contract did not. They moved here (objectui#3227) because that left the
 * repo's only guard on this contract sitting in a package that no longer
 * references `PageNodeSchema` at all — where it read as debris from a finished
 * refactor, and deleting it would have gone unnoticed by every test. This
 * package declares the type, so it owns the pin.
 *
 * The `import type` of the spec's `Page` is load-bearing in the other
 * direction too: if the spec retires that name, this file stops compiling and
 * the layer split is re-triaged instead of quietly outliving its subject.
 *
 * ## These assertions are compile-time only
 *
 * They mean something here only because this package actually type-checks its
 * tests. `tsconfig.json` excludes test files (they must not emit into `dist`)
 * and `tsconfig.test.json` picks them back up, chained off the package's
 * `type-check` script. Vitest alone would NOT catch a broken pin — it strips
 * types without checking them (objectstack#4642). If this package ever stops
 * running `tsc -p tsconfig.test.json`, everything below silently becomes a
 * comment.
 */

import { describe, it, expect } from 'vitest';
import type { Page as SpecPage } from '@objectstack/spec/ui';
// Imported through the package entrypoint, not `../layout`: the barrel is the
// surface `@object-ui/components` and every other consumer sees.
import type { PageNodeSchema } from '../index';

/* -------------------------------------------------------------------------- */
/* Compile-time pins — compiled by tsconfig.test.json, chained off type-check. */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

describe('the authored page document and the SDUI page node stay two types', () => {
  it('is pinned at compile time', () => {
    // Keeps the pins below from passing vacuously: `Equal<any, X>` is `false`
    // and `keyof any` admits every key, so an `any` `SpecPage` would satisfy
    // both of them while checking nothing at all.
    type _PageIsReal = Assert<Equal<IsAny<SpecPage>, false>>;

    // The spec's `Page` is the page DOCUMENT (`name` identifies it); the SDUI
    // node is `PageNodeSchema`, tagged `type: 'page'`. Two layers, two names.
    type _DocumentIsNotNode = Assert<Equal<Equal<SpecPage, PageNodeSchema>, false>>;
    type _DocumentIsIdentified = Assert<HasKey<SpecPage, 'name'>>;

    // The wire key `PageRenderer` is registered under. Exact equality, not
    // assignability — see the file header.
    type _NodeIsATaggedNode = Assert<Equal<PageNodeSchema['type'], 'page'>>;

    expect(true).toBe(true);
  });
});
