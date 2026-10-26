/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * [objectui#6332] The explain REQUEST this hook sends is the spec's
 * `ExplainRequest`, and `RecordCrudOperation` is a DECLARED subset of the
 * spec's eight-verb enum rather than an unrelated union that happens to spell
 * two of them.
 *
 * ## Why every assertion here is a compile-time one
 *
 * State the limit first, because it decides the whole shape of this file: the
 * adoption is **type-only and erased at runtime**. The bytes on the wire are
 * identical before and after — `{ object, operation, recordIds }` either way.
 * So there is no runtime behaviour to pin, and a vitest case that captured the
 * outgoing body and parsed it with `ExplainRequestSchema` would pass against
 * the PRE-fix hook too. That is exactly the "ghost assertion" shape
 * `./useRecordCrudVerdicts.batchCap.test.tsx` documents next door: an
 * assertion that reads like a contract test and cannot fail for the drift it
 * claims to cover. This file does not write one.
 *
 * What the change genuinely buys is a class of COMPILE errors that the old
 * code accepted, and the honest place to pin that is `tsc`. Two independent
 * mechanisms are used, both of which fail loudly:
 *
 *   - `Assert<...>` aliases (the house idiom — see
 *     `../__tests__/spec-symbol-batch7.test.ts`), which raise TS2344 when the
 *     relation they state stops holding.
 *   - `@ts-expect-error`, which is SELF-PROVING in the other direction: if the
 *     error it expects stops happening, the directive is unused and tsc raises
 *     TS2578. A pin that silently stopped checking is therefore not a way this
 *     file can fail — the narrowing pins below all take this form.
 *
 * ⚠️ These assertions are erased before anything runs, so vitest proves nothing
 * about them. They are checked by `tsc -p tsconfig.test.json`, the second half
 * of this package's `type-check` script — verified with `--listFiles`, which
 * names this file as a program input. The single runtime case at the bottom is
 * a vacuity control, not a contract test.
 */

import { describe, it, expect } from 'vitest';
import {
  ExplainRequestSchema,
  type ExplainOperation,
  type ExplainRequest,
} from '@objectstack/spec/security';

import type { RecordCrudOperation } from './useRecordCrudVerdicts';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

/* -------------------------------------------------------------------------- */
/* The spec symbols are real — without this the pins below are vacuous         */
/* -------------------------------------------------------------------------- */

// If `@objectstack/spec/security` ever stopped exporting these, an untyped
// import would degrade to `any` and EVERY assertion in this file would pass
// while checking nothing. Both are pinned as not-any first, for the same reason
// `spec-symbol-batch7.test.ts` opens with `_SpecIsReal`.
type _ExplainOperationIsReal = Assert<Equal<IsAny<ExplainOperation>, false>>;
type _ExplainRequestIsReal = Assert<Equal<IsAny<ExplainRequest>, false>>;

/* -------------------------------------------------------------------------- */
/* The narrowing survives the adoption (the card's load-bearing constraint)     */
/* -------------------------------------------------------------------------- */

// Exactly the two kebab verbs, still — adopting the spec's request type must
// not have widened this to the spec's vocabulary.
type _StillExactlyTwoVerbs = Assert<Equal<RecordCrudOperation, 'update' | 'delete'>>;

// ...and they ARE spec verbs. This is the half `SpecVerbSubset` enforces at the
// declaration; restating it here means the relation is pinned from outside the
// module too, so deleting the wrapper does not delete the check.
type _NarrowingIsASpecSubset = Assert<Extends<RecordCrudOperation, ExplainOperation>>;

// ...a PROPER subset. Equality here would mean the narrowing was replaced by
// the spec enum wholesale — the specific regression this card must not cause.
type _NarrowingIsNotTheWholeEnum = Assert<Equal<Equal<RecordCrudOperation, ExplainOperation>, false>>;

describe('[#6332] the kebab verbs stay a declared subset of the spec enum', () => {
  it('rejects every spec verb that is not a row-kebab verb', () => {
    // Each directive is live only while the verb beside it is NOT assignable.
    // Widen `RecordCrudOperation` to `ExplainOperation` and these do not fail
    // to catch anything — they become UNUSED, which is TS2578 and red. That is
    // why the narrowing is pinned this way rather than with a bare `Assert`.
    // @ts-expect-error 'read' is a spec verb, but a row kebab offers no read affordance
    const _read: RecordCrudOperation = 'read';
    // @ts-expect-error 'create' is a spec verb; creation is not a per-ROW verdict at all
    const _create: RecordCrudOperation = 'create';
    // @ts-expect-error 'restore' is a spec verb this list has no affordance for
    const _restore: RecordCrudOperation = 'restore';
    // @ts-expect-error 'purge' is a spec verb this list has no affordance for
    const _purge: RecordCrudOperation = 'purge';
    // @ts-expect-error 'export' is a spec verb, and it is an OBJECT-level affordance here
    const _export: RecordCrudOperation = 'export';
    // @ts-expect-error 'transfer' is a spec verb this list has no affordance for
    const _transfer: RecordCrudOperation = 'transfer';
    expect(true).toBe(true);
  });

  it('rejects a verb the explain API does not accept at all', () => {
    // The other direction, and the one `SpecVerbSubset` on the declaration
    // catches at its source: an invented verb is neither a kebab verb nor a
    // spec verb. Before the adoption a widening to `'archive'` compiled
    // cleanly here and failed as `400 VALIDATION_FAILED` in a browser.
    // @ts-expect-error 'archive' is not a verb the explain API accepts
    const _archive: RecordCrudOperation = 'archive';
    // @ts-expect-error ...and it is not one the spec's own enum accepts either
    const _archiveSpec: ExplainOperation = 'archive';
    expect(true).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The request body answers to the spec's request contract                     */
/* -------------------------------------------------------------------------- */

describe('[#6332] the explain request body is the spec\'s ExplainRequest', () => {
  it('accepts the exact literal the hook builds', () => {
    // The shape at the call site, spelled out. If the spec renames a key or
    // makes one required that this hook does not send, this stops compiling —
    // which is the whole point of annotating the body over there.
    const _body = {
      object: 'showcase_project',
      operation: 'update' as RecordCrudOperation,
      recordIds: ['r_0', 'r_1'],
    } satisfies ExplainRequest;
    expect(Object.keys(_body).sort()).toEqual(['object', 'operation', 'recordIds']);
  });

  it('rejects the key drift the untyped literal used to accept', () => {
    // These four are what the change actually catches. Every one of them
    // compiled cleanly when the body was an inline object literal passed
    // straight to `JSON.stringify` — the reverse-verification leg on this card
    // confirmed it against the pre-fix file.
    // @ts-expect-error `recordIDs` is not the spec's casing; the server would see no ids
    const _misCased = { object: 'o', operation: 'update', recordIDs: ['r'] } satisfies ExplainRequest;
    // @ts-expect-error the key is `object`, not `objectName` (the hook's local variable name)
    const _localName = { objectName: 'o', operation: 'update' } satisfies ExplainRequest;
    // @ts-expect-error `recordIds` is `string[]`; ids are not coerced from numbers
    const _numericIds = { object: 'o', operation: 'update', recordIds: [1, 2] } satisfies ExplainRequest;
    // @ts-expect-error `object` is required — the spec has no "current object" default
    const _noObject = { operation: 'update', recordIds: ['r'] } satisfies ExplainRequest;
    expect(true).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Vacuity control — the ONE thing here that runs                              */
/* -------------------------------------------------------------------------- */

describe('[#6332] control: the spec module really resolved', () => {
  it('is a live zod schema, so the types above came from the spec and not from `any`', () => {
    // The type-level pins cannot tell a resolved module from a stubbed one.
    // This can: it touches the runtime export that sits beside them. A build
    // where `@objectstack/spec/security` failed to resolve fails HERE, loudly,
    // instead of leaving a file of assertions that quietly check nothing.
    expect(ExplainRequestSchema).toBeDefined();
    const parsed = ExplainRequestSchema.safeParse({
      object: 'showcase_project',
      operation: 'update',
      recordIds: ['r_0'],
    });
    expect(parsed.success).toBe(true);
    // ...and it is genuinely the eight-verb enum the narrowing is a subset OF,
    // so `_NarrowingIsNotTheWholeEnum` above is asserting against a real enum.
    expect(ExplainRequestSchema.safeParse({ object: 'o', operation: 'archive' }).success).toBe(false);
  });
});
