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
 * `expect`, `capabilities`, `run.personas` (hidden fields and row scope),
 * `run.agentActions`, and `run.questions` / `run.operations` for the persona
 * grant checks ({@link gradePersonaGrants}: what the card has each persona
 * read and write, against that persona's permission set) — picked from the
 * card schema's own type ({@link ScenarioArtifactCard}), never a copy of it.
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

import { buildEffectiveObjectPermissions, holdsSuperuserBypass, resolveStackCollection, superuserFieldVote } from '@objectstack/core';
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
import { objectPermissionGrants, type ObjectPermissionVerbTarget } from '@objectstack/spec/security';
import { SystemFieldName } from '@objectstack/spec/system';

import { rowOwner } from '../row-owner.js';
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

/**
 * What {@link scoreScenarioArtifact} reads of one card: a pick of the card
 * schema's type. `questions` and `operations` feed the persona grant checks
 * alone ({@link gradePersonaGrants}); a pick without them derives none.
 */
export type ScenarioArtifactCard = Pick<ScenarioCard, 'expect' | 'capabilities'> & {
  run: Pick<ScenarioCard['run'], 'personas' | 'agentActions' | 'userHandleFields'> & Partial<Pick<ScenarioCard['run'], 'questions' | 'operations' | 'seed'>>;
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

/**
 * Whether the read policies that apply to a persona on an object narrow it on
 * their own: at least one applies, and none admits every row. Whether each
 * lowers to a filter is asked apart, before this (`rowSecurityGap`).
 */
const narrowsOnItsOwn = (policies: readonly Bag[]): boolean => policies.length > 0 && !policies.some(admitsEveryRow);

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
 * A detail takes the last route too: the engine ANDs the detail's own read
 * policies with the filter it derives from the master (plugin-security's find
 * path composes `computeRlsFilter` and `computeControlledByParentFilter` into
 * one `$and`), so a detail they narrow is kept to the persona's rows whatever
 * the master admits, and the master is followed only when they do not.
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
    if (narrowsOnItsOwn(policies)) return undefined;
    const master = controlledByParentMasterOf(def.fields);
    const target = master && isBag(def.fields) ? referenceTargetOf(def.fields[master.field]) : undefined;
    if (target === undefined) return `${object} is controlled by a parent it names no master of`;
    if ([...via, object].some((o) => norm(o) === norm(target))) return `${object} is controlled by a parent chain that loops back to ${target}`;
    return rowSecurityGap(f, ctx, persona, target, [...via, object]);
  }
  if (!narrowsOnItsOwn(policies)) return `no read policy on ${set} narrows ${object}`;
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
            return !narrowsOnItsOwn(policies);
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
      'every business action the card declares an agent may call (`run.agentActions`) exists on its object, is opted into the AI / MCP surface (`ai.exposed`), and is confirm-gated (`ai.requiresConfirmation`) where the card says `confirm`, and only there',
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
 * of its checks — the agent cannot call what the build does not expose. The
 * gate is judged both ways: `confirm-gated` where the card says `confirm`,
 * `not-confirm-gated` where it says the agent acts at once.
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
    } else {
      // Over-gating is a build defect too: the card has the agent act at
      // once, and a gated action meets the door's confirmation instead
      // (`428 no_confirmation_service` where no confirmation service runs), so
      // the run could only mark the write not measured.
      out.push(check(
        `${at}->not-confirm-gated`,
        !!decl && ai?.requiresConfirmation !== true,
        !decl
          ? 'not declared'
          : ai?.requiresConfirmation === true
            ? 'ai.requiresConfirmation is true on an action the card has the agent run without asking, so the door asks for a confirmation the card never gives'
            : undefined,
      ));
    }
  }
  return out;
}

// ── Persona grants: what the card has each persona do, against its set ──────

/** The verb a persona grant check names: `read` for a question, the operation's own kind for a write. */
export type PersonaGrantVerb = 'read' | NonNullable<ScenarioArtifactCard['run']['operations']>[number]['kind'];

