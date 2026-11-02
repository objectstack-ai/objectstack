// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28661] A data write whose roll-up could not be recomputed after it landed
 * is answered with the write's own success — never a 500.
 *
 * The engine reports that case as `ERR_SUMMARY_RECOMPUTE` ("the triggering
 * records WERE written"), and the protocol's data method attaches the answer
 * the write earned to it (`earnedAnswerOf`, `@objectstack/types`).
 * Answering the refusal's 500 told a client a write failed that had landed,
 * so a retried create made a duplicate. The door answers the earned body with
 * the write's success status instead: the body the same write answers when
 * every roll-up recomputes, no member added. What it costs is said once in the
 * log, at `error` (`staleSummaryAnswerLines`).
 */

import { earnedAnswerOf, staleSummaryAnswerLines, type SummaryRecomputeRefusal } from '@objectstack/types';
import { applyDroppedFieldsHeader } from './error-response.js';
import { logError } from './log.js';

/**
 * The answer the write `error` earned, when it is a stale-roll-up refusal
 * carrying one — logged once per stale field and with the dropped-fields
 * header the success path sets already applied to `res`, so the caller only
 * relays it with the write's own success status; `undefined` for every other
 * error (the caller's own error mapping answers it). The body is the
 * protocol's result, relayed as the success path relays it, so this module
 * writes no response of its own.
 */
export function earnedWriteDespiteStaleSummary(error: unknown, res: any, object: string | undefined): Record<string, unknown> | undefined {
  const earned = earnedAnswerLogged(error, object);
  if (earned !== undefined) applyDroppedFieldsHeader(res, earned);
  return earned;
}

/**
 * [#28782] The same reading for a door whose success path sets no
 * dropped-fields header (public form submit, `createMany`, clone): the answer
 * the write `error` earned, logged once per stale field; `undefined` for every
 * other error. The door relays it as its own success path relays the
 * protocol's result.
 */
export function earnedAnswerLogged(error: unknown, object: string | undefined): Record<string, unknown> | undefined {
  const earned = earnedAnswerOf(error);
  if (earned === undefined) return undefined;
  for (const line of staleSummaryAnswerLines(error as SummaryRecomputeRefusal, object)) logError(`[REST] ${line}`);
  return earned;
}
