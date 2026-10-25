// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useFlowScope — React adapter over the pure {@link resolveFlowScope} graph-walk
 * that powers the inspector's variable data-picker (#1934).
 *
 * It resolves the graph-aware refs synchronously, then lazily fetches the
 * trigger object's field catalog (via the shared metadata client) and merges
 * the expanded `record.<field>` refs in — grouping everything into the ordered
 * sections the picker renders. An empty result (`isEmpty`) tells the field to
 * degrade to a plain input.
 */

import * as React from 'react';
import {
  edgeSourceOutputRefs,
  resolveFlowScope,
  triggerFieldRefs,
  type ScopeGroupId,
  type ScopeRef,
  type TriggerScope,
} from './flow-scope.js';
import { useObjectFields } from '../previews/useObjectFields.js';
import { t, useMetadataLocale } from '../i18n.js';

export interface ScopeGroup {
  id: ScopeGroupId;
  label: string;
  refs: ScopeRef[];
}

export interface UseFlowScopeResult {
  /** Non-empty groups, in display order. */
  groups: ScopeGroup[];
  /** Flat, de-duplicated ref list (all groups). */
  refs: ScopeRef[];
  /**
   * objectstack-ai/objectstack#3447: the picker groups for an approval node's `expression` APPROVER,
   * whose closed root set differs from a flow condition's — `current.<field>`
   * (live record at node entry), `trigger.<field>` (submit-time snapshot) and
   * `vars.*` (flow variables / upstream outputs, prefix-mapped). `record.*`
   * and bare fields are deliberately absent: inserting them would author
   * exactly the spelling the runtime rejects.
   */
  approvalExpressionGroups: ScopeGroup[];
  /**
   * The trigger record's DECLARED subject vocabulary at this node, when one is
   * in scope — `{ objectName, fieldPrefix, includePrevious }`, straight from
   * {@link resolveFlowScope} (objectui#6226).
   *
   * Re-exported rather than re-derived: the `refs` above have already been
   * flattened and merged with variables / upstream outputs, so a consumer that
   * needs the *shape* of the record vocabulary (the condition builder's
   * subjects) would otherwise have to reverse-engineer the prefix back out of
   * the tokens. Absent on a schedule / manual / webhook trigger, which binds no
   * record — and absence is the signal that no vocabulary may be assumed.
   */
  trigger?: TriggerScope;
  /** True while the trigger object's fields are still loading. */
  loading: boolean;
  /** No references in scope — the field should render as a plain input. */
  isEmpty: boolean;
}

// The REGULAR picker's sections — the approval_* group ids (objectstack-ai/objectstack#3447) never
// appear here; they ride the separately-emitted approvalExpressionGroups.
// Each heading is a catalogue key, resolved in the designer locale
// (objectui#10748).
const GROUP_ORDER = ['variables', 'outputs', 'loop', 'trigger'] as const;
const GROUP_LABEL_KEYS: Record<(typeof GROUP_ORDER)[number], string> = {
  variables: 'engine.flowScope.group.variables',
  outputs: 'engine.flowScope.group.outputs',
  loop: 'engine.flowScope.group.loop',
  trigger: 'engine.flowScope.group.trigger',
};

/**
 * Resolve + (async) expand the in-scope references at a flow node. `draft` is
 * the whole flow draft; `nodeId` the node being edited. An EDGE is not a node:
 * its guard also sees its source node's own outputs, so an edge goes through
 * {@link useEdgeScope}, never through this hook with its source id
 * (objectui#11085).
 *
 * `extraRefs` are merged in before de-dup / grouping — used for a NESTED node,
 * whose scope anchor is its container (ADR-0031 outer scope): the container's
 * own outputs are excluded from the graph walk at its id, so a loop's
 * `iteratorVariable` must be injected explicitly for a body node to see it. Pass
 * a memoized array (a fresh one every render would thrash the memo).
 *
 * `connectors` is the runtime connector registry the calling inspector already
 * reads (`useConnectorRegistry`, gated on `hasCommittedConnectorAction`), so an
 * upstream `connector_action` node offers its action's declared output keys
 * (objectui#11028). Omitted, such a node offers none.
 */