/** The object-permission bit each verb needs, read through the spec's fold (`objectPermissionGrants`). */
const VERB_GRANT: Readonly<Record<PersonaGrantVerb, ObjectPermissionVerbTarget>> = {
  read: 'allowRead',
  create: 'allowCreate',
  update: 'allowEdit',
  delete: 'allowDelete',
};

/** The row-policy operation (`RLSOperation`) a write of each kind meets, besides `all`. */
const WRITE_POLICY_OPERATION: Readonly<Record<Exclude<PersonaGrantVerb, 'read'>, string>> = {
  create: 'insert',
  update: 'update',
  delete: 'delete',
};

/** One persona × object × verb the card implies, and what implies it. */
export interface PersonaGrantNeed {
  persona: string;
  object: string;
  verb: PersonaGrantVerb;
  /** The questions and operations that need the grant: a question the persona answers, a write applied or awaiting confirmation. */
  requiredBy: string[];
  /** The operations among those whose outcome is `pending_confirmation`: the write waits on a person's confirmation. */
  awaitingConfirmation: string[];
  /** The operations among those that name the card's agent action they go through (`via`), each with that action. */
  routedVia: Array<{ operation: string; action: string }>;
  /** The writes the card declares refused `PERMISSION_DENIED`, each with the fields it names. */
  refusedBy: Array<{ operation: string; fields: string[] }>;
}

/**
 * What the card alone implies each persona may and may not do, one entry per
 * persona × object × verb, in card order:
 *
 *  - a question asked as a persona (`questions[].personas`) needs `read` on its
 *    object, unless the persona hides that whole object (`hidden.objects`): a
 *    persona that must not read the object declines the question, it reads
 *    nothing;
 *  - an operation whose outcome is `applied` or `pending_confirmation` needs
 *    its kind on its object, for the persona it acts as; one that names the
 *    card's agent action it goes through (`via`) is recorded with it;
 *  - an operation refused `PERMISSION_DENIED` must be refused by that
 *    persona's set. Any other refusal (`VALIDATION_FAILED`) implies nothing
 *    about the grant.
 */
export function personaGrantNeeds(card: ScenarioArtifactCard): PersonaGrantNeed[] {
  const needs = new Map<string, PersonaGrantNeed>();
  const need = (persona: string, object: string, verb: PersonaGrantVerb): PersonaGrantNeed => {
    const key = `${persona}:${object}:${verb}`;
    let n = needs.get(key);
    if (!n) needs.set(key, (n = { persona, object, verb, requiredBy: [], awaitingConfirmation: [], routedVia: [], refusedBy: [] }));
    return n;
  };
  const hidesObject = new Map(card.run.personas.map((p) => [p.id, new Set(p.hidden.objects ?? [])]));
  for (const q of card.run.questions ?? []) {
    for (const persona of q.personas ?? []) {
      if (hidesObject.get(persona)?.has(q.object)) continue;
      need(persona, q.object, 'read').requiredBy.push(`question ${q.id}`);
    }
  }
  for (const op of card.run.operations ?? []) {
    const { outcome } = op;
    if (outcome.kind === 'applied' || outcome.kind === 'pending_confirmation') {
      const n = need(op.actingAs, op.object, op.kind);
      n.requiredBy.push(`operation ${op.id}`);
      if (outcome.kind === 'pending_confirmation') n.awaitingConfirmation.push(op.id);
      if (op.via !== undefined) n.routedVia.push({ operation: op.id, action: op.via });
    } else if (outcome.code === 'PERMISSION_DENIED') {
      need(op.actingAs, op.object, op.kind).refusedBy.push({ operation: op.id, fields: Object.keys(op.values ?? {}) });
    }
  }
  return [...needs.values()];
}

