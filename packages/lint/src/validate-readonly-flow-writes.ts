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
//   • `update_record` AND `create_record` — the two nodes whose `fields` map
//     is a caller-supplied write payload. The create verb used to be excluded
//     because INSERT was engine-exempt from the author-declared static-
//     `readonly` strip (#3043/#3413: "a `create_record` may legitimately seed
//     readonly columns", with an ingress copy in metadata-protocol that the
//     flow engine bypassed by calling the data engine directly). The maintainer
//     ruling of 2026-09-03 (option C, #14147) SUPERSEDED that row: `engine.insert`
//     runs the SAME `stripReadonlyFields` the update path runs, under the same
//     `isSystem` gate, and a `create_record` node without `runAs:'system'` is
//     exactly such a caller — the row lands WITHOUT the column and the step
//     still reports `success` (measured end to end in service-automation's
//     `create-record-readonly-drop.test.ts`). So the STATIC branch below judges
//     both verbs alike (#15394 closed the scan gap #14147 left open).
//
//     ⚠️ The CONDITIONAL branch stays `update_record`-only, on purpose: a
//     `readonlyWhen` predicate is evaluated against the record being written
//     over, which a create does not have, and `engine.ts` says so at the strip
//     ("INSERT stays exempt" — `stripReadonlyWhenFields` is update-path-only).
//     A `readonlyWhen` finding on a `create_record` would state something false
//     about a write that lands, so none is ever produced.
//
//   • `runAs:'system'` exempts the STATIC branch ONLY - it is not a flow-level
//     skip. An elevated run bypasses the static `readonly` strip, so a system
//     flow legitimately MAINTAINS readonly fields ("users can't edit this, but
//     automation does"). That is the intended channel, so it is never flagged.
//
//     ⚠️ The exemption stops there. `stripReadonlyWhenFields` runs with no
//     `isSystem` guard at all (engine.ts, the #9107 note: "`isSystem` is still
//     NOT an exemption here, unlike the static strip below"), pinned as "LOCK 2
//     - isSystem does NOT exempt a caller-supplied value" in
//     `engine-readonly-when-derived-writes.test.ts` and from the other side in
//     `engine-readonly-strict-writes.test.ts` ("covers readonlyWhen too - the
//     arm a trusted (isSystem) caller can still hit"). So a `runAs:'system'`
//     flow writing a `readonlyWhen` field IS still stripped on a locked record,
//     and the conditional branch inspects an elevated flow exactly like any
//     other, at its usual `warning` severity. Narrowing this exemption to the
//     branch it belongs to (#14201) is what stops the rule from going silent on
//     the one flow class its own hint tells the author elevation cannot save -
//     the same split the action sibling was born with
//     (`validate-readonly-action-writes.ts`: an action body is system-elevated
//     BY DESIGN, so it carries the conditional half and only that half).
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

import { walkFlowNodes, flowNodeLabel } from './flow-walk.js';
import { recordsOf } from './object-graph.js';

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

// Rule ids (registry entries). One id per SHAPE, not per verb: since #15394
// `flow-update-readonly-field` covers the static shape on `create_record` too,
// because the finding is the same fact (a caller-supplied write to a declared-
// readonly field the engine strips) and the same strip — the message names the
// verb it was judged on, and a second id would only split one finding's
// suppression, docs and counts in two.
export const FLOW_UPDATE_READONLY_FIELD = 'flow-update-readonly-field';
export const FLOW_UPDATE_READONLY_WHEN_FIELD = 'flow-update-readonly-when-field';

/** The node type whose payload the STATIC branch alone judges (#15394). */
const CREATE_NODE_TYPE = 'create_record';
/** The node type both branches judge. */
const UPDATE_NODE_TYPE = 'update_record';
/**
 * Flow nodes whose `config.fields` is a caller-supplied write payload the engine
 * runs `stripReadonlyFields` over. Declared as data so a third CRUD verb cannot
 * land silently in a branch never written for it.
 */
export const READONLY_FLOW_WRITE_NODE_TYPES: readonly string[] = [UPDATE_NODE_TYPE, CREATE_NODE_TYPE];
const WRITE_NODE_TYPES: ReadonlySet<string> = new Set(READONLY_FLOW_WRITE_NODE_TYPES);

type AnyRec = Record<string, unknown>;