export function useFlowScope(
  draft: Record<string, unknown> | undefined,
  nodeId: string | undefined,
  extraRefs?: ReadonlyArray<ScopeRef>,
  connectors?: unknown,
): UseFlowScopeResult {
  // The picker's headings and details, in the designer locale — read here, as
  // `VariableTextInput` (which renders them) reads it (objectui#10748).
  const locale = useMetadataLocale();
  const scope = React.useMemo(
    () => resolveFlowScope(draft ?? {}, nodeId, locale, connectors),
    [draft, nodeId, locale, connectors],
  );
  const { fields, loading } = useObjectFields(scope.trigger?.objectName);

  return React.useMemo(() => {
    const all: ScopeRef[] = [...scope.refs];
    if (extraRefs && extraRefs.length) all.push(...extraRefs);
    if (scope.trigger) all.push(...triggerFieldRefs(scope.trigger, fields, locale));
    // Global de-dup by token (a declared var also written upstream shows once).
    const seen = new Set<string>();
    const refs = all.filter((r) => (seen.has(r.token) ? false : (seen.add(r.token), true)));
    const groups = GROUP_ORDER.map((id) => ({
      id,
      label: t(GROUP_LABEL_KEYS[id], locale),
      refs: refs.filter((r) => r.group === id),
    })).filter((g) => g.refs.length > 0);

    // objectstack-ai/objectstack#3447: approval-expression picker groups, built from the same materials.
    // Trigger-object fields expand under BOTH times (current/trigger); the
    // graph-walk refs (variables / upstream outputs / loop items) re-home
    // under the `vars.` prefix. Trigger-group refs (record.<f>, previous.<f>,
    // bare fields) are excluded — those spellings are not bound there.
    const approvalCurrent: ScopeRef[] = [];
    const approvalTrigger: ScopeRef[] = [];
    for (const f of fields) {
      if (!f?.name) continue;
      const detail = f.label && f.label !== f.name ? f.label : f.type;
      approvalCurrent.push({ token: `current.${f.name}`, label: `current.${f.name}`, detail, group: 'approval_current' });
      approvalTrigger.push({ token: `trigger.${f.name}`, label: `trigger.${f.name}`, detail, group: 'approval_trigger' });
    }
    const approvalVars: ScopeRef[] = refs
      .filter((r) => r.group === 'variables' || r.group === 'outputs' || r.group === 'loop')
      .map((r) => ({ ...r, token: `vars.${r.token}`, label: `vars.${r.token}`, group: 'approval_vars' as const }));
    // `vars.previous` (the pre-update row) is always addressable — listing it
    // both teaches the spelling and keeps the `vars` root in the known set so
    // FlowExprIssue never flags a legitimate vars.* reference on a flow with
    // no declared variables or upstream outputs.
    approvalVars.push({
      token: 'vars.previous', label: 'vars.previous',
      detail: t('engine.flowScope.detail.preUpdateRow', locale), group: 'approval_vars',
    });
    const approvalExpressionGroups: ScopeGroup[] = [
      { id: 'approval_current' as const, label: t('engine.flowScope.group.approvalCurrent', locale), refs: approvalCurrent },
      { id: 'approval_trigger' as const, label: t('engine.flowScope.group.approvalTrigger', locale), refs: approvalTrigger },
      { id: 'approval_vars' as const, label: t('engine.flowScope.group.variables', locale), refs: approvalVars },
    ].filter((g) => g.refs.length > 0);

    return {
      groups,
      refs,
      approvalExpressionGroups,
      trigger: scope.trigger,
      loading: !!scope.trigger && loading,
      isEmpty: refs.length === 0,
    };
  }, [scope, fields, loading, extraRefs, locale]);
}

/**
 * The edge twin of {@link useFlowScope}: the references in scope on an edge's
 * guard — the scope at its SOURCE node plus that source's own outputs, the
 * engine having written them before it evaluates the out-edge
 * (objectui#11085). Which own outputs count is {@link edgeSourceOutputRefs},
 * the rule the Problems panel's edge scan (`resolveEdgeScope`) reads too.
 *
 * `edge` may be missing (a stale selection): the result is then the flow
 * variables alone, as for an unset node id.
 */
export function useEdgeScope(
  draft: Record<string, unknown> | undefined,
  edge: { source?: unknown; type?: unknown } | null | undefined,
  connectors?: unknown,
): UseFlowScopeResult {
  const source = typeof edge?.source === 'string' && edge.source ? edge.source : undefined;
  const edgeType = edge?.type;
  const ownRefs = React.useMemo(
    () => edgeSourceOutputRefs(draft ?? {}, { source, type: edgeType }, connectors),
    [draft, source, edgeType, connectors],
  );
  return useFlowScope(draft, source, ownRefs, connectors);
}
