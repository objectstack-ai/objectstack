// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail for `{record.<path>}` template references in a
// record-change flow's node config (#3426).
//
// A `notify` / `update_record` / `http` / ... node interpolates
// `{record.<field>}` tokens against the triggering record. Two authoring
// mistakes render a SILENT empty string at runtime, with no design-time
// signal — exactly the failure #3426 reported:
//
//   1. `{record.<unknown>}` — the path head is neither a declared field nor a
//      system column. Almost always a typo (`{record.full_naem}`). The template
//      engine resolves it to `undefined` -> '' with no warning.
//
//   2. `{record.<lookup>.<subfield>}` — a cross-object hop through a lookup /
//      master_detail / user / tree relation. The seeded flow record carries the
//      relation as a SCALAR foreign-key id, not an expanded object (a default
//      data-API read does not expand relations either — see #3426's hydration
//      note and #1872). So `record.account.name` walks `.name` on a string id
//      and yields '' silently. Not resolved today; tracked on #3426.
//
//   3. `{record.<injected anchor>}` on an ADR-0015 `external` trigger object
//      (#8340) — the head RESOLVES (it is a registry-injected system column, so
//      case 1 rightly stays silent), but the remote database owns the table and
//      the platform provisions no storage behind the anchor. The value is empty
//      on every run, so the token renders '' with the same silence — reaching
//      case 1's failure by a route case 1 structurally cannot see, because it
//      judges the name against the object-independent `SYSTEM_FIELDS` union.
//      Reported as a WARNING in both positions, filter included: the existence
//      question has a closed oracle (the field is absent or it is not) and the
//      provenance one does not — this pass knows the platform stores nothing,
//      not what the deployment's remote schema holds (#8116's reasoning).
//
// A pure `(stack) => Finding[]` rule (ADR-0019), run from `os validate` and
// reusable by AI authoring.
//
// SEVERITY FOLLOWS THE RUNTIME CONSEQUENCE, which differs by POSITION:
//
//   - Everywhere else (a message body, an http url, a write payload) an
//     unresolved token renders a blank. The output is wrong but the run
//     completes, and the head object may legitimately come from another
//     installed package (skipped — see below). Advisory: WARNING.
//
//   - Inside a filter-guarded CRUD node's `filter`, an unresolved token used to
//     DELETE the condition from the query, and a removed condition matches MORE
//     rows — `delete_record` with its only condition gone matched every row.
//     Since framework#3810 those nodes REFUSE TO EXECUTE. So a finding here is
//     not "the output will be blank", it is "this node cannot run": the build
//     is shipping a flow whose runtime is already decided. Gating: ERROR.
//
// The split is the same shift-left `validateReadonlyFlowWrites` makes — a
// certain runtime failure gates the build, a state-dependent one advises — and
// it keeps this rule honest about what it found. Catching the typo at build
// time beats a failed run at 3am; catching it and calling it advisory, when the
// runtime has already committed to refusing, understates it.
//
// Deliberately conservative to keep false positives near zero:
//   - A token is checked only when its ROOT resolves to an object THIS stack
//     defines. Two kinds of root resolve (#17305): `record`, the triggering
//     record of a record-triggered flow, and a flow VARIABLE that a node in
//     this flow binds to a record by a STATIC declaration carried beside the
//     name (the variable-root section below). Every other `{var}` token
//     addresses something this pass cannot resolve, and stays unjudged.
//   - A root whose object is unknown here (another package, `sys_*`) has no
//     schema to compare against, so that root is skipped; a flow with no
//     resolvable root at all is skipped whole.
//   - `formula` / `summary` fields are VALID heads (formula is hydrated onto the
//     record since #3445; summary is stored on write) — never flagged.
//   - A trailing NUMERIC segment (`{record.target_channels.0}`) is an array
//     index into a `multiple` lookup (#1872), not a cross-object hop — allowed.
//   - Structured scalar heads (`json` / `composite` / `repeater` / `record`) may
//     carry legitimate sub-paths — their `.<sub>` access is left alone.
//
// VARIABLE ROOTS (#17305) — the same failure, one spelling further out.
//
// `{record.…}` used to be the only root this rule could resolve, which left
// cases 1 and 2 above invisible whenever the author reached the record through
// a flow variable instead. They are not unresolvable: a `get_record` node
// declares `objectName` AND `outputVariable` in ONE config, so the name it
// binds holds a record of a known object — a static binding, not an inference.
// A `loop` declares `collection` and `iteratorVariable`, so when the collection
// is one of those multi-record outputs each element is a record of that same
// object. `{caseRecord.owner_id.manager}` and `{currentCase.owner_id.manager}`
// are then case 2 exactly, reached by a root the rule used to ignore.
//
// Two gates move, both deliberately:
//
//   - The record-trigger gate now applies to the `record` root ALONE. It is
//     right there (no trigger, no triggering record) and meaningless for a name
//     a node inside the flow binds: a `schedule` flow's `get_record` output is
//     as statically typed as a record-change flow's. So a non-record-triggered
//     flow is no longer skipped whole — its `record.` tokens stay unjudged and
//     its variable roots are checked.
//   - A variable root resolves only when NOTHING ELSE in the flow can bind that
//     name. `seedRunVariables` keeps one flat map per run, so a declared flow
//     variable, an assignment target, another node's `outputVariable`, an
//     `indexVariable` / `errorVariable`, a node id (a bare CEL root in its own
//     right) or a trigger field flattened to top level all make the name
//     ambiguous — and ambiguous means SILENT, which is the conservatism this
//     rule already had rather than a new one.
//
// Deliberately NOT resolved, each silent rather than guessed: an
// `outputVariable` on any node type other than `get_record` (the value's shape
// is that executor's, not a declared object); a `loop` whose `collection` is
// not a bare variable name holding a multi-record `get_record` output; and
// case 3 above, which stays a TRIGGER-root question — `config.expand` and the
// registry-injected columns are both read off the START node and neither has a
// counterpart on a variable root.

