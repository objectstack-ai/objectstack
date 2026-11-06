// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Card object names are bare (`account`); an ObjectStack package's are not.
 * Measured on `create-objectstack` 18.3 and the open framework's unmanaged
 * install door:
 *
 *   - `defineStack` refuses an object not named `<namespace>_<short>` once the
 *     manifest declares a namespace (every scaffolded project does);
 *   - dropping the namespace validates, but the unmanaged install refuses the
 *     bare object anyway (`422 NAMESPACE_PREFIX`, the namespace derived from the
 *     package id) — so a bare-name build can never be a template.
 *
 * So the runner reads a card as NAMESPACE-RELATIVE: against a package whose
 * namespace is `ns`, the card's object `account` is `ns_account` — in `expect`,
 * the seed, questions, personas, operations, guardrails, agent actions and the
 * iterate delta. Fields, row ids and computed truths are untouched (a truth is
 * keyed by question id and computed over row values). An answer may still cite
 * the bare name: {@link citationLabels} hands the grader both spellings.
 */

import type { LoadedScenario } from '../loader.js';
import type { ScenarioCard } from '../schema.js';

/** The `namespace` a project's `objectstack.config.ts` declares, or `undefined`. */
export function namespaceOfConfig(source: string): string | undefined {
  return /\bnamespace\s*:\s*['"]([a-z][a-z0-9_]*)['"]/.exec(source)?.[1];
}

/** The `namespace` a built artifact's manifest declares. */
export function namespaceOfArtifact(artifact: unknown): string | undefined {
  const m = (artifact as { manifest?: { namespace?: unknown } } | undefined)?.manifest;
  return typeof m?.namespace === 'string' ? m.namespace : undefined;
}

/** The card with every object reference prefixed `ns_`; identity when `ns` is undefined or a name already carries it. */
export function namespacedScenario(scenario: LoadedScenario, ns: string | undefined): LoadedScenario {
  if (!ns) return scenario;
  const o = (name: string) => (name.startsWith(`${ns}_`) ? name : `${ns}_${name}`);
  const c: ScenarioCard = scenario.card;
  const ex = c.expect;
  const card: ScenarioCard = {
    ...c,
    expect: {
      ...ex,
      objects: ex.objects.map(o),
      ...(ex.selectFields ? { selectFields: ex.selectFields.map((s) => ({ ...s, object: o(s.object) })) } : {}),
      ...(ex.lookups ? { lookups: ex.lookups.map((l) => ({ ...l, object: o(l.object), to: o(l.to) })) } : {}),
      ...(ex.appNavTargets ? { appNavTargets: ex.appNavTargets.map((t) => (ex.objects.includes(t) ? o(t) : t)) } : {}),
    },
    run: {
      ...c.run,
      seed: Object.fromEntries(Object.entries(c.run.seed).map(([k, rows]) => [o(k), rows])),
      questions: c.run.questions.map((q) => ({ ...q, object: o(q.object) })),
      personas: c.run.personas.map((p) => ({
        ...p,
        hidden: {
          ...(p.hidden.objects ? { objects: p.hidden.objects.map(o) } : {}),
          ...(p.hidden.fields ? { fields: p.hidden.fields.map((f) => ({ ...f, object: o(f.object) })) } : {}),
        },
        ...(p.scope ? { scope: p.scope.map((s) => ({ ...s, object: o(s.object) })) } : {}),
      })),
      operations: c.run.operations.map((op) => ({
        ...op,
        object: o(op.object),
        outcome: op.outcome.kind === 'applied' ? { ...op.outcome, state: op.outcome.state.map((s) => ({ ...s, object: o(s.object) })) } : op.outcome,
      })),
      guardrails: c.run.guardrails.map((g) => (g.cell ? { ...g, cell: { ...g.cell, object: o(g.cell.object) } } : g)),
      ...(c.run.agentActions ? { agentActions: c.run.agentActions.map((a) => ({ ...a, object: o(a.object) })) } : {}),
    },
    iterate: {
      ...c.iterate,
      expectDelta: {
        ...c.iterate.expectDelta,
        ...(c.iterate.expectDelta.objects ? { objects: c.iterate.expectDelta.objects.map(o) } : {}),
        ...(c.iterate.expectDelta.selectFields ? { selectFields: c.iterate.expectDelta.selectFields.map((s) => ({ ...s, object: o(s.object) })) } : {}),
        ...(c.iterate.expectDelta.lookups ? { lookups: c.iterate.expectDelta.lookups.map((l) => ({ ...l, object: o(l.object), to: o(l.to) })) } : {}),
      },
    },
  };
  return { ...scenario, card };
}

/** For the citation axis: each namespaced object may also be cited by its bare card name. */
export function citationLabels(original: LoadedScenario, ns: string | undefined): Record<string, string[]> | undefined {
  if (!ns) return undefined;
  const all = new Set([...original.card.expect.objects, ...(original.card.iterate.expectDelta.objects ?? [])]);
  return Object.fromEntries([...all].map((name) => [`${ns}_${name}`, [name]]));
}
