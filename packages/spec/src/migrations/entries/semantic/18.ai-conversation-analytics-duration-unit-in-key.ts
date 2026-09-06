// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ai-conversation-analytics-duration-unit-in-key',
  surface: 'ConversationAnalytics.duration, the emitted session length whose name carried no '
    + 'unit (ai/conversation.zod.ts)',
  replacement: 'durationSeconds — rename the key; the value is unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'It stands alone because it is the only offender in ai/ and the only one on its file. '
    + 'What makes the bare name worth a registry row rather than a quiet edit is the company '
    + 'it kept: every other number on ConversationAnalytics is a COUNT — totalMessages, '
    + 'totalTokens, peakTokenUsage, pruningEvents, tokensSavedByPruning — so the one field '
    + 'that carried a unit was the one field that did not say so, sitting in a block of '
    + 'twelve unitless integers. The two instants beside it, firstMessageAt and lastMessageAt, '
    + 'already spelled themselves; the measurement between them did not. Tombstoned with '
    + 'retiredKey(); the shape is not strict, so a bare deletion would strip in silence and '
    + 'an emitter writing the old spelling would lose the value with no error anywhere. '
    + 'Why a semantic entry and not a D2 conversion: conversation analytics are computed at '
    + 'runtime and handed to a consumer, never authored by hand and never stored as a '
    + 'sys_metadata row, so the conversion chain has no seam that would ever see one — the '
    + 'same disposition every runtime-emitted measurement in this stack has taken. '
    + '#15680, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every producer that BUILDS a ConversationAnalytics spells durationSeconds, and every '
    + 'consumer that reads a session length reads durationSeconds. Authoring duration fails '
    + 'to compile (input type `never`) and fails to parse with the rename prescription rather '
    + 'than a bare unrecognized-key error. Behaviour is unchanged: durationSeconds: 1800 is '
    + 'the same half hour duration: 1800 was, the key stays optional, and the non-negative '
    + 'bound rides along with the renamed key so a negative session length is still refused. '
    + 'The migration is proved correct when no source in the tree spells a bare duration on '
    + 'this shape AND the twelve sibling counts are untouched — a sweep that suffixed any of '
    + 'them has read a count as a duration and over-applied the rule.',
};