import {
  SYSTEM_FIELDS,
  unprovisionedInjectedColumnsFor,
  unprovisionedAnchorCause,
  unprovisionedAnchorHint,
} from './system-fields.js';
import { walkFlowNodes, type WalkedFlowNode } from './flow-walk.js';
import { recordsOf } from './object-graph.js';

export type FlowTemplatePathSeverity = 'error' | 'warning';

export interface FlowTemplatePathFinding {
  severity: FlowTemplatePathSeverity;
  rule: string;
  /** Human-readable location, e.g. `flow "notify_lead" node "notify"`. */
  where: string;
  /** Config path, e.g. `flows[0].nodes[2]`. */
  path: string;
  message: string;
  hint: string;
}

// Rule ids (registry entries).
export const FLOW_TEMPLATE_UNKNOWN_FIELD = 'flow-template-unknown-field';
export const FLOW_TEMPLATE_LOOKUP_TRAVERSAL = 'flow-template-lookup-traversal';
export const FLOW_TEMPLATE_FIELD_UNPROVISIONED = 'flow-template-field-unprovisioned';

type AnyRec = Record<string, unknown>;

// Path heads addressable in a `{record.<col>}` template without being authored
// fields: the package-shared registry-injected columns (`system-fields.ts`,
// #4330) plus three heads this rule has always exempted. `name`, `owner` and
// `record_type` are NOT registry-injected system columns (`name` in particular
// is an ordinary authored field on most objects), so they stay rule-local —
// see the shared module's note — instead of widening every field-existence
// rule in the package.
const IMPLICIT_HEADS: ReadonlySet<string> = new Set([
  ...SYSTEM_FIELDS,
  'name', 'owner', 'record_type',
]);

// Field types that address ANOTHER object — a `.<subfield>` hop through one is
// a cross-object traversal the seeded flow record does not expand.
const RELATION_TYPES: ReadonlySet<string> = new Set([
  'lookup',
  'master_detail',
  'user',
  'tree',
]);

// The CRUD nodes whose `filter` the runtime guards (framework#3810): each calls
// `resolveNodeFilter`, which refuses the node when interpolation erased any
// authored condition. `create_record` is deliberately absent — it writes a
// payload and has no filter, so an unresolved token there is a blank value on
// the new row, not a widened query.
const FILTER_GUARDED_NODE_TYPES: ReadonlySet<string> = new Set([
  'get_record',
  'update_record',
  'delete_record',
]);

