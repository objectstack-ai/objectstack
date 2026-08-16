// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Author-time write-set check for a flow CRUD node's `fields` write map — the
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
// write paths strip only readonly/readonlyWhen, and the SQL driver's
// `formatInput` / `applyWriteColumnMap` pass an unrecognized key straight
// through (`m[k] ?? k`). Every branch below was measured, not inferred:
//
//   • Through the engine, an undeclared key reaches `driver.update` /
//     `driver.create` verbatim, alongside the audit stamps.
//   • On SQLite/knex an UPDATE becomes `update "deal" set "name" = 'n2',
//     "stagee" = 'won' … → no such column: stagee`. The statement is rejected
//     WHOLE: `name` — spelled correctly, in the same payload — does not land
//     either, and the step fails with a driver error naming a column, far from
//     the authoring mistake.
//   • An INSERT fails the same way (`table deal has no column named stagee`),
//     and one notch harder: the row is never created at all, so every later
//     node that expected `{<node>.id}` is working from a record that does not
//     exist.
//   • On a schemaless datasource (memory, MongoDB) nothing rejects it, so the
//     stray key is persisted into a column the object never declares — where no
//     schema-driven read surface will return it.
//
// No outcome is "the rest still works". That is the same call
// `validate-searchable-fields` makes for a stale entry and
// `validate-flow-template-paths` makes for a filter-position token: gate when
// the miss breaks or corrupts the operation, advise when it merely narrows the
// output. Every skip below exists so that gate only ever fires on a certainty.
//
// ─── Scope ──────────────────────────────────────────────────────────────────
//
// {@link FLOW_WRITE_NODE_TYPES} — every CRUD node type that carries a `fields`
// WRITE map: `update_record` (#4369) and `create_record` (#4371). The deferred
// half, {@link FLOW_WRITE_NODE_TYPES_DEFERRED}, is now empty, and the partition
// test still derives the full set behaviourally from the spec's
// executor-written config schemas — so a node type that grows a write map later
// lands on neither side and fails that test until someone classifies it.
//
// `get_record.fields` is NOT a member and never will be: it is a projection
// (`z.array(z.string())`), a READ, and an unknown entry there narrows the
// selection rather than breaking the statement. `screen.defaults` is not one
// either — an object-form screen forwards it into the `ScreenSpec` the client
// renders, so an unknown key is a form prefill the renderer ignores: inert, the
// "skips it and renders the rest" case this rule's severity is defined against.
// Both are excluded on the shape of their failure, not by omission.
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

import {
  indexObjectFields,
  judgeableFieldsOf,
  IMPLICIT_FIELDS,
  unprovisionedAnchorWriteConsequence,
} from './validate-hook-body-writes.js';
import {
  indexUnprovisionedAnchors,
  unprovisionedAnchorCause,
  unprovisionedAnchorHint,
} from './system-fields.js';
import { walkFlowNodes, flowNodeLabel } from './flow-walk.js';

/**
 * `error` for the existence verdict — a literal key against a literal object is
 * a certainty (see the module note). [#8663] `warning` for the provenance one:
 * the same widening `validateFlowTemplatePaths` carries, for the same reason.
 * The two questions have different certainties, so they cannot share a
 * severity; the suite that runs this rule is severity-agnostic by contract and
 * carries each finding's own value through.
 */
export type FlowNodeWriteSeverity = 'error' | 'warning';

