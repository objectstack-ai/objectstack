// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15937] `ToolExecutionContext.confirmedBlueprintIdentity`, pinned where a
 * grep can find it.
 *
 * The field arrives in the protocol because a PUBLISHED handler already
 * authorizes on it: cloud's `apply_blueprint` gate makes a matching
 * blueprint-identity digest one clause of the decision to build a whole app
 * (cloud#1954 / cloud PR #2005), and until this card it read the value off the
 * execution context through a structural cast against a declaration that lived
 * only in that one consumer's augmented type. A consent field a handler
 * authorizes on belongs in the declared contract.
 *
 * ## What is pinned, and what is deliberately NOT
 *
 * Pinned: that the member lives on `ToolExecutionContext` itself (not on some
 * neighbouring options bag), that it reaches a handler through the same
 * `ChatWithToolsOptions.toolExecutionContext` thread every other field uses,
 * that it is OPTIONAL and reads back `undefined` when absent, that its read
 * type is `string | undefined` rather than `string` — so a handler cannot
 * compile a path that assumes a confirmation is always present — and that it
 * is typed `string` rather than `any`, which is what makes the two
 * `@ts-expect-error` legs below detect anything at all.
 *
 * NOT pinned: any authorization behaviour. The gate that consumes this field
 * lives in `objectstack-ai/cloud` and is not in this tree, so a behavioural
 * assertion here would be a stub asserting itself. This file pins the
 * DECLARATION half, which is the half this repository owns.
 *
 * ## Why every leg carries a control
 *
 * A `@ts-expect-error` is only a check while the line under it really is an
 * error: an unused directive is itself a `tsc` error (TS2578) under
 * `packages/spec`'s test-layer program, so each negative leg goes red — rather
 * than quietly green — the day the type stops refusing what it names. The
 * positive legs are the other half of the same pair: the near-miss spelling is
 * refused only because the correct spelling on the line above is accepted.
 */

import { describe, it, expect } from 'vitest';

import type { ChatWithToolsOptions, ToolExecutionContext } from './ai-service';

/** Identity helper, so a rejected shape errors on the argument's own line. */
const asCtx = (c: ToolExecutionContext) => c;
const asOptions = (o: ChatWithToolsOptions) => o;

/** A plausible digest — the shape cloud stamps, opaque to this contract. */
const DIGEST = 'sha256:3f6a1c0e9b2d4a7f8c5e1b0d9a2f4c6e8b0d3a5f7c9e1b3d5a7f9c1e3b5d7a9f';

describe('confirmedBlueprintIdentity contract (#15937)', () => {
  it('is declared on `ToolExecutionContext` and round-trips the digest', () => {
    const ctx = asCtx({
      actor: { id: 'usr_1' },
      conversationId: 'conv_1',
      confirmedBlueprintIdentity: DIGEST,
    });

    expect(ctx.confirmedBlueprintIdentity).toBe(DIGEST);
  });

  it('reaches a handler through the same context thread as every other field', () => {
    // Declaring the member is worthless if the only path a tool handler sees it
    // on does not carry it. This is that path.
    const options = asOptions({
      toolExecutionContext: { confirmedBlueprintIdentity: DIGEST },
    });

    expect(options.toolExecutionContext?.confirmedBlueprintIdentity).toBe(DIGEST);
  });

  it('is OPTIONAL, and absence reads as `undefined` rather than anything truthy', () => {
    // "No confirmed identity on this turn" is the resting state of every turn
    // that is not a confirm replay, so a context without the member must still
    // be a legal `ToolExecutionContext`.
    const none = asCtx({ actor: { id: 'usr_1' } });

    expect(none.confirmedBlueprintIdentity).toBeUndefined();
    // Control: the same read is lit on a context that does carry it, so the
    // `undefined` above is the ABSENT member and not a misspelled read.
    expect(asCtx({ confirmedBlueprintIdentity: DIGEST }).confirmedBlueprintIdentity).toBe(DIGEST);
  });

  it('reads as `string | undefined`, so no handler can assume a confirmation', () => {
    const ctx = asCtx({ actor: { id: 'usr_1' } });

    // @ts-expect-error — the member is optional on purpose: absence authorizes
    // nothing, and a consumer that narrows it to `string` without a check has
    // written exactly the path this contract forbids. Were the member ever made
    // required, this directive would stop detecting anything and TS2578 would
    // fail the test-layer type-check.
    const assumed: string = ctx.confirmedBlueprintIdentity;
    expect(assumed).toBeUndefined();

    // Control: the guarded read — the shape a handler is meant to write — does
    // compile, so the leg above is refused for its missing check and not
    // because the member is unreadable.
    const guarded: string = ctx.confirmedBlueprintIdentity ?? '';
    expect(guarded).toBe('');
  });

  it('is typed `string`, not `any` — a non-string is a compile error', () => {
    const wrong = asCtx({
      // @ts-expect-error — a digest is a string. Typed `any` or `unknown` this
      // line would compile and the directive would go unused (TS2578), so this
      // leg also pins that the member did not arrive untyped.
      confirmedBlueprintIdentity: 42,
    });

    expect(String(wrong.confirmedBlueprintIdentity)).toBe('42');
  });

  it('is pinned by its SPELLING — a near-miss is not the confirmation field', () => {
    const typo = asCtx({
      // @ts-expect-error — the excess-property check refuses a member
      // `ToolExecutionContext` does not declare. The lit control is the first
      // leg above, where the correct spelling on the same helper is accepted.
      confirmedBlueprintIdentify: DIGEST,
    });

    expect(typo.confirmedBlueprintIdentity).toBeUndefined();
  });
});