/** Build a `fieldName -> type` map for an object (declared fields only). */
function fieldTypesOf(obj: AnyRec): Map<string, string> {
  const types = new Map<string, string>();
  for (const f of recordsOf(obj.fields)) {
    if (typeof f.name === 'string') {
      types.set(f.name, typeof f.type === 'string' ? f.type : '');
    }
  }
  return types;
}

/** One dotted `{root.seg…}` reference found in a template string. */
interface TemplateRef {
  /** The token's first segment — the name the run resolves in its variable map. */
  root: string;
  /** The segments AFTER the root, e.g. `{record.account.name}` -> `['account', 'name']`. */
  rest: string[];
}

/**
 * Extract the dotted `{root.<path>}` references from a template string. Mirrors
 * the runtime interpolator's token grammar (service-automation
 * builtin/template.ts): a `{...}` token whose body is a plain dotted path.
 * Arithmetic / function tokens (`{NOW()}`, `{a + b}`) are ignored, and so is a
 * single-segment token — there is no `.<field>` hop in it to judge.
 *
 * The ROOT is returned rather than filtered here (#17305): which roots are
 * resolvable is the caller's per-flow question, and it is no longer the single
 * literal `record`.
 */
function templateRefsIn(text: string): TemplateRef[] {
  const refs: TemplateRef[] = [];
  const tokenRe = /\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(text)) !== null) {
    const body = m[1].trim();
    // Pure dotted path only (same shape the interpolator's fast path accepts):
    // identifier head, then identifier-or-numeric segments. Anything with
    // operators / spaces / quotes is an arithmetic token — not a bare field ref.
    if (!/^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/.test(body)) continue;
    const segments = body.split('.');
    const rest = segments.slice(1);
    if (rest.length > 0) refs.push({ root: segments[0], rest });
  }
  return refs;
}

/** Recursively collect templated string leaves from a config-bearing block. */
function stringLeaves(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (value.includes('{')) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) stringLeaves(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as AnyRec)) stringLeaves(v, out);
  }
}

// The typed config blocks + freeform `config` a node interpolates at runtime.
// We scan every string leaf under these (the runtime `interpolate()` walks the
// whole config recursively), NOT `id` / `type` / `label` / `position`, which are
// never templated.
const NODE_CONFIG_KEYS = [
  'config',
  'notify',
  'update_record',
  'create_record',
  'http',
  'script',
  'screen',
  'wait',
  'approval',
  'connector_action',
  'subflow',
  'decision',
  'start',
];

/** A templated string leaf plus the one thing severity depends on: where it sits. */
interface TemplateLeaf {
  text: string;
  /** Inside a filter-guarded CRUD node's `filter` — an unresolved token there is refused at runtime. */
  inFilter: boolean;
}

/**
 * Collect a node's templated string leaves, tagging those that sit under a
 * `filter` key when the node type is one the runtime guards.
 *
 * `guarded` leaves are returned FIRST so the per-node dedupe below resolves a
 * reference that appears in both positions at its higher severity: one typo
 * used in a filter and echoed in a message is an error, not a warning.
 */
function collectNodeLeaves(node: AnyRec, guarded: boolean): TemplateLeaf[] {
  const filterLeaves: TemplateLeaf[] = [];
  const otherLeaves: TemplateLeaf[] = [];

  for (const key of NODE_CONFIG_KEYS) {
    if (!(key in node)) continue;
    const block = node[key];
    const splitFilter = guarded && !!block && typeof block === 'object' && !Array.isArray(block);

    if (splitFilter) {
      const { filter, ...rest } = block as AnyRec;
      const inFilter: string[] = [];
      stringLeaves(filter, inFilter);
      for (const text of inFilter) filterLeaves.push({ text, inFilter: true });
      const outside: string[] = [];
      stringLeaves(rest, outside);
      for (const text of outside) otherLeaves.push({ text, inFilter: false });
      continue;
    }

    const plain: string[] = [];
    stringLeaves(block, plain);
    for (const text of plain) otherLeaves.push({ text, inFilter: false });
  }

  return [...filterLeaves, ...otherLeaves];
}

