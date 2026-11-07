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
 * ## Whether an expression compiles
 *
 * A row that asks whether an expression compiles or enforces (a formula, a
 * validation rule, an approver expression, an RLS predicate) asks the
 * platform's own expression front end, through `scenario-expressions.ts`,
 * which names the function each site's runtime and build run and what of the
 * build's pass it leaves out.
 *
 * Deterministic: no model call, no network (the cost ruling on cloud#3600).
 */

import { resolveStackCollection } from '@objectstack/core';
import { standaloneActionOwnerKey } from '@objectstack/objectql';
import { effectiveSharingModel } from '@objectstack/plugin-sharing';
import {
  APPROVAL_BRANCH_LABELS,
  APPROVAL_NODE_TYPE,
  APPROVER_VALUE_BINDINGS,
  canonicalApproverType,
  resolveFlowTriggerKind,
} from '@objectstack/spec/automation';
import {
  SINGLE_OPTION_TYPES,
  controlledByParentMasterOf,
  injectedSystemColumnDefs,
  referenceTargetOf,
  summaryFunctionReadsField,
} from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';

import { personaPermissionSetName, ROW_SCOPE_TAG, type ScenarioCard } from '../schema.js';
import { approverExpressionRefusal, recordExpressionRefusal, rlsPredicateEnforces } from './scenario-expressions.js';
import { artifactToEvalGraph } from './scenario-graph.js';
import { gradeItemNames } from './scenario-naming.js';
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
  /** Raw dataset and report definitions — for the keys the eval graph does not carry. */
  datasets: readonly Bag[];
  reports: readonly Bag[];
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

  const collection = (key: string) => resolveStackCollection(artifact, key).filter(isBag);
  return {
    graph,
    objects,
    flows: collection('flows'),
    permissionSets,
    actions,
    datasets: collection('datasets'),
    reports: collection('reports'),
  };
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

/** A raw object definition, matched by name as the graph matches one. */
function rawObject(facts: ArtifactFacts, name: string): Bag | undefined {
  return [...facts.objects].find(([n]) => norm(n) === norm(name))?.[1];
}

/** The object a user reference points at, asked of the spec (the `user` type fixes it). */
const USER_OBJECT = referenceTargetOf({ type: 'user' });

/** Whether `field` of this object holds a user: a declared field, or an injected column, that references the user object. */
function holdsUser(def: Bag, field: string): boolean {
  const declared = isBag(def.fields) ? def.fields[field] : undefined;
  return USER_OBJECT !== undefined && referenceTargetOf(declared ?? injectedSystemColumnDefs(def)[field]) === USER_OBJECT;
}

const flowNodes = (flow: Bag): Bag[] => (Array.isArray(flow.nodes) ? flow.nodes.filter(isBag) : []);
const approvalNodes = (flow: Bag): Bag[] => flowNodes(flow).filter((n) => n.type === APPROVAL_NODE_TYPE);

/**
 * The first pair of Approval nodes that run in sequence: the second reached
 * from the first's `approve` branch, as the engine walks a flow
 * (`traverseNext`, service-automation `dag-traversal.ts`). Out of an Approval
 * node it follows the edges labelled `approve`, or every out-edge when none
 * is; out of any other node, every out-edge; never a `fault` edge. Two
 * Approval nodes on alternative branches, or one behind the other's `reject`
 * edge, are not in sequence.
 */
function approvalSequence(flow: Bag): [string, string] | undefined {
  const edges = Array.isArray(flow.edges) ? flow.edges.filter(isBag) : [];
  const nodes = new Map(flowNodes(flow).map((n) => [String(n.id), n]));
  const out = (id: string) => edges.filter((e) => e.source === id && e.type !== 'fault');
  for (const first of approvalNodes(flow)) {
    const from = String(first.id);
    const approve = out(from).filter((e) => e.label === APPROVAL_BRANCH_LABELS.approve);
    const queue = (approve.length > 0 ? approve : out(from)).map((e) => String(e.target));
    const seen = new Set<string>([from]);
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = nodes.get(id);
      if (node?.type === APPROVAL_NODE_TYPE) return [from, id];
      if (node) queue.push(...out(id).map((e) => String(e.target)));
    }
  }
  return undefined;
}