/**
 * How a persona's own set can refuse one declared write that its object grant
 * admits: a field lock, a row rule, or nothing. The platform answers the same
 * `403 PERMISSION_DENIED` for an object verb it does not grant, for a write
 * naming a field the caller's set does not let it edit (plugin-security's
 * field-level write step), and for a row its row policy refuses; so a refused
 * write does not by itself mean the verb is absent.
 *
 *  - `field-lock` — an entry with no row condition (`when`) on a field the
 *    write names, not editable (`fieldPermissionVote`'s reading), and no Modify
 *    All vote on the object (`superuserFieldVote`) to override it;
 *  - `row-rule` — a row policy (`rowLevelSecurity`) that applies to this write
 *    (`enabled` not false, its object or `'*'`, its operation or `all`, no
 *    `positions`: the persona holds none), or a row-conditioned entry on a
 *    field it names. Whether it refuses this row depends on the row, which the
 *    artifact does not carry;
 *  - `none` — nothing in the set refuses it.
 */
function writeRefusalRoute(
  set: Bag,
  object: string,
  verb: Exclude<PersonaGrantVerb, 'read'>,
  fields: readonly string[],
): { route: 'field-lock' | 'row-rule' | 'none'; names: string[] } {
  const entries = isBag(set.fields) ? set.fields : {};
  const written = verb === 'delete' ? [] : fields.flatMap((f) => {
    const entry = entries[`${object}.${f}`];
    return isBag(entry) && entry.editable !== true ? [{ field: f, conditioned: entry.when !== undefined }] : [];
  });
  const modifyAll = superuserFieldVote([set as { objects?: Record<string, unknown> }], object)?.editable === true;
  const locked = modifyAll ? [] : written.filter((w) => !w.conditioned).map((w) => w.field);
  if (locked.length > 0) return { route: 'field-lock', names: locked };
  const policies = (Array.isArray(set.rowLevelSecurity) ? set.rowLevelSecurity : []).filter(
    (r): r is Bag =>
      isBag(r) &&
      r.enabled !== false &&
      (r.object === '*' || r.object === object) &&
      (r.operation === 'all' || r.operation === WRITE_POLICY_OPERATION[verb]) &&
      !(Array.isArray(r.positions) && r.positions.length > 0),
  );
  const rowRules = [
    ...policies.map((r) => `row policy ${String(r.name)}`),
    ...(modifyAll ? [] : written.filter((w) => w.conditioned).map((w) => `row-conditioned field ${w.field}`)),
  ];
  return rowRules.length > 0 ? { route: 'row-rule', names: rowRules } : { route: 'none', names: [] };
}

/**
 * The confirm-gated agent actions the card declares on `object`
 * (`run.agentActions[]` with `confirm`) that the build declares there too, by
 * name. An action body runs elevated (`isSystem`, the runtime's sandbox), so a
 * build may withhold a write the card has wait on a person's confirmation from
 * the persona's set and route it through such an action: the lock and the
 * door ruling A on #31999 item 9 accepts on the Run side, here offered by the
 * card itself. For a write the card applies outright only the action the
 * operation names as its route (`via`) counts ({@link designedRoutes}):
 * without one it stays measured against the grant, whatever actions the
 * build adds.
 */
function confirmGatedRoutes(facts: ArtifactFacts, card: ScenarioArtifactCard, object: string): string[] {
  return (card.run.agentActions ?? [])
    .filter((a) => a.confirm === true && a.object === object && buildDeclaresAction(facts, object, a.name))
    .map((a) => a.name);
}

/** Whether the build declares an action named `name` on `object`. */
function buildDeclaresAction(facts: ArtifactFacts, object: string, name: string): boolean {
  return facts.actions.some((x) => x.object === object && x.action.name === name);
}

/**
 * Each write the need's grant is withheld from, with the routes the card
 * designs for it that the build declares: the agent action the operation
 * names (`via`, any `confirm`) and, for a write that waits on confirmation,
 * the card's confirm-gated actions ({@link confirmGatedRoutes}). `undefined`
 * when one write has no such route: the grant is then measured. The card's
 * other actions on the object are no route, whatever the build declares.
 */
