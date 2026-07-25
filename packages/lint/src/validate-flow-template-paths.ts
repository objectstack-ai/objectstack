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
// A pure `(stack) => Finding[]` rule (ADR-0019), run from `os validate` and
// reusable by AI authoring. Both findings are warnings: the runtime still
// produces output (a blank), nothing is fully broken, and the head object may
// legitimately come from another installed package (skipped — see below).
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

// System/audit columns the platform injects on every object — always
// addressable in a `{record.<col>}` template even though they are not authored
// fields. Mirrors `validateFormLayout`'s system-field set plus the audit/tenant
// columns from `FIELD_GROUP_SYSTEM_FIELDS`.
const SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'name',
  'owner',
  'owner_id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'organization_id',
  'tenant_id',
  'is_deleted',
  'deleted_at',
  'record_type',
]);

// Field types that address ANOTHER object — a `.<subfield>` hop through one is
// a cross-object traversal the seeded flow record does not expand.
const RELATION_TYPES: ReadonlySet<string> = new Set([
  'lookup',
  'master_detail',
  'user',
  'tree',
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
    const expandSet = declaredExpandOf(flow);

    nodes.forEach((node, nodeIndex) => {
      if (typeof node !== 'object' || !node) return;
      const nodeLabel =
        typeof node.type === 'string' ? node.type : typeof node.id === 'string' ? node.id : `#${nodeIndex}`;

      // Collect templated string leaves from the config-bearing blocks only.
      const leaves: string[] = [];
      for (const key of NODE_CONFIG_KEYS) {
        if (key in node) stringLeaves((node as AnyRec)[key], leaves);
      }
      if (leaves.length === 0) return;

      // Dedupe references so one repeated typo yields one finding per node.
      const seenUnknown = new Set<string>();
      const seenTraversal = new Set<string>();

      for (const leaf of leaves) {
        for (const rest of recordRefsIn(leaf)) {
          const head = rest[0];
          const hasSubPath = rest.length > 1;
          // A trailing numeric segment is an array index (#1872), not a hop.
          const nextIsIdentifier = hasSubPath && !/^\d+$/.test(rest[1]);

          const isKnown = fieldTypes.has(head) || SYSTEM_FIELDS.has(head);

          if (!isKnown) {
            if (seenUnknown.has(head)) continue;
            seenUnknown.add(head);
            findings.push({
              severity: 'warning',
              rule: FLOW_TEMPLATE_UNKNOWN_FIELD,
              where: `flow "${flowName}" node "${nodeLabel}"`,
              path: `flows[${flowIndex}].nodes[${nodeIndex}]`,
              message:
                `template references '{record.${rest.join('.')}}', but '${head}' is not a field on ` +
                `object '${objectName}' — it resolves to an empty string at runtime (silently).`,
              hint:
                `Check the field name against the object's field definitions (e.g. '{record.full_name}', ` +
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
                severity: 'warning',
                rule: FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
                where: `flow "${flowName}" node "${nodeLabel}"`,
                path: `flows[${flowIndex}].nodes[${nodeIndex}]`,
                message:
                  `template references '{record.${key}}', a cross-object hop through the ${headType} field ` +
                  `'${head}' — the flow record carries '${head}' as a scalar id, not an expanded object, so ` +
                  `this resolves to an empty string at runtime (silently).`,
                hint:
                  `Opt in to resolve it: add '${head}' to the start node's config.expand (#3475) and the ` +
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
