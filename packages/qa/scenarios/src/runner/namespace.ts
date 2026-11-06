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
 * So the runner reads a card as NAMESPACE-RELATIVE (ruling A on #30292), and
 * the namespace is the card's own: `demo` + its `code` ({@link scenarioNamespace},
 * `democrm`), in both modes, so a scored build's names are the same on every
 * run and every machine. The card's object `account` is `democrm_account` — in
 * `expect`, the seed, questions, personas, operations, guardrails and the
 * iterate delta. Every other item the card names carries the prefix too, since
 * a gallery app prefixes every item name (the scorer reports a bare one,
 * `score/scenario-naming.ts`): the expected dashboards and nav targets, the
 * agent actions, and each persona's permission set ({@link permissionSetName}).
 * Fields, row ids, persona ids and computed truths are untouched (a truth is
 * keyed by question id and computed over row values). An answer may still cite
 * the bare object name: {@link citationLabels} hands the grader both spellings.
 */

import type { LoadedScenario } from '../loader.js';
import { scenarioNamespace, type ScenarioCard } from '../schema.js';

/** The `namespace` a project's `objectstack.config.ts` declares, or `undefined`. */
export function namespaceOfConfig(source: string): string | undefined {
  return /\bnamespace\s*:\s*['"]([a-z][a-z0-9_]*)['"]/.exec(source)?.[1];
}

/** The `namespace` a built artifact's manifest declares. */
export function namespaceOfArtifact(artifact: unknown): string | undefined {
  const m = (artifact as { manifest?: { namespace?: unknown } } | undefined)?.manifest;
  return typeof m?.namespace === 'string' ? m.namespace : undefined;
}

/**
 * Template mode's blank HOST project: `host` + the card's code (`hostcrm`),
 * never the app's own namespace. The unmanaged copy keeps the template's
 * namespace (`democrm`), and the import refuses a namespace a package of the
 * environment already owns — measured on `create-objectstack` 18.3: a host
 * scaffolded as `democrm` answers `409 RESOURCE_CONFLICT` ("the namespace
 * 'democrm' … is already owned by 'com.example.democrm'"), a host scaffolded as
 * `hostcrm` installs the same copy with `200`.
 */
export function templateHostName(card: Pick<ScenarioCard, 'code'>): string {
  return `host${card.code}`;
}

/** The permission set a persona signs in with: `<namespace>_<persona id>` (`democrm_sdr`). */
export function permissionSetName(card: Pick<ScenarioCard, 'code'>, persona: string): string {
  return `${scenarioNamespace(card)}_${persona}`;
}

/** The card with every item name it states prefixed `<namespace>_` (a name already carrying the prefix is kept). */
export function namespacedScenario(scenario: LoadedScenario): LoadedScenario {
  const c: ScenarioCard = scenario.card;
  const ns = scenarioNamespace(c);
  const o = (name: string) => (name.startsWith(`${ns}_`) ? name : `${ns}_${name}`);
  const ex = c.expect;
  const card: ScenarioCard = {
    ...c,
    expect: {
      ...ex,
      objects: ex.objects.map(o),
      ...(ex.selectFields ? { selectFields: ex.selectFields.map((s) => ({ ...s, object: o(s.object) })) } : {}),
      ...(ex.lookups ? { lookups: ex.lookups.map((l) => ({ ...l, object: o(l.object), to: o(l.to) })) } : {}),
      ...(ex.dashboards ? { dashboards: ex.dashboards.map(o) } : {}),
      ...(ex.appNavTargets ? { appNavTargets: ex.appNavTargets.map(o) } : {}),
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
      ...(c.run.agentActions ? { agentActions: c.run.agentActions.map((a) => ({ ...a, name: o(a.name), object: o(a.object) })) } : {}),
    },
    iterate: {
      ...c.iterate,
      expectDelta: {
        ...c.iterate.expectDelta,
        ...(c.iterate.expectDelta.objects ? { objects: c.iterate.expectDelta.objects.map(o) } : {}),
        ...(c.iterate.expectDelta.selectFields ? { selectFields: c.iterate.expectDelta.selectFields.map((s) => ({ ...s, object: o(s.object) })) } : {}),
        ...(c.iterate.expectDelta.lookups ? { lookups: c.iterate.expectDelta.lookups.map((l) => ({ ...l, object: o(l.object), to: o(l.to) })) } : {}),
        ...(c.iterate.expectDelta.dashboards ? { dashboards: c.iterate.expectDelta.dashboards.map(o) } : {}),
        ...(c.iterate.expectDelta.appNavTargets ? { appNavTargets: c.iterate.expectDelta.appNavTargets.map(o) } : {}),
      },
    },
  };
  return { ...scenario, card };
}

/** For the citation axis: each namespaced object may also be cited by its bare card name. */
export function citationLabels(original: LoadedScenario): Record<string, string[]> {
  const ns = scenarioNamespace(original.card);
  const all = new Set([...original.card.expect.objects, ...(original.card.iterate.expectDelta.objects ?? [])]);
  return Object.fromEntries([...all].map((name) => [`${ns}_${name}`, [name]]));
}
