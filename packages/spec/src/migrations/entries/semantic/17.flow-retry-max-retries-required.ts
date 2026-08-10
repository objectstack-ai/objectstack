// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// `etl-retry-converged-onto-retry-policy` (#4962) stood here and was
// ABSORBED by `etl-pipeline-layer-retired` below (#6414), the §0 same-major
// rule: both land in the unreleased protocol 17, and composed, the rename
// `ETLPipeline.retry.maxAttempts` -> `maxRetries` has no observable effect
// because the shape carrying it does not survive the major. Leaving both
// would tell an upgrader to rewrite a key on a schema this same upgrade
// deletes, and would break the fixture-disjointness the replay contract
// asserts. The `agent.knowledge` / `WidgetManifest.performance` precedent:
// a tombstone goes with the shape that carried it, which is strictly
// stronger than the tombstone.
export const entry: SemanticMigration = {
  id: 'flow-retry-max-retries-required',
  surface: "flow.errorHandling.maxRetries (under strategy: 'retry')",
  replacement: 'an explicit count >= 1 (e.g. maxRetries: 3), or strategy: \'fail\'',
  reason:
    'maxRetries had two defaults — FlowSchema `.default(0)` and the engine\'s ' +
    '`maxRetries ?? 3` — so an unstated count retried 0 times through the schema and 3 ' +
    'times through a hand-built definition (#4247). With the engine\'s copy removed the ' +
    'unstated count is unambiguously 0, and retrying zero times is exactly ' +
    "`strategy: 'fail'`, so the schema now refuses the combination instead of it silently " +
    'doing nothing. There is no lossless rewrite: 0 preserves the behaviour a parsed flow ' +
    'got but contradicts what its author wrote, and any positive count is a NEW decision ' +
    'about re-running the whole flow with its side effects. That choice is the author\'s.',
  acceptanceCriteria:
    "Every flow declaring `errorHandling.strategy: 'retry'` also declares " +
    '`maxRetries` >= 1, and each count was chosen knowing a retry replays the flow FROM ' +
    'THE START (records re-created, callouts re-fired); flows that never actually wanted ' +
    "retries say `strategy: 'fail'`. No flow fails to register with the maxRetries " +
    'prescription.',
};