/**
 * The approver bindings whose value is read off the request record
 * (`APPROVER_VALUE_BINDINGS`): `trigger-field` (a field of the record holds the
 * approver), `auto` (the manager of the record's subject user) and
 * `expression` (CEL over the record at node entry). Every other binding names a
 * fixed directory member or catalog item — one person, team, department,
 * position, queue or membership tier for every request.
 */
const RECORD_ROUTED_SOURCES: ReadonlySet<string> = new Set(['trigger-field', 'auto', 'expression']);

/** Every approver of an Approval node of `flow` whose binding reads the request record. */
function recordRoutedApprovers(flow: Bag): Array<{ at: string; type: string; approver: Bag }> {
  return approvalNodes(flow).flatMap((node) => {
    const approvers = isBag(node.config) && Array.isArray(node.config.approvers) ? node.config.approvers.filter(isBag) : [];
    return approvers.flatMap((approver, i) => {
      const type = canonicalApproverType(String(approver.type));
      const binding = (APPROVER_VALUE_BINDINGS as Readonly<Record<string, { source: string }>>)[type];
      return binding && RECORD_ROUTED_SOURCES.has(binding.source) ? [{ at: `${flowName(flow)}.${String(node.id)}[${i}]`, type, approver }] : [];
    });
  });
}

/**
 * Why a record-routed approver can name no one, or `undefined`. A `field`
 * approver reads the user ids its field holds; a `manager` approver the
 * manager of the user its `value` field holds, else of the record's owner
 * (plugin-approvals `resolveApproverSpec`); either field must hold a user. An
 * `expression` must parse over the closed approver roots.
 */
function approverRouteRefusal(type: string, approver: Bag, object: string | undefined, def: Bag | undefined): string | undefined {
  if (type === 'expression') return approverExpressionRefusal(approver.value);
  const named = typeof approver.value === 'string' && approver.value !== '' ? approver.value : undefined;
  const field = named ?? (type === 'manager' ? SystemFieldName.OWNER_ID : undefined);
  if (field === undefined) return 'names no field';
  if (!def) return object === undefined ? 'the flow binds no object' : `the build has no object ${object}`;
  return holdsUser(def, field) ? undefined : `${object}.${field} holds no user`;
}

/** A validation rule's predicates: `condition`, a conditional rule's `when`, and those of the rules in its `then` / `otherwise`. */
function rulePredicates(rule: Bag): unknown[] {
  return [
    ...[rule.condition, rule.when].filter((p) => p !== undefined),
    ...[rule.then, rule.otherwise].filter(isBag).flatMap(rulePredicates),
  ];
}

const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : []);
const memberNames = (list: unknown): Set<string> =>
  new Set((Array.isArray(list) ? list : []).filter(isBag).flatMap((m) => (typeof m.name === 'string' ? [norm(m.name)] : [])));

/** What a report selects from each dataset it binds: its own selection, or each block's on a `joined` report. */
function reportBindings(report: Bag): Bag[] {
  if (report.type !== 'joined') return [report];
  return Array.isArray(report.blocks) ? report.blocks.filter(isBag) : [];
}

function datasetNamed(facts: ArtifactFacts, name: unknown): Bag | undefined {
  return typeof name === 'string' ? facts.datasets.find((d) => typeof d.name === 'string' && norm(d.name) === norm(name)) : undefined;
}

/** Why a report binding draws nothing, or `undefined`: it names a dataset of the build, and selects only its measures and dimensions. */
function reportBindingGap(facts: ArtifactFacts, binding: Bag): string | undefined {
  if (typeof binding.dataset !== 'string') return 'binds no dataset';
  const ds = datasetNamed(facts, binding.dataset);
  if (!ds) return `no dataset ${binding.dataset}`;
  const measures = memberNames(ds.measures);
  const dimensions = memberNames(ds.dimensions);
  const missing = [
    ...strings(binding.values).filter((m) => !measures.has(norm(m))).map((m) => `measure ${m}`),
    ...[...strings(binding.rows), ...strings(binding.columns)].filter((d) => !dimensions.has(norm(d))).map((d) => `dimension ${d}`),
  ];
  return missing.length === 0 ? undefined : `dataset ${binding.dataset} has no ${missing.join(', ')}`;
}

// ── The closed tag → check table ────────────────────────────────────────────

