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
//   - Only `record.`-prefixed tokens are checked. Other `{var}` tokens address
//     flow variables / node outputs the rule cannot resolve statically.
//   - Only flows bound to an object THIS stack defines are checked; when the
//     object is unknown here (another package, `sys_*`) the rule has no schema
//     to compare against and skips the whole flow.
//   - `formula` / `summary` fields are VALID heads (formula is hydrated onto the
//     record since #3445; summary is stored on write) — never flagged.
//   - A trailing NUMERIC segment (`{record.target_channels.0}`) is an array
//     index into a `multiple` lookup (#1872), not a cross-object hop — allowed.
//   - Structured scalar heads (`json` / `composite` / `repeater` / `record`) may
//     carry legitimate sub-paths — their `.<sub>` access is left alone.

import {
  SYSTEM_FIELDS,
  unprovisionedInjectedColumnsFor,
  unprovisionedAnchorCause,
  unprovisionedAnchorHint,
} from './system-fields.js';
import { walkFlowNodes } from './flow-walk.js';

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

/** Coerce an array-or-name-keyed-map collection to an array (name injected). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({
      name,
      ...(def as AnyRec),
    }));
  }
  return [];
}

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
  for (const f of asArray(obj.fields)) {
    if (typeof f.name === 'string') {
      types.set(f.name, typeof f.type === 'string' ? f.type : '');
    }
  }
  return types;
}

/**
 * Extract the `record.<path>` references from a template string. Mirrors the
 * runtime interpolator's token grammar (service-automation builtin/template.ts):
 * a `{...}` token whose body is a dotted path whose HEAD is `record`. Arithmetic
 * / function tokens (`{NOW()}`, `{a + b}`) and non-`record` heads are ignored.
 *
 * Returns each reference's segment list AFTER the `record` head, e.g.
 * `{record.account.name}` -> `[['account', 'name']]`.
 */
function recordRefsIn(text: string): string[][] {
  const refs: string[][] = [];
  const tokenRe = /\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(text)) !== null) {
    const body = m[1].trim();
    // Pure dotted path only (same shape the interpolator's fast path accepts):
    // identifier head, then identifier-or-numeric segments. Anything with
    // operators / spaces / quotes is an arithmetic token — not a bare field ref.
    if (!/^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/.test(body)) continue;
    const segments = body.split('.');
    if (segments[0] !== 'record') continue;
    const rest = segments.slice(1);
    if (rest.length > 0) refs.push(rest);
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
  const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];
  const start = nodes.find((n) => n?.type === 'start');
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
  const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];
  const start = nodes.find((n) => n?.type === 'start');
  const raw = ((start?.config ?? {}) as AnyRec).expand;
  if (typeof raw === 'string') return new Set(raw ? [raw] : []);
  if (Array.isArray(raw)) return new Set(raw.filter((r): r is string => typeof r === 'string' && r.length > 0));
  return new Set();
}

/**
 * Validate `{record.<path>}` template references across every record-change
 * flow. Pure and dependency-free; safe on pre- or post-parse stacks.
 */
