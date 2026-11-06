// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/scenarios/score` — the NARROW scorer entry (#30915): the
 * graph-shape scorer (`scoreGraphShape`, `scoreGraph`, `artifactToEvalGraph`),
 * the item-name check, the operation grader and the run graders
 * (`gradeRun`, `gradePersonaRun`).
 *
 * Its import graph reaches `@objectstack/core` and `@objectstack/spec` and no
 * other runtime package. The capability-tag checks (`scenario-tags.ts`) read
 * `@objectstack/objectql` and `@objectstack/plugin-sharing`, so they and the
 * card-level wrappers beside them (`scoreCardArtifact`, `gradeCardOperation`,
 * `gradeCardAnswer`) are `@objectstack/scenarios/score/full`
 * (`./index.ts`), which re-exports everything here as well.
 *
 * Re-exports only: the modules stay where they are. Pinned by
 * test/build/narrow-score-graph.test.ts.
 */

export * from './scenario-graph.js';
export * from './scenario-naming.js';
export * from './scenario-operation-grade.js';
export * from './scenario-run-grade.js';
export * from './scenario-score.js';