/** True when the flow is armed by a record lifecycle event. */
function isRecordTriggered(flow: AnyRec, startConfig: AnyRec): boolean {
  if (flow.type === 'record_change') return true;
  const triggerType = typeof startConfig.triggerType === 'string' ? startConfig.triggerType : undefined;
  return !!triggerType && triggerType.startsWith('record-');
}

/** Resolve the object a record-change flow binds to, from its start node. */
function boundObjectOf(flow: AnyRec): string | undefined {
  // `recordsOf`, not `Array.isArray` + cast (#16751). This site and the two
  // below never threw — but only because each `.find` predicate happens to be
  // spelled `n?.type`, one character away from the reader that did throw in
  // `lint-flow-patterns.ts`. Nothing maintained that difference, and the `?.`
  // reads as redundant beside an `Array.isArray`, so the coercion is made where
  // it has a home and the optional chain goes with it.
  const nodes = recordsOf(flow.nodes);
  const start = nodes.find((n) => n.type === 'start');
  if (!start) return undefined;
  const config = (start.config ?? {}) as AnyRec;
  const typed = (start.start ?? {}) as AnyRec;
  const fromConfig = typeof config.objectName === 'string' ? config.objectName : undefined;
  const fromTyped = typeof typed.objectName === 'string' ? typed.objectName : undefined;
  return fromConfig ?? fromTyped;
}

/**
 * The lookup relations a record-change flow opted IN to expand, from the start
 * node's `config.expand` (#3475). A `{record.<rel>.<field>}` hop through one of
 * these IS resolved at run time — the engine re-reads it as the run's identity —
 * so the traversal warning is suppressed for those relations. Accepts a `string`
 * or `string[]`; anything else yields the empty set.
 */
function declaredExpandOf(flow: AnyRec): Set<string> {
  const nodes = recordsOf(flow.nodes);
  const start = nodes.find((n) => n.type === 'start');
  const raw = ((start?.config ?? {}) as AnyRec).expand;
  if (typeof raw === 'string') return new Set(raw ? [raw] : []);
  if (Array.isArray(raw)) return new Set(raw.filter((r): r is string => typeof r === 'string' && r.length > 0));
  return new Set();
}

/** Shared empty set — a root with no `expand` opt-ins and no injected anchors. */
const NO_NAMES: ReadonlySet<string> = new Set<string>();

/** Roots the run owns outright, so no node declaration may claim the name. */
const RESERVED_ROOTS: ReadonlySet<string> = new Set(['record', 'previous']);

/** A bare variable name — the only `loop.collection` spelling resolved here. */
const BARE_NAME_RE = /^[A-Za-z_$][\w$]*$/;

/** Everything the token checks need about ONE resolvable template root. */
interface TemplateRoot {
  /** The object whose fields this root's `.<field>` segments address. */
  objectName: string;
  /** `fieldName -> type` for that object. */
  fieldTypes: Map<string, string>;
  /** True for the `record` root — the two start-node-scoped checks below are its alone. */
  isTrigger: boolean;
  /** [#8340] Injected-but-unprovisioned anchors. Empty on a variable root. */
  unprovisionedAnchors: ReadonlySet<string>;
  /** [#3475] Relations the start node opted in to expanding. Empty on a variable root. */
  expand: ReadonlySet<string>;
}

/**
 * The body of a string that is EXACTLY one `{…}` token, or the string itself
 * when it carries no braces — the two spellings `loop-node.ts` accepts for
 * `config.collection` (it interpolates the template, then falls back to a bare
 * variable lookup).
 */
function loneTokenBody(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const braced = /^\{([^{}]+)\}$/.exec(trimmed);
  return (braced ? braced[1] : trimmed).trim();
}

