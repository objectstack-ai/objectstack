// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32872] The publish gate's verdict on ONE authored expression, at the two
 * sites the gate judges with passes of its own beyond the shared validator: a
 * validation rule's `condition` and a formula field's `expression`.
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
 */

import { analyzeRelationshipTraversals } from '@objectstack/formula';
import { stripInjectedSystemColumns } from '@objectstack/metadata-core';
import { referenceTargetOf } from '@objectstack/spec/data';

import { recordsOf } from './object-graph.js';
import { runStackExpressionPasses, type ExprIssue } from './validate-expressions.js';

type AnyRec = Record<string, unknown>;

/** The two sites the gate judges with passes of its own, as `validate_expression` names them. */
export type AuthoredExpressionSite = 'validation' | 'formula';

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
 * The name the judged formula field carries. No sentence of the formula
 * site names it; it is spelled so that no authored field can be it.
 */
export const AUTHORED_FORMULA_FIELD_NAME = '__validate_expression__';

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
 * The gate's findings on the one rule or formula field described, beyond the
 * shared validator's: each the gate's own pass, in the gate's words, at the
 * gate's severity. Empty when `objects` carries no definition of
 * `objectName`.
 */
export function judgeAuthoredSiteExpression({
  site,
  objectName,
  expression,
  severity,
  objects,
}: AuthoredSiteExpression): ExprIssue[] {
  const authored = objects.map((o) => stripInjectedSystemColumns(o));
  const served = authored.find((o) => o?.name === objectName);
  if (!served) return [];
  const others = authored.filter((o) => o !== served && o?.name !== objectName);
  const { validations: _servedRules, ...body } = served;
  const subject = site === 'validation'
    ? {
        ...body,
        validations: [{
          name: AUTHORED_RULE_NAME,
          type: 'script',
          condition: expression,
          message: AUTHORED_RULE_NAME,
          ...(severity ? { severity } : {}),
        }],
      }
    : { ...body, fields: withAuthoredFormulaField(body.fields, expression) };
  const issues = runStackExpressionPasses(
    { objects: [subject, ...others] },
    { runtimeWriteType: 'object', sharedValidatorRunByCaller: true },
  );
  // Every finding of the validation-rule pass carries the judged slot's key
  // path; the field-formula pass locates its findings on the field's key.
  const rulePath = 'objects[0].validations[0].';
  const formulaWhere = `object '${objectName}' · field '${AUTHORED_FORMULA_FIELD_NAME}' expression`;
  return issues.filter((issue) =>
    site === 'validation' ? issue.path?.startsWith(rulePath) === true : issue.where === formulaWhere,
  );
}

/** The served `fields`, in the shape they came in, with the judged formula field added. */
function withAuthoredFormulaField(fields: unknown, expression: string): unknown {
  const field = { type: 'formula', label: AUTHORED_FORMULA_FIELD_NAME, expression };
  if (Array.isArray(fields)) return [...fields, { name: AUTHORED_FORMULA_FIELD_NAME, ...field }];
  return { ...(fields && typeof fields === 'object' ? fields : {}), [AUTHORED_FORMULA_FIELD_NAME]: field };
}
