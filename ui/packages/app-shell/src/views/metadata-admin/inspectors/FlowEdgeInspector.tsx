// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowEdgeInspector — scoped editor for the selected flow connection (edge).
 *
 * Selection shape:  { kind: 'edge', id: <edgeKey> }
 * Patches:           draft.edges[i] = {...edge, ...updates}
 *
 * An edge carries the flow's routing semantics between two nodes: an optional
 * branch `label` (e.g. an Approval node's `approve` / `reject` out-edge, a
 * Decision branch name), a guard `condition` (a CEL expression the engine
 * evaluates to pick the branch), and an `isDefault` flag marking the fallback
 * ("else") branch.
 *
 * From / To re-point the connection to another node of the flow, through the
 * same patch (objectui#11905); the edge keeps its routing as written. The
 * canvas draws a NEW connection between two nodes the flow already has, by a
 * drag from a node's connect handle (`FlowCanvas`). Both doors refuse the same
 * connections through one rule, `edgeConnectionRefusal` (`flow-problems`): a
 * node to itself, a pair another edge already joins, a node the flow does not
 * have. A refusal writes nothing and says why under To. An endpoint naming a
 * node the flow does not have shows flagged in its picker, where picking a
 * real node repairs the edge.
 *
 * An edge without an `id` is selected by a key built from its endpoints
 * (`edgeKey`), so a re-pointed one is re-selected under its new key; every
 * re-point re-selects, so the panel's title names the new endpoints.
 */

import * as React from 'react';
import type { MetadataInspectorProps } from '../inspector-registry.js';
import { t, tFormat } from '../i18n.js';
import {
  InspectorShell,
  InspectorTextField,
  InspectorSelectField,
  InspectorCheckboxField,
  InspectorRemoveButton,
  InspectorEmptyState,
  spliceArray,
} from './_shared.js';
import { Label } from '@object-ui/components';
import { edgeKey, conditionText } from '../previews/flow-canvas-layout.js';
import { validateExpressionClient } from './expression-validate.js';
import { useEdgeScope } from './useFlowScope.js';
import { hasCommittedConnectorAction } from './flow-scope.js';
import { useConnectorRegistry } from './connector-input-fields.js';
import { VariableTextInput } from './VariableTextInput.js';
import { findUnknownRefs, scopeRoots, describeUnknownRefs } from './flow-ref-check.js';
import { writeExpressionSource } from './expression-envelope.js';
import { describeEdgeConnectionRefusal, edgeConnectionRefusal } from '../previews/flow-problems.js';
import { flowEdgeDisplayName } from '../previews/flow-canvas-parts.js';
// objectui#7265 — the selected edge as this panel reads it out of the draft.
// This file used to declare its own `interface FlowEdge`, a THIRD hand copy of
// the designer dialect below: `FlowNodeInspector` and `FlowPreview` already
// take the same shape from `flow-canvas-layout`, and that module is where the
// divergence from `@objectstack/spec/automation`'s `FlowEdge` is reasoned and
// written down (`id` absent while an edge is being drawn; `type` left `string`
// so the canvas round-trips whatever an authored flow carries). The copy here
// restated the divergence without the reasoning and under the SPEC's name,
// which is the mirror rule 1 flags. `FlowDesignerEdge` is the package's
// declared dialect for it and already carries the rename ratchet in
// `spec-symbol-parity.test.ts`, so this panel uses that name outright rather
// than aliasing the spec's over it.
import type { FlowDesignerEdge } from '../previews/flow-canvas-layout.js';

export function FlowEdgeInspector({
  selection,
  draft,
  onPatch,
  onClearSelection,
  onSelectionChange,
  locale,
  readOnly,
}: MetadataInspectorProps) {
  const edges = Array.isArray((draft as any).edges) ? ((draft as any).edges as FlowDesignerEdge[]) : [];
  const index = edges.findIndex((e, i) => edgeKey(e, i) === selection.id);
  const edge = index >= 0 ? edges[index] : null;
  // objectui#11905 — the reason the last From / To pick was refused, kept for
  // the edge it was made on: the panel stays mounted when another edge is
  // selected, and that edge has no refusal to show.
  const [endpointRefusal, setEndpointRefusal] = React.useState<{ key: string; text: string } | null>(null);
  // The runtime connector registry, read only when the flow holds a committed
  // `connector_action` node, so the guard's scope offers that action's declared
  // output keys (objectui#11028).
  const connectors = useConnectorRegistry(hasCommittedConnectorAction(draft as Record<string, unknown>));
  // References available on this edge: those in scope at its SOURCE node
  // (#1934) plus the source's own outputs, which the engine has written by the
  // time it evaluates this guard (objectui#11085). Called unconditionally — a
  // missing edge resolves the flow variables alone.
  const { groups: scopeGroups } = useEdgeScope(draft as Record<string, unknown>, edge, connectors);

  if (!edge) {
    return (
      <InspectorShell
        kindLabel={t('engine.inspector.flowEdge.kind', locale)}
        title={selection.label ?? selection.id}
        onClose={onClearSelection}
        closeLabel={t('engine.inspector.flowEdge.close', locale)}
      >
        <InspectorEmptyState message={t('engine.inspector.flowEdge.missing', locale)} />
      </InspectorShell>
    );
  }

  // Splice an updated edge in place. An edit never moves the edge in the
  // array, so the row index is stable; an edge without an explicit `id` keys
  // off `source->target#index`, so only a From / To edit changes its key, and
  // `reconnect` re-selects it under the new one.
  const patchEdge = (updates: Partial<FlowDesignerEdge>) => {
    const next: FlowDesignerEdge = { ...edge, ...updates };
    // Prune empty optional keys so a cleared field doesn't linger in the draft.
    for (const k of ['label', 'condition', 'isDefault'] as const) {
      const v = next[k];
      if (v === undefined || v === '' || v === false) delete next[k];
    }
    // `type` defaults to 'default' (FlowEdgeSchema) — don't persist the noise so
    // a normal edge stays `{ source, target }`; only `back`/`fault`/`conditional`
    // are written.
    if (next.type === 'default' || next.type === '' || next.type === undefined) delete next.type;
    onPatch({ edges: spliceArray(edges, index, next) });
  };

  const isDefault = edge.isDefault === true;

  // Decision out-edges can bind EXPLICITLY to one of the source decision's
  // branches (vs the implicit by-order auto-wire): picking a branch writes its
  // expression / label (or marks the default) onto this edge, so routing stays
  // correct even when edges are connected out of branch order.
  const nodes = Array.isArray((draft as { nodes?: unknown }).nodes)
    ? ((draft as { nodes: Array<Record<string, unknown>> }).nodes)
    : [];
  const sourceNode = nodes.find((n) => n.id === edge.source);

  // objectui#11905 — From / To: every node of the flow, by label and id. A
  // stored endpoint naming no node is drawn flagged by the picker itself.
  const nodeOptions = nodes.flatMap((n) => {
    const id = n?.id;
    if (typeof id !== 'string' || !id) return [];
    const label = typeof n.label === 'string' ? n.label.trim() : '';
    return [{ value: id, label: label && label !== id ? `${label} · ${id}` : id }];
  });
  // Re-point one end through `patchEdge`, unless `edgeConnectionRefusal` (the
  // rule the canvas's connect drag also calls) refuses the pair; then nothing
  // is written and the reason shows under To.
  const reconnect = (end: 'source' | 'target', id: string) => {
    const source = end === 'source' ? id : edge.source;
    const target = end === 'target' ? id : edge.target;
    if (source === edge.source && target === edge.target) return;
    const refusal = edgeConnectionRefusal({ nodes, edges }, source, target, index);
    if (refusal) {
      setEndpointRefusal({ key: selection.id, text: describeEdgeConnectionRefusal(refusal, source, target, locale) });
      return;
    }
    setEndpointRefusal(null);
    patchEdge({ source, target });
    onSelectionChange?.({ kind: 'edge', id: edgeKey({ ...edge, source, target }, index), label: flowEdgeDisplayName({ source, target }, nodes, locale) });
  };
  const branches =
    sourceNode?.type === 'decision' &&
    Array.isArray((sourceNode.config as Record<string, unknown> | undefined)?.conditions)
      ? ((sourceNode.config as { conditions: Array<Record<string, unknown>> }).conditions)
      : [];
  const branchExpr = (b: Record<string, unknown>) => (typeof b.expression === 'string' ? b.expression.trim() : '');
  const branchName = (b: Record<string, unknown>) => (typeof b.label === 'string' ? b.label.trim() : '');
  // Which branch this edge currently represents: the default edge maps to the
  // `true`/empty branch; otherwise match by condition, then by label. '' = custom.
  const selectedBranch = (() => {
    if (!branches.length) return '';
    if (isDefault) {
      const i = branches.findIndex((b) => { const e = branchExpr(b); return e === '' || e === 'true'; });
      return i >= 0 ? String(i) : '';
    }
    const cond = conditionText(edge.condition);
    let i = cond ? branches.findIndex((b) => branchExpr(b) === cond) : -1;
    if (i < 0 && edge.label) i = branches.findIndex((b) => branchName(b) === edge.label);
    return i >= 0 ? String(i) : '';
  })();
  const applyBranch = (key: string) => {
    if (key === '') return; // keep current custom values
    const b = branches[Number(key)];
    if (!b) return;
    const expr = branchExpr(b);
    const lbl = branchName(b) || undefined;
    if (expr === '' || expr === 'true') patchEdge({ isDefault: true, condition: undefined, label: lbl });
    else patchEdge({ isDefault: false, condition: expr, label: lbl });
  };

  // Approval out-edges (ADR-0019/0044) route by branch *label*: the engine
  // resumes down the out-edge whose label matches the decision — `approve` /
  // `reject`, or `revise` (ADR-0044 send-back-for-revision). Offer those as a
  // picker (mirrors APPROVAL_BRANCH_LABELS in @objectstack/spec) so the author
  // need not recall the exact keyword; a free-text label is still allowed.
  const isApprovalSource = sourceNode?.type === 'approval';
  const APPROVAL_BRANCHES: readonly string[] = ['approve', 'reject', 'revise'];
  const currentApprovalBranch = (() => {
    const l = (edge.label ?? '').trim().toLowerCase();
    return APPROVAL_BRANCHES.includes(l) ? l : '';
  })();

  const edgeType = (typeof edge.type === 'string' && edge.type) || 'default';

  return (
    <InspectorShell
      kindLabel={t('engine.inspector.flowEdge.kind', locale)}
      // Read off the edge itself, each end by its node's name (objectui#13143):
      // a selection's label is written once, by whoever selected, and goes
      // stale when an end node is renamed.
      title={flowEdgeDisplayName(edge, nodes, locale)}
      onClose={onClearSelection}
      closeLabel={t('engine.inspector.flowEdge.close', locale)}
      footer={
        <InspectorRemoveButton
          label={t('engine.inspector.flowEdge.remove', locale)}
          onClick={() => {
            onPatch({ edges: spliceArray(edges, index, null) });
            onClearSelection();
          }}
          disabled={readOnly}
        />
      }
    >
      <InspectorSelectField
        label={t('engine.inspector.flowEdge.source', locale)}
        value={edge.source}
        options={nodeOptions}
        onCommit={(v) => reconnect('source', v)}
        disabled={readOnly}
      />
      <InspectorSelectField
        label={t('engine.inspector.flowEdge.target', locale)}
        value={edge.target}
        options={nodeOptions}
        onCommit={(v) => reconnect('target', v)}
        disabled={readOnly}
      />
      {endpointRefusal && endpointRefusal.key === selection.id && (
        <p className="text-[11px] leading-snug text-destructive" role="alert">
          {endpointRefusal.text}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('engine.inspector.flowEdge.routing', locale)}
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

      {branches.length > 0 && (
        <InspectorSelectField
          label={t('engine.inspector.flowEdge.branch', locale)}
          value={selectedBranch}
          options={[
            ...branches.map((b, i) => {
              const expr = branchExpr(b);
              const nm = branchName(b) || tFormat('engine.flowRegion.branchN', locale, { n: i + 1 });
              const suffix = expr === '' || expr === 'true'
                ? ` \u00b7 ${t('engine.inspector.flowEdge.branchDefault', locale)}`
                : ` \u00b7 ${expr}`;
              return { value: String(i), label: `${nm}${suffix}` };
            }),
            { value: '', label: t('engine.inspector.flowEdge.branchCustom', locale) },
          ]}
          onCommit={applyBranch}
          disabled={readOnly}
        />
      )}

      {isApprovalSource && (
        <InspectorSelectField
          label={t('engine.inspector.flowEdge.approvalBranch', locale)}
          value={currentApprovalBranch}
          options={[
            { value: 'approve', label: t('engine.inspector.flowEdge.branchApprove', locale) },
            { value: 'reject', label: t('engine.inspector.flowEdge.branchReject', locale) },
            { value: 'revise', label: t('engine.inspector.flowEdge.branchRevise', locale) },
            { value: '', label: t('engine.inspector.flowEdge.branchCustom', locale) },
          ]}
          // Picking a branch writes the matching label; "Custom" keeps the
          // free-text label the author typed below.
          onCommit={(v) => { if (v) patchEdge({ label: v }); }}
          disabled={readOnly}
        />
      )}

      <InspectorTextField
        label={t('engine.inspector.flowEdge.label', locale)}
        value={edge.label ?? ''}
        onCommit={(v) => patchEdge({ label: v })}
        placeholder={t('engine.inspector.flowEdge.labelHint', locale)}
        disabled={readOnly || isDefault}
      />
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{t('engine.inspector.flowEdge.condition', locale)}</Label>
        {/* #3216 converged the READ on `conditionText`; the write stayed a
            bare string, which the spec's pipe would have re-stamped as
            `dialect: 'cel'` — silently swapping the engine of a `cron` /
            `template` guard and dropping its `ast` / `meta`. Same rule as the
            hook guard now (#3218). */}
        <VariableTextInput
          mode="expression"
          mono
          value={conditionText(edge.condition) ?? ''}
          onValueChange={(v) => patchEdge({ condition: writeExpressionSource(edge.condition, v) })}
          groups={scopeGroups}
          placeholder={t('engine.inspector.flowEdge.conditionHint', locale)}
          disabled={readOnly || isDefault}
        />
      </div>
      {(() => {
        // ADR-0032 — flag a malformed edge guard (e.g. `{record.x}` brace-in-CEL)
        // inline, with the same corrective message as build/agent validation.
        const issue = isDefault ? null : validateExpressionClient('predicate', edge.condition, locale);
        if (issue) {
          return (
            <p className="text-[11px] leading-snug text-destructive" role="alert">
              {issue.message}
            </p>
          );
        }
        // #1934 — gentle scope-aware "unknown reference" warning (the edge's
        // scope, above), once the guard is structurally valid.
        const unknown = isDefault
          ? []
          : findUnknownRefs(conditionText(edge.condition), 'predicate', scopeRoots(scopeGroups.flatMap((g) => g.refs)));
        return unknown.length > 0 ? (
          <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400" role="note">
            {describeUnknownRefs(unknown, locale)}
          </p>
        ) : null;
      })()}
      <InspectorCheckboxField
        label={t('engine.inspector.flowEdge.isDefault', locale)}
        value={isDefault}
        // The default ("else") branch is taken when no other guard matches, so
        // it carries neither a condition nor a branch label — clear both.
        onCommit={(v) => patchEdge(v ? { isDefault: true, condition: undefined, label: undefined } : { isDefault: false })}
        disabled={readOnly}
      />
      <p className="text-[11px] leading-snug text-muted-foreground">
        {t('engine.inspector.flowEdge.hint', locale)}
      </p>

      <div className="flex items-center gap-2 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('engine.inspector.flowEdge.connection', locale)}
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>
      <InspectorSelectField
        label={t('engine.inspector.flowEdge.type', locale)}
        value={edgeType}
        options={[
          { value: 'default', label: t('engine.inspector.flowEdge.typeDefault', locale) },
          { value: 'conditional', label: t('engine.inspector.flowEdge.typeConditional', locale) },
          { value: 'fault', label: t('engine.inspector.flowEdge.typeFault', locale) },
          { value: 'back', label: t('engine.inspector.flowEdge.typeBack', locale) },
        ]}
        onCommit={(v) => patchEdge({ type: v })}
        disabled={readOnly}
      />
      {edge.type === 'back' && (
        <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400" role="note">
          {t('engine.inspector.flowEdge.backHint', locale)}
        </p>
      )}
    </InspectorShell>
  );
}