/**
 * The flow variables that hold ONE record of a known object, as `name ->
 * objectName` (#17305).
 *
 * Two declarations bind one, and both carry the object statically:
 *
 *   - `get_record` — `config.objectName` + `config.outputVariable`. `limit > 1`
 *     switches the executor to a multi-record read, so that variable holds an
 *     ARRAY and is recorded as a list rather than a record root.
 *   - `loop` — `config.collection` + `config.iteratorVariable`. When the
 *     collection names one of those lists, each element is a record of its
 *     object.
 *
 * A SECOND binder POISONS the name instead. `seedRunVariables` keeps ONE flat
 * map per run, so two writers make the root ambiguous and an ambiguous root
 * must stay silent — the same conservatism the `record` root has always had,
 * not a new one. Poisoned: assignment targets, `indexVariable` /
 * `errorVariable`, an `outputVariable` on any other node type, an unresolvable
 * `iteratorVariable`, every node id (the engine writes each node's outputs
 * under `<nodeId>.<key>` and `evaluateCondition` expands that dotted key into
 * an object AT the node id), and any name a trigger field is flattened to.
 *
 * ⛔ A `flow.variables` DECLARATION is deliberately NOT a second binder. It
 * declares the slot the node then fills — `seedDeclaredVariables` runs first
 * and the node's write replaces what it seeded — and it is the shape the
 * platform's own canon teaches: `examples/app-todo`'s two sweep flows declare
 * `tasksToRemind` / `overdueTasks` beside the `get_record` that fills them.
 * Treating the declaration as a collision would make this whole resolution
 * inert on exactly the flows it was written for.
 */
function resolveVariableRoots(
  walked: readonly WalkedFlowNode[],
  triggerScope: ReadonlySet<string>,
): Map<string, string> {
  const single = new Map<string, string>();
  const lists = new Map<string, string>();
  const poisoned = new Set<string>();

  const poison = (name: unknown): void => {
    if (typeof name !== 'string' || !name) return;
    poisoned.add(name);
    single.delete(name);
    lists.delete(name);
  };
  const bind = (into: Map<string, string>, name: string, objectName: string): void => {
    if (poisoned.has(name)) return;
    const other = into === single ? lists : single;
    const prior = into.get(name);
    if (other.has(name) || (prior !== undefined && prior !== objectName)) {
      poison(name);
      return;
    }
    into.set(name, objectName);
  };

  const loops: Array<{ collection: unknown; iterator: string }> = [];

  for (const { node } of walked) {
    poison(node.id);
    const rawConfig = node.config;
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue;
    const config = rawConfig as AnyRec;
    const nodeType = typeof node.type === 'string' ? node.type : '';

    poison(config.indexVariable);
    poison(config.errorVariable);

    if (nodeType === 'assignment') {
      // Every shape `logic-nodes.ts` dispatches on, read as a POISON list
      // rather than as the executor's precedence order: over-poisoning only
      // costs silence, and silence is this rule's safe direction.
      const raw = config.assignments;
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (!item || typeof item !== 'object') continue;
          const entry = item as AnyRec;
          poison(entry.variable);
          poison(entry.name);
          poison(entry.key);
        }
      } else if (raw && typeof raw === 'object') {
        for (const key of Object.keys(raw as AnyRec)) poison(key);
      } else {
        for (const key of Object.keys(config)) poison(key);
      }
    }

    const output = config.outputVariable;
    if (typeof output === 'string' && output) {
      const objectName = typeof config.objectName === 'string' ? config.objectName : '';
      if (nodeType !== 'get_record' || !objectName) {
        poison(output);
      } else if (typeof config.limit === 'number' && config.limit > 1) {
        bind(lists, output, objectName);
      } else {
        bind(single, output, objectName);
      }
    }

    const iterator = config.iteratorVariable;
    if (typeof iterator === 'string' && iterator) {
      // Deferred: a loop may iterate a list bound by a LATER node in the walk,
      // and the run's variable map is flow-scoped, not traversal-ordered.
      if (nodeType === 'loop') loops.push({ collection: config.collection, iterator });
      else poison(iterator);
    }
  }

  for (const { collection, iterator } of loops) {
    const body = loneTokenBody(collection);
    const source = body && BARE_NAME_RE.test(body) ? lists.get(body) : undefined;
    if (source) bind(single, iterator, source);
    else poison(iterator);
  }

  const roots = new Map<string, string>();
  for (const [name, objectName] of single) {
    if (poisoned.has(name)) continue;
    if (RESERVED_ROOTS.has(name) || name.startsWith('$')) continue;
    // A trigger field flattened to top level answers to this name too, and the
    // winner depends on whether the binding node has run yet.
    if (triggerScope.has(name)) continue;
    roots.set(name, objectName);
  }
  return roots;
}

