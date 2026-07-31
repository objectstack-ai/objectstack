// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Author-time write-set check for a flow `update_record` node's `fields` — the
// THIRD surface in the family #4271 opened, and the one the docs spent the
// longest recommending as the safe alternative to the other two.
//
// A flow node that writes a field the target object never declares
// (`config.fields.stagee` against an object whose column is `stage`) was caught
// by nothing. `validate-readonly-flow-writes.ts` walks this exact map and
// explicitly stepped over the unknown key ("a form/field-layout lint concern,
// not this rule's" — a referral to a rule that does not check writes);
// `validate-flow-template-paths.ts` checks the `{record.<path>}` READ tokens
// interpolated into node config, never the write-side key. So the surface the
// hook-body docs pointed authors at — "prefer a flow update_record node, whose
// structural `fields` config is checked" — was the least checked of the three.
//
// ─── Why this one GATES where its two siblings advise ───────────────────────
//
// `hook-body-write-unknown-field` (#4305) and `action-body-write-unknown-field`
// (#4344) are `warning` because they PARSE JavaScript: the finding is only as
// good as the extractor, and a false positive kills an advisory lint. Nothing
// here is parsed. `config.fields` is a literal, structural map next to a
// literal `objectName` — when this rule speaks, the key provably resolves to no
// column, at the same certainty `flow-update-readonly-field` already gates on
// one config key over.
//
// And the runtime consequence is not the benign "consumer skips the unknown
// name and does the rest" that keeps `page-field-unknown` / `form-field-unknown`
// advisory. Nothing between the node and storage removes the key: the flow
// executor calls the data engine directly (bypassing the metadata-protocol
// ingress, which strips `readonly` — not unknown — keys anyway), the engine's
// UPDATE path strips only readonly/readonlyWhen, and the SQL driver's
// `formatInput` / `applyWriteColumnMap` pass an unrecognized key straight
// through (`m[k] ?? k`). Both halves were measured, not inferred:
//
//   • Through the engine, an undeclared key reaches `driver.update` verbatim,
//     alongside the audit stamps.
//   • On SQLite/knex it then becomes `update "deal" set "name" = 'n2',
//     "stagee" = 'won' … → no such column: stagee`. The statement is rejected
//     WHOLE: `name` — spelled correctly, in the same payload — does not land
//     either, and the step fails with a driver error naming a column, far from
//     the authoring mistake.
//   • On a schemaless datasource (memory, MongoDB) nothing rejects it, so the
//     stray key is persisted into a column the object never declares — where no
//     schema-driven read surface will return it.
//
// Neither outcome is "the rest still works". That is the same call
// `validate-searchable-fields` makes for a stale entry and
// `validate-flow-template-paths` makes for a filter-position token: gate when
// the miss breaks or corrupts the operation, advise when it merely narrows the
// output. Every skip below exists so that gate only ever fires on a certainty.
//
// ─── Scope ──────────────────────────────────────────────────────────────────
//
// {@link FLOW_WRITE_NODE_TYPES} — today `update_record` alone — with the
// deliberate non-member (`create_record`) declared as data in
// {@link FLOW_WRITE_NODE_TYPES_DEFERRED} rather than left as silence, and the
// two halves partition-tested against the CRUD node types that carry a `fields`
// write map. A node type that grows one later fails that test until someone
// classifies it.
//
// `runAs` is deliberately NOT consulted, unlike its readonly sibling. A
// `runAs:'system'` flow is elevated past the readonly strip, which is why that
// rule skips it — but no run identity conjures a column, so an unknown field is
// unknown at every privilege level.
//
// Wired via REFERENCE_INTEGRITY_RULES (it resolves a field NAME written in
// metadata against what the stack declares — the suite's exact membership
// test), so `os validate`, `os lint` and `os compile` report it at once. The
// readonly rule next door is still hand-wired into two of those three; this one
// does not repeat that.

import { findClosestMatches, formatSuggestion } from '@objectstack/spec/shared';

import { indexObjectFields, IMPLICIT_FIELDS } from './validate-hook-body-writes.js';

export type FlowNodeWriteSeverity = 'error';

export interface FlowNodeWriteFinding {
  /** Always `error` — a literal key against a literal object is a certainty (see module note). */
  severity: FlowNodeWriteSeverity;
  rule: string;
  /** Human-readable location, e.g. `flow "close_deal" › node "Mark won"`. */
  where: string;
  /** Config path, e.g. `flows[0].nodes[3].config.fields.stagee`. */
  path: string;
  message: string;
  hint: string;
}

// Rule id (registry entry).
export const FLOW_NODE_WRITE_UNKNOWN_FIELD = 'flow-node-write-unknown-field';

// ─── The covered-node ledger ────────────────────────────────────────────────
//
// Which flow node types have their `config.fields` write map resolved against
// the target object, declared as data — and, next to it, which `fields`-bearing
// node type deliberately does not yet, with its reason. Both halves are
// partition-tested against the CRUD schemas in
// `@objectstack/spec/automation/builtin-node-config`, so a node type that grows
// a write map later cannot land on the uncovered side by nobody noticing.

/** Flow node types whose `config.fields` keys this rule resolves. */
export const FLOW_WRITE_NODE_TYPES: readonly string[] = ['update_record'];

/** A `fields`-bearing node type this rule does NOT cover yet, and why. */
export interface FlowWriteNodeDeferral {
  /** The `FlowNode.type` left uncovered. */
  readonly type: string;
  /** Why it is not covered, in terms a reviewer can act on. */
  readonly reason: string;
}

