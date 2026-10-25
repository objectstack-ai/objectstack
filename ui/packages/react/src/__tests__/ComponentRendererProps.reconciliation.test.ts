/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One `ComponentRendererProps` (objectui#4594).
 *
 * Two packages published a type of this name and they were not the same type:
 *
 *   `@object-ui/core`  `interface ComponentRendererProps { schema: SchemaNode; … }`
 *   `@object-ui/types` `interface ComponentRendererProps< TSchema extends BaseSchema = BaseSchema > { schema: TSchema; … }`
 *
 * The second such pair in one file — it sat two lines below `SchemaNode`, whose
 * reconciliation #4580/PR #4608 settled — and the third across this fault line
 * once `ComponentInput` (#4972/PR #5671) is counted. `@object-ui/types`' generic
 * declaration wins and core's becomes a re-export, so there is exactly one
 * declaration left to disagree with.
 *
 * ## Why this file lives in `@object-ui/react`
 *
 * Same reason as `SchemaNode.reconciliation.test.ts` next door: the pin has to
 * be a CONSUMER of both packages, resolving each through `node_modules`. This
 * package's `tsconfig.test.json` sets `"paths": {}` precisely so `@object-ui/*`
 * resolve through the workspace dependency's built `.d.ts` rather than pulling
 * sibling sources in as program inputs — which is what makes the two `dist`
 * identities real rather than an artefact of the source tree.
 *
 * `ComponentRendererProps` had **zero consumers** when this was written (the
 * measurement #4594 was dispatched on, re-verified on the merged ref). This
 * file is therefore the type's first consumer, and deliberately so: a name that
 * nothing imports is a name nothing can hold still, and the interim state the
 * card closes — core's `schema` silently widened to types' `SchemaNode` union
 * when #4608 landed — arrived exactly that way, with no consumer to notice.
 *
 * ## Predictions, written before the first run (red-first)
 *
 * With core's declaration restored to the hand-written non-generic interface,
 * `tsc -p packages/react/tsconfig.test.json` must report:
 *
 *   1. `assertion1` — `Equal< CoreProps, TypesProps >` resolves `false`
 *      (core's `schema` is the `SchemaNode` union, types' is `BaseSchema`), so
 *      `Expect< … >` fails its `extends true` constraint: **TS2344**.
 *   2. `assertion2` / `narrowedSchemaArmCompiles` — a type argument applied to
 *      core's name: **TS2315**, `Type 'ComponentRendererProps' is not generic`.
 *   3. `narrowedSchemaArmCompiles` again, at the read — core's `schema` is the
 *      union, which is not assignable to a `BaseSchema` sub-interface: **TS2322**.
 *
 * After the fix all three compile clean. The equality assertion is deliberately
 * INVARIANT (`Equal`, not `extends`): the index signature `[key: string]: any`
 * makes almost anything mutually assignable, so a one-way `extends` — or a bare
 * `satisfies` — would stay green against a structural copy, which is the whole
 * defect.
 */

import { describe, it, expect } from 'vitest';
import type { ComponentRendererProps as CoreProps } from '@object-ui/core';
import type {
  ComponentRendererProps as TypesProps,
  BaseSchema,
} from '@object-ui/types';

/* ── Type-level helpers ──────────────────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/** A concrete arm, to prove the type parameter is reachable through core's name. */
interface TextSchema extends BaseSchema {
  type: 'text';
  value?: string;
}

/* ── 1. The two names are now one type ───────────────────────────────────── */

export type assertion1 = Expect< Equal< CoreProps, TypesProps > >;

/* ── 2. Core's name carries the type parameter, with the same default ────── */

export type assertion2 = Expect< Equal< CoreProps< TextSchema >, TypesProps< TextSchema > > >;
export type assertion3 = Expect< Equal< CoreProps, TypesProps< BaseSchema > > >;

/* ── 3. The parameter actually narrows `schema`, read through core's name ── */

/**
 * ⚠️ Inside a never-called function on purpose — the sibling `SchemaNode` pin
 * records why: `declare`d values are type-level fictions, so a top-level
 * `const` of one throws `ReferenceError` the moment vitest imports the module
 * and fails the whole suite before a case runs. A function body is checked by
 * `tsc` just as thoroughly and never executes, which is what lets one file be
 * read by both tools. Nothing here is `declare`d today, but the constraint is
 * the file's, not the expression's.
 */
export function narrowedSchemaArmCompiles(): void {
  const props: CoreProps< TextSchema > = { schema: { type: 'text', value: 'Hello' } };
  // Pre-fix this read is the union, not the arm: TS2322.
  const node: TextSchema = props.schema;
  void node;
}

/* ── Runtime companion ───────────────────────────────────────────────────── */

describe('ComponentRendererProps is declared once (objectui#4594)', () => {
  it('type-level: core and types name the same type', () => {
    // The assertions above are erased at runtime — `tsc -p tsconfig.test.json`
    // is what checks them, and this package chains that from `type-check`.
    // This case documents that the pin is compile-time, so a reader does not
    // mistake a green vitest run for the proof.
    const witness: CoreProps< TextSchema > = { schema: { type: 'text' } };
    expect(witness.schema.type).toBe('text');
  });
});