/**
 * Validate the dotted `{root.<path>}` template references of every flow whose
 * root this pass can resolve — the trigger record of a record-triggered flow,
 * and the flow variables {@link resolveVariableRoots} binds to an object.
 * Pure and dependency-free; safe on pre- or post-parse stacks.
 */
export function validateFlowTemplatePaths(stack: AnyRec): FlowTemplatePathFinding[] {
  const findings: FlowTemplatePathFinding[] = [];
  const flows = recordsOf(stack.flows);
  if (flows.length === 0) return findings;

  const objectsByName = new Map<string, AnyRec>();
  for (const obj of recordsOf(stack.objects)) {
    if (typeof obj.name === 'string') objectsByName.set(obj.name, obj);
  }

  // One field map per object, not per root: a flow may resolve several roots
  // onto the same object (a trigger record plus a `get_record` re-read of it).
  const fieldTypeCache = new Map<string, Map<string, string>>();
  const fieldTypesFor = (objectName: string, obj: AnyRec): Map<string, string> => {
    let types = fieldTypeCache.get(objectName);
    if (!types) {
      types = fieldTypesOf(obj);
      fieldTypeCache.set(objectName, types);
    }
    return types;
  };

  flows.forEach((flow, flowIndex) => {
    const flowName = typeof flow.name === 'string' ? flow.name : `#${flowIndex}`;
    const nodes = recordsOf(flow.nodes);
    const start = (nodes.find((n) => n.type === 'start')?.config ?? {}) as AnyRec;

    const roots = new Map<string, TemplateRoot>();

    // ── Root 1: `record` — the TRIGGERING record. The trigger gate is this
    // root's alone (#17305): without a record trigger there is no such record.
    // Unknown object here -> no schema to compare against (another package /
    // `sys_*`). The trigger-readiness rule already flags a wrong name; we can't
    // meaningfully classify field paths, so this root does not resolve.
    if (isRecordTriggered(flow, start)) {
      const objectName = boundObjectOf(flow);
      const obj = objectName ? objectsByName.get(objectName) : undefined;
      if (objectName && obj) {
        roots.set('record', {
          objectName,
          fieldTypes: fieldTypesFor(objectName, obj),
          isTrigger: true,
          // [#8340] The injected anchors THIS trigger object registers with no
          // storage behind them. Read off the object def already resolved above.
          unprovisionedAnchors: unprovisionedInjectedColumnsFor(obj),
          expand: declaredExpandOf(flow),
        });
      }
    }

    // Every node, INCLUDING those nested in try_catch / loop / parallel regions
    // (#4380). This rule was not merely blind to them — it was WORSE than
    // blind: the recursive string-leaf scan already saw a nested node's tokens
    // through its container's `config`, but `collectNodeLeaves` splits `filter`
    // only at the top level of the node it is handed, so a nested filter token
    // lost its position and the gating #3810 finding silently degraded to a
    // warning reported against the wrapping `try_catch`. Walking to the real
    // node restores both the severity and the location.
    const walked = walkFlowNodes(flow, `flows[${flowIndex}]`);

    // ── Roots 2..n: flow variables a node binds to a record (#17305). The
    // trigger's own scope is handed in because those names are flattened to
    // top level on a record-triggered run and a root that collides with one is
    // ambiguous.
    const triggerRoot = roots.get('record');
    const triggerScope: ReadonlySet<string> = triggerRoot
      ? new Set<string>([...triggerRoot.fieldTypes.keys(), ...IMPLICIT_HEADS])
      : NO_NAMES;
    for (const [name, objectName] of resolveVariableRoots(walked, triggerScope)) {
      const obj = objectsByName.get(objectName);
      if (!obj) continue;
      roots.set(name, {
        objectName,
        fieldTypes: fieldTypesFor(objectName, obj),
        isTrigger: false,
        unprovisionedAnchors: NO_NAMES,
        expand: NO_NAMES,
      });
    }

    if (roots.size === 0) return;

    walked.forEach(({ node, path: nodePath, regionTrail, localConfig }, walkIndex) => {
      const nodeLabel =
        typeof node.type === 'string' ? node.type : typeof node.id === 'string' ? node.id : `#${walkIndex}`;
      const where = regionTrail
        ? `flow "${flowName}" ${regionTrail} node "${nodeLabel}"`
        : `flow "${flowName}" node "${nodeLabel}"`;

      // Collect templated string leaves from the config-bearing blocks only,
      // tagging filter positions when this node type guards its filter (#3810).
      const nodeType = typeof node.type === 'string' ? node.type : '';
      const guarded = FILTER_GUARDED_NODE_TYPES.has(nodeType);
      // Scan the container's config WITHOUT its region slots: their nodes are
      // walked in their own right, and leaving them in would report every
      // nested finding a second time against the container.
      const scanNode =
        localConfig !== undefined && localConfig !== node.config
          ? ({ ...node, config: localConfig } as AnyRec)
          : (node as AnyRec);
      const leaves = collectNodeLeaves(scanNode, guarded);
      if (leaves.length === 0) return;

      // Dedupe references so one repeated typo yields one finding per node.
      // Keyed by the whole token, root included: two roots may legitimately
      // carry the same head, and they are two findings.
      const seenUnknown = new Set<string>();
      const seenTraversal = new Set<string>();
      const seenUnprovisioned = new Set<string>();

      for (const leaf of leaves) {
        const inFilter = leaf.inFilter;
        for (const { root: rootName, rest } of templateRefsIn(leaf.text)) {
          const root = roots.get(rootName);
          // An unresolvable root — a flow variable nothing binds statically, an
          // ambiguous one, `{record.…}` on a flow with no record trigger.
          if (!root) continue;
          const objectName = root.objectName;
          const token = `${rootName}.${rest.join('.')}`;
          const head = rest[0];
          const hasSubPath = rest.length > 1;
          // A trailing numeric segment is an array index (#1872), not a hop.
          const nextIsIdentifier = hasSubPath && !/^\d+$/.test(rest[1]);

          const isKnown = root.fieldTypes.has(head) || IMPLICIT_HEADS.has(head);

          // [#8340] The head RESOLVES — `IMPLICIT_HEADS` keeps owning that
          // decision, exactly as before — but on an ADR-0015 `external` trigger
          // object the platform registers this anchor and stores nothing in it,
          // so the interpolator reads an empty value from the flow record. In a
          // filter position that is #3810's own failure reached by a second
          // route: the token erases the authored condition and `resolveNodeFilter`
          // refuses the node at run time. Warning, not error, on both positions:
          // unlike a typo (a closed oracle — the field is simply absent) this
          // pass cannot see whether the remote schema resolves the column.
          if (root.unprovisionedAnchors.has(head)) {
            if (!seenUnprovisioned.has(head)) {
              seenUnprovisioned.add(head);
              findings.push({
                severity: 'warning',
                rule: FLOW_TEMPLATE_FIELD_UNPROVISIONED,
                where,
                path: nodePath,
                message:
                  (inFilter ? `${nodeType} filter references ` : 'template references ') +
                  `'{${token}}', and ${unprovisionedAnchorCause(objectName, head)} — ` +
                  (inFilter
                    ? `the token resolves to nothing on every run, which DROPS the condition from ` +
                      `the query instead of narrowing it; the node then refuses to run at execution ` +
                      `time (#3810).`
                    : `the token resolves to an empty string on every run (silently).`),
                hint: unprovisionedAnchorHint(objectName, head),
              });
            }
          }

          if (!isKnown) {
            if (seenUnknown.has(token)) continue;
            seenUnknown.add(token);
            findings.push({
              severity: inFilter ? 'error' : 'warning',
              rule: FLOW_TEMPLATE_UNKNOWN_FIELD,
              where,
              path: nodePath,
              message: inFilter
                ? `${nodeType} filter references '{${token}}', but '${head}' is not a field on ` +
                  `object '${objectName}' — the token resolves to nothing, which DROPS the condition from the ` +
                  `query instead of narrowing it. The node refuses to run at execution time (#3810).`
                : `template references '{${token}}', but '${head}' is not a field on ` +
                  `object '${objectName}' — it resolves to an empty string at runtime (silently).`,
              hint: root.isTrigger
                ? inFilter
                  ? `Check the field name against the object's field definitions (e.g. '{record.full_name}', ` +
                    `not '{record.full_naem}'); system columns like id/created_at/owner are also addressable. ` +
                    `This gates the build rather than warning: an absent condition WIDENS the query, so the ` +
                    `runtime has already decided to refuse this node.`
                  : `Check the field name against the object's field definitions (e.g. '{record.full_name}', ` +
                    `not '{record.full_naem}'). System columns like id/created_at/owner are also addressable.`
                : inFilter
                  ? `Check the field name against object '${objectName}'s field definitions — '${rootName}' is ` +
                    `bound to a '${objectName}' record by this flow; system columns like id/created_at/owner ` +
                    `are also addressable. This gates the build rather than warning: an absent condition ` +
                    `WIDENS the query, so the runtime has already decided to refuse this node.`
                  : `Check the field name against object '${objectName}'s field definitions — '${rootName}' is ` +
                    `bound to a '${objectName}' record by this flow. System columns like id/created_at/owner ` +
                    `are also addressable.`,
            });
            continue;
          }

          if (nextIsIdentifier) {
            const headType = root.fieldTypes.get(head) ?? '';
            if (RELATION_TYPES.has(headType) && !root.expand.has(head)) {
              if (seenTraversal.has(token)) continue;
              seenTraversal.add(token);
              findings.push({
                severity: inFilter ? 'error' : 'warning',
                rule: FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
                where,
                path: nodePath,
                message: inFilter
                  ? `${nodeType} filter references '{${token}}', a cross-object hop through the ` +
                    `${headType} field '${head}' — the ${root.isTrigger ? 'flow record' : `'${rootName}' record`} ` +
                    `carries '${head}' as a scalar id, not an ` +
                    `expanded object, so the token resolves to nothing and the condition is DROPPED from the ` +
                    `query instead of narrowing it. The node refuses to run at execution time (#3810).`
                  : `template references '{${token}}', a cross-object hop through the ${headType} field ` +
                    `'${head}' — the ${root.isTrigger ? 'flow record' : `'${rootName}' record`} carries ` +
                    `'${head}' as a scalar id, not an expanded object, so ` +
                    `this resolves to an empty string at runtime (silently).`,
                hint: root.isTrigger
                  ? inFilter
                    ? `Opt in to resolve it: add '${head}' to the start node's config.expand (#3475) and the ` +
                      `engine re-reads it as the run's identity. Otherwise filter on the foreign-key id directly ` +
                      `('{record.${head}}'), or project the value via a formula field on '${objectName}'. This ` +
                      `gates the build rather than warning: an absent condition WIDENS the query.`
                    : `Opt in to resolve it: add '${head}' to the start node's config.expand (#3475) and the ` +
                      `engine re-reads it as the run's identity. Otherwise reference the foreign-key id directly ` +
                      `('{record.${head}}'), or project the value via a formula field on '${objectName}'.`
                  : inFilter
                    ? `A record read into a flow variable is not expanded either — config.expand is the ` +
                      `START node's opt-in and covers the trigger record alone. Filter on the foreign-key id ` +
                      `directly ('{${rootName}.${head}}'), project the value via a formula field on ` +
                      `'${objectName}', or add a get_record node that reads the related record. This gates the ` +
                      `build rather than warning: an absent condition WIDENS the query.`
                    : `A record read into a flow variable is not expanded either — config.expand is the ` +
                      `START node's opt-in and covers the trigger record alone. Reference the foreign-key id ` +
                      `directly ('{${rootName}.${head}}'), project the value via a formula field on ` +
                      `'${objectName}', or add a get_record node that reads the related record.`,
              });
            }
            // STRUCTURED_TYPES + any other scalar `.sub` access is left alone:
            // json/composite/record sub-paths are legitimate in-row reads, and
            // a plain scalar `.sub` is rare enough that flagging it would risk
            // more false positives than it prevents.
          }
        }
      }
    });
  });

  return findings;
}
