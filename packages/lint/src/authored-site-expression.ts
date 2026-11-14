// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32872] The publish gate's verdict on ONE authored expression, at the
 * sites the gate judges with passes of its own beyond the shared validator: a
 * validation rule's `condition`, a formula field's `expression` and (#33147) a
 * flow's condition.
 *
 * The MCP `validate_expression` tool promises "the verdict is the one the
 * publish gate gives that rule". It runs the shared validator
 * (`@objectstack/formula`'s `validateExpression`) itself, and before this
 * entry it ran nothing else, so it answered `ok: true` for rules the gate then
 * refused: the null-guard gate, a hop to a field the reference's target does
 * not declare, a hop into a stored-metadata table, a validation rule reading
 * `parent`, and (a warning) a read of an external object's unprovisioned
 * anchor. Each of those lives inside the gate's walk
 * ({@link runStackExpressionPasses}), closed over the stack's indexes.
 *
 * ⛔ Nothing here re-implements a pass. The entry builds the stack the gate
 * would judge, the subject object carrying the one rule or formula field the
 * caller describes, and runs the gate's OWN walk over it, as the object save
 * door does (`runtimeWriteType: 'object'`), with the one call the caller has
 * already made left out (`sharedValidatorRunByCaller`). What comes back is
 * every finding the gate locates on that rule or field and nothing else: a
 * pass added to the gate at either site is carried by construction, and
 * `authored-site-expression.test.ts` lists each one so its refusal through
 * this entry is pinned.
 *
 * [#33147] A flow condition is judged the way the runtime publish gate judges
 * a flow write (`runtimeWriteType: 'flow'`), the door an MCP or Studio write
 * of the flow meets: the probe is a one-flow stack whose start node carries
 * the trigger the caller names, and the condition sits on its one edge. That
 * door gives the null guard on a `record.` / `previous.` read and the
 * unprovisioned-anchor warning. It never judges a bare name's null guard or a
 * root the run does not bind: those are `os validate`'s whole-flow judgments,
 * over the flow's variables, node ids and entrances. The door does warn on a
 * bare read of a name a flow variable shares with a field
 * (`warnShadowedFieldReads`), but that needs the flow's declared variables,
 * and the caller does not hand this entry any, so the probe declares none and
 * that warning never fires here. So `[]` at a flow condition is that door's
 * verdict, short of the shadowed-read warning, and not `os validate`'s.
 */

import { analyzeRelationshipTraversals } from '@objectstack/formula';
import { stripInjectedSystemColumns } from '@objectstack/metadata-core';
import type { FlowTriggerKind } from '@objectstack/spec/automation';
import { referenceTargetOf } from '@objectstack/spec/data';

import { recordsOf } from './object-graph.js';
import { runStackExpressionPasses, type ExprIssue } from './validate-expressions.js';

type AnyRec = Record<string, unknown>;

/** The sites the gate judges with passes of its own, as `validate_expression` names them. */
export type AuthoredExpressionSite = 'validation' | 'formula' | 'flow_condition';

/**
 * [#33147] How the flow a condition sits on is started, as
 * `resolveFlowTriggerKind` reads it off the flow, or `none` for a flow with
 * no auto-launch trigger (a screen flow, a flow started by hand, an action or
 * a parent flow).
 */
export type AuthoredFlowTrigger = FlowTriggerKind | 'none';

/** What {@link judgeAuthoredSiteExpression} judges. */
export interface AuthoredSiteExpression {
  site: AuthoredExpressionSite;
  /** The object the rule or formula field is authored on. */
  objectName: string;
  /** The CEL source: the rule's `condition`, or the formula field's `expression`. */
  expression: string;
  /** site `validation` only: the rule's `severity` (the spec default is `error`). */
  severity?: 'error' | 'warning' | 'info';
  /**
   * [#33147] site `formula` only: the name of the field the expression is
   * authored on. A field the subject's definition declares keeps its
   * definition (its type above all) with this expression in place, so a
   * stored field (any type but `formula`) is judged as stored and a formula
   * is judged on the object's formula graph under its own name. A name the
   * definition does not declare is judged as a new `formula` field of that
   * name. Absent: a new formula field no authored formula can read.
   */
  field?: string;
  /** [#33147] site `flow_condition` only: how the flow is started. Default: `record_change`. */
  triggerKind?: AuthoredFlowTrigger;
  /**
   * [#33147] site `flow_condition` with `triggerKind` `time_relative` only:
   * the flow's `timeRelative.object`. Default: `objectName`.
   */
  sweepObject?: string;
  /**
   * [#33147] site `flow_condition` only: the flow's start condition, when the
   * judged condition is an edge or a `decision` branch after it. The gate
   * presumes what the start condition proves at every condition downstream,
   * so a guard written there holds here. Absent: the judged condition is the
   * start condition itself, or follows none (the gate answers both alike).
   */
  startCondition?: string;
  /**
   * The object definitions as the registry serves them: the subject's, and
   * those of the objects its references name that the expression reads
   * through ({@link authoredExpressionHopTargets}). A target left out is not
   * judged, as the gate does not judge a target outside the stack it reads.
   *
   * Served, a definition carries the system columns the registry injects as
   * declared fields; the gate judges the body as authored, so each is read
   * through `stripInjectedSystemColumns` (`@objectstack/metadata-core`, the
   * write path's own strip of exactly those) and the walk re-derives the
   * injected columns itself. Unstripped, the null-guard gate would judge
   * `created_at` as a declared nullable field and an external object's
   * anchors would read as columns its author vouches for.
   */
  objects: readonly AnyRec[];
}

/**
 * The name the judged rule carries. The gate's sentences that name a rule
 * (the null-guard and `parent` verdicts) name this one, since the tool is
 * handed the condition and not the rule it will sit on.
 */
export const AUTHORED_RULE_NAME = 'this rule';

/**
 * The name the judged formula field carries when the caller names no field.
 * No sentence of the formula site names it; it is spelled so that no authored
 * field can be it.
 */
export const AUTHORED_FORMULA_FIELD_NAME = '__validate_expression__';

/**
 * [#33147] The names the probe flow carries. The gate's flow sentences name
 * the slot they judge (`flow 'NAME' · edge 'ID' (start→end) condition`), so
 * they read as the condition being authored.
 */
export const AUTHORED_FLOW_NAME = 'this flow';
export const AUTHORED_CONDITION_ID = 'this condition';

/** [#33147] Where the probe flow's one edge sits, as the gate's findings spell its key path. */
const AUTHORED_CONDITION_PATH = 'flows[0].edges[0].condition';

/**
 * [#33147] The start node's trigger for each kind, spelled as
 * `resolveFlowTriggerKind` reads it (`authored-site-expression.test.ts` reads
 * each one back), with the flow `type` it needs.
 */
function probeTrigger(
  triggerKind: AuthoredFlowTrigger,
  objectName: string,
  sweepObject: string | undefined,
): { type: string; config: AnyRec } {
  switch (triggerKind) {
    case 'record_change':
      return { type: 'autolaunched', config: { triggerType: 'record-after-update' } };
    case 'time_relative':
      return { type: 'autolaunched', config: { timeRelative: { object: sweepObject ?? objectName } } };
    case 'schedule':
      return { type: 'schedule', config: { schedule: '0 * * * *' } };
    case 'api':
      return { type: 'api', config: {} };
    case 'none':
      return { type: 'autolaunched', config: {} };
  }
}

/**
 * [#33147] The flow the gate judges for one flow condition: a start node
 * bound to `objectName` with the trigger the caller names (and its start
 * condition, when given), and one edge to an end node carrying the
 * condition. Exported for the read-back pin; the entry is its one caller.
 */
export function authoredFlowProbe({
  objectName,
  expression,
  triggerKind = 'record_change',
  sweepObject,
  startCondition,
}: Pick<AuthoredSiteExpression, 'objectName' | 'expression' | 'triggerKind' | 'sweepObject' | 'startCondition'>): AnyRec {
  const trigger = probeTrigger(triggerKind, objectName, sweepObject);
  return {
    name: AUTHORED_FLOW_NAME,
    label: AUTHORED_FLOW_NAME,
    type: trigger.type,
    nodes: [
      {
        id: 'start',
        type: 'start',
        config: {
          objectName,
          ...trigger.config,
          ...(startCondition !== undefined ? { condition: startCondition } : {}),
        },
      },
      { id: 'end', type: 'end' },
    ],
    edges: [{ id: AUTHORED_CONDITION_ID, source: 'start', target: 'end', condition: expression }],
  };
}

/**
 * The objects whose definitions {@link judgeAuthoredSiteExpression} needs
 * beyond the subject: the target of each reference field of `subject` that
 * `expression` reads through (`record.FIELD.MEMBER`), read with the analysis
 * and the target accessor the gate's hop passes use. Empty when the source
 * does not parse (the shared validator reports that) or reads no hop.
 */
export function authoredExpressionHopTargets(subject: AnyRec, expression: string): string[] {
  const traversals = analyzeRelationshipTraversals(expression, 'record')?.traversals;
  if (!traversals || traversals.size === 0) return [];
  const targets = new Set<string>();
  for (const field of recordsOf(subject.fields)) {
    if (typeof field.name !== 'string' || !traversals.has(field.name)) continue;
    const target = referenceTargetOf(field)?.trim();
    if (target) targets.add(target);
  }
  return [...targets].sort();
}

/**
 * The gate's findings on the one rule, formula field or flow condition
 * described, beyond the shared validator's: each the gate's own pass, in the
 * gate's words, at the gate's severity. Empty when `objects` carries no
 * definition of `objectName`.
 */
export function judgeAuthoredSiteExpression({
  site,
  objectName,
  expression,
  severity,
  field,
  triggerKind,
  sweepObject,
  startCondition,
  objects,
}: AuthoredSiteExpression): ExprIssue[] {
  const authored = objects.map((o) => stripInjectedSystemColumns(o));
  const served = authored.find((o) => o?.name === objectName);
  if (!served) return [];
  const others = authored.filter((o) => o !== served && o?.name !== objectName);
  const { validations: _servedRules, ...body } = served;
  const fieldName = field ?? AUTHORED_FORMULA_FIELD_NAME;
  // The stack the gate would judge, the write type of the door that judges
  // it, and which of its findings are on the judged slot.
  let stack: AnyRec;
  let runtimeWriteType: 'object' | 'flow';
  let onSlot: (issue: ExprIssue) => boolean;
  if (site === 'flow_condition') {
    // [#33147] A flow write at the runtime publish gate: the walk judges the
    // flow against the objects beside it, the subject among them, whose own
    // rules are not what is judged here (left out, as at a validation site).
    stack = {
      objects: [body, ...others],
      flows: [authoredFlowProbe({ objectName, expression, triggerKind, sweepObject, startCondition })],
    };
    runtimeWriteType = 'flow';
    // Every finding on the probe's one edge carries that edge's key path.
    onSlot = (issue) => issue.path === AUTHORED_CONDITION_PATH;
  } else if (site === 'validation') {
    const subject = {
      ...body,
      validations: [{
        name: AUTHORED_RULE_NAME,
        type: 'script',
        condition: expression,
        message: AUTHORED_RULE_NAME,
        ...(severity ? { severity } : {}),
      }],
    };
    stack = { objects: [subject, ...others] };
    runtimeWriteType = 'object';
    // Every finding of the validation-rule pass carries the judged slot's key path.
    onSlot = (issue) => issue.path?.startsWith('objects[0].validations[0].') === true;
  } else {
    const subject = { ...body, fields: withAuthoredFormulaField(body.fields, fieldName, expression) };
    stack = { objects: [subject, ...others] };
    runtimeWriteType = 'object';
    // The field-formula pass (and the formula-cycle pass after it) locate
    // their findings on the field's key.
    const formulaWhere = `object '${objectName}' · field '${fieldName}' expression`;
    onSlot = (issue) => issue.where === formulaWhere;
  }
  return runStackExpressionPasses(stack, { runtimeWriteType, sharedValidatorRunByCaller: true }).filter(onSlot);
}

/**
 * The served `fields`, in the shape they came in, with the judged field in
 * place: [#33147] a field the body declares under `name` keeps its definition
 * with `expression` written over it; any other name is added as a `formula`.
 */
function withAuthoredFormulaField(fields: unknown, name: string, expression: string): unknown {
  const added = { type: 'formula', label: name, expression };
  if (Array.isArray(fields)) {
    const at = fields.findIndex((f) => isRecord(f) && f.name === name);
    if (at < 0) return [...fields, { name, ...added }];
    return fields.map((f, i) => (i === at ? { ...(f as AnyRec), expression } : f));
  }
  const map = isRecord(fields) ? fields : {};
  const declared = Object.prototype.hasOwnProperty.call(map, name) && isRecord(map[name]) ? map[name] : undefined;
  return { ...map, [name]: declared ? { ...declared, expression } : added };
}

function isRecord(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
