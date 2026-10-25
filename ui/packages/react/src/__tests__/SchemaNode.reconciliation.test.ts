// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One `SchemaNode` (objectui#4580).
 *
 * Two packages published a type of this name and they were not the same type:
 *
 *   `@object-ui/core`  `interface SchemaNode { type: string; … [key: string]: any }`
 *   `@object-ui/types` `type SchemaNode = BaseSchema | string | number | boolean | null | undefined`
 *
 * Both are exported under one name from packages the same consumers import
 * together, so which declaration a call site got depended on which package it
 * happened to import from. #4548's option-A canary measured **19 of 35** errors
 * as exactly this collision. PR #4578 sidestepped it — `SchemaRenderer` states
 * its own component-level union instead of picking a side — and left the
 * reconciliation to this card.
 *
 * `@object-ui/types`' union wins: it is the spec of record (its own doc comment
 * names `'Plain string'` a valid node), and it is the side the measured
 * collisions resolve toward. Core's hand-declared interface becomes a
 * re-export, so there is exactly one declaration left to disagree with.
 *
 * ## Why this file lives in `@object-ui/react`
 *
 * It has to be a CONSUMER of both packages, resolving each through
 * `node_modules` — that is the only place the collision is observable. This
 * package's `tsconfig.test.json` sets `"paths": {}` precisely so `@object-ui/*`
 * resolve through the workspace dependency's built `.d.ts` rather than pulling
 * sibling sources in as program inputs, which is what makes the two `dist`
 * identities in the error text below real.
 *
 * ## Predictions, written before the first run (red-first)
 *
 * Against `origin/main` (`92250d648`), i.e. with core's interface still
 * hand-declared, `tsc -p packages/react/tsconfig.test.json` must report:
 *
 *   1. `assertion1` — `Equal< CoreSchemaNode, TypesSchemaNode >` resolves
 *      `false`, so `Expect< … >` fails its `extends true` constraint (TS2344).
 *   2. `acceptsCoreNode(typesNode)` — TS2322, naming both `dist` identities:
 *      `Type 'import(".../packages/types/dist/base").SchemaNode' is not
 *      assignable to type 'import(".../packages/core/dist/types/index").SchemaNode'`.
 *   3. `plainStringIsANode` — a plain string is a node per types' doc comment,
 *      and core's interface requires `type: string`, so this too is TS2322.
 *
 * After the fix all three compile clean. The assertions are deliberately
 * type-level and INVARIANT (`Equal`, not `extends`): a one-way `extends` — or a
 * bare `satisfies` — would stay green if core's declaration were merely made
 * assignable rather than made THE SAME TYPE, which is the whole defect.
 */

import { describe, it, expect } from 'vitest';
import type { SchemaNode as CoreSchemaNode } from '@object-ui/core';
import type { SchemaNode as TypesSchemaNode, TextSchema } from '@object-ui/types';

/* ── Type-level helpers ──────────────────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── 1. The two names are now one type ───────────────────────────────────── */

export type assertion1 = Expect< Equal< CoreSchemaNode, TypesSchemaNode > >;

/* ── 2. The measured collision, pinned at a call boundary ────────────────── */

declare function acceptsCoreNode(node: CoreSchemaNode): void;
declare const typesNode: TypesSchemaNode;

/**
 * Assignment position — this is the spelling #4580 quotes, and it reports
 * TS2322. The call-boundary spelling below is the same defect at an argument,
 * where the compiler reports TS2345 instead; both are pinned because both are
 * how the collision reached real call sites.
 *
 * ⚠️ Both live INSIDE never-called functions, and that is load-bearing rather
 * than stylistic. `typesNode` and `acceptsCoreNode` are `declare`d — they are
 * type-level fictions with no runtime existence — so a top-level
 * `export const coreNodeHoldsTypesNode: CoreSchemaNode = typesNode;` type-checks
 * exactly the same but **throws `ReferenceError: typesNode is not defined` the
 * moment vitest imports the module**, failing the whole suite before a single
 * case runs. Round 1 of this card only ever type-checked this file (the
 * reconciliation was withdrawn before it reached a vitest run), so the defect
 * was latent in the preserved pin and surfaced the first time both checkers saw
 * it. A function body is checked by `tsc` just as thoroughly and never
 * executes, which is what lets one file be read by both tools.
 */
export function assignmentPositionCompiles(): void {
  const coreNodeHoldsTypesNode: CoreSchemaNode = typesNode;
  void coreNodeHoldsTypesNode;
}

export function crossPackageHandoffCompiles(): void {
  // Pre-fix this is the 19-of-35 error class from #4548, verbatim.
  acceptsCoreNode(typesNode);
}

/* ── 3. The union's members are nodes through core's name too ────────────── */

export const plainStringIsANode: CoreSchemaNode = 'Plain string';
export const nullishIsANode: CoreSchemaNode = null;
// Authored as the `text` node it is (objectui#11349). `value` is the spelling
// `TextSchema` retired for `content` (objectui#7016), and a literal checked
// against the union may author only `BaseSchema`'s own keys now that
// objectui#8347 has removed its index signature. Same string, same pin.
const textNode: TextSchema = { type: 'text', content: 'Hello' };
export const objectIsStillANode: CoreSchemaNode = textNode;

/* ── Runtime companion ───────────────────────────────────────────────────── */

describe('SchemaNode is declared once (objectui#4580)', () => {
  it('type-level: core and types name the same type', () => {
    // The assertions above are erased at runtime — `tsc -p tsconfig.test.json`
    // is what checks them, and this package chains that from `type-check`.
    // This case documents that the pin is compile-time, so a reader does not
    // mistake a green vitest run for the proof.
    const witness: CoreSchemaNode = 'Plain string';
    expect(witness).toBe('Plain string');
  });
});