export function validateFlowTemplatePaths(stack: AnyRec): FlowTemplatePathFinding[] {
  const findings: FlowTemplatePathFinding[] = [];
  const flows = asArray(stack.flows);
  if (flows.length === 0) return findings;

  const objectsByName = new Map<string, AnyRec>();
  for (const obj of asArray(stack.objects)) {
    if (typeof obj.name === 'string') objectsByName.set(obj.name, obj);
  }

  flows.forEach((flow, flowIndex) => {
    const flowName = typeof flow.name === 'string' ? flow.name : `#${flowIndex}`;
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];
    const start = (nodes.find((n) => n?.type === 'start')?.config ?? {}) as AnyRec;
    if (!isRecordTriggered(flow, start)) return;

    const objectName = boundObjectOf(flow);
    if (!objectName) return;
    const obj = objectsByName.get(objectName);
    // Unknown object here -> no schema to compare against (another package /
    // `sys_*`). The trigger-readiness rule already flags a wrong name; we can't
    // meaningfully classify field paths, so skip the whole flow.
    if (!obj) return;

    const fieldTypes = fieldTypesOf(obj);
    // [#8340] The injected anchors THIS trigger object registers with no
    // storage behind them. Read off the object def already resolved above —
    // there is no second lookup and no stack-level index, because this rule
    // judges every token of a flow against ONE object (the trigger's).
    const unprovisionedAnchors = unprovisionedInjectedColumnsFor(obj);
    const expandSet = declaredExpandOf(flow);

    // Every node, INCLUDING those nested in try_catch / loop / parallel regions
    // (#4380). This rule was not merely blind to them — it was WORSE than
    // blind: the recursive string-leaf scan already saw a nested node's tokens
    // through its container's `config`, but `collectNodeLeaves` splits `filter`
    // only at the top level of the node it is handed, so a nested filter token
    // lost its position and the gating #3810 finding silently degraded to a
    // warning reported against the wrapping `try_catch`. Walking to the real
    // node restores both the severity and the location.
    walkFlowNodes(flow, `flows[${flowIndex}]`).forEach(({ node, path: nodePath, regionTrail, localConfig }, walkIndex) => {
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
      const seenUnknown = new Set<string>();
      const seenTraversal = new Set<string>();
      const seenUnprovisioned = new Set<string>();

      for (const leaf of leaves) {
        const inFilter = leaf.inFilter;
        for (const rest of recordRefsIn(leaf.text)) {
          const head = rest[0];
          const hasSubPath = rest.length > 1;
          // A trailing numeric segment is an array index (#1872), not a hop.
          const nextIsIdentifier = hasSubPath && !/^\d+$/.test(rest[1]);

          const isKnown = fieldTypes.has(head) || IMPLICIT_HEADS.has(head);

          // [#8340] The head RESOLVES — `IMPLICIT_HEADS` keeps owning that
          // decision, exactly as before — but on an ADR-0015 `external` trigger
          // object the platform registers this anchor and stores nothing in it,
          // so the interpolator reads an empty value from the flow record. In a
          // filter position that is #3810's own failure reached by a second
          // route: the token erases the authored condition and `resolveNodeFilter`
          // refuses the node at run time. Warning, not error, on both positions:
          // unlike a typo (a closed oracle — the field is simply absent) this
          // pass cannot see whether the remote schema resolves the column.
          if (unprovisionedAnchors.has(head)) {
            if (!seenUnprovisioned.has(head)) {
              seenUnprovisioned.add(head);
              findings.push({
                severity: 'warning',
                rule: FLOW_TEMPLATE_FIELD_UNPROVISIONED,
                where,
                path: nodePath,
                message:
                  (inFilter ? `${nodeType} filter references ` : 'template references ') +
                  `'{record.${rest.join('.')}}', and ${unprovisionedAnchorCause(objectName, head)} — ` +
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
            if (seenUnknown.has(head)) continue;
            seenUnknown.add(head);
            findings.push({
              severity: inFilter ? 'error' : 'warning',
              rule: FLOW_TEMPLATE_UNKNOWN_FIELD,
              where,
              path: nodePath,
              message: inFilter
                ? `${nodeType} filter references '{record.${rest.join('.')}}', but '${head}' is not a field on ` +
                  `object '${objectName}' — the token resolves to nothing, which DROPS the condition from the ` +
                  `query instead of narrowing it. The node refuses to run at execution time (#3810).`
                : `template references '{record.${rest.join('.')}}', but '${head}' is not a field on ` +
                  `object '${objectName}' — it resolves to an empty string at runtime (silently).`,
              hint: inFilter
                ? `Check the field name against the object's field definitions (e.g. '{record.full_name}', ` +
                  `not '{record.full_naem}'); system columns like id/created_at/owner are also addressable. ` +
                  `This gates the build rather than warning: an absent condition WIDENS the query, so the ` +
                  `runtime has already decided to refuse this node.`
                : `Check the field name against the object's field definitions (e.g. '{record.full_name}', ` +
                  `not '{record.full_naem}'). System columns like id/created_at/owner are also addressable.`,
            });
            continue;
          }

          if (nextIsIdentifier) {
            const headType = fieldTypes.get(head) ?? '';
            if (RELATION_TYPES.has(headType) && !expandSet.has(head)) {
              const key = rest.join('.');
              if (seenTraversal.has(key)) continue;
              seenTraversal.add(key);
              findings.push({
                severity: inFilter ? 'error' : 'warning',
                rule: FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
                where,
                path: nodePath,
                message: inFilter
                  ? `${nodeType} filter references '{record.${key}}', a cross-object hop through the ` +
                    `${headType} field '${head}' — the flow record carries '${head}' as a scalar id, not an ` +
                    `expanded object, so the token resolves to nothing and the condition is DROPPED from the ` +
                    `query instead of narrowing it. The node refuses to run at execution time (#3810).`
                  : `template references '{record.${key}}', a cross-object hop through the ${headType} field ` +
                    `'${head}' — the flow record carries '${head}' as a scalar id, not an expanded object, so ` +
                    `this resolves to an empty string at runtime (silently).`,
                hint: inFilter
                  ? `Opt in to resolve it: add '${head}' to the start node's config.expand (#3475) and the ` +
                    `engine re-reads it as the run's identity. Otherwise filter on the foreign-key id directly ` +
                    `('{record.${head}}'), or project the value via a formula field on '${objectName}'. This ` +
                    `gates the build rather than warning: an absent condition WIDENS the query.`
                  : `Opt in to resolve it: add '${head}' to the start node's config.expand (#3475) and the ` +
                    `engine re-reads it as the run's identity. Otherwise reference the foreign-key id directly ` +
                    `('{record.${head}}'), or project the value via a formula field on '${objectName}'.`,
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