/**
 * `fields`-bearing CRUD node types deliberately left out of v1.
 *
 * `create_record` fails identically — same literal map, same `objectName`
 * binding, same driver fate — and covering it is one entry in
 * {@link FLOW_WRITE_NODE_TYPES} plus its fixtures. It is out of scope here only
 * because the reported gap (#4001 family, the `update_record` surface the docs
 * recommended) is the UPDATE one, and a gating rule earns its severity one
 * measured surface at a time. Recorded rather than omitted so the remaining
 * half is a decision on the record, not a discovery someone makes twice.
 */
export const FLOW_WRITE_NODE_TYPES_DEFERRED: readonly FlowWriteNodeDeferral[] = [
  {
    type: 'create_record',
    reason:
      "same literal `config.fields` map and same `objectName` binding as update_record, so the check carries " +
      'over verbatim; deferred only to land the gating severity on one surface first',
  },
];

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Coerce an array-or-name-keyed-map collection to an array (name injected). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v.filter((x): x is AnyRec => isRec(x));
  if (isRec(v)) {
    return Object.entries(v).map(([name, def]) => ({
      name,
      ...(isRec(def) ? def : {}),
    }));
  }
  return [];
}

/**
 * The target object of a CRUD node, when statically knowable. Reads the
 * canonical `objectName` and its historical `object` alias — a pre-parse source
 * may still carry the alias until the 'flow-node-crud-object-alias' conversion
 * (#3796) canonicalizes it at load. A templated value (contains `{`) is
 * resolved from flow variables at run time, so it is skipped rather than
 * guessed. Same read as `validate-readonly-flow-writes.ts`, which walks the
 * same nodes for the other question.
 */
function readLiteralObjectName(config: AnyRec): string | undefined {
  const raw = config.objectName ?? config.object;
  if (typeof raw !== 'string' || raw.includes('{')) return undefined;
  return raw || undefined;
}

const COVERED_TYPES: ReadonlySet<string> = new Set(FLOW_WRITE_NODE_TYPES);

/**
 * Validate flow write-node `fields` keys against the target object's declared
 * fields. Pure `(stack) => Finding[]` (ADR-0019); safe on pre- or post-parse
 * stacks.
 */
export function validateFlowNodeWrites(stack: AnyRec): FlowNodeWriteFinding[] {
  const findings: FlowNodeWriteFinding[] = [];
  if (!isRec(stack)) return findings;

  const flows = asArray(stack.flows);
  if (flows.length === 0) return findings;

  // Built lazily: a stack whose flows carry no write node never pays it.
  let objectFields: Map<string, Set<string>> | null = null;

  flows.forEach((flow, flowIndex) => {
    const flowName = typeof flow.name === 'string' && flow.name ? flow.name : `#${flowIndex}`;
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];

    nodes.forEach((node, nodeIndex) => {
      if (!isRec(node)) return;
      if (typeof node.type !== 'string' || !COVERED_TYPES.has(node.type)) return;

      const config = isRec(node.config) ? node.config : undefined;
      if (!config) return;

      // A non-literal write map (templated string, spread result, array) is not
      // statically knowable — skip rather than guess.
      const fields = config.fields;
      if (!isRec(fields)) return;
      const written = Object.keys(fields);
      if (written.length === 0) return;

      const objectName = readLiteralObjectName(config);
      if (!objectName) return; // templated / dynamic object — resolved at run time

      objectFields ??= indexObjectFields(stack);
      const known = objectFields.get(objectName);
      if (!known) return; // object declared by another package — cannot judge its fields
      // An object that declares NO fields is an external / datasource-introspected
      // schema whose columns are resolved at runtime (the same skip
      // validate-searchable-fields takes). Every write to it would otherwise be
      // flagged, and this rule gates.
      if (known.size === 0) return;

      const nodeName =
        typeof node.label === 'string' && node.label
          ? node.label
          : typeof node.id === 'string' && node.id
            ? node.id
            : `#${nodeIndex}`;

      for (const fieldName of written) {
        if (known.has(fieldName) || IMPLICIT_FIELDS.has(fieldName)) continue;
        // A dotted key addresses a nested path, not a top-level column — the
        // document drivers forward it verbatim. Not statically a missing field.
        if (fieldName.includes('.')) continue;

        findings.push({
          severity: 'error',
          rule: FLOW_NODE_WRITE_UNKNOWN_FIELD,
          where: `flow "${flowName}" › node "${nodeName}"`,
          path: `flows[${flowIndex}].nodes[${nodeIndex}].config.fields.${fieldName}`,
          message:
            `${node.type} writes '${fieldName}', but object '${objectName}' declares no such field. Nothing ` +
            `between the node and storage removes the key: on a SQL datasource the driver rejects the whole ` +
            `statement ('no such column'), so the correctly named fields in this same payload never land ` +
            `either; on a schemaless one the stray key is persisted into a column no read surface returns.`,
          hint: fixHint(fieldName, [...known]),
        });
      }
    });
  });

  return findings;
}

/** Did-you-mean (declared + system columns as candidates) plus the fix. */
function fixHint(field: string, declared: string[]): string {
  const suggestion = formatSuggestion(findClosestMatches(field, [...declared, ...IMPLICIT_FIELDS]));
  return (
    (suggestion ? `${suggestion} ` : '') +
    `Fix the field name, or declare '${field}' on the object. This gates the build rather than warning: ` +
    `the key is literal and so is the object, so unlike the hook/action body rules there is nothing here ` +
    `that could have been mis-extracted.`
  );
}
