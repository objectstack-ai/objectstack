// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Capability-tag checks and the agent-action exposure check — the half of the
 * scenario scorer that asks whether a built artifact CARRIES what a scenario
 * card claims beyond its shape.
 *
 * Shape alone saturated once (cloud#2146: every golden build scored 1.00), so a
 * card's `capabilities` tags (`<area>.<name>`) are what make a score mean
 * something. Each tag maps to one deterministic check over the artifact
 * (`dist/objectstack.json`, as `os build` writes it):
 *
 *  - {@link CAPABILITY_TAG_CHECKS} is the CLOSED tag → check table. A tag with
 *    no row is reported `unscored` — never a pass — and so is a tag whose row
 *    finds nothing in the card to judge (a field-permission tag on a card whose
 *    personas hide no field). An `unscored` tag is listed, and counted in
 *    neither the passed nor the total figure.
 *  - {@link gradeAgentActions} judges the card's `run.agentActions`: each
 *    declared action must exist on its object, be opted into the AI / MCP
 *    surface, and be confirm-gated where the card says so. A declared action
 *    the artifact does not carry FAILS every one of those checks; it is never
 *    skipped.
 *
 * ## What "opted into the AI / MCP surface" reads, and what it cannot
 *
 * Measured against the runtime: the MCP `list_actions` / `run_action` doors
 * (`packages/runtime/src/domains/mcp.ts`) admit an action only when
 * `actionAiExposureError` (`packages/runtime/src/action-execution.ts`) passes —
 * `action.ai.exposed === true`, the author's opt-in (ADR-0011) — and the
 * confirmation gate `actionConfirmationRefusal` refuses an unconfirmed call
 * only when `action.ai.requiresConfirmation === true` (the DECLARED flag, never
 * the `mode: 'delete'` / `variant: 'danger'` listing heuristic, which advises a
 * client but refuses nothing). Both bits are the action's own declaration, so
 * both are read here from the artifact.
 *
 * The listing's other admissions are runtime facts the artifact does not hold:
 * a script action's handler is bound by code at boot, a flow action needs the
 * automation service, and the caller's permissions are the session's. Those
 * are observed by the scenario runner, not judged here.
 *
 * ## What of the card the checks read
 *
 * `expect`, `capabilities`, `run.personas` (hidden fields and row scope) and
 * `run.agentActions` — picked from the card schema's own type
 * ({@link ScenarioArtifactCard}), never a copy of it.
 *
 * Deterministic: no model call, no network (the cost ruling on cloud#3600).
 */

import { resolveStackCollection } from '@objectstack/core';
import { standaloneActionOwnerKey } from '@objectstack/objectql';
import { effectiveSharingModel } from '@objectstack/plugin-sharing';
import { APPROVAL_NODE_TYPE, resolveFlowTriggerKind } from '@objectstack/spec/automation';
import { SINGLE_OPTION_TYPES, summaryFunctionReadsField } from '@objectstack/spec/data';

import type { ScenarioCard } from '../schema.js';
import { artifactToEvalGraph } from './scenario-graph.js';
import {
  PLATFORM_OBJECT_PREFIX,
  measureChecks,
  scoreGraph,
  scoreGraphShape,
  deriveShape,
  type CheckResult,
  type EvalGraph,
  type EvalGraphField,
  type ScoreResult,
} from './scenario-score.js';

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value);
const norm = (s: string): string => s.trim().toLowerCase();

// ── What of the card the checks read ────────────────────────────────────────

/** What {@link scoreScenarioArtifact} reads of one card: a pick of the card schema's type. */
export type ScenarioArtifactCard = Pick<ScenarioCard, 'expect' | 'capabilities'> & {
  run: Pick<ScenarioCard['run'], 'personas' | 'agentActions'>;
};

/** A business action the card declares an agent must be able to call (`run.agentActions[]`). */
export type ScenarioAgentAction = NonNullable<ScenarioCard['run']['agentActions']>[number];

// ── The artifact facts the checks read ──────────────────────────────────────

/** One action declaration and the object that owns it. */
export interface ArtifactAction {
  object: string;
  action: Bag;
}

/** The artifact, read once for every check. */
export interface ArtifactFacts {
  graph: EvalGraph;
  /** Raw object definitions by name — for keys the eval graph does not carry. */
  objects: ReadonlyMap<string, Bag>;
  flows: readonly Bag[];
  permissionSets: readonly Bag[];
  actions: readonly ArtifactAction[];
}

/**
 * Read a built artifact into the facts the checks judge.
 *
 * Every collection goes through `resolveStackCollection`, the one reader of a
 * multi-package artifact's `packages[]` (`scenario-graph.ts` says why). Action
 * ownership follows the MCP doors: an action written on an object belongs to
 * it, a standalone one to `standaloneActionOwnerKey`'s owner, and an
 * object-embedded declaration wins over a standalone one of the same key
 * (`collectActionDeclarations`).
 *
 * @throws TypeError when the artifact cannot be read in its spec shape
 *   (see {@link artifactToEvalGraph}).
 */
export function readArtifactFacts(artifact: unknown): ArtifactFacts {
  const graph = artifactToEvalGraph(artifact);

  const objects = new Map<string, Bag>();
  for (const raw of resolveStackCollection(artifact, 'objects')) {
    if (isBag(raw) && typeof raw.name === 'string') objects.set(raw.name, raw);
  }

  const actions: ArtifactAction[] = [];
  const seen = new Set<string>();
  for (const [object, def] of objects) {
    for (const action of Array.isArray(def.actions) ? def.actions : []) {
      if (!isBag(action) || typeof action.name !== 'string') continue;
      seen.add(`${object}:${action.name}`);
      actions.push({ object, action });
    }
  }
  for (const action of resolveStackCollection(artifact, 'actions')) {
    if (!isBag(action) || typeof action.name !== 'string') continue;
    const object = standaloneActionOwnerKey(action);
    if (seen.has(`${object}:${action.name}`)) continue;
    seen.add(`${object}:${action.name}`);
    actions.push({ object, action });
  }

  // At the artifact stage `permissions` is the ADR-0090 collection of
  // permission sets; a set is the entry carrying an `objects` record.
  const permissionSets = resolveStackCollection(artifact, 'permissions').filter(
    (p): p is Bag => isBag(p) && typeof p.name === 'string' && isBag(p.objects),
  );

  return { graph, objects, flows: resolveStackCollection(artifact, 'flows').filter(isBag), permissionSets, actions };
}

// ── Check helpers ───────────────────────────────────────────────────────────

const check = (name: string, pass: boolean, detail?: string): CheckResult =>
  detail === undefined ? { check: name, pass } : { check: name, pass, detail };

function findObject(graph: EvalGraph, name: string) {
  return graph.objects.find((o) => norm(o.name) === norm(name));
}

function resolvesInBuild(graph: EvalGraph, target: string): boolean {
  return !!findObject(graph, target) || PLATFORM_OBJECT_PREFIX.test(target);
}

/** Every field of `type` that carries an author-chosen target. */
function relationships(graph: EvalGraph, type: string): Array<{ object: string; field: EvalGraphField }> {
  return graph.objects.flatMap((o) =>
    o.fields.filter((f) => f.type === type && f.reference).map((field) => ({ object: o.name, field })),
  );
}

function rawField(facts: ArtifactFacts, object: string, field: string): Bag | undefined {
  const fields = facts.objects.get(object)?.fields;
  if (!isBag(fields)) return undefined;
  const def = fields[field];
  return isBag(def) ? def : undefined;
}

/** The object a flow binds to: its record trigger's `objectName`, else a record-reference start input's. */
function flowBoundObject(flow: Bag): string | undefined {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const start = nodes.find((n): n is Bag => isBag(n) && n.type === 'start');
  const config = start && isBag(start.config) ? start.config : undefined;
  if (typeof config?.objectName === 'string') return config.objectName;
  const variables = Array.isArray(flow.variables) ? flow.variables : [];
  const input = variables.find((v): v is Bag => isBag(v) && v.isInput === true && typeof v.objectName === 'string');
  return input?.objectName as string | undefined;
}

const flowName = (flow: Bag): string => (typeof flow.name === 'string' ? flow.name : '(unnamed flow)');

// ── The closed tag → check table ────────────────────────────────────────────

/** A check's answer: the checks it ran, or why it had nothing in the card to judge. */
export type TagCheckOutcome = { checks: CheckResult[] } | { unscored: string };

export interface TagCheck {
  /** One sentence: what the check asserts of the artifact. */
  asserts: string;
  run(facts: ArtifactFacts, card: ScenarioArtifactCard): TagCheckOutcome;
}

function uniqueBy<T>(items: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The closed table. Keys are full tags; the area half of each is pinned by the
 * test to be a checklist area (`docs/qa/platform-checklist/areas/*.json`), the
 * same closed set the card loader reads. ⛔ Never a prefix or area match: a row
 * that answered for every `approvals.*` tag would score a tag it was never
 * written to judge.
 */
export const CAPABILITY_TAG_CHECKS: Readonly<Record<string, TagCheck>> = Object.freeze({
  'records-forms.lookup': {
    asserts: 'the build carries a lookup field, and every lookup field resolves to an object the build or the platform serves',
    run(f) {
      const rels = relationships(f.graph, 'lookup');
      return {
        checks: [
          check('lookup-field-exists', rels.length > 0, `${rels.length} lookup field(s)`),
          ...rels.map(({ object, field }) =>
            check(`lookup:${object}.${field.name}->resolves`, resolvesInBuild(f.graph, field.reference!), field.reference),
          ),
        ],
      };
    },
  },

  'records-forms.master-detail-inline-edit': {
    asserts: 'every master-detail field resolves, and one of them is edited inline on its master (`inlineEdit`)',
    run(f) {
      const rels = relationships(f.graph, 'master_detail');
      const inline = rels.filter(({ object, field }) => {
        const mode = rawField(f, object, field.name)?.inlineEdit;
        return mode === true || mode === 'grid' || mode === 'form';
      });
      return {
        checks: [
          check('master-detail-field-exists', rels.length > 0, `${rels.length} master-detail field(s)`),
          ...rels.map(({ object, field }) =>
            check(`master_detail:${object}.${field.name}->resolves`, resolvesInBuild(f.graph, field.reference!), field.reference),
          ),
          check('master-detail-inline-edit', inline.length > 0, `${inline.length} edited inline`),
        ],
      };
    },
  },

  'records-forms.roll-up-summary': {
    asserts: 'the build carries a roll-up summary, and each one reads a child object that relates back to it and, unless it counts, a child field that exists',
    run(f) {
      const checks: CheckResult[] = [];
      let summaries = 0;
      for (const o of f.graph.objects) {
        for (const field of o.fields) {
          if (field.type !== 'summary') continue;
          summaries += 1;
          const at = `summary:${o.name}.${field.name}`;
          const ops = rawField(f, o.name, field.name)?.summaryOperations;
          const childName = isBag(ops) && typeof ops.object === 'string' ? ops.object : undefined;
          const child = childName === undefined ? undefined : findObject(f.graph, childName);
          checks.push(check(`${at}->source`, !!child, childName ?? 'names no child object'));
          if (!child || !isBag(ops)) continue;
          const back = child.fields.filter(
            (cf) => (cf.type === 'lookup' || cf.type === 'master_detail') && norm(cf.reference ?? '') === norm(o.name),
          );
          const via = typeof ops.relationshipField === 'string' ? ops.relationshipField : undefined;
          checks.push(check(
            `${at}->relates`,
            via === undefined ? back.length > 0 : back.some((cf) => cf.name === via),
            via === undefined ? `${back.length} reference(s) back` : `via ${via}`,
          ));
          const fn = typeof ops.function === 'string' ? ops.function : undefined;
          if (summaryFunctionReadsField(fn)) {
            const read = typeof ops.field === 'string' ? ops.field : undefined;
            checks.push(check(`${at}->field`, read !== undefined && child.fields.some((cf) => cf.name === read), read ?? 'names no field'));
          }
        }
      }
      return { checks: [check('roll-up-summary-exists', summaries > 0, `${summaries} summary field(s)`), ...checks] };
    },
  },

  'records-forms.select-options': {
    asserts: 'the build carries a single-choice option field, and every one offers at least two options',
    run(f) {
      const selects = f.graph.objects.flatMap((o) =>
        o.fields.filter((field) => SINGLE_OPTION_TYPES.has(field.type)).map((field) => ({ object: o.name, field })),
      );
      return {
        checks: [
          check('option-field-exists', selects.length > 0, `${selects.length} option field(s)`),
          ...selects.map(({ object, field }) =>
            check(`${field.type}:${object}.${field.name}->options>=2`, (field.options?.length ?? 0) >= 2, `has ${field.options?.length ?? 0}`),
          ),
        ],
      };
    },
  },

  'access-security.field-permissions': {
    asserts: 'every field a card persona must not see exists and is denied (`readable: false`) by a permission set',
    run(f, card) {
      const hidden = uniqueBy(
        card.run.personas.flatMap((p) => p.hidden.fields ?? []),
        (h) => `${h.object}.${h.field}`,
      );
      if (hidden.length === 0) return { unscored: "the card's personas hide no field, so no field permission has anything to deny" };
      return {
        checks: hidden.map(({ object, field }) => {
          const exists = !!findObject(f.graph, object)?.fields.some((x) => norm(x.name) === norm(field));
          const deniedBy = f.permissionSets.find((ps) => {
            const entry = isBag(ps.fields) ? ps.fields[`${object}.${field}`] : undefined;
            return isBag(entry) && entry.readable === false;
          });
          return check(
            `field-permission:${object}.${field}->denied`,
            exists && !!deniedBy,
            !exists ? 'the build has no such field' : deniedBy ? `by ${String(deniedBy.name)}` : 'no permission set denies it',
          );
        }),
      };
    },
  },

  'access-security.row-scope': {
    asserts: "every object a card persona sees only part of keeps its records private (owner-scoped) or derives access from its master",
    run(f, card) {
      const scoped = [...new Set(card.run.personas.flatMap((p) => (p.scope ?? []).map((s) => s.object)))];
      if (scoped.length === 0) return { unscored: "the card's personas scope no rows, so no object has a row scope to keep" };
      return {
        checks: scoped.map((object) => {
          const def = [...f.objects].find(([name]) => norm(name) === norm(object))?.[1];
          // `effectiveSharingModel` is plugin-sharing's own reading (ADR-0090
          // D1: an undeclared custom object is private). A detail is public
          // there because the security plugin scopes it through its master.
          const scopedHere = !!def && (effectiveSharingModel(def) === 'private' || def.sharingModel === 'controlled_by_parent');
          return check(
            `row-scope:${object}->private`,
            scopedHere,
            def ? `sharingModel ${String(def.sharingModel ?? '(undeclared)')}` : 'the build has no such object',
          );
        }),
      };
    },
  },

  'approvals.approval-flow': {
    asserts: 'the build carries an approval (a flow with an Approval node), every approval binds to an object it serves, and one binds to an object the card names',
    run(f, card) {
      const approvals = f.flows.filter(
        (flow) => Array.isArray(flow.nodes) && flow.nodes.some((n) => isBag(n) && n.type === APPROVAL_NODE_TYPE),
      );
      const expected = new Set(card.expect.objects.map(norm));
      const bound = approvals.map((flow) => ({ flow, object: flowBoundObject(flow) }));
      return {
        checks: [
          ...bound.map(({ flow, object }) =>
            check(`approval:${flowName(flow)}->resolves`, object !== undefined && resolvesInBuild(f.graph, object), object ?? 'binds no object'),
          ),
          // Also the existence check: no approval flow binds nothing.
          check(
            'approval-binds-expected-object',
            bound.some(({ object }) => object !== undefined && expected.has(norm(object))),
            `${approvals.length} approval flow(s)`,
          ),
        ],
      };
    },
  },

  'automation.record-triggered-flow': {
    asserts: 'the build carries a record-triggered flow, every one binds to an object it serves, and one binds to an object the card names',
    run(f, card) {
      const triggered = f.flows.filter((flow) => resolveFlowTriggerKind(flow) === 'record_change');
      const expected = new Set(card.expect.objects.map(norm));
      const bound = triggered.map((flow) => ({ flow, object: flowBoundObject(flow) }));
      return {
        checks: [
          ...bound.map(({ flow, object }) =>
            check(`flow:${flowName(flow)}->resolves`, object !== undefined && resolvesInBuild(f.graph, object), object ?? 'binds no object'),
          ),
          // Also the existence check: no record-triggered flow binds nothing.
          check(
            'record-trigger-binds-expected-object',
            bound.some(({ object }) => object !== undefined && expected.has(norm(object))),
            `${triggered.length} record-triggered flow(s)`,
          ),
        ],
      };
    },
  },

  'dashboards.widget-measures': {
    asserts: 'the build carries a dashboard widget with a measure, and every widget measure resolves on the dataset it binds',
    run(f) {
      const measures = measureChecks(f.graph, (d, m, ds) => `measure:${d}.${m}@${ds}`);
      return { checks: [check('dashboard-measure-exists', measures.length > 0, `${measures.length} widget measure(s)`), ...measures] };
    },
  },
});

/** One tag's verdict. `checks` is empty for an `unscored` tag. */
export interface TagVerdict {
  tag: string;
  status: 'pass' | 'fail' | 'unscored';
  checks: CheckResult[];
  /** Why a tag is `unscored`. */
  reason?: string;
}

/** Judge every tag of a card against the artifact. */
export function gradeCapabilityTags(facts: ArtifactFacts, card: ScenarioArtifactCard): TagVerdict[] {
  return card.capabilities.map((tag) => {
    const row = Object.prototype.hasOwnProperty.call(CAPABILITY_TAG_CHECKS, tag) ? CAPABILITY_TAG_CHECKS[tag] : undefined;
    if (!row) return { tag, status: 'unscored', checks: [], reason: 'no check in the closed tag table' };
    const out = row.run(facts, card);
    if ('unscored' in out) return { tag, status: 'unscored', checks: [], reason: out.unscored };
    // A row that ran no check has proved nothing: that is a failure, never a pass.
    const pass = out.checks.length > 0 && out.checks.every((c) => c.pass);
    return { tag, status: pass ? 'pass' : 'fail', checks: out.checks };
  });
}

// ── Agent actions: exists, AI-exposed, confirm-gated ────────────────────────

/**
 * One check per declared fact of each action. A missing declaration fails all
 * of its checks — the agent cannot call what the build does not expose.
 */
export function gradeAgentActions(facts: ArtifactFacts, actions: readonly ScenarioAgentAction[]): CheckResult[] {
  const out: CheckResult[] = [];
  for (const a of actions) {
    const at = `action:${a.object}.${a.name}`;
    const decl = facts.actions.find((x) => norm(x.object) === norm(a.object) && norm(String(x.action.name)) === norm(a.name));
    const ai = decl && isBag(decl.action.ai) ? decl.action.ai : undefined;
    out.push(check(`${at}->exists`, !!decl, decl ? undefined : 'the build declares no such action on that object'));
    out.push(check(
      `${at}->ai-exposed`,
      ai?.exposed === true,
      !decl ? 'not declared' : ai?.exposed === true ? undefined : 'ai.exposed is not true, so the MCP doors refuse it',
    ));
    if (a.confirm) {
      out.push(check(
        `${at}->confirm-gated`,
        ai?.requiresConfirmation === true,
        !decl ? 'not declared' : ai?.requiresConfirmation === true ? undefined : 'ai.requiresConfirmation is not true, so nothing gates the call',
      ));
    }
  }
  return out;
}

// ── One card against one artifact ───────────────────────────────────────────

export interface ScenarioArtifactScore {
  /** The card's `expect`, by exact name ({@link scoreGraph}). */
  expect: ScoreResult;
  /** The same `expect` by shape ({@link scoreGraphShape}) — reported, not counted below. */
  shape: ScoreResult;
  tags: TagVerdict[];
  agentActions: CheckResult[];
  /** Checks passed across `expect`, the scored tags and the agent actions. */
  passed: number;
  total: number;
  /** passed / total; `null` when nothing was scored — never a vacuous 1. */
  score: number | null;
  /** The tags no check judged, each with its reason. */
  unscored: Array<{ tag: string; reason: string }>;
}

/** Score one built artifact against one card: shape, capability tags and agent actions. */
export function scoreScenarioArtifact(artifact: unknown, card: ScenarioArtifactCard): ScenarioArtifactScore {
  const facts = readArtifactFacts(artifact);
  const expect = scoreGraph(facts.graph, card.expect);
  const shape = scoreGraphShape(facts.graph, deriveShape(card.expect));
  const tags = gradeCapabilityTags(facts, card);
  const agentActions = gradeAgentActions(facts, card.run.agentActions ?? []);
  const all = [...expect.checks, ...tags.flatMap((t) => t.checks), ...agentActions];
  const passed = all.filter((c) => c.pass).length;
  return {
    expect,
    shape,
    tags,
    agentActions,
    passed,
    total: all.length,
    score: all.length === 0 ? null : passed / all.length,
    unscored: tags.filter((t) => t.status === 'unscored').map((t) => ({ tag: t.tag, reason: t.reason! })),
  };
}
