// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16293] The action-confirmation contract, pinned where a grep can find it.
 *
 * The contract landed with no test naming any of its symbols: `git grep -l`
 * over test files returned ZERO for `AI_ACTION_CONFIRMATION_MEMBER`,
 * `AIActionConfirmation`, `ActionConfirmationRequiredDetails` and
 * `ACTION_CONFIRMATION_REQUIRED`, while the same grep over non-test files lit
 * for each of them. A contract nothing asserts is a contract the next edit can
 * change without telling anyone — and this one is a SAFETY contract, so the
 * failure mode is silent.
 *
 * ## What is pinned, and what is deliberately NOT
 *
 * Pinned: that the refusal code is admitted by the closed `ErrorCode` union,
 * that the ledger registers it under the package that owns the action doors,
 * that it is not a synonym of a standard-catalog member (which is the whole
 * argument for registering it rather than answering `PRECONDITION_REQUIRED`),
 * and that `ActionConfirmationRequiredDetails.confirmationMember` is typed to
 * the CONSTANT rather than to `string` — the property that lets a client read
 * the member's spelling off a refusal instead of hard-coding it.
 *
 * NOT pinned: any refusal behaviour. The runtime door that performs it lands
 * in #15942 and is not in this tree, so a behavioural assertion here would
 * either be a stub asserting itself or a green test standing in for an absent
 * gate. This file asserts the CONTRACT half, which is the half that exists.
 *
 * ## Why every leg carries a lit control
 *
 * Each assertion below is paired with one that must go the OTHER way on the
 * same call. A zero from `standardSynonymOf` proves nothing unless the same
 * function answers non-undefined for a code that really is a synonym; an
 * `accepts` case proves nothing unless a near-miss of the same string is
 * rejected by the same parser. The `@ts-expect-error` legs are the compile
 * half of that discipline: an unused directive is itself a `tsc` error
 * (TS2578) under `packages/spec`'s test-layer program, so a leg that stops
 * detecting anything turns the type-check red rather than passing quietly.
 */

import { describe, it, expect } from 'vitest';

import {
  ERROR_CODE_LEDGER,
  ErrorCode,
  standardSynonymOf,
} from '../api/error-code-ledger.zod';
import {
  AI_ACTION_CONFIRMATION_MEMBER,
  type AIActionConfirmation,
  type ActionConfirmationRequiredDetails,
} from './ai-service';

/** The refusal code the contract names. */
const CODE = 'ACTION_CONFIRMATION_REQUIRED';
/** The package that owns both AI-facing action doors, and so owns the code. */
const OWNER = '@objectstack/runtime';

/** Identity helpers, so a rejected shape errors on the argument's own line. */
const asDetails = (d: ActionConfirmationRequiredDetails) => d;
const asConfirmation = (c: AIActionConfirmation) => c;

describe('action-confirmation contract (#16293)', () => {
  it('the refusal code is ADMITTED by the closed `ErrorCode` union', () => {
    expect(ErrorCode.parse(CODE)).toBe(CODE);
    // Control: the union is closed, so a one-character near-miss is refused.
    // Without this, `parse` returning the input proves only that it is a
    // string.
    expect(ErrorCode.safeParse('ACTION_CONFIRMATION_REQUIRE').success).toBe(false);
  });

  it('the ledger registers it under the package that owns the action doors', () => {
    expect(ERROR_CODE_LEDGER[OWNER]).toContain(CODE);
    // Control: the row is not merely somewhere in the ledger. If the code
    // moved owners, the assertion above would still pass under a `flat()`.
    const otherOwners = Object.entries(ERROR_CODE_LEDGER)
      .filter(([pkg]) => pkg !== OWNER)
      .filter(([, codes]) => (codes as readonly string[]).includes(CODE))
      .map(([pkg]) => pkg);
    expect(otherOwners).toEqual([]);
  });

  it('it is NOT a synonym of a standard-catalog member', () => {
    // The argument for registering a code instead of answering the standard
    // `PRECONDITION_REQUIRED`: this one says WHICH precondition. If the
    // detector ever reads it as a synonym, the row needs a recorded waiver
    // and the ledger's own admission test goes red — this states the intent.
    expect(standardSynonymOf(CODE)).toBeUndefined();
    // Controls: the same detector, lit, on codes that ARE synonyms.
    expect(standardSynonymOf('CONFLICT')).toBe('RESOURCE_CONFLICT');
    expect(standardSynonymOf('FORBIDDEN')).toBe('PERMISSION_DENIED');
  });

  it('the member spelling is one exported constant, not a per-door string', () => {
    expect(AI_ACTION_CONFIRMATION_MEMBER).toBe('confirm');
  });

  it('`confirmationMember` is typed to the CONSTANT, not to `string`', () => {
    // The refusal echoes the member so a client builds the retry off the
    // response. Typed as `string` that echo is unverifiable; typed as
    // `typeof AI_ACTION_CONFIRMATION_MEMBER` a refusal that names anything
    // else does not compile.
    const details = asDetails({
      actionName: 'archive_account',
      objectName: 'account',
      confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
    });
    expect(details.confirmationMember).toBe(AI_ACTION_CONFIRMATION_MEMBER);

    const mismatched = asDetails({
      actionName: 'archive_account',
      // @ts-expect-error — the member is pinned to the constant's literal type; a
      // plausible near-miss is a compile error, which is the point of the type.
      confirmationMember: 'confirmed',
    });
    expect(String(mismatched.confirmationMember)).toBe('confirmed');
  });

  it('the confirmation member is a BOOLEAN — a truthy string is not an attestation', () => {
    expect(asConfirmation({ confirm: true }).confirm).toBe(true);
    // Absent is legal: the member is required only on declared-gated actions.
    expect(asConfirmation({}).confirm).toBeUndefined();

    const stringy = asConfirmation({
      // @ts-expect-error — a transport artefact, not a decision; the contract
      // admits only the boolean.
      confirm: 'true',
    });
    expect(String(stringy.confirm)).toBe('true');
  });
});