function designedRoutes(facts: ArtifactFacts, card: ScenarioArtifactCard, n: PersonaGrantNeed): Array<{ operation: string; via: string[]; confirm: string[] }> | undefined {
  const confirm = confirmGatedRoutes(facts, card, n.object);
  const routes = n.requiredBy.map((r) => {
    const operation = r.replace(/^operation /, '');
    const via = n.routedVia.filter((v) => v.operation === operation && buildDeclaresAction(facts, n.object, v.action)).map((v) => v.action);
    return { operation, via, confirm: n.awaitingConfirmation.includes(operation) ? confirm : [] };
  });
  return routes.every((r) => r.via.length > 0 || r.confirm.length > 0) ? routes : undefined;
}

/**
 * The platform's owner-only delete floor, read for each write a delete need
 * applies or awaits ({@link PersonaGrantNeed.requiredBy}), against the row the
 * operation deletes (`target`). Read off the platform, not guessed:
 *
 *  - every member resolves `member_default`, whose wildcard
 *    `owner_only_deletes` policy (plugin-security
 *    `platform-ownership-policies.ts`) admits a delete only of a row the caller
 *    created. The runner loads the seed as the admin user, so no persona
 *    created a seeded row;
 *  - the floor comes off a row only where the sharing service's delete
 *    verdict (`SharingService.checkDelete`, plugin-sharing) answers `allow`:
 *    ownership (`owner_id`, the persona {@link rowOwner} loads the row as
 *    owned by; a write depth of `org`) or Modify All (`modifyAllRecords`). An
 *    edit share never opens a delete. That verdict abstains on an object
 *    whose org-wide default is public (`public_read_write` opens updates
 *    only, `owdOpenWritesCoversOperation`) or which has no `owner_id`
 *    (`ownership` other than `user`), and an abstain leaves the floor
 *    standing, Modify All included;
 *  - beside the floor, an app-authored row policy for deletes (`delete` or
 *    `all`, with a `using`) widens the rows a delete reaches (Layer 1 is an
 *    OR of permissive policies), and a `controlled_by_parent` detail hands its
 *    floor to the master's gate. Each depends on a row the artifact does not
 *    carry, so the write is `open`: not measured;
 *  - an agent action the build declares as the write's designed route (the
 *    one the operation names, `via`, or for a write awaiting confirmation the
 *    card's confirm-gated one, as {@link designedRoutes} reads them) runs
 *    elevated and meets no floor: `open` too, the run's to observe.
 *
 * Every other write is `refused`. A write whose operation names no `target`,
 * or whose target is not a seed row the card carries, is judged no further.
 */
