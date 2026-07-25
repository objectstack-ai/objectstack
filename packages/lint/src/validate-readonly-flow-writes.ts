// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail: a flow `update_record` node that writes a field the
// target object declares `readonly: true`, under a non-system run identity, is
// a SILENT NO-OP. The objectql engine strips static-`readonly` fields from a
// non-system UPDATE payload (#2948), so the intended write never lands — yet
// the step still reports `success`. #3407/#3413 made that strip observable at
// RUN time (a step warning + `droppedFields`); this rule shifts the discovery
// LEFT to `os validate` / `os build`, so an author finds the mismatch at design
// time instead of by reading server WARN logs days later (#3425).
//
// Scope — deliberately narrow to keep it false-positive-free:
//
//   • Only `update_record`. INSERT is engine-exempt from the readonly strip (a
//     `create_record` may legitimately seed readonly columns; the ingress strip
//     added in #3043 lives in metadata-protocol, which the flow engine bypasses
//     by calling the data engine directly), so a create writing a readonly
//     field is NOT a no-op and is never flagged.
//
//   • Only `runAs !== 'system'`. A `runAs:'system'` run is elevated and the
//     engine skips the strip entirely, so a system flow legitimately MAINTAINS
//     readonly fields ("users can't edit this, but automation does"). That is
//     the intended channel, so it is never flagged.
//
//   • Static `readonly:true` + a LITERAL field name is a 100%-certain no-op →
//     ERROR (gates the build). `readonlyWhen` is per-record-state — it strips
//     only on records whose predicate is TRUE at run time, so it MAY silently
//     not land → WARNING (advisory). A templated object name or a non-literal
//     `fields` map is not statically knowable → skipped, no guess.
//
// A pure `(stack) => Finding[]` rule (ADR-0019): no I/O, no runtime. Shared by
// the CLI and any other consumer (AI authoring), so hand-authored and generated
// flows are held to the same bar.

export type ReadonlyFlowWriteSeverity = 'error' | 'warning';

export interface ReadonlyFlowWriteFinding {
  severity: ReadonlyFlowWriteSeverity;
  rule: string;
  /** Human-readable location, e.g. `flow "approve_deal" › node "Mark approved"`. */
  where: string;
  /** Config path, e.g. `flows[0].nodes[3].config.fields.approval_status`. */
  path: string;
  message: string;
  hint: string;
}

// Rule ids (registry entries).
export const FLOW_UPDATE_READONLY_FIELD = 'flow-update-readonly-field';
export const FLOW_UPDATE_READONLY_WHEN_FIELD = 'flow-update-readonly-when-field';

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

interface FieldReadonlyMeta {
  /** Static `readonly: true`. */
  readonly: boolean;
  /** A non-empty `readonlyWhen` predicate is declared. */
  readonlyWhen: boolean;
}

/**
 * object name → (field name → readonly metadata). Handles both `fields` shapes
 * (array of `{name, readonly, readonlyWhen}` and name-keyed map). A field with
 * neither flag is recorded as `{false, false}` so callers can distinguish a
 * "known-writable field" from an "unknown field" (absent from the map).
 */
function buildReadonlyIndex(objects: AnyRec[]): Map<string, Map<string, FieldReadonlyMeta>> {
  const idx = new Map<string, Map<string, FieldReadonlyMeta>>();
  for (const obj of objects) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const fieldMap = new Map<string, FieldReadonlyMeta>();
    const collect = (fieldName: string, def: AnyRec): void => {
      const rw = def?.readonlyWhen;
      const readonlyWhen = rw != null && !(typeof rw === 'string' && rw.trim() === '');
      fieldMap.set(fieldName, { readonly: def?.readonly === true, readonlyWhen });
    };
    const fields = obj.fields;
    if (Array.isArray(fields)) {
      for (const f of fields as AnyRec[]) {
        const fn = (f as AnyRec)?.name;
        if (typeof fn === 'string') collect(fn, f as AnyRec);
      }
    } else if (fields && typeof fields === 'object') {
      for (const [fn, def] of Object.entries(fields as AnyRec)) collect(fn, def as AnyRec);
    }
    idx.set(name, fieldMap);
  }
  return idx;
}

