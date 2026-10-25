/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9653 — `KanbanStrayGroupByRefusal`'s message must not deny the
 * validation that emits it.
 *
 * The objectui#8365 message said a view carrying `groupBy` "never came through
 * the validated path", and a few clauses later that the key rode this mirror's
 * `.passthrough()` into `ListView` and changed the board. Only the second was
 * true: at the parent of the commit that added the refusal, `safeValidateSchema`
 * ACCEPTED the key in both nestings and KEPT it, and `ListView` grouped the board
 * by it. The protocol is what refuses it (`@objectstack/spec`'s strict
 * `KanbanConfigSchema`); this package did not, until the refusal.
 *
 * The message is read by an AUTHOR, from this package's own validator — so a
 * clause telling them their document was never validated is false at the very
 * place they read it. The same false clause was caught once before, in
 * objectui#8355's calendar stem, before it landed (objectui#9648).
 *
 * ## What is asserted, and why not the wording
 *
 * The refusal itself (`code` and `path` on both channels) is pinned by the
 * objectui#8365 tests; this file re-reads it only to find the message. It does
 * NOT pin the message's sentences. It asserts two things about CONTENT:
 *
 *   - NEGATIVE — no clause denies that the document passed a validator.
 *   - LIT CONTROL, on the true clause — the message still names the mechanism
 *     that kept the key (`.passthrough()`). Without it, the negative is satisfied
 *     by a message that says nothing about the history at all.
 *
 * A third arm proves the negative's matcher fires on the retired clause, so a
 * later loosening of the pattern cannot turn the negative into a no-op.
 *
 * REVERSE VERIFICATION, predicted before running: restore the retired clause
 * in the message ⇒ the NEGATIVE arm goes red on both channels, while the lit
 * control and the matcher control stay green (the retired text described the
 * passthrough too — that is the contradiction). Drop the history clause
 * instead ⇒ the lit control goes red and the negative stays green.
 */

import { describe, it, expect } from 'vitest';
import { ListViewSchema } from '../zod/objectql.zod';

/** A clause that tells the author their document never passed a validator. */
const DENIES_VALIDATION =
  /never\s+(?:came|went|passed)\s+through\s+(?:the\s+|a\s+)?(?:validated\s+path|validator|validation)/i;

/** The refusal message at one channel, read through the published door. */
function refusalMessage(doc: Record<string, unknown>, path: string, code: string): string {
  const result = ListViewSchema.safeParse({ type: 'list-view', objectName: 'deal', ...doc });
  expect(result.success, 'the fixture must be refused, or there is no message to read').toBe(false);
  const issue = result.success ? undefined : result.error.issues.find((i) => i.path.join('.') === path);
  expect(issue?.code).toBe(code);
  return issue?.message ?? '';
}

const CHANNELS = [
  { name: 'declared `kanban` slot', doc: { kanban: { groupByField: 'stage', groupBy: 'stage' } }, path: 'kanban.groupBy', code: 'invalid_type' },
  // `invalid_type` since objectui#6152 round 12: the bag nests the declared slot's
  // own block, so the arm is a member there too (it was a `custom` check).
  { name: 'legacy `options.kanban` bag', doc: { options: { kanban: { groupBy: 'stage' } } }, path: 'options.kanban.groupBy', code: 'invalid_type' },
] as const;

describe('objectui#9653 · the stray-`groupBy` refusal does not deny the validation that emits it', () => {
  for (const channel of CHANNELS) {
    it(`NEGATIVE (${channel.name}): no clause says the document never passed a validator`, () => {
      const message = refusalMessage(channel.doc, channel.path, channel.code);
      expect(message).not.toMatch(DENIES_VALIDATION);
    });

    it(`LIT CONTROL (${channel.name}): the message still describes the passthrough that kept the key`, () => {
      const message = refusalMessage(channel.doc, channel.path, channel.code);
      expect(message).toContain('`.passthrough()`');
    });
  }

  it('MATCHER CONTROL: the negative fires on the retired clause', () => {
    expect('so a view carrying it never came through the validated path.').toMatch(DENIES_VALIDATION);
  });
});