export interface FlowNodeWriteFinding {
  /** Per-finding — see {@link FlowNodeWriteSeverity}, which says why it is not a constant. */
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

/**
 * [#8663] The flow-node twin of `hook-body-write-unprovisioned-anchor`. This
 * rule reached the same blind spot from the same direction: it imports
 * {@link IMPLICIT_FIELDS} from the hook rule, so it inherited the set's
 * object-independence along with its contents.
 *
 * ⚠️ `warning`, NOT this rule's usual `error`. The existence verdict gates
 * because a literal key against a literal object is a certainty; the provenance
 * verdict is a claim about a REMOTE schema this repo cannot see, so it advises.
 * Reclassifying it upward would convert a silent case straight into a build
 * break — the shape ADR-0072 D1 forbids, at the one severity where it cannot be
 * ignored.
 */
export const FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR = 'flow-node-write-unprovisioned-anchor';

// ─── The covered-node ledger ────────────────────────────────────────────────
//
// Which flow node types have their `config.fields` write map resolved against
// the target object, declared as data — and, next to it, which `fields`-bearing
// node type deliberately does not yet, with its reason. Both halves are
// partition-tested against the CRUD schemas in
// `@objectstack/spec/automation/builtin-node-config`, so a node type that grows
// a write map later cannot land on the uncovered side by nobody noticing.

/** Flow node types whose `config.fields` keys this rule resolves. */
export const FLOW_WRITE_NODE_TYPES: readonly string[] = ['update_record', 'create_record'];

/** A `fields`-bearing node type this rule does NOT cover yet, and why. */
export interface FlowWriteNodeDeferral {
  /** The `FlowNode.type` left uncovered. */
  readonly type: string;
  /** Why it is not covered, in terms a reviewer can act on. */
  readonly reason: string;
}

/**
 * `fields`-bearing CRUD node types deliberately left uncovered.
 *
 * **Empty, and that is the point.** #4369 shipped `update_record` alone and
 * parked `create_record` here with its reason — a gating rule earning its
 * severity one measured surface at a time — rather than leaving the other half
 * as silence. #4371 measured the INSERT path (`table deal has no column named
 * stagee`, and the row never created at all), found it strictly worse than the
 * UPDATE one, and moved it across.
 *
 * The slot stays because the partition test derives the full `fields`-write-map
 * set from the spec's own config schemas: a node type that grows one later
 * belongs to neither list and fails that test until someone puts it in one.
 * Deleting this array would turn that forced decision back into a default.
 */
export const FLOW_WRITE_NODE_TYPES_DEFERRED: readonly FlowWriteNodeDeferral[] = [];

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
  // [#8663] Non-empty only for a stack carrying an ADR-0015 `external` object.
  let anchors: ReadonlyMap<string, ReadonlySet<string>> | null = null;

  flows.forEach((flow, flowIndex) => {
    const flowName = typeof flow.name === 'string' && flow.name ? flow.name : `#${flowIndex}`;
    // Every node, INCLUDING those nested in try_catch / loop / parallel regions
    // — a gating rule that stops at the top level simply stops gating the
    // moment an author wraps the write in error handling (#4380).
    const walked = walkFlowNodes(flow, `flows[${flowIndex}]`);

    walked.forEach(({ node, path: nodePath, regionTrail }, walkIndex) => {
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
      anchors ??= indexUnprovisionedAnchors(stack);
      // Cross-package objects and objects declaring no fields at all (external /
      // datasource-introspected schemas) are both unjudgeable, and this rule
      // gates — see {@link judgeableFieldsOf}, which is where that guard now
      // lives for the whole family rather than once per rule (#4383).
      const known = judgeableFieldsOf(objectFields, objectName);
      if (!known) return;

      const nodeName = flowNodeLabel(node, walkIndex);
      // A nested node names the region that holds it, or "node X" is ambiguous
      // in a flow where the same label appears in a try and a catch branch.
      const nodeWhere = regionTrail ? `${regionTrail} › node "${nodeName}"` : `node "${nodeName}"`;

      for (const fieldName of written) {
        // An author-DECLARED column wins outright — on a federated object it
        // maps a remote column the author vouches for (#7859's direction).
        if (known.has(fieldName)) continue;
        if (IMPLICIT_FIELDS.has(fieldName)) {
          // [#8663] Implicitly writable SOMEWHERE is not provisioned HERE.
          if (!anchors.get(objectName)?.has(fieldName)) continue;
          findings.push({
            severity: 'warning',
            rule: FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR,
            where: `flow "${flowName}" › ${nodeWhere}`,
            path: `${nodePath}.config.fields.${fieldName}`,
            message:
              `${node.type} writes '${fieldName}', and ${unprovisionedAnchorCause(objectName, fieldName)} — ` +
              unprovisionedAnchorWriteConsequence(),
            hint: unprovisionedAnchorHint(objectName, fieldName),
          });
          continue;
        }
        // A dotted key addresses a nested path, not a top-level column — the
        // document drivers forward it verbatim. Not statically a missing field.
        if (fieldName.includes('.')) continue;

        findings.push({
          severity: 'error',
          rule: FLOW_NODE_WRITE_UNKNOWN_FIELD,
          where: `flow "${flowName}" › ${nodeWhere}`,
          path: `${nodePath}.config.fields.${fieldName}`,
          message:
            `${node.type} writes '${fieldName}', but object '${objectName}' declares no such field. Nothing ` +
            `between the node and storage removes the key: on a SQL datasource the driver rejects the whole ` +
            `statement ('no such column'), so the correctly named fields in this same payload never land ` +
            `either${
              node.type === 'create_record' ? ' and the record is never created at all' : ''
            }; on a schemaless one the stray key is persisted into a column no read surface returns.`,
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
