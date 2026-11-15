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
 * that the ledger registers it under the package that owns the action doors
 * and under exactly one second emitter, the MCP `delete_record` tool's gate,
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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTION_CONFIRMATION_REFUSAL_REASONS,
  AI_ACTION_CONFIRMATION_CAPABILITY,
  AI_ACTION_CONFIRMATION_MEMBER,
  type AIActionConfirmation,
  type ActionConfirmationHandOff,
  type ActionConfirmationPending,
  type ActionConfirmationRefusalReason,
  type ActionConfirmationRequiredDetails,
  type IActionConfirmationService,
} from './ai-service';

/** The refusal code the contract names. */
const CODE = 'ACTION_CONFIRMATION_REQUIRED';
/** The package that owns both AI-facing action doors, and so owns the code. */
const OWNER = '@objectstack/runtime';
/**
 * The one second EMITTER (provenance, not identity): the MCP `delete_record`
 * tool's gate stamps the same code on a record delete without the member.
 */
const SECOND_EMITTER = '@objectstack/mcp';

/** Identity helpers, so a rejected shape errors on the argument's own line. */
const asDetails = (d: ActionConfirmationRequiredDetails) => d;
const asConfirmation = (c: AIActionConfirmation) => c;

describe('action-confirmation contract — an unconfirmed gated action is refused', () => {
  it('the refusal code is ADMITTED by the closed `ErrorCode` union', () => {
    expect(ErrorCode.parse(CODE)).toBe(CODE);
    // Control: the union is closed, so a one-character near-miss is refused.
    // Without this, `parse` returning the input proves only that it is a
    // string.
    expect(ErrorCode.safeParse('ACTION_CONFIRMATION_REQUIRE').success).toBe(false);
  });

  it('the ledger registers it under the package that owns the action doors, and under its one second emitter', () => {
    expect(ERROR_CODE_LEDGER[OWNER]).toContain(CODE);
    // Control: the row is not merely somewhere in the ledger. If the code
    // moved owners, the assertion above would still pass under a `flat()`.
    // The one other package listing it is the MCP `delete_record` gate's; a
    // further emitter is a new door, and moving this pin is how it says so.
    const otherOwners = Object.entries(ERROR_CODE_LEDGER)
      .filter(([pkg]) => pkg !== OWNER)
      .filter(([, codes]) => (codes as readonly string[]).includes(CODE))
      .map(([pkg]) => pkg);
    expect(otherOwners).toEqual([SECOND_EMITTER]);
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

/**
 * The amended contract: a person confirms a declared-gated action, through
 * MCP elicitation when the client can be asked and through a hand-off to the
 * host's pending-confirmation service otherwise, refused only when the host
 * has none; the caller's own `confirm` never counts (ruling
 * 「3826 照建议（征询版）」, objectstack-ai/cloud#3826 item 6, as amended on
 * the card).
 *
 * Pinned here: the capability's spelling, the CLOSED refusal-reason set (a
 * hand-off is not in it), that `details.reason` is typed to it and stays
 * optional while the member gates still answer without it, the pending
 * answer's discriminant and the hand-off seam's shape, that the amendment adds
 * no second refusal code, and that the contract's own text names every reason,
 * every answer and the three steps, so the types and the prose cannot drift
 * apart. NOT pinned: any door behaviour, which the implementing change lands
 * and pins.
 */
describe('action-confirmation contract, as amended: a person confirms, elicited or handed off', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const CONTRACT_SOURCE = join(HERE, 'ai-service.ts');

  /** The capability constant's docblock, comment gutters folded into spaces. */
  function capabilityProse(): string {
    const source = readFileSync(CONTRACT_SOURCE, 'utf8');
    const at = source.indexOf('export const AI_ACTION_CONFIRMATION_CAPABILITY');
    expect(at, '`AI_ACTION_CONFIRMATION_CAPABILITY` moved — re-anchor this pin').toBeGreaterThan(-1);
    const open = source.lastIndexOf('/**', at);
    return source.slice(open, at).replace(/\n\s*\*\s?/g, ' ').replace(/\s+/g, ' ');
  }

  it('the capability is MCP\'s own spelling, one exported constant', () => {
    expect(AI_ACTION_CONFIRMATION_CAPABILITY).toBe('elicitation');
    // Control: it is not the member; the two travel on different channels.
    expect(AI_ACTION_CONFIRMATION_CAPABILITY).not.toBe(AI_ACTION_CONFIRMATION_MEMBER);
  });

  it('the refusal reasons are a CLOSED set of exactly five', () => {
    expect([...ACTION_CONFIRMATION_REFUSAL_REASONS]).toEqual([
      'declined',
      'cancelled',
      'timed_out',
      'no_confirmation_service',
      'service_account',
    ]);
    // Controls: an accepted elicitation and a hand-off are not refusals, and a
    // client that cannot elicit is handed off rather than refused for that.
    const reasons = ACTION_CONFIRMATION_REFUSAL_REASONS as readonly string[];
    for (const notARefusal of ['accepted', 'pending_confirmation', 'elicitation_unsupported']) {
      expect(reasons.includes(notARefusal), `${notARefusal} must not be a refusal reason`).toBe(false);
    }
  });

  it('`details.reason` is typed to the closed set, and optional', () => {
    const declined = asDetails({
      actionName: 'archive_account',
      objectName: 'account',
      confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
      reason: 'declined',
    });
    expect(declined.reason).toBe('declined');
    // Optional: a member gate (the MCP delete tools, a door before the
    // implementing change) still answers without it.
    const memberGate = asDetails({ actionName: 'delete_record', confirmationMember: AI_ACTION_CONFIRMATION_MEMBER });
    expect(memberGate.reason).toBeUndefined();

    const nearMiss = asDetails({
      actionName: 'archive_account',
      confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
      // @ts-expect-error — not a reason the contract names; the set is closed.
      reason: 'denied',
    });
    expect(String(nearMiss.reason)).toBe('denied');
    const reason: ActionConfirmationRefusalReason = 'timed_out';
    expect(ACTION_CONFIRMATION_REFUSAL_REASONS).toContain(reason);
  });

  it('a hand-off answers with the pending discriminant, through an optional host seam', () => {
    const pending: ActionConfirmationPending = {
      status: 'pending_confirmation',
      pendingId: 'pc_1',
      message: 'A confirmation was sent to you.',
      actionName: 'archive_account',
      objectName: 'account',
    };
    expect(pending.status).toBe('pending_confirmation');
    const wrongStatus: ActionConfirmationPending = {
      // @ts-expect-error — the discriminant is one literal; the in-app chat's
      // older `pending_approval` envelope is not this answer.
      status: 'pending_approval',
      pendingId: 'pc_1',
      message: 'm',
      actionName: 'archive_account',
    };
    expect(String(wrongStatus.status)).toBe('pending_approval');

    const handOff: ActionConfirmationHandOff = {
      actionName: 'archive_account', objectName: 'account', recordId: 'a1', params: {}, door: 'mcp',
    };
    const service: IActionConfirmationService = {
      submit: async (h) => ({ pendingId: `pc_${h.actionName}` }),
    };
    return expect(service.submit(handOff, {} as never)).resolves.toEqual({ pendingId: 'pc_archive_account' });
  });

  it('the amendment keeps ONE refusal code: no second code is registered for it', () => {
    const all = Object.values(ERROR_CODE_LEDGER).flat() as string[];
    expect(all).toContain(CODE);
    // Every reason rides `details.reason` under the one registered code.
    expect(all.filter((code) => /ELICIT|CONFIRMATION_(DECLINED|CANCELLED|TIMED_OUT|UNSUPPORTED)/.test(code))).toEqual([]);
  });

  it('the contract text names every reason and every elicitation answer', () => {
    const prose = capabilityProse();
    expect(prose.length, 'the capability docblock read empty').toBeGreaterThan(3000);
    for (const reason of ACTION_CONFIRMATION_REFUSAL_REASONS) {
      expect(prose, `the contract no longer states the \`${reason}\` case`).toContain(`\`${reason}\``);
    }
    for (const answer of ['`accept`', '`decline`', '`cancel`', 'timed out', 'then approved in the app', 'then rejected in the app']) {
      expect(prose, `the contract no longer says what ${answer} does`).toContain(answer);
    }
    for (const step of ['**Elicit**', '**Hand off**', '**Refuse**, only when the host has no pending-confirmation service']) {
      expect(prose, `the contract dropped the step ${step}`).toContain(step);
    }
    expect(prose, 'the contract dropped the AI-identity refusal on the approve and reject doors').toMatch(
      /approve and reject doors of the pending-confirmation service refuse an AI identity/,
    );
    expect(prose, 'the contract dropped the re-check at approval').toMatch(/every gate and permission re-checked/);
    expect(prose, 'the contract dropped the trust bound of an elicited answer').toMatch(/proves that the CLIENT answered, not that a person did/);
    expect(prose, 'the contract claims a refused call read nothing again').not.toMatch(/no record was read/);
    expect(prose, 'the contract dropped "the caller\'s `confirm` never counts"').toMatch(/The caller's `confirm` never counts/);
    expect(prose, 'the contract dropped the unchanged AI service account rule').toMatch(
      /An AI service account: unchanged\*\* \(ADR-0151 D3 rule 3\)/,
    );
    expect(prose, 'the refusal for a client without elicitation no longer names the remedy').toMatch(
      /use a client that supports confirmation, or to perform the action in the app/,
    );
  });
});