/**
 * The target object of an `update_record` node, when statically knowable. Reads
 * the canonical `objectName` and its historical `object` alias (the same pair
 * `readAliasedConfig` resolves at run time). A templated value (contains `{`) is
 * dynamic — return undefined so the node is skipped rather than guessed.
 */
function readLiteralObjectName(config: AnyRec): string | undefined {
  const raw = config.objectName ?? config.object;
  if (typeof raw !== 'string' || raw.includes('{')) return undefined;
  return raw || undefined;
}

/**
 * Validate flow `update_record` writes against target-object readonly
 * declarations. Pure and dependency-free; safe on pre- or post-parse stacks.
 */
export function validateReadonlyFlowWrites(stack: AnyRec): ReadonlyFlowWriteFinding[] {
  const findings: ReadonlyFlowWriteFinding[] = [];
  const flows = asArray(stack.flows);
  if (flows.length === 0) return findings;

  const roIndex = buildReadonlyIndex(asArray(stack.objects));

  flows.forEach((flow, flowIndex) => {
    // `runAs` defaults to 'user' (schema default). Only an explicit 'system'
    // run bypasses the strip, so treat anything else — including an unauthored
    // (undefined) runAs — as strip-subject.
    if (flow.runAs === 'system') return;
    const runAs = flow.runAs === 'user' || flow.runAs === 'system' ? flow.runAs : 'user';

    const flowName = typeof flow.name === 'string' ? flow.name : `#${flowIndex}`;
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];

    nodes.forEach((node, nodeIndex) => {
      if (node?.type !== 'update_record') return;
      const config = (node.config ?? {}) as AnyRec;

      const objectName = readLiteralObjectName(config);
      if (!objectName) return; // templated / dynamic object — not statically knowable
      const fieldMap = roIndex.get(objectName);
      if (!fieldMap) return; // object defined by another package — cannot judge its fields

      const fields = config.fields;
      // A non-literal write map (templated string, spread, array) is not
      // statically knowable — skip rather than guess.
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;

      const nodeName =
        typeof node.label === 'string' && node.label
          ? node.label
          : typeof node.id === 'string' && node.id
            ? node.id
            : `#${nodeIndex}`;

      for (const fieldName of Object.keys(fields as AnyRec)) {
        const meta = fieldMap.get(fieldName);
        if (!meta) continue; // unknown field — a form/field-layout lint concern, not this rule's

        if (meta.readonly) {
          findings.push({
            severity: 'error',
            rule: FLOW_UPDATE_READONLY_FIELD,
            where: `flow "${flowName}" › node "${nodeName}"`,
            path: `flows[${flowIndex}].nodes[${nodeIndex}].config.fields.${fieldName}`,
            message:
              `writes field '${fieldName}', which object '${objectName}' declares readonly:true. Under ` +
              `runAs:'${runAs}' the engine silently strips readonly fields from the UPDATE payload (#2948), ` +
              `so this write never lands — while the step still reports success.`,
            hint:
              `If automation is meant to maintain this field, declare the flow runAs:'system' (the intended ` +
              `channel — readonly governs the end-user/API surface, not trusted system writers). Otherwise ` +
              `remove '${fieldName}' from this update_record node.`,
          });
        } else if (meta.readonlyWhen) {
          findings.push({
            severity: 'warning',
            rule: FLOW_UPDATE_READONLY_WHEN_FIELD,
            where: `flow "${flowName}" › node "${nodeName}"`,
            path: `flows[${flowIndex}].nodes[${nodeIndex}].config.fields.${fieldName}`,
            message:
              `writes field '${fieldName}', which object '${objectName}' declares readonlyWhen. On records ` +
              `where that predicate is TRUE, a runAs:'${runAs}' UPDATE strips the field (#3042), so this ` +
              `write may silently not land depending on the record's state.`,
            hint:
              `If automation must maintain this field regardless of record state, run the flow runAs:'system'. ` +
              `Otherwise confirm this node only targets records whose readonlyWhen predicate is FALSE.`,
          });
        }
      }
    });
  });

  return findings;
}