function deleteFloorReading(
  facts: ArtifactFacts,
  card: ScenarioArtifactCard,
  set: Bag,
  n: PersonaGrantNeed,
): { refused: Array<{ operation: string; row: string; why: string }>; open: Array<{ operation: string; row: string; why: string }> } {
  const refused: Array<{ operation: string; row: string; why: string }> = [];
  const open: Array<{ operation: string; row: string; why: string }> = [];
  const schema = facts.objects.get(n.object);
  const declared = schema?.sharingModel ?? (isBag(schema?.security) ? schema.security.sharingModel : undefined);
  const ownerField = (schema?.ownership ?? 'user') === 'user';
  const sharingEnforces = effectiveSharingModel(schema) !== 'public' && ownerField;
  const objects = isBag(set.objects) ? set.objects : {};
  const entry = objects[n.object] ?? objects['*'];
  const orgDepth = isBag(entry) && entry.writeScope === 'org';
  const modifyAll = holdsSuperuserBypass(set as { objects?: Record<string, unknown> }, n.object, 'modify');
  const authored = (Array.isArray(set.rowLevelSecurity) ? set.rowLevelSecurity : []).filter(
    (r): r is Bag =>
      isBag(r) &&
      r.enabled !== false &&
      (r.object === '*' || r.object === n.object) &&
      (r.operation === 'all' || r.operation === 'delete') &&
      typeof r.using === 'string' &&
      r.using.trim().length > 0 &&
      !(Array.isArray(r.positions) && r.positions.length > 0),
  );
  const confirmRoutes = confirmGatedRoutes(facts, card, n.object);
  for (const r of n.requiredBy) {
    if (!r.startsWith('operation ')) continue;
    const operation = r.slice('operation '.length);
    const op = (card.run.operations ?? []).find((o) => o.id === operation);
    const target = op?.target;
    const row = target === undefined ? undefined : (card.run.seed?.[n.object] ?? []).find((x) => x.id === target);
    if (target === undefined || row === undefined) continue;
    const owner = rowOwner(card, n.object, row);
    if (sharingEnforces && (modifyAll || orgDepth || owner === n.persona)) continue;
    if (declared === 'controlled_by_parent') {
      open.push({ operation, row: target, why: `${n.object} is \`controlled_by_parent\` and its master's gate decides, which depends on the master row` });
      continue;
    }
    if (authored.length > 0) {
      open.push({ operation, row: target, why: `only ${authored.map((p) => `row policy ${String(p.name)}`).join(', ')} could admit it, which depends on the row` });
      continue;
    }
    const via = n.routedVia.filter((v) => v.operation === operation && buildDeclaresAction(facts, n.object, v.action)).map((v) => v.action);
    const through = [...new Set([...via, ...(n.awaitingConfirmation.includes(operation) ? confirmRoutes : [])])];
    if (through.length > 0) {
      open.push({ operation, row: target, why: `the build declares ${through.join(' or ')}, a door that writes as the platform: whether the write goes through it is the run's to observe` });
      continue;
    }
    const whose = owner === undefined ? 'a row the admin owns' : owner === n.persona ? `a row ${n.persona} owns` : `a row ${owner} owns`;
    refused.push({
      operation,
      row: target,
      why: sharingEnforces
        ? `${whose}, and ${String(set.name)} holds no Modify All (\`modifyAllRecords\`) or \`writeScope: 'org'\` on ${n.object}`
        : `${whose}, and ${n.object}'s ${ownerField ? `org-wide default (\`${String(declared ?? 'unset')}\`) is public` : 'records have no owner (`ownership` is not `user`)'}, so the sharing service abstains and nothing lifts the floor, Modify All included`,
    });
  }
  return { refused, open };
}

/**
 * One Build check per persona × object × verb the card implies
 * ({@link personaGrantNeeds}), named `persona-grant:<persona>:<object>:<verb>`,
 * judged against the persona's own permission set
 * ({@link TagCheckContext.namespace}): the set the runner signs the persona in
 * with, and the only one the data contract promises it ("a user holding only
 * that set").
 *
 * The object grant is the platform's own answer, never a reading of one bit:
 * the set is folded by `buildEffectiveObjectPermissions` (`@objectstack/core`,
 * the map `/auth/me/permissions` serves — an explicit entry, else the set's
 * `'*'` wildcard where the object's `access.default` lets one cover it), and
 * the entry asked through the spec's `objectPermissionGrants`, the fold the
 * enforcement door asks (`edit` and `delete` are `read ∧ grant`).
 *
 *  - Needed (a question's read, an applied or pending write): passes when the
 *    set grants the verb. A refused write of the same persona, object and verb
 *    beside it is refused by a row or a field, not the grant; it is named in
 *    the detail and judged no further. One exception, not measured and never
 *    a pass: a write verb the set withholds where every operation needing it
 *    has a route the card designs and the build declares
 *    ({@link designedRoutes}) — the agent action the operation names as its
 *    route (`via`), or, for a `pending_confirmation` operation, the card's
 *    confirm-gated agent action on the object ({@link confirmGatedRoutes}).
 *    An operation without `via` is graded as before: an applied write stays
 *    measured whatever actions the build adds.
 *    A delete the set grants is also read against the platform's owner-only
 *    delete floor ({@link deleteFloorReading}): `allowDelete` without Modify
 *    All does not pass a delete of a seeded row the persona does not own. It
 *    fails where nothing lifts the floor on some write's row, and is not
 *    measured where only a row-dependent rule or an elevated route could.
 *  - Refused `PERMISSION_DENIED` only: passes when the set refuses every such
 *    write — it grants no verb, or it locks a field each write names
 *    ({@link writeRefusalRoute}). When only a row rule could refuse one, the
 *    check is not measured: it counts in neither passed nor total and is never
 *    a pass. When nothing in the set refuses one, it fails.
 *
 * A persona whose set the build does not declare fails every check: there is
 * no built set to judge.
 */
export function gradePersonaGrants(facts: ArtifactFacts, card: ScenarioArtifactCard, ctx: TagCheckContext = {}): CheckResult[] {
  const needs = personaGrantNeeds(card);
  if (needs.length === 0) return [];
  const schemas = [...facts.objects.values()];
  const source = { allSchemas: () => schemas, schemaOf: (name: string) => facts.objects.get(name) };
  const effective = new Map<string, ReturnType<typeof buildEffectiveObjectPermissions>>();
  return needs.map((n) => {
    const name = `persona-grant:${n.persona}:${n.object}:${n.verb}`;
    const setName = personaSetName(ctx, n.persona);
    const set = facts.permissionSets.find((ps) => ps.name === setName);
    if (!set) return check(name, false, `the build declares no permission set ${setName}`);
    if (!effective.has(setName)) effective.set(setName, buildEffectiveObjectPermissions([set as { objects?: Record<string, unknown> }], source));
    const granted = objectPermissionGrants(effective.get(setName)![n.object], VERB_GRANT[n.verb]);
    const refused = n.refusedBy.map((r) => r.operation);

    if (n.requiredBy.length > 0) {
      const beside = refused.length > 0 ? `; ${refused.join(', ')} is refused by a row or a field, not the grant` : '';
      const routes = granted || n.verb === 'read' ? undefined : designedRoutes(facts, card, n);
      if (routes !== undefined && routes.some((r) => r.via.length > 0)) {
        const through = routes.map((r) => `operation ${r.operation} through ${[...new Set([...r.via, ...r.confirm])].join(' or ')}`);
        return {
          check: name,
          pass: false,
          notMeasured:
            `${setName} grants no ${n.verb} on ${n.object}, and the build declares the card's agent action each write names as its route (\`via\`) ` +
            `or its confirm-gated one, a door that writes as the platform: whether ${through.join(', ')} goes through it is the run's to observe`,
        };
      }
      const routed = routes === undefined ? [] : routes[0]!.confirm;
      if (routed.length > 0) {
        return {
          check: name,
          pass: false,
          notMeasured:
            `${setName} grants no ${n.verb} on ${n.object}, and the build declares the card's confirm-gated agent action${routed.length > 1 ? 's' : ''} ` +
            `${routed.join(', ')} there, a door that writes as the platform: whether ${n.requiredBy.join(', ')} goes through it is the run's to observe`,
        };
      }
      if (granted && n.verb === 'delete') {
        const floor = deleteFloorReading(facts, card, set, n);
        if (floor.refused.length > 0) {
          return check(
            name,
            false,
            `${setName} grants delete on ${n.object}, but the platform keeps owner-only deletes (its \`owner_only_deletes\` floor, ` +
              '`created_by == current_user.id`) where nothing lifts it: ' +
              floor.refused.map((r) => `operation ${r.operation} deletes ${r.row}, ${r.why}`).join('; '),
          );
        }
        if (floor.open.length > 0) {
          return {
            check: name,
            pass: false,
            notMeasured:
              `${setName} grants delete on ${n.object}; the platform's owner-only delete floor stands on ` +
              floor.open.map((r) => `operation ${r.operation} (${r.row}), where ${r.why}`).join('; '),
          };
        }
      }
      return check(
        name,
        granted,
        granted
          ? `${setName} grants it${beside}`
          : `${setName} grants no ${n.verb} on ${n.object}, which ${n.requiredBy.join(', ')} needs${beside}`,
      );
    }

    if (!granted) return check(name, true, `${setName} grants no ${n.verb} on ${n.object}`);
    const verb = n.verb as Exclude<PersonaGrantVerb, 'read'>;
    const routes = n.refusedBy.map((r) => ({ operation: r.operation, ...writeRefusalRoute(set, n.object, verb, r.fields) }));
    const open = routes.filter((r) => r.route === 'none');
    if (open.length > 0) {
      return check(
        name,
        false,
        `${setName} grants ${n.verb} on ${n.object}, locks no field ${open.map((r) => r.operation).join(', ')} names, and no row rule applies: nothing in the set refuses it`,
      );
    }
    const byRow = routes.filter((r) => r.route === 'row-rule');
    const locks = routes.filter((r) => r.route === 'field-lock').map((r) => `${r.operation} by ${r.names.join(', ')}`);
    if (byRow.length > 0) {
      return {
        check: name,
        pass: false,
        notMeasured:
          `${setName} grants ${n.verb} on ${n.object}; only ${byRow.map((r) => r.names.join(', ')).join('; ')} could refuse ` +
          `${byRow.map((r) => r.operation).join(', ')}, and whether it refuses the row depends on the row, which the artifact does not carry`,
      };
    }
    return check(name, true, `${setName} grants ${n.verb} on ${n.object} and locks the fields: ${locks.join('; ')}`);
  });
}

