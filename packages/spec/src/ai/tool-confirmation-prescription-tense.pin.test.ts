// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17487] The shipped confirmation-gate prescriptions are held to the door
 * that actually runs — in BOTH directions.
 *
 * Three customer-facing prescriptions tell an author what
 * `action.ai.requiresConfirmation: true` does: the `requiresConfirmation` entry
 * of `TOOL_RETIRED_KEY_GUIDANCE` (reached as a parse error on the `.strict()`
 * `ToolSchema`, the one channel every consumer bumping `@objectstack/spec` is
 * guaranteed to hit) and the ADR-0087 D3 entry's `replacement` and
 * `acceptanceCriteria`, which are what `spec-changes.json`, the upgrade guide
 * and `os migrate meta` project to consumers.
 *
 * ## Why this pin exists, and why it reads the RUNTIME
 *
 * All three used to carry a hedge — "the declaration is the contract, not yet
 * the behaviour … until that door lands, such a call simply RUNS" — written
 * while the runtime door was a separate, unlanded card. The door landed. The
 * hedge then DENIED a door that exists, and denied it in the dangerous
 * direction: an author who reads it concludes the safety flag is inert and
 * stops setting it, losing the gate at the moment it starts working. That is
 * the mirror of the ADR-0049 defect the tool-level key was retired for —
 * "a SAFETY flag that is merely accepted is false compliance" — with the sign
 * flipped.
 *
 * Nothing tied the prose to the function it describes, which is exactly how the
 * sentence rotted the first time (the same diagnosis
 * `ui/action-requires-confirmation-docblock.pin.test.ts` records for its own
 * surface). This pin is the tie. It fails in BOTH directions:
 *
 *  - if the prose re-acquires a not-yet-shipped DENIAL, the self-tested
 *    predicate below flags it — and the predicate is fed the three historical
 *    sentences verbatim, so it cannot pass merely by the prose falling silent;
 *  - if the runtime door is removed or narrowed — `actionConfirmationRefusal`
 *    gone, no longer reading the DECLARED flag, or no longer called
 *    pre-dispatch by `invokeBusinessAction` — this goes red naming both files,
 *    and whoever makes that change is told the prescriptions are now the thing
 *    that has to move.
 *
 * ## The over-claim guard is the other half
 *
 * An unbounded "the platform refuses unconfirmed calls" would be this same
 * defect in the first direction. The door's enforced set is bounded by
 * `ai.exposed`, so the prose must carry that bound, and the REST `/actions`
 * door must still be outside it — asserted here against
 * `runtime/src/domains/actions.ts` rather than trusted. If REST ever joins the
 * gate, the sentence saying it sits outside becomes false and this pin says so.
 *
 * ⛔ Scope: the RELATION and the two load-bearing facts, never the wording.
 * Rewording these prescriptions freely is fine. What they may not do is deny
 * the refusal, drop the code/status that names it, or drop the `ai.exposed`
 * bound that keeps the claim honest.
 *
 * ⛔ `entry.reason` is deliberately NOT scanned. It is the retirement's
 * historical rationale for the TOOL-level key ("Setting it on a destructive
 * tool produced NO PAUSE"), which is past tense about a key that really was
 * inert — true then, true now, and not a prescription an author acts on.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { ToolSchema } from './tool.zod';
import { ActionSchema } from '../ui/action.zod';
import { entry as toolConfirmationEntry } from '../migrations/entries/semantic/17.tool-requires-confirmation-retired';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/spec/src/ai → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');
const GATE_SOURCE = join(REPO_ROOT, 'packages', 'runtime', 'src', 'action-execution.ts');
const REST_ACTIONS_SOURCE = join(REPO_ROOT, 'packages', 'runtime', 'src', 'domains', 'actions.ts');

/** The shipped prescription, read off the rejection an author actually meets. */
function toolRejectionMessage(): string {
  const result = ToolSchema.safeParse({
    name: 'delete_everything',
    label: 'Delete Everything',
    description: 'Destructive',
    parameters: {},
    requiresConfirmation: true,
  });
  expect(result.success, '`requiresConfirmation` stopped being rejected — re-anchor this pin').toBe(false);
  if (result.success) return '';
  return result.error.issues.map((i) => i.message).join(' ');
}

/**
 * The three carriers, each named. A prescription reaching consumers through a
 * different projection is the same text, so one set of assertions covers all.
 */
function shippedPrescriptions(): Array<[string, string]> {
  return [
    ['ToolSchema rejection (TOOL_RETIRED_KEY_GUIDANCE.requiresConfirmation)', toolRejectionMessage()],
    ['ADR-0087 D3 entry — replacement', toolConfirmationEntry.replacement],
    ['ADR-0087 D3 entry — acceptanceCriteria', toolConfirmationEntry.acceptanceCriteria],
  ];
}

/**
 * Claims that the refusal is not performed. A closed list, every member taken
 * verbatim from a sentence one of these three carriers really shipped — so the
 * predicate answers "did the retired shape come back", never "does this read
 * hedged to me".
 */
const DENIALS: Array<[string, RegExp]> = [
  ['not yet the behaviour', /not yet the behaviour/i],
  ['the door ships separately', /ships separately/i],
  ['DECLARED, not yet performed', /not yet performed/i],
  ['setting the flag does NOT stop an unconfirmed call', /does NOT stop an unconfirmed/i],
  ['the flag stops nothing', /stops nothing/i],
  ['such a call simply RUNS', /simply RUNS/i],
  ['the call is not refused', /is not refused/i],
  ['until it does / until then / until that door lands', /until (?:it does|then|that door lands)\b/i],
];

/** Which denials a text carries, by name. */
function deniesTheDoor(text: string): string[] {
  return DENIALS.filter(([, probe]) => probe.test(text)).map(([name]) => name);
}

/** The body of `actionConfirmationRefusal` — the function this prose describes. */
function gateBody(): string {
  const source = readFileSync(GATE_SOURCE, 'utf8');
  const start = source.indexOf('export function actionConfirmationRefusal');
  expect(start, '`actionConfirmationRefusal` moved — re-anchor this pin').toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  const end = source.indexOf('\n}', open);
  expect(end, 'unterminated `actionConfirmationRefusal` body').toBeGreaterThan(open);
  return source.slice(open, end);
}

/** The body of `invokeBusinessAction` — the AI-facing door that calls the gate. */
function aiDoorBody(): string {
  const source = readFileSync(GATE_SOURCE, 'utf8');
  const start = source.indexOf('export async function invokeBusinessAction');
  expect(start, '`invokeBusinessAction` moved — re-anchor this pin').toBeGreaterThan(-1);
  const end = source.indexOf('\nexport ', start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

describe('[#17487] the confirmation-gate prescriptions match the door that runs', () => {
  it('anchors on real text in all three carriers', () => {
    // Anti-vacuity for every assertion below: an empty carrier would pass
    // "carries no denial" by reading nothing.
    for (const [name, text] of shippedPrescriptions()) {
      expect(text.length, `${name} read empty`).toBeGreaterThan(200);
      expect(text, `${name} no longer names the replacement key`).toMatch(/ai\.requiresConfirmation/);
    }
  });

  it('the runtime door is still there, and still reads the DECLARED flag', () => {
    const body = gateBody();
    const source = readFileSync(GATE_SOURCE, 'utf8');

    // The narrow predicate — the author's own declaration, never the listing
    // heuristic. If this ever widens, the prose's second bound is stale.
    expect(body, 'the gate stopped reading the DECLARED flag').toMatch(
      /action\?\.ai\?\.requiresConfirmation !== true/,
    );
    // Only the boolean `true` attests.
    expect(body, 'the gate stopped requiring the confirmation member').toMatch(
      /AI_ACTION_CONFIRMATION_MEMBER\] === true/,
    );
    // The envelope the prose names, by value.
    expect(source).toMatch(/ACTION_CONFIRMATION_REQUIRED_CODE = 'ACTION_CONFIRMATION_REQUIRED'/);
    expect(source).toMatch(/ACTION_CONFIRMATION_REQUIRED_STATUS = 428/);
  });

  it('the AI-facing door still calls the gate pre-dispatch', () => {
    expect(
      aiDoorBody(),
      '`invokeBusinessAction` no longer calls `actionConfirmationRefusal` — the prescriptions '
        + 'in `ai/tool.zod.ts` and the ADR-0087 D3 entry now describe a door that does not run',
    ).toMatch(/actionConfirmationRefusal\(/);
  });

  it('REST `/actions` is still OUTSIDE the gate, which is what the bound claims', () => {
    // The over-claim guard. The prose tells an author to arrange their own
    // human in front of REST; if that door joins the gate, the sentence is
    // false and this is where it is caught.
    expect(
      readFileSync(REST_ACTIONS_SOURCE, 'utf8'),
      'the REST actions door now enforces the confirmation gate — the `ai.exposed` bound in '
        + 'the shipped prescriptions is stale',
    ).not.toMatch(/actionConfirmationRefusal|ACTION_CONFIRMATION_REQUIRED/);
  });

  it('would flag each retired sentence as a denial (self-test)', () => {
    // Verbatim, the three sentences this card retired. Without these the
    // assertion below could pass simply because the prose went quiet.
    expect(
      deniesTheDoor(
        'Read this before you rely on it: the declaration is the contract, not yet the '
        + 'behaviour — the runtime door that performs the refusal ships separately, and until '
        + 'it does, setting the flag does NOT stop an unconfirmed call.',
      ).length,
    ).toBeGreaterThan(0);
    expect(
      deniesTheDoor(
        'The refusal is DECLARED, not yet performed — the runtime door lands separately, so '
        + 'until then the flag stops nothing on its own.',
      ).length,
    ).toBeGreaterThan(0);
    expect(
      deniesTheDoor(
        'Do NOT try to "prove the gate" by invoking the operation without the confirmation '
        + 'member: before that ships the call is not refused, it RUNS the destructive operation.',
      ).length,
    ).toBeGreaterThan(0);

    // And the predicate is not "never say `until`" — the ADR-0033 sentence the
    // corrected prescription still carries must pass.
    expect(
      deniesTheDoor(
        'For AI metadata mutations the ADR-0033 draft/publish workspace is the gate: nothing '
        + 'is live until a human publishes.',
      ),
    ).toEqual([]);
  });

  it('no shipped prescription denies the refusal', () => {
    for (const [name, text] of shippedPrescriptions()) {
      expect(deniesTheDoor(text), `${name} denies a door that exists`).toEqual([]);
    }
  });

  it('every shipped prescription states the refusal, and states its bound', () => {
    for (const [name, text] of shippedPrescriptions()) {
      // The refusal, by the code and status the door really answers — what a
      // caller builds the retry from.
      expect(text, `${name} no longer names the refusal code`).toMatch(/ACTION_CONFIRMATION_REQUIRED/);
      expect(text, `${name} no longer names the 428 status`).toMatch(/\b428\b/);
      expect(text, `${name} no longer names the confirmation member`).toMatch(/`confirm: true`/);
      // The bound. Without it the sentence over-promises, which is this same
      // defect in the other direction.
      expect(text, `${name} dropped the \`ai.exposed\` bound`).toMatch(/`ai\.exposed`/);
      expect(text, `${name} dropped the REST \`/actions\` carve-out`).toMatch(/REST `\/actions`/);
      expect(text, `${name} dropped the unverifiable-claim caveat`).toMatch(/unverifiable caller claim/);
    }
  });

  it('moves NO accept set — the same metadata is accepted and refused as before', () => {
    // This card is a text correction (`Clause-②: no`). If a future
    // "clarification" moves what parses, that is a contract change wearing a
    // text-change costume, and it fails here.
    expect(
      ToolSchema.safeParse({
        name: 'delete_everything', label: 'D', description: 'd', parameters: {},
        requiresConfirmation: true,
      }).success,
      '`tool.requiresConfirmation` must still be REFUSED',
    ).toBe(false);
    expect(
      ToolSchema.safeParse({ name: 'ok_tool', label: 'OK', description: 'd', parameters: {} }).success,
      'a minimal tool must still be ACCEPTED',
    ).toBe(true);

    for (const declared of [true, false]) {
      expect(
        ActionSchema.safeParse({
          name: 'archive_lead', label: 'Archive Lead', target: 'noop',
          ai: { requiresConfirmation: declared },
        }).success,
        `\`action.ai.requiresConfirmation: ${declared}\` must still be ACCEPTED`,
      ).toBe(true);
    }
  });
});