export interface FieldReadonlyMeta {
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
 *
 * Exported for `validate-readonly-hook-writes.ts` (#13653), which asks the
 * IDENTICAL question one surface over — "is this declared field writable
 * through this channel?" — about a hook body's `ctx.api` update instead of a
 * flow node's `config.fields`. Shared rather than copied for the reason #4330
 * collapsed five hand-copied lists: two readings of `readonly`/`readonlyWhen`
 * that drift produce two rules that disagree about the same field, and the
 * disagreement is silent. `IMPLICIT_FIELDS` in `validate-hook-body-writes.ts`
 * is shared across its three surfaces on exactly this reasoning.
 */
export function buildReadonlyIndex(objects: AnyRec[]): Map<string, Map<string, FieldReadonlyMeta>> {
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
 * Objects the engine's CREATE-side static strip does not judge at all — the
 * two object-level exclusions of `staticReadonlyInsertSubject`
 * (packages/objectql/src/validation/rule-validator.ts): a platform object
 * (`managedBy` set, or the reserved `sys_` namespace) carries its own
 * field-write governance (ADR-0086, a 403 guard) that a silent strip must not
 * pre-empt, so `engine.insert` runs no readonly strip on it. A create finding
 * on such an object would describe a strip that never happens.
 *
 * ⚠️ Create-verb ONLY. The UPDATE path applies neither exclusion (stated at
 * that function: "This asymmetry is the create side's"), so the update branch
 * of both rules keeps judging these objects. Shared with
 * `validate-readonly-hook-writes.ts` for the same reason the index above is.
 */
export function buildInsertStripExemptObjects(objects: AnyRec[]): Set<string> {
  const exempt = new Set<string>();
  for (const obj of objects) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    if (obj.managedBy || name.startsWith('sys_')) exempt.add(name);
  }
  return exempt;
}

/**
 * The target object of an `update_record` / `create_record` node, when
 * statically knowable. Both node configs anchor the object on the same key
 * (`CreateRecordConfigSchema` / `UpdateRecordConfigSchema` in
 * `@objectstack/spec` automation, `objectName`) and share the same alias
 * conversion (`flow-node-crud-object-alias` covers the whole CRUD quartet). Reads
 * the canonical `objectName` and its historical `object` alias — a pre-parse
 * source may still carry the alias during the protocol-17 window, until the
 * 'flow-node-crud-object-alias' conversion (#3796) canonicalizes it at load. A
 * templated value (contains `{`) is dynamic — return undefined so the node is
 * skipped rather than guessed.
 */
function readLiteralObjectName(config: AnyRec): string | undefined {
  const raw = config.objectName ?? config.object;
  if (typeof raw !== 'string' || raw.includes('{')) return undefined;
  return raw || undefined;
}

/**
 * Validate flow `update_record` / `create_record` writes against target-object
 * readonly declarations. Pure and dependency-free; safe on pre- or post-parse
 * stacks.
 */
export function validateReadonlyFlowWrites(stack: AnyRec): ReadonlyFlowWriteFinding[] {
  const findings: ReadonlyFlowWriteFinding[] = [];
  const flows = recordsOf(stack.flows);
  if (flows.length === 0) return findings;

  const objects = recordsOf(stack.objects);
  const roIndex = buildReadonlyIndex(objects);
  const insertStripExempt = buildInsertStripExemptObjects(objects);

  flows.forEach((flow, flowIndex) => {
    // `runAs` defaults to 'user' (schema default). Only an explicit 'system'
    // run bypasses the STATIC strip, so treat anything else — including an
    // unauthored (undefined) runAs — as subject to both strips. ⛔ Not a
    // flow-level skip: the conditional strip has no `isSystem` guard, so an
    // elevated flow stays in the walk and is judged on the `readonlyWhen`
    // branch below (#14201).
    const runAs = flow.runAs === 'user' || flow.runAs === 'system' ? flow.runAs : 'user';
    const isSystemRun = runAs === 'system';

    const flowName = typeof flow.name === 'string' ? flow.name : `#${flowIndex}`;
    // Every node, INCLUDING those nested in try_catch / loop / parallel regions.
    // A readonly write inside a `catch` branch is the same certain no-op as one
    // at the top level, and this rule gates on it (#4380).
    const walked = walkFlowNodes(flow, `flows[${flowIndex}]`);

    walked.forEach(({ node, path: nodePath, regionTrail }, walkIndex) => {
      const nodeType = node?.type;
      if (typeof nodeType !== 'string' || !WRITE_NODE_TYPES.has(nodeType)) return;
      // A create has no prior record, so only the STATIC branch applies to it
      // (the header's second bullet); the verb also reaches the message.
      const isCreate = nodeType === CREATE_NODE_TYPE;
      const config = (node.config ?? {}) as AnyRec;

      const objectName = readLiteralObjectName(config);
      if (!objectName) return; // templated / dynamic object — not statically knowable
      const fieldMap = roIndex.get(objectName);
      if (!fieldMap) return; // object defined by another package — cannot judge its fields
      // A platform object is outside the create-side strip entirely (see
      // `buildInsertStripExemptObjects`); the update branch is not.
      if (isCreate && insertStripExempt.has(objectName)) return;

      const fields = config.fields;
      // A non-literal write map (templated string, spread, array) is not
      // statically knowable — skip rather than guess.
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;

      const nodeName = flowNodeLabel(node, walkIndex);
      const where = regionTrail
        ? `flow "${flowName}" › ${regionTrail} › node "${nodeName}"`
        : `flow "${flowName}" › node "${nodeName}"`;

      for (const fieldName of Object.keys(fields as AnyRec)) {
        const meta = fieldMap.get(fieldName);
        // Unknown field — `validate-flow-node-writes.ts` owns that question
        // (`flow-node-write-unknown-field`, also gating). This rule is about a
        // field the object DOES declare and the engine then strips; a name that
        // resolves to no column is a different failure with a different fix, so
        // the two never double-report the same key.
        if (!meta) continue;

        // The static branch is the one an elevated run really does bypass, so
        // `isSystem` gates it HERE rather than at flow level. A field declaring
        // BOTH flags therefore still falls through to the conditional branch
        // under `runAs:'system'` — which is the truth about that write: the
        // static strip is skipped, the conditional one is not.
        if (meta.readonly && !isSystemRun) {
          findings.push({
            severity: 'error',
            rule: FLOW_UPDATE_READONLY_FIELD,
            where,
            path: `${nodePath}.config.fields.${fieldName}`,
            message: isCreate
              ? // The create-side strip is the 2026-09-03 ruling (#14147): the
                // same `stripReadonlyFields`, now run by `engine.insert` too. The
                // id stays in this comment, out of the string an author reads
                // and cannot resolve (`check:doc-authoring`).
                `writes field '${fieldName}', which object '${objectName}' declares readonly:true. Under ` +
                `runAs:'${runAs}' the engine silently strips readonly fields from the INSERT payload too ` +
                `(the same strip the UPDATE path runs), so the row is created WITHOUT this column ` +
                `(it falls back to the field's defaultValue) — while the create_record step still reports ` +
                `success, with only a run-time warning naming the dropped field.`
              : `writes field '${fieldName}', which object '${objectName}' declares readonly:true. Under ` +
                `runAs:'${runAs}' the engine silently strips readonly fields from the UPDATE payload (#2948), ` +
                `so this write never lands — while the step still reports success.`,
            hint: isCreate
              ? `Seeding a readonly column at create time is a SYSTEM act: declare the flow runAs:'system' ` +
                `(the intended channel — readonly governs the end-user/API surface, not trusted system ` +
                `writers). Otherwise remove '${fieldName}' from this create_record node, or stamp it in a ` +
                `beforeInsert hook on '${objectName}' — a hook-assigned key is the hook's write, not a ` +
                `caller-supplied one, and survives the strip.`
              : `If automation is meant to maintain this field, declare the flow runAs:'system' (the intended ` +
                `channel — readonly governs the end-user/API surface, not trusted system writers). Otherwise ` +
                `remove '${fieldName}' from this update_record node.`,
          });
        } else if (meta.readonlyWhen && !isCreate) {
          // `!isCreate`: the conditional lock has no prior record to evaluate on
          // an insert and the engine does not run it there ("INSERT stays
          // exempt"), so a create is judged on the static branch alone — under
          // `runAs:'system'` that means a create writing BOTH kinds is clean,
          // where the same update would still draw the conditional warning.
          findings.push({
            severity: 'warning',
            rule: FLOW_UPDATE_READONLY_WHEN_FIELD,
            where,
            path: `${nodePath}.config.fields.${fieldName}`,
            message:
              `writes field '${fieldName}', which object '${objectName}' declares readonlyWhen. On records ` +
              `where that predicate is TRUE, a runAs:'${runAs}' UPDATE strips the field (#3042), so this ` +
              `write may silently not land depending on the record's state.`,
            hint:
              `Elevation is not a workaround here: unlike the static readonly strip, the conditional lock ` +
              `is NOT waived by a system context, so runAs:'system' strips this field on a locked record ` +
              `exactly as this run does. Either confirm this node only targets records whose readonlyWhen ` +
              `predicate is FALSE, or derive '${fieldName}' in a beforeUpdate hook on '${objectName}' - a ` +
              `hook-derived value is not caller-supplied and does land, even on a locked record. Otherwise ` +
              `remove '${fieldName}' from this update_record node. This warning never blocks a build.`,
          });
        }
      }
    });
  });

  return findings;
}