/** A check's answer: the checks it ran, or why it had nothing in the card to judge. */
export type TagCheckOutcome = { checks: CheckResult[] } | { unscored: string };

/** What a check knows beyond the card and the artifact. */
export interface TagCheckContext {
  /**
   * The app's namespace (`democrm`): a persona's permission set is
   * `<namespace>_<persona id>` ({@link personaPermissionSetName}). Absent ⇒
   * the card's names are read bare, and so is the persona's set (its id).
   */
  namespace?: string;
}

export interface TagCheck {
  /** One sentence: what the check asserts of the artifact. */
  asserts: string;
  run(facts: ArtifactFacts, card: ScenarioArtifactCard, ctx: TagCheckContext): TagCheckOutcome;
}

/** The permission set the runner grants a persona: see {@link TagCheckContext.namespace}. */
function personaSetName(ctx: TagCheckContext, persona: string): string {
  return ctx.namespace === undefined ? persona : personaPermissionSetName(ctx.namespace, persona);
}

/**
 * The `rowLevelSecurity` policies of a permission set that apply when its
 * holder READS `object` (`skills/objectstack-data/rules/security.md` §RLS): not
 * `enabled: false`, `object` the object or `'*'`, `operation` `select` or
 * `all`. A policy that lists `positions` applies only to their holders, and a
 * persona holds none (the runner grants it this one set), so it is left out.
 */
function readPolicies(set: Bag | undefined, object: string): Bag[] {
  const policies = Array.isArray(set?.rowLevelSecurity) ? set.rowLevelSecurity : [];
  return policies.filter(
    (r): r is Bag =>
      isBag(r) &&
      r.enabled !== false &&
      (r.object === '*' || (typeof r.object === 'string' && norm(r.object) === norm(object))) &&
      (r.operation === 'select' || r.operation === 'all') &&
      !(Array.isArray(r.positions) && r.positions.length > 0),
  );
}

/**
 * A read policy that admits every row: no `using`, or the literal `true`. The
 * applicable `using` predicates OR-combine, so one such policy undoes the rest.
 */
const admitsEveryRow = (r: Bag): boolean => typeof r.using !== 'string' || r.using.trim() === '' || r.using.trim() === 'true';

