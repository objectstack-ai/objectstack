// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/scenarios/score/full` — score a LOADED card against what a
 * run produced: a built artifact (`dist/objectstack.json`), an observed write,
 * or an agent's answer. The entry the scenario runner calls; private, like the
 * rest of this package. The narrow `@objectstack/scenarios/score` is
 * `./narrow.ts`: everything here except the capability-tag checks and the
 * card-level functions below.
 *
 * Every function takes a {@link LoadedScenario} (what `loadScenarios` /
 * `loadScenarioFile` return), so the card it judges against has already passed
 * the schema and the semantic pass, and its truths are the loader's computed
 * ones — a card the loader refused cannot be scored here at all.
 *
 * Deterministic: no model call, no network (the cost ruling on cloud#3600).
 */

import type { LoadedScenario } from '../loader.js';
import { isProbedOperation, scenarioNamespace } from '../schema.js';
import { gradeOperation, type OperationGrade, type OperationObservation } from './scenario-operation-grade.js';
import { gradePersonaRun, type HiddenScope, type PersonaRunGrade, type RunTranscript } from './scenario-run-grade.js';
import { scoreScenarioArtifact, type ScenarioArtifactScore } from './scenario-tags.js';

export * from './scenario-graph.js';
export * from './scenario-naming.js';
export * from './scenario-operation-grade.js';
export * from './scenario-run-grade.js';
export * from './scenario-score.js';
export * from './scenario-tags.js';

/**
 * Score one built artifact against one loaded card: `expect`, capability tags,
 * agent actions, and every non-object item named without the card's namespace
 * prefix (`demo` + code) as a failing check of its own.
 */
export function scoreCardArtifact(scenario: LoadedScenario, artifact: unknown): ScenarioArtifactScore {
  return scoreScenarioArtifact(artifact, scenario.card, { namespace: scenarioNamespace(scenario.card) });
}

/**
 * Judge one observed write against the outcome the card declares for operation
 * `operationId` — a probed one (`isProbedOperation`: the `write_validation`
 * operation and every refused overstep) in two halves, the agent's and the
 * runner's probe — with a value declared as the card's `asOf` also met by the
 * run date.
 */
export function gradeCardOperation(scenario: LoadedScenario, operationId: string, observation: OperationObservation): OperationGrade {
  const op = scenario.card.run.operations.find((o) => o.id === operationId);
  if (!op) throw new RangeError(`${scenario.card.id}: no operation \`${operationId}\``);
  const { asOf } = scenario.card;
  return gradeOperation(op.outcome, observation, { probed: isProbedOperation(scenario.card, operationId), ...(asOf !== undefined ? { asOf } : {}) });
}

export interface CardAnswer {
  /** The question's id. */
  question: string;
  /** The persona the agent answered as; absent ⇒ graded against the all-rows truth. */
  persona?: string;
  turn: RunTranscript;
  /**
   * Values and aggregates the asker may not receive, computed by the caller
   * (see {@link HiddenScope}); the hidden objects and fields are read from the
   * persona and need not be passed.
   */
  hidden?: Pick<HiddenScope, 'values' | 'aggregates'>;
  /** Names an answer may cite an object by besides its machine name. */
  objectLabels?: Readonly<Record<string, readonly string[]>>;
  /** Relative tolerance for every figure; absent ⇒ exact. */
  tol?: number;
}

/**
 * Grade one agent answer to a card question — as a persona against that
 * persona's computed truth (a `withheld` truth is must-not-reveal), or, with
 * no persona, against the truth over every row.
 */
export function gradeCardAnswer(scenario: LoadedScenario, answer: CardAnswer): PersonaRunGrade {
  const { card } = scenario;
  const q = card.run.questions.find((x) => x.id === answer.question);
  if (!q) throw new RangeError(`${card.id}: no question \`${answer.question}\``);
  const truth = scenario.truths[q.id];
  if (!truth) throw new RangeError(`${card.id}: question \`${q.id}\` has no computed truth`);

  const hidden: HiddenScope = { ...answer.hidden };
  let personaTruth = truth;
  let inScopeFigures: readonly number[] | undefined;
  if (answer.persona !== undefined) {
    const persona = card.run.personas.find((p) => p.id === answer.persona);
    if (!persona) throw new RangeError(`${card.id}: no persona \`${answer.persona}\``);
    const scoped = scenario.personaTruths[q.id]?.[persona.id];
    if (!scoped) throw new RangeError(`${card.id}: question \`${q.id}\` is not answered as persona \`${persona.id}\``);
    personaTruth = scoped;
    hidden.objects = persona.hidden.objects ?? [];
    const fields: Record<string, string[]> = {};
    for (const f of persona.hidden.fields ?? []) (fields[f.object] ??= []).push(f.field);
    hidden.fields = fields;
    inScopeFigures = scenario.scopeFigures[q.id]?.[persona.id];
  }

  return gradePersonaRun(
    {
      object: q.object,
      truth,
      personaTruth,
      hidden,
      ...(answer.objectLabels ? { objectLabels: answer.objectLabels } : {}),
      ...(answer.tol !== undefined ? { tol: answer.tol } : {}),
      ...(inScopeFigures ? { inScopeFigures } : {}),
    },
    answer.turn,
  );
}
