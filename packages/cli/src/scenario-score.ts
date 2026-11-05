// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/cli/scenario-score` — the public entry for the deterministic
 * scenario scorer.
 *
 * ## Why this entry exists
 *
 * The scorer was ported into `src/lint/` from the cloud eval harness under the
 * cloud#3600 D2 ruling (「打分器可以迁移到开源项目」), and the port closed two
 * blind spots the cloud copy still carries: a nav target that "exists" without
 * any app navigating to it, and a widget bound to a dataset the build does not
 * carry passing its measure check. The port added no entry, so an installed
 * copy of this package could not reach the scorer: `exports` seals every
 * `dist/lint/` path. A consumer that cannot import the fixed scorer keeps its
 * own copy, and a copy is a scorer that drifts from this one.
 *
 * This entry is the door, in the shape `./hook-body` and `./console` use: a
 * dedicated barrel, not the internal modules themselves.
 *
 * ## What is public, and what is not
 *
 * Five functions and the types their signatures name, re-exported BY NAME,
 * with no star:
 *
 *   - `scoreGraph` / `scoreGraphShape` / `deriveShape` — the build-half
 *     scorers and the expectation they take (`scenario-score.ts`);
 *   - `artifactToEvalGraph` — reads a built artifact into the graph both
 *     scorers take (`scenario-graph.ts`);
 *   - `gradeRun` — the run-half grader (`scenario-run-grade.ts`).
 *
 * The helpers beside them (`PLATFORM_OBJECT_PREFIX`, `numbersIn`, `leaksOf`)
 * stay internal: no signature above names them, so a consumer never needs
 * them, and exporting them would make each one a contract. An export one of
 * those modules grows tomorrow is NOT public until someone edits this list,
 * and `test/published-subpath-scenario-score.pin.test.ts` holds the packed
 * `.d.ts` to exactly these names and shapes, so a widening is a deliberate,
 * reviewed act rather than a side effect of a refactor.
 *
 * ⛔ Do not add to this list to make something convenient reachable. A new
 * name here is a new public contract on a published package.
 */

export { deriveShape, scoreGraph, scoreGraphShape } from './lint/scenario-score.js';
export type {
  CheckResult,
  EvalGraph,
  EvalGraphField,
  EvalGraphNavEntry,
  ScenarioExpectation,
  ScoreResult,
  ShapeExpectation,
} from './lint/scenario-score.js';
export { artifactToEvalGraph } from './lint/scenario-graph.js';
export { gradeRun } from './lint/scenario-run-grade.js';
export type {
  HiddenScope,
  RunGrade,
  RunToolCall,
  RunTranscript,
  RunTruth,
  TruthFigure,
} from './lint/scenario-run-grade.js';