function uniqueBy<T>(items: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Each object a card persona sees only part of (`run.personas[].scope`) → the personas scoping it, in card order. */
function scopedObjects(card: ScenarioArtifactCard): Map<string, string[]> {
  const scopedBy = new Map<string, string[]>();
  for (const p of card.run.personas) {
    for (const s of p.scope ?? []) {
      const personas = scopedBy.get(s.object) ?? [];
      if (!personas.includes(p.id)) scopedBy.set(s.object, [...personas, p.id]);
    }
  }
  return scopedBy;
}

/**
 * Why `persona` is not kept to its rows of `object` by a route that enforces,
 * or `undefined` when it is. The routes are the three row-scope accepts
 * (#30883 item 4 as corrected): a private object (plugin-sharing's
 * `effectiveSharingModel`), a detail controlled by its parent — here only
 * when that master is itself kept so for the persona (ADR-0055: the detail
 * reads through it), or a read policy on the persona's own permission set.
 * Whichever route, every read policy that applies there must lower to a query
 * filter: one that does not matches no row (`rlsPredicateEnforces`), so the
 * persona would see none of its own.
 */
function rowSecurityGap(f: ArtifactFacts, ctx: TagCheckContext, persona: string, object: string, via: readonly string[] = []): string | undefined {
  const def = rawObject(f, object);
  if (!def) return `the build has no object ${object}`;
  const set = personaSetName(ctx, persona);
  const policies = readPolicies(f.permissionSets.find((ps) => ps.name === set), object);
  const dead = policies.find((r) => typeof r.using === 'string' && r.using.trim() !== '' && !rlsPredicateEnforces(r.using));
  if (dead) return `the read policy ${String(dead.name)} on ${set} does not lower to a filter on ${object}, so it matches no row`;
  if (effectiveSharingModel(def) === 'private') return undefined;
  if (def.sharingModel === 'controlled_by_parent') {
    const master = controlledByParentMasterOf(def.fields);
    const target = master && isBag(def.fields) ? referenceTargetOf(def.fields[master.field]) : undefined;
    if (target === undefined) return `${object} is controlled by a parent it names no master of`;
    if ([...via, object].some((o) => norm(o) === norm(target))) return `${object} is controlled by a parent chain that loops back to ${target}`;
    return rowSecurityGap(f, ctx, persona, target, [...via, object]);
  }
  if (policies.length === 0 || policies.some(admitsEveryRow)) return `no read policy on ${set} narrows ${object}`;
  return undefined;
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

  'records-forms.formula-field': {
    asserts:
      "the build carries a computed field (a `formula` field, or a stored field computed from an `expression`), and every computed field's expression compiles: valid CEL reading only columns its object has, by the validator `os build` runs",
    run(f) {
      // A stored field with an `expression` is the same capability, stored:
      // the engine computes and keeps it, which is what lets a roll-up sum it
      // (a `formula` field is virtual — no column — and cannot be rolled up).
      // A card whose total sums a computed line amount is built that way.
      const computed = [...f.objects].flatMap(([object, def]) =>
        Object.entries(isBag(def.fields) ? def.fields : {}).flatMap(([field, fd]) =>
          isBag(fd) && (fd.type === 'formula' || fd.expression !== undefined) ? [{ object, def, field, fd }] : [],
        ),
      );
      return {
        checks: [
          check('computed-field-exists', computed.length > 0, `${computed.length} computed field(s)`),
          ...computed.map(({ object, def, field, fd }) => {
            const refusal = recordExpressionRefusal('value', fd.expression, object, def);
            return check(`formula:${object}.${field}->compiles`, refusal === undefined, refusal);
          }),
        ],
      };
    },
  },

  'records-forms.validation-rule': {
    asserts:
      "an object the card names carries an active validation rule that refuses the write (`severity: 'error'`), and every validation rule's predicates (`condition`, a conditional rule's `when`, and those of the rules in its `then` / `otherwise`) compile against its object, by the validator `os build` runs",
    run(f, card) {
      const expected = new Set(card.expect.objects.map(norm));
      const rules = [...f.objects].flatMap(([object, def]) =>
        (Array.isArray(def.validations) ? def.validations.filter(isBag) : []).map((rule) => ({ object, def, rule })),
      );
      // An advisory severity flags and lets the write through, and a nested
      // branch follows its top-level rule's severity.
      const blocking = rules.filter(({ object, rule }) => expected.has(norm(object)) && rule.active !== false && (rule.severity ?? 'error') === 'error');
      return {
        checks: [
          ...rules.flatMap(({ object, def, rule }) => {
            const predicates = rulePredicates(rule);
            if (predicates.length === 0) return [];
            const refusal = predicates.map((p) => recordExpressionRefusal('predicate', p, object, def)).find((r) => r !== undefined);
            return [check(`validation:${object}.${String(rule.name)}->compiles`, refusal === undefined, refusal)];
          }),
          check(
            'validation-rule-binds-expected-object',
            blocking.length > 0,
            `${rules.length} validation rule(s), ${blocking.length} refusing a write on an object the card names`,
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

  [ROW_SCOPE_TAG]: {
    asserts:
      "every object a card persona sees only part of keeps its records private (owner-scoped), derives access from its master, or is narrowed for each such persona by a read policy (`rowLevelSecurity`) on that persona's permission set",
    run(f, card, ctx) {
      const scopedBy = scopedObjects(card);
      if (scopedBy.size === 0) return { unscored: "the card's personas scope no rows, so no object has a row scope to keep" };
      return {
        checks: [...scopedBy].map(([object, personas]) => {
          const at = `row-scope:${object}->scoped`;
          const def = [...f.objects].find(([name]) => norm(name) === norm(object))?.[1];
          if (!def) return check(at, false, 'the build has no such object');
          const model = `sharingModel ${String(def.sharingModel ?? '(undeclared)')}`;
          // `effectiveSharingModel` is plugin-sharing's own reading (ADR-0090
          // D1: an undeclared custom object is private). A detail is public
          // there because the security plugin scopes it through its master.
          if (effectiveSharingModel(def) === 'private' || def.sharingModel === 'controlled_by_parent') return check(at, true, model);
          // Otherwise every persona that sees only part of the object must be
          // narrowed on its own: the read policies of its permission set AND
          // into its query (`skills/objectstack-data/rules/security.md` §RLS).
          const unnarrowed = personas.filter((p) => {
            const name = personaSetName(ctx, p);
            const policies = readPolicies(f.permissionSets.find((ps) => ps.name === name), object);
            return policies.length === 0 || policies.some(admitsEveryRow);
          });
          const sets = personas.map((p) => personaSetName(ctx, p)).join(', ');
          return check(
            at,
            unnarrowed.length === 0,
            unnarrowed.length === 0
              ? `${model}; narrowed by a read policy on ${sets}`
              : `${model}, and no read policy narrows it on ${unnarrowed.map((p) => personaSetName(ctx, p)).join(', ')}`,
          );
        }),
      };
    },
  },

  'access-security.row-level-security': {
    asserts:
      "every object a card persona sees only part of is kept to that persona's rows by a route that enforces: it is private (owner-scoped), it is a detail whose master is itself kept so, or a read policy (`rowLevelSecurity`) on the persona's permission set narrows it; and every read policy that applies there lowers to a query filter",
    run(f, card, ctx) {
      // Row-scope's routes (#30883 item 4 as corrected), each held to enforce:
      // see `rowSecurityGap`. What this row adds is the enforcement — a read
      // policy that matches no row, and a detail whose master any persona
      // reads in full, keep nothing to the persona's own rows.
      const scopedBy = scopedObjects(card);
      if (scopedBy.size === 0) return { unscored: "the card's personas scope no rows, so no row-level security has a scope to enforce" };
      return {
        checks: [...scopedBy].map(([object, personas]) => {
          const gaps = uniqueBy(personas.flatMap((p) => rowSecurityGap(f, ctx, p, object) ?? []), (g) => g);
          return check(
            `row-level-security:${object}->enforced`,
            gaps.length === 0,
            gaps.length === 0 ? `enforced for ${personas.map((p) => personaSetName(ctx, p)).join(', ')}` : gaps.join('; '),
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

  'approvals.multi-step-approval': {
    asserts:
      "an approval flow bound to an object the card names and the build carries runs its approval in steps: a second Approval node follows the first on its `approve` branch (ADR-0019: a step is an Approval node)",
    run(f, card) {
      const expected = new Set(card.expect.objects.map(norm));
      const flows = f.flows.filter((flow) => approvalNodes(flow).length > 0);
      const stepped = flows.flatMap((flow) => {
        const object = flowBoundObject(flow);
        const steps = approvalSequence(flow);
        return object !== undefined && expected.has(norm(object)) && findObject(f.graph, object) && steps
          ? [`${flowName(flow)} on ${object}: ${steps.join(' then ')}`]
          : [];
      });
      return {
        checks: [
          check(
            'multi-step-approval-binds-expected-object',
            stepped.length > 0,
            stepped.length > 0 ? stepped.join('; ') : `${flows.length} approval flow(s), none in steps on an object the card names`,
          ),
        ],
      };
    },
  },

  'approvals.dynamic-approver-routing': {
    asserts:
      'an approval flow bound to an object the card names and the build carries routes to an approver read off the request record (a field of it, the manager of its owner or of a user it names, or an expression over it), and every such approver can name someone: its field holds a user, its expression parses over `current` / `trigger` / `vars` alone',
    run(f, card) {
      const expected = new Set(card.expect.objects.map(norm));
      const routed = f.flows.flatMap((flow) => {
        const object = flowBoundObject(flow);
        const def = object === undefined ? undefined : rawObject(f, object);
        return recordRoutedApprovers(flow).map((r) => ({ ...r, object, def }));
      });
      return {
        checks: [
          ...routed.map(({ at, type, approver, object, def }) => {
            const refusal = approverRouteRefusal(type, approver, object, def);
            return check(`approver:${at}->routes`, refusal === undefined, refusal ?? (typeof approver.value === 'string' ? `${type} ${approver.value}` : type));
          }),
          // Also the existence check: a fixed approver (a user, a position, a
          // team…) is the same slate for every request.
          check(
            'dynamic-approver-binds-expected-object',
            routed.some(({ object, def }) => object !== undefined && !!def && expected.has(norm(object))),
            `${routed.length} approver(s) read off the request record`,
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

  'dashboards.report': {
    asserts:
      "the build carries a report (`reports`) whose dataset binds an object the card names, and every report draws from datasets the build carries, selecting only the measures (`values`) and dimensions (`rows`, `columns`) they declare — a `joined` report through each block's own",
    run(f, card) {
      // ADR-0021: a report binds a dataset, never an object; the dataset's
      // `object` is what it reports on. A dashboard widget is the sibling tag's
      // (`dashboards.widget-measures`), not a report.
      const expected = new Set(card.expect.objects.map(norm));
      const onExpected = f.reports.filter((r) =>
        reportBindings(r).some((b) => {
          const object = datasetNamed(f, b.dataset)?.object;
          return typeof object === 'string' && expected.has(norm(object));
        }),
      );
      return {
        checks: [
          ...f.reports.map((r) => {
            const bindings = reportBindings(r);
            const gaps = bindings.length === 0 ? ['binds no dataset'] : bindings.flatMap((b) => reportBindingGap(f, b) ?? []);
            return check(`report:${typeof r.name === 'string' ? r.name : '(unnamed report)'}->resolves`, gaps.length === 0, gaps.length === 0 ? undefined : gaps.join('; '));
          }),
          check('report-binds-expected-object', onExpected.length > 0, `${f.reports.length} report(s)`),
        ],
      };
    },
  },

  'ai.agent-actions': {
    asserts:
      'every business action the card declares an agent may call (`run.agentActions`) exists on its object, is opted into the AI / MCP surface (`ai.exposed`), and is confirm-gated (`ai.requiresConfirmation`) where the card says `confirm`',
    run(f, card) {
      // The checks `gradeAgentActions` runs for the card's actions, counted
      // under this tag as well — as `dashboards.widget-measures` counts the
      // measure checks `expect` already runs.
      const actions = card.run.agentActions ?? [];
      if (actions.length === 0) return { unscored: 'the card declares no agent action, so none has to be callable' };
      return { checks: gradeAgentActions(f, actions) };
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
export function gradeCapabilityTags(facts: ArtifactFacts, card: ScenarioArtifactCard, ctx: TagCheckContext = {}): TagVerdict[] {
  return card.capabilities.map((tag) => {
    const row = Object.prototype.hasOwnProperty.call(CAPABILITY_TAG_CHECKS, tag) ? CAPABILITY_TAG_CHECKS[tag] : undefined;
    if (!row) return { tag, status: 'unscored', checks: [], reason: 'no check in the closed tag table' };
    const out = row.run(facts, card, ctx);
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
  /** One failing check per bare non-object item name ({@link gradeItemNames}); empty when no namespace was given. */
  naming: CheckResult[];
  /** Checks passed across `expect`, the scored tags, the agent actions and the naming rule. */
  passed: number;
  total: number;
  /** passed / total; `null` when nothing was scored — never a vacuous 1. */
  score: number | null;
  /** The tags no check judged, each with its reason. */
  unscored: Array<{ tag: string; reason: string }>;
}

/**
 * Score one built artifact against one card: shape, capability tags and agent
 * actions, plus — given the app's `namespace` — every bare non-object item name.
 */
export function scoreScenarioArtifact(artifact: unknown, card: ScenarioArtifactCard, opts: { namespace?: string } = {}): ScenarioArtifactScore {
  const facts = readArtifactFacts(artifact);
  const expect = scoreGraph(facts.graph, card.expect);
  const shape = scoreGraphShape(facts.graph, deriveShape(card.expect));
  const tags = gradeCapabilityTags(facts, card, opts.namespace === undefined ? {} : { namespace: opts.namespace });
  const agentActions = gradeAgentActions(facts, card.run.agentActions ?? []);
  const naming = opts.namespace === undefined ? [] : gradeItemNames(artifact, opts.namespace);
  const all = [...expect.checks, ...tags.flatMap((t) => t.checks), ...agentActions, ...naming];
  const passed = all.filter((c) => c.pass).length;
  return {
    expect,
    shape,
    tags,
    agentActions,
    naming,
    passed,
    total: all.length,
    score: all.length === 0 ? null : passed / all.length,
    unscored: tags.filter((t) => t.status === 'unscored').map((t) => ({ tag: t.tag, reason: t.reason! })),
  };
}