// ── One card against one artifact ───────────────────────────────────────────

export interface ScenarioArtifactScore {
  /** The card's `expect`, by exact name ({@link scoreGraph}). */
  expect: ScoreResult;
  /** The same `expect` by shape ({@link scoreGraphShape}) — reported, not counted below. */
  shape: ScoreResult;
  tags: TagVerdict[];
  agentActions: CheckResult[];
  /** One check per persona × object × verb the card implies ({@link gradePersonaGrants}); a not-measured one is listed and counted in neither figure. */
  personaGrants: CheckResult[];
  /** One failing check per bare view, doc, capability or position name ({@link gradeItemNames}); empty when no namespace was given. */
  naming: CheckResult[];
  /** Checks passed across `expect`, the scored tags, the agent actions, the persona grants and the naming rule. */
  passed: number;
  /** The same checks, less the not-measured ones. */
  total: number;
  /** passed / total; `null` when nothing was scored — never a vacuous 1. */
  score: number | null;
  /** The tags no check judged, each with its reason. */
  unscored: Array<{ tag: string; reason: string }>;
}

/**
 * Score one built artifact against one card: shape, capability tags, agent
 * actions and persona grants, plus — given the app's `namespace` — every bare
 * non-object item name.
 */
export function scoreScenarioArtifact(artifact: unknown, card: ScenarioArtifactCard, opts: { namespace?: string } = {}): ScenarioArtifactScore {
  const facts = readArtifactFacts(artifact);
  const ctx: TagCheckContext = opts.namespace === undefined ? {} : { namespace: opts.namespace };
  const expect = scoreGraph(facts.graph, card.expect);
  const shape = scoreGraphShape(facts.graph, deriveShape(card.expect));
  const tags = gradeCapabilityTags(facts, card, ctx);
  const agentActions = gradeAgentActions(facts, card.run.agentActions ?? []);
  const personaGrants = gradePersonaGrants(facts, card, ctx);
  const naming = opts.namespace === undefined ? [] : gradeItemNames(artifact, opts.namespace);
  const measured = [...expect.checks, ...tags.flatMap((t) => t.checks), ...agentActions, ...personaGrants, ...naming].filter(
    (c) => c.notMeasured === undefined,
  );
  const passed = measured.filter((c) => c.pass).length;
  return {
    expect,
    shape,
    tags,
    agentActions,
    personaGrants,
    naming,
    passed,
    total: measured.length,
    score: measured.length === 0 ? null : passed / measured.length,
    unscored: tags.filter((t) => t.status === 'unscored').map((t) => ({ tag: t.tag, reason: t.reason! })),
  };
}
