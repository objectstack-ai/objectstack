// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28661] A data write whose roll-up could not be recomputed after it landed
 * is answered with the write's own success — never a 500.
 *
 * The engine reports that case as `ERR_SUMMARY_RECOMPUTE` ("the triggering
 * records WERE written"), and the protocol's data method attaches the answer
 * the write earned to it (`earnedAnswerOf`, `@objectstack/metadata-protocol`).
 * Answering the refusal's 500 told a client a write failed that had landed,
 * so a retried create made a duplicate. The door answers the earned body with
 * the write's success status instead: the body the same write answers when
 * every roll-up recomputes, no member added. What it costs is said once in the
 * log, at `error` (`staleSummaryAnswerLines`).
 */

import { earnedAnswerOf, staleSummaryAnswerLines, type SummaryRecomputeRefusal } from '@objectstack/metadata-protocol';
import { applyDroppedFieldsHeader } from './error-response.js';
import { logError } from './log.js';

/**
 * Answer the write `error` earned, when it is a stale-roll-up refusal carrying
 * one: `true` once `res` is answered with `status`, the earned body and the
 * dropped-fields header the success path sets, `false` for every other error
 * (the caller's own error mapping answers it).
 */
export function answerEarnedWriteDespiteStaleSummary(error: unknown, res: any, status: number, object: string | undefined): boolean {
  const earned = earnedAnswerOf(error);
  if (earned === undefined) return false;
  for (const line of staleSummaryAnswerLines(error as SummaryRecomputeRefusal, object)) logError(`[REST] ${line}`);
  applyDroppedFieldsHeader(res, earned);
  res.status(status).json(earned);
  return true;
}
