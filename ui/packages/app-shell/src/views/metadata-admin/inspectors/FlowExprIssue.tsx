// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowExprIssue — the shared inline validation line for an expression / template
 * value in the flow inspector (#1934). Renders, in precedence order:
 *   1. an ADR-0032 brace/shape ERROR (red) — the CEL brace trap on a CEL cell,
 *      a single brace on a `{{ }}` text-slot cell;
 *   2. else a scope-aware "unknown reference" WARNING (amber) — a referenced
 *      root not in scope at the node, with a "did you mean?" hint.
 * Returns null when the value is clean (or scope is unknown). Used by the picker
 * repeater cells (decision Branches, key/value values, approval expression
 * approvers, a screen field's visibleWhen) that carry the picker but otherwise
 * had no inline validation.
 *
 * Which scope step 2 reads depends on the cell. Every cell passes the
 * `scopeGroups` its picker offers — the flow scope at the node, or the approval
 * roots on an approver — except one: a `screen` node's `fields[].visibleWhen`
 * binds the same screen's declared fields plus `record`, never the flow scope
 * (spec `ScreenFieldSpec.visibleWhen`; ruling C on objectui#10743). That cell
 * passes `screenNode`, and step 2 is then `screenVisibleWhenScopeError` — the
 * rule the Problems panel and the Debug run's screen step judge the column by,
 * over `screenPredicateRoots` (objectui#10772). A sibling-field predicate
 * (`discount > 0`) is clean there, and a run variable (`needsApproval == true`)
 * is the unknown reference, in the panel's words.
 */

import * as React from 'react';
import { validateExpressionClient, type ExprFieldRole } from './expression-validate.js';
import { useMetadataLocale } from '../i18n.js';
import { findUnknownRefs, scopeRoots, describeUnknownRefs } from './flow-ref-check.js';
import type { ScopeGroup } from './useFlowScope.js';
import { screenVisibleWhenScopeError, type ScreenPreviewNode } from '../previews/screen-spec.js';

/** The positions this line judges. */
export type FlowExprIssueRole = Exclude<ExprFieldRole, 'template'> | 'hole';

export interface FlowExprIssueProps {
  value: unknown;
  /**
   * `'predicate'` / `'value'` → CEL (brace-checked); `'hole'` → a flow text
   * slot's ADR-0032 §3 `{{ }}` holes, where a single brace is flagged with the
   * double-brace fix (objectui#12101, the check `FlowNodeConfigField` runs on a
   * single text slot since objectui#11824). No single-brace role: no flow
   * string reads that dialect since spec 18 (objectui#12329).
   */
  role: FlowExprIssueRole;
  scopeGroups?: ScopeGroup[];
  /**
   * Set only on a `screen` node's `fields[].visibleWhen` cell: the node whose
   * declared fields the predicate binds. The unknown-reference check is then
   * `screenVisibleWhenScopeError(value, screenNode)` and `scopeGroups` is not
   * read (objectui#10772).
   */
  screenNode?: ScreenPreviewNode;
}

/**
 * The flow-scope reading: the roots the picker's groups offer, named in the
 * designer `locale`, as the siblings `FlowEdgeInspector` and
 * `FlowNodeConfigField` name them (objectui#10804).
 */
function flowScopeNote(
  value: unknown,
  role: FlowExprIssueRole,
  scopeGroups: ScopeGroup[] | undefined,
  locale: string,
): string | undefined {
  const roots = scopeGroups && scopeGroups.length > 0 ? scopeRoots(scopeGroups.flatMap((g) => g.refs)) : null;
  const unknown = roots ? findUnknownRefs(value, role, roots) : [];
  return unknown.length > 0 ? describeUnknownRefs(unknown, locale) : undefined;
}

export function FlowExprIssue({ value, role, scopeGroups, screenNode }: FlowExprIssueProps): React.ReactElement | null {
  // Brace / shape error: a CEL role's brace trap, or a hole's single brace.
  // In the designer locale, read here as the sibling `FlowObjectListField` does (objectui#10748).
  const locale = useMetadataLocale();
  const issue = validateExpressionClient(role === 'hole' ? 'template' : role, value, locale);
  if (issue) {
    return (
      <p className="text-[11px] leading-snug text-destructive" role="alert">
        {issue.message}
      </p>
    );
  }
  const note = screenNode
    ? screenVisibleWhenScopeError(value, screenNode, locale)
    : flowScopeNote(value, role, scopeGroups, locale);
  return note ? (
    <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400" role="note">
      {note}
    </p>
  ) : null;
}
