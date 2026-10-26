// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowNodeInspector — scoped editor for the selected flow node.
 *
 * Selection shape:  { kind: 'node', id: <nodeId> }         — a top-level node
 *                   { kind: 'nested-node', id: <path> }    — a node inside a
 *                     container region (loop/parallel/try_catch, #2670)
 * Patches:          via `locateFlowNode(...).write` — top-level nodes splice
 *                   `draft.nodes[i]`; nested nodes rebuild the container's
 *                   `config.<region>.nodes[i]` with explicit spreads.
 *
 * Both share the SAME schema-driven form. Beyond id / label / type, each node
 * type exposes a set of typed form fields (see
 * `flow-node-config`, or the engine-published configSchema) that edit scalar
 * keys on `node.config`; remaining keys go to an "Advanced (JSON)" block so
 * authors are never locked out. A nested node is edit-only this phase: its id is
 * read-only, it has no delete, and (for a nested decision) the virtual Target
 * column is dropped — region-internal routing is not managed here.
 */

import * as React from 'react';
import { Plus } from 'lucide-react';
import { resolveFlowTriggerKind } from '@objectstack/spec/automation';
import { Input, Label } from '@object-ui/components';
import type { MetadataInspectorProps } from '../inspector-registry.js';
import { t, tFormat } from '../i18n.js';
import {
  InspectorShell,
  InspectorTextField,
  InspectorSelectField,
  InspectorRemoveButton,
  InspectorEmptyState,
} from './_shared.js';
import {
  mergeServerFlowFields,
  localizeFlowFields,
  isFieldVisible,
  inactiveRetainedKind,
  unsetTriggerReading,
  getFieldValue,
  readFieldValue,
  switchedBlockOf,
  isBareSwitchedOffBlock,
  configKeyOf,
  isScheduleExpressionPath,
  readOnlyScheduleCadence,
  scheduleWithExpression,
  type FlowConfigField,
  type ScheduleCadence,
} from './flow-node-config.js';
import { declaredConfigKeys, jsonSchemaToFlowFields } from './json-schema-to-fields.js';
import {
  applyConnectorInputForm,
  connectorActionInputSchema,
  connectorInputExtras,
  connectorInputFields,
  mergeConnectorInputExtras,
  useConnectorRegistry,
} from './connector-input-fields.js';
import { applyDecisionBranches, syncDecisionEdgesByOrder, withBranchTargets } from './flow-decision-edges.js';
import { useActionConfigSchemas, useFlowNodePalette } from '../previews/useFlowNodePalette.js';
import { defaultNodeLabel, flowNodeDisplayName, paletteTypeOptions } from '../previews/flow-canvas-parts.js';
import { FlowNodeConfigField } from './FlowNodeConfigField.js';
import { specRequiredColumns, specRequiresField } from './flow-required-keys.js';
import { useFlowScope } from './useFlowScope.js';
import { hasCommittedConnectorAction, nodeOutputRefs, type ScopeRef } from './flow-scope.js';
import { NESTED_NODE_KIND, parseNestedNodeId, locateFlowNode, type InspectorFlowNode } from './flow-nested-selection.js';
import { displayRegionLabel } from '../previews/flow-region-label.js';
import type { FlowDesignerEdge } from '../previews/flow-canvas-layout.js';
import { ScreenPreview } from '../previews/ScreenPreview.js';
import {
  boundaryRefsAfterNodeRename,
  describeNodeRemovalRefusal,
  edgesAfterNodeRemoval,
  edgesAfterNodeRename,
  nodeRemovalRefusal,
  nodeRenameRefusal,
} from '../previews/flow-problems.js';
import { describeExprSite, expressionRefsAfterNodeRename, type ExprRenameRefusal } from '../previews/flow-node-refs.js';

/**
 * The node and edge shapes this panel edits — ALIASED, never restated
 * (objectui#6287).
 *
 * Both used to be hand-written copies here, and both had already drifted from
 * the declarations they duplicate:
 *
 * - the node copy declared `description?: string`, a key `FlowNodeSchema`
 *   refuses by name (`.strict()`, objectstack#4001) — and the copy was not even
 *   the type the panel reads through, since `locateFlowNode` returns
 *   `InspectorFlowNode`. Narrowing the copy alone would have changed nothing.
 * - the edge copy still spelled `condition?: unknown`, months after
 *   `FlowEdgeInspector`'s twin was narrowed to the spec's `ExpressionInput`
 *   because the loose spelling described an envelope the server rejects — the
 *   over-wide read type that got objectui#3171 filed against a defect that does
 *   not reproduce (objectui#3202).
 *
 * `FlowPreview.tsx` made exactly this move for its own pair, and its comment is
 * about this one: "two copies of one shape is how the wrong one survives being
 * fixed". Aliasing costs nothing at runtime — both imports are `import type`,
 * erased at compile time, and `flow-canvas-layout` is dependency-free by design.
 * `flow-designer-edge.types.test.ts` already pins the edge condition against the
 * spec, so this panel now inherits that pin instead of needing its own copy of
 * it.
 */
type FlowNode = InspectorFlowNode;
type FlowEdge = FlowDesignerEdge;

/**
 * Node keys the spec's `.strict()` `FlowNodeSchema` refuses, stripped on write
 * so a stored flow HEALS on the author's first edit.
 *
 * This is the same migrate-on-write boundary `withCanonicalGeometry` gives the
 * retired `ui` geometry, for the same reason it gives it: a node carrying such
 * a key is unsavable rather than untidy — `unrecognized_keys` in the live
 * client validation, a 422 on save. `description` reached stored flows through
 * this panel's own Description field (removed in objectui#6287), and with that
 * field gone there would otherwise be no way left to clear it by hand.
 *
 * Deliberately a NAMED list rather than "everything the spec does not list":
 * the index signature on the node type is load-bearing — the canvas
 * round-trips node properties this layer does not understand, and a blanket
 * strip would be exactly the data loss that type exists to prevent.
 */
const SPEC_REFUSED_NODE_KEYS = ['description'] as const;

function withoutSpecRefusedKeys(node: Record<string, unknown>): Record<string, unknown> {
  if (!SPEC_REFUSED_NODE_KEYS.some((k) => k in node)) return node;
  const next = { ...node };
  for (const k of SPEC_REFUSED_NODE_KEYS) delete next[k];
  return next;
}

/**
 * The decision Branches editor field: the `config.conditions` list whose
 * columns include the virtual `target` column (#1942). For it, the value shown
 * is augmented with per-branch targets derived from the out-edges, and a
 * commit reconciles the chosen targets back onto the edges — see
 * `flow-decision-edges` for the full semantics.
 */
function isBranchTargetField(field: FlowConfigField): boolean {
  return (
    field.kind === 'objectList' &&
    configKeyOf(field) === 'conditions' &&
    (field.columns ?? []).some((c) => c.key === 'target')
  );
}

function asConfig(node: FlowNode | null): Record<string, unknown> {
  const c = node?.config;
  return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
}

/**
 * Immutably set `value` at `path` on a plain object, pruning any intermediate
 * object that becomes empty (so e.g. clearing the last `waitEventConfig` key
 * removes the whole block). Empty string / null / undefined deletes the leaf.
 */
function setAtPath(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path;
  const next: Record<string, unknown> = { ...obj };
  if (rest.length === 0) {
    if (value === undefined || value === null || value === '') delete next[head];
    else next[head] = value;
  } else {
    const cur = next[head];
    const base = cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur as Record<string, unknown>) : {};
    const child = setAtPath(base, rest, value);
    if (Object.keys(child).length === 0) delete next[head];
    else next[head] = child;
  }
  return next;
}

/**
 * An interval or once cadence as the read-only Cron schedule field shows it
 * (objectui#12779): an interval in the largest whole unit it divides into.
 */
function describeCadence(cadence: Exclude<ScheduleCadence, { type: 'cron' }>, locale: string | undefined): string {
  if (cadence.type === 'once') return tFormat('engine.inspector.flowNode.cadenceOnce', locale, { at: cadence.at });
  const ms = cadence.intervalMs;
  const units: ReadonlyArray<[number, string]> = [
    [86_400_000, 'engine.inspector.flowNode.cadenceEveryDays'],
    [3_600_000, 'engine.inspector.flowNode.cadenceEveryHours'],
    [60_000, 'engine.inspector.flowNode.cadenceEveryMinutes'],
    [1_000, 'engine.inspector.flowNode.cadenceEverySeconds'],
  ];
  for (const [size, key] of units) {
    if (ms % size === 0) return tFormat(key, locale, { n: ms / size });
  }
  return tFormat('engine.inspector.flowNode.cadenceEveryMs', locale, { n: ms });
}

/**
 * The node's ID field (objectui#11827). Unlike the panel's other text fields it
 * holds what the author types as a DRAFT and commits only a finished id — on
 * blur or Enter — because an id is not a value like a label: it is the handle
 * every edge names. Committed per keystroke, each intermediate spelling was a
 * rename of its own, and the first one already left the inspector's selection
 * naming an id that no longer existed.
 *
 * `refusalOf` judges the finished id; a refused id is never handed to
 * `onRename`, the field shows the stored id again, and the reason stays under
 * it until the author edits again. Escape puts the stored id back. An Enter that
 * ends an IME composition is the composition's, not a commit.
 *
 * Local to this panel on purpose: the shared `InspectorTextField` commits on
 * every change, which is right for every field but this one.
 */
function FlowNodeIdField({
  label,
  id,
  disabled,
  refusalOf,
  onRename,
}: {
  label: string;
  /** The node's stored id. */
  id: string;
  disabled?: boolean;
  /** Why `next` may not be the node's id, as the text to show — or null when it may. */
  refusalOf: (next: string) => string | null;
  onRename: (next: string) => void;
}) {
  const inputId = React.useId();
  const refusalId = `${inputId}-refusal`;
  const [text, setText] = React.useState(id);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  // The stored id moved under the field — the rename landed, or another node
  // was selected — so the field shows it and drops any earlier refusal. Adjusted
  // while rendering (React's documented pattern for state that follows a prop):
  // no effect, and no remount, so the input keeps focus after an Enter.
  const [shownId, setShownId] = React.useState(id);
  if (shownId !== id) {
    setShownId(id);
    setText(id);
    setRefusal(null);
  }

  const commit = () => {
    if (text === id) return;
    const refused = refusalOf(text);
    if (refused) {
      setRefusal(refused);
      setText(id);
      return;
    }
    onRename(text);
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">{label}</Label>
      <Input
        id={inputId}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setRefusal(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setText(id);
            setRefusal(null);
          }
        }}
        disabled={disabled}
        aria-invalid={refusal ? true : undefined}
        aria-describedby={refusal ? refusalId : undefined}
        className="h-8 font-mono text-sm"
      />
      {refusal && (
        <p id={refusalId} className="text-[11px] leading-snug text-destructive" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}

export function FlowNodeInspector({ selection, draft, onPatch, onClearSelection, onSelectionChange, locale, readOnly }: MetadataInspectorProps) {
  // Resolve the selection to a node + how to write it back — a top-level draft
  // node, or a node nested inside a container region (#2670). Every edit goes
  // through loc.write, so the inspector never branches on where the node lives.
  // Memoized on (draft, selection) so its `write` closure and identity stay
  // stable between edits (keeps the nested-scope memo below from thrashing).
  const loc = React.useMemo(
    () => locateFlowNode(draft as Record<string, unknown>, selection),
    [draft, selection],
  );
  const node = loc?.node ?? null;

  // Server-driven property form: when the running engine publishes a config
  // JSON Schema for this node type (ADR-0018 §configSchema — e.g. the ADR-0019
  // approval node), derive the form from it so the designer stays in lock-step
  // with the backend. Falls back to the hardcoded field group when no schema is
  // published (offline / plugin absent / older backend).
  const configSchemas = useActionConfigSchemas();
  // objectui#11778 — the Node Type select offers the add-node palette's types
  // with its display names: the list the canvas adds from, engine-merged.
  const paletteItems = useFlowNodePalette();
  // A nested node anchors its scope on the container (ADR-0031 outer scope). The
  // container's own outputs — a loop's iteratorVariable — are excluded from the
  // graph walk at its id, so inject the loop group explicitly for a body node.
  const nestedLoopRefs = React.useMemo<ScopeRef[]>(
    () => (loc?.nested && loc.container ? nodeOutputRefs(loc.container).filter((r) => r.group === 'loop') : []),
    [loc],
  );
  // #4305 — a COMMITTED connector action (connector + action both chosen) types
  // its Input section from that action's descriptor `inputSchema`. Read the
  // committed pair and the stored input map off the node's spec-structured
  // `connectorConfig` block: both are needed before any registry fetch, and the
  // stored map decides whether a closed schema still needs the repeater.
  const { connectorId, actionId, storedInput } = React.useMemo<{
    connectorId?: string;
    actionId?: string;
    storedInput?: unknown;
  }>(() => {
    const cc = node?.connectorConfig;
    if (!cc || typeof cc !== 'object' || Array.isArray(cc)) return {};
    const block = cc as Record<string, unknown>;
    return {
      connectorId: typeof block.connectorId === 'string' && block.connectorId ? block.connectorId : undefined,
      actionId: typeof block.actionId === 'string' && block.actionId ? block.actionId : undefined,
      storedInput: block.input,
    };
  }, [node]);
  // The same registry read also serves the scope (objectui#11028): an upstream
  // committed `connector_action` node offers its action's declared output keys
  // as references, so the read fires for this node's own committed pair OR for
  // any committed connector action in the flow — one read, two consumers.
  const connectors = useConnectorRegistry(
    (!!connectorId && !!actionId) || hasCommittedConnectorAction(draft as Record<string, unknown>),
  );
  // In-scope variable references for this node, for the data-picker (#1934).
  const { groups: scopeGroups, approvalExpressionGroups, trigger: triggerScope } = useFlowScope(
    draft as Record<string, unknown>,
    loc?.scopeAnchorId,
    nestedLoopRefs,
    connectors,
  );
  const connectorInput = React.useMemo(
    () => connectorInputFields(connectorActionInputSchema(connectors, connectorId, actionId)),
    [connectors, connectorId, actionId],
  );
  // Hoisted so this memo reads only the node's TYPE, never the node object: with
  // `node?.type` inline the compiler infers a dependency on all of `node` while
  // the declared dep is the narrower `node?.type`, and it then declines to
  // memoize the form at all ("existing memoization could not be preserved").
  const nodeType = node?.type;
  const fields = React.useMemo(() => {
    const schema = nodeType ? configSchemas[nodeType] : undefined;
    const serverFields = schema !== undefined ? jsonSchemaToFlowFields(schema) : null;
    // A published configSchema describes `node.config` ONLY, so it replaces just
    // the config-rooted fields — the spec-structured sibling blocks
    // (connectorConfig / waitEventConfig / boundaryConfig) and top-level
    // `timeoutMs` are always kept from the hand-written group (framework#4045).
    // A key it declares but the mapper cannot type keeps its hand-written
    // editor (objectui#11788 — `notify.recipients`).
    const resolved = mergeServerFlowFields(serverFields, nodeType, schema !== undefined ? declaredConfigKeys(schema) : null);
    // Localize both the hardcoded table and the engine-published configSchema
    // fields (they share field ids for built-in nodes); no-op for English.
    const localized = localizeFlowFields(nodeType, resolved, locale);
    // Applied AFTER localization on purpose: the typed input fields are labelled
    // by the DESCRIPTOR (its `title` / `description`) — the connector's own i18n
    // channel — so they must not be overlaid from the client's zh table, while
    // the extras repeater keeps the localized "Input" label it always had.
    return applyConnectorInputForm(localized, connectorInput, storedInput);
  }, [configSchemas, nodeType, locale, connectorInput, storedInput]);
  const config = asConfig(node);
  // objectui#11054 — the flow's trigger kind, asked of the whole draft with the
  // spec's own resolver (the engine's precedence), for fields gated by
  // `flowKind`: an `api` flow is `type: 'api'` OR a start-node
  // `triggerType: 'api'`, and only the draft can answer the first.
  //
  // objectui#12672 — handed only to the start node it is resolved FROM. The
  // resolver reads the first top-level `start` node, and so does the engine's
  // binding, so another start node (the spec's parse admits a second) or one
  // inside a region binds nothing and must not wear the flow's kind. Compared by
  // the draft's own element: `locateFlowNode` hands back `draft.nodes[i]` itself.
  const kindStart = Array.isArray(draft.nodes)
    ? (draft.nodes as unknown[]).find((n) => !!n && typeof n === 'object' && (n as { type?: unknown }).type === 'start')
    : undefined;
  const flowKind = !loc?.nested && node !== null && node === kindStart ? resolveFlowTriggerKind(draft) : undefined;
  const visibleFields = fields.filter((f) => isFieldVisible(f, node, fields, flowKind));
  // objectui#10948 — the fields holding a key the installed spec refuses this
  // node without, so the author sees the requirement before the save-time error
  // names it. Asked of the spec itself for the node as it stands
  // (`flow-required-keys.ts`), never read from a list kept here; recomputed on
  // every edit, so a rule-dependent requirement (`notify`'s `title` while it has
  // no `template`) follows the configuration.
  const requiredness = React.useMemo(() => {
    const out = new Map<string, { required: boolean; columns?: ReadonlySet<string> }>();
    for (const f of fields) {
      out.set(f.id, {
        required: specRequiresField(node, f),
        columns: f.kind === 'objectList' ? specRequiredColumns(node, f) : undefined,
      });
    }
    return out;
  }, [node, fields]);

  // The `{{ }}` hole values for the screen preview — the flow's declared
  // variables and their defaults (the designer has no live run state).
  const screenVars = React.useMemo(() => {
    const decls = Array.isArray((draft as any).variables) ? ((draft as any).variables as Array<Record<string, unknown>>) : [];
    const out: Record<string, unknown> = {};
    for (const v of decls) if (v && typeof v.name === 'string') out[v.name] = v.defaultValue;
    return out;
  }, [draft]);
  // Only fields stored under `config` "own" a config key; spec-structured
  // blocks (waitEventConfig, etc.) and top-level timeoutMs never suppress an
  // Advanced key.
  const ownedConfigKeys = React.useMemo(() => {
    const s = new Set<string>();
    for (const f of fields) {
      const k = configKeyOf(f);
      if (k) s.add(k);
      // A loose-shape fallback rooted at `config` is claimed too, so a tolerated
      // legacy key (e.g. a wait node's `config.eventType`) never leaks to Advanced.
      if (f.fallbackPath && f.fallbackPath.length >= 2 && f.fallbackPath[0] === 'config') s.add(f.fallbackPath[1]);
    }
    return s;
  }, [fields]);

  const extraJson = React.useMemo(() => {
    const extra = Object.fromEntries(Object.entries(config).filter(([k]) => !ownedConfigKeys.has(k)));
    return Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '';
    // Recompute when the node identity changes (patch) or the known keys change.
  }, [node, ownedConfigKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const [advText, setAdvText] = React.useState(extraJson);
  const [advError, setAdvError] = React.useState<string | null>(null);
  const [advOpen, setAdvOpen] = React.useState(extraJson.trim() !== '');
  // Reveals the optional custom-keys editor on nodes that currently have none.
  const [advReveal, setAdvReveal] = React.useState(false);
  // objectui#11838 — the node whose "Remove node" was refused. The message is
  // derived from the draft while that node stays selected, so it names what
  // still blocks the removal and goes away once nothing does. Reset while
  // rendering when another node is shown, as `FlowNodeIdField` resets its own.
  const [removeRefusedId, setRemoveRefusedId] = React.useState<string | null>(null);
  const shownNodeId = node?.id ?? null;
  const [refusalShownFor, setRefusalShownFor] = React.useState(shownNodeId);
  if (refusalShownFor !== shownNodeId) {
    setRefusalShownFor(shownNodeId);
    setRemoveRefusedId(null);
  }
  React.useEffect(() => {
    setAdvText(extraJson);
    setAdvError(null);
    setAdvOpen(extraJson.trim() !== '');
    setAdvReveal(false);
  }, [extraJson]);

  if (!node) {
    // Stale selection (deleted node, or a deep link the draft has moved past).
    // For a nested path, show the node's own id — not the encoded
    // container::region::node string — as the empty-state identity.
    const nestedPath = selection.kind === NESTED_NODE_KIND ? parseNestedNodeId(selection.id) : null;
    const emptyId = nestedPath?.nodeId ?? selection.id;
    return (
      <InspectorShell kindLabel={t('engine.inspector.flowNode.kind', locale)} title={selection.label ?? emptyId} onClose={onClearSelection} closeLabel={t('engine.inspector.flowNode.close', locale)}>
        <InspectorEmptyState message={emptyId} />
      </InspectorShell>
    );
  }

  const patchNode = (updates: Partial<FlowNode>) => {
    const patch = loc?.write(withoutSpecRefusedKeys({ ...node, ...updates }));
    if (patch) onPatch(patch);
  };

  const hasExtras = extraJson.trim() !== '';

  // Screen nodes (and the `user_task` alias) get a live end-user preview.
  const isScreen = node.type === 'screen' || node.type === 'user_task';

  const setField = (field: FlowConfigField, value: unknown) => {
    if (!loc) return;
    const path = field.path;
    let stored = value;
    let nextEdges: FlowEdge[] | undefined;
    // #4305 — the Input repeater standing beside typed fields edits only the
    // undeclared extras, but its commit REPLACES whatever map it was handed. Fold
    // the edit back over the stored map so the typed keys (and the stored key
    // order) survive: without this, one extras edit would wipe every typed input.
    if (field.omitKeys) {
      stored = mergeConnectorInputExtras(
        getFieldValue(node, field),
        (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}),
        field.omitKeys,
      );
    }
    // Decision→edge mirroring is TOP-LEVEL only. A top-level decision drives
    // routing via its out-edges (the engine/simulator read edge.condition, not
    // node.config.conditions), and the Branches editor's Target column (#1942)
    // wires each branch to its downstream node. A NESTED decision routes within
    // its region sub-graph, not on draft.edges — mirroring there would forge
    // phantom top-level edges pointing at nested ids, so it is skipped entirely
    // (the virtual Target column is also stripped from nested fields below).
    if (!loc.nested) {
      const draftEdges = Array.isArray((draft as { edges?: unknown }).edges)
        ? ((draft as { edges: FlowEdge[] }).edges)
        : [];
      // objectui#13138 — the stored branches this commit replaces: what tells a
      // branch's own edge (kept driving through a one-cell edit) apart from a
      // connection no branch has routed (never rewritten, never detached).
      const prior = getFieldValue(node, field);
      if (isBranchTargetField(field)) {
        const applied = applyDecisionBranches(node.id, value, draftEdges, prior);
        stored = applied.conditions.length ? applied.conditions : undefined;
        nextEdges = applied.edges;
      } else if (node.type === 'decision' && path.length === 2 && path[0] === 'config' && path[1] === 'conditions') {
        // A decision branch list without a Target column (engine-published
        // configSchema form) keeps the legacy by-order mirror.
        nextEdges = syncDecisionEdgesByOrder(node.id, value, draftEdges, prior);
      }
    }
    // objectui#11660 — a block whose EXISTENCE is its switch (`switchedBlockOf`:
    // the approval node's SLA escalation). The write itself is the ordinary
    // one, so switching off a block that holds entered values stores
    // `enabled: false` beside them, every value kept (objectui#6499 Option C,
    // triage 6003792818) — including a block that has no `timeoutHours` yet:
    // nothing is filled in, nothing deleted. What is never stored is the bare
    // `{ enabled: false }` stub `ApprovalNodeConfigSchema` refuses: a write
    // that would leave it — switching off with nothing entered, or clearing the
    // last value retained under a switched-off block — removes the block
    // instead, which says the same OFF. `setAtPath` deletes only the block —
    // sibling config keys are not rebuilt — and prunes a `config` left empty.
    const switched = switchedBlockOf(node, field);
    // objectui#12779 — the Cron schedule commit rewrites the whole
    // `config.schedule`, so a bare string or `{ cron }` cadence stores the
    // typed cron where the engine reads it, rather than an `expression`
    // merged beside the key the engine resolves first.
    let nextNode = isScheduleExpressionPath(path)
      ? setAtPath(node, path.slice(0, -1), scheduleWithExpression(config.schedule, stored))
      : setAtPath(node, path, stored);
    if (switched && isBareSwitchedOffBlock(nextNode, switched)) {
      nextNode = setAtPath(nextNode, [...switched.block], undefined);
    }
    // Migrate-on-edit: writing the canonical path drops any looser fallback
    // location, so the node never carries a stale duplicate (engine + designer agree).
    if (field.fallbackPath) nextNode = setAtPath(nextNode, field.fallbackPath, undefined);
    const patch = loc.write(withoutSpecRefusedKeys(nextNode));
    if (!patch) return;
    if (nextEdges) patch.edges = nextEdges;
    onPatch(patch);
  };

  const commitAdvanced = () => {
    try {
      const parsed = advText.trim() === '' ? {} : JSON.parse(advText);
      // A value that parses but is not an object is this box's own refusal, in
      // the designer locale (objectui#10748); a parse failure keeps the
      // engine's own `SyntaxError` text below.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setAdvError(t('engine.inspector.flowNode.advancedNotObject', locale));
        return;
      }
      // Form-owned config keys always win: the Advanced block may only set keys
      // that no form field owns, so it can never overwrite or resurrect one.
      const knownPart = Object.fromEntries(Object.entries(config).filter(([k]) => ownedConfigKeys.has(k)));
      const extrasPart = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(([k]) => !ownedConfigKeys.has(k)),
      );
      const merged = { ...knownPart, ...extrasPart };
      setAdvError(null);
      const nextNode: Record<string, unknown> = { ...node };
      if (Object.keys(merged).length === 0) delete nextNode.config;
      else nextNode.config = merged;
      const patch = loc?.write(withoutSpecRefusedKeys(nextNode));
      if (patch) onPatch(patch);
    } catch (e) {
      setAdvError(String((e as Error).message));
    }
  };

  // objectui#11772 — removing a node removes the edges that name it in the
  // SAME patch, splicing a single-path node out (predecessor → successor): the
  // canvas's Delete key makes the identical removal (`edgesAfterNodeRemoval`).
  // Writing `null` to the node alone left every edge naming it behind, and the
  // next node minted with that id inherited them all. Top-level only: a nested
  // node has no Remove (its routing lives in its region, not on `draft.edges`).
  //
  // objectui#11838 — and it is refused, writing nothing, while a boundary
  // event's host or an expression root still names the node: a removal has no
  // new id for those to follow. `nodeRemovalRefusal` is the one rule the
  // canvas's Delete key applies too; the refusal names each site under the
  // button, and the node stays selected.
  const removalSites = removeRefusedId === node.id ? nodeRemovalRefusal(draft as Record<string, unknown>, node.id) : null;
  const remove = () => {
    if (nodeRemovalRefusal(draft as Record<string, unknown>, node.id)) {
      setRemoveRefusedId(node.id);
      return;
    }
    const patch = loc?.write(null);
    if (patch && !loc?.nested) {
      const draftEdges = Array.isArray((draft as { edges?: unknown }).edges)
        ? ((draft as { edges: FlowEdge[] }).edges)
        : [];
      const remaining = new Set(
        (patch.nodes as Array<{ id?: unknown } | null>).flatMap((n) => (typeof n?.id === 'string' ? [n.id] : [])),
      );
      patch.edges = edgesAfterNodeRemoval(draftEdges, node.id, remaining);
    }
    if (patch) onPatch(patch);
    onClearSelection();
  };

  // objectui#11827 — renaming a node carries every reference to it in the
  // SAME patch: each edge endpoint that named the old id (`edgesAfterNodeRename`)
  // and a boundary event's host (`boundaryRefsAfterNodeRename`). Writing the
  // node's id alone left every edge naming a node that no longer existed, so the
  // renamed node ran disconnected. The selection then follows the node, or the
  // inspector would be left on an id the draft no longer holds. Top-level only:
  // a nested node's id is read-only here (its region routing is not managed).
  //
  // objectui#11838 — the same patch carries every expression reference whose
  // root is the old id (`expressionRefsAfterNodeRename`): a later branch's
  // `x.decision == 'approve'`, a record field's `{x.field}` / `{{x.field}}`,
  // read through the expression parsers. A reference no parser can place is
  // not guessed at: the rename is refused, naming it. `renamePatch` is the one
  // build both the refusal and the commit read, so the field refuses exactly
  // what the commit could not carry.
  const renamePatch = (nextId: string): { patch: Record<string, unknown> } | { refusal: ExprRenameRefusal } | null => {
    if (!loc || loc.nested) return null;
    const oldId = node.id;
    const patch = loc.write(withoutSpecRefusedKeys({ ...node, id: nextId }));
    if (!patch) return null;
    const nodesAfter = Array.isArray(patch.nodes) ? (patch.nodes as Array<{ id?: unknown; boundaryConfig?: unknown } | null>) : [];
    const draftEdges = Array.isArray((draft as { edges?: unknown }).edges)
      ? ((draft as { edges: FlowEdge[] }).edges)
      : [];
    const idsAfter = new Set(nodesAfter.flatMap((n) => (typeof n?.id === 'string' ? [n.id] : [])));
    const edges = edgesAfterNodeRename(draftEdges, oldId, nextId, idsAfter);
    const carried = expressionRefsAfterNodeRename(
      { nodes: boundaryRefsAfterNodeRename(nodesAfter, oldId, nextId), edges, variables: (draft as { variables?: unknown }).variables },
      oldId,
      nextId,
    );
    if (!carried.ok) return { refusal: carried.refusal };
    patch.nodes = carried.nodes;
    if (carried.edges !== draftEdges) patch.edges = carried.edges;
    return { patch };
  };
  const idRefusal = (next: string): string | null => {
    switch (nodeRenameRefusal(draft as Record<string, unknown>, node.id, next)) {
      case 'empty':
        return t('engine.inspector.flowNode.idRequired', locale);
      case 'node':
        return tFormat('engine.inspector.flowNode.idTaken', locale, { id: next });
      case 'edge':
        return tFormat('engine.inspector.flowNode.idEdgeNamed', locale, { id: next });
    }
    const built = renamePatch(next);
    if (!built || !('refusal' in built)) return null;
    const { refusal } = built;
    const refs = refusal.sites.map(describeExprSite).join('; ');
    return refusal.kind === 'unparsed'
      ? tFormat('engine.inspector.flowNode.idRefsUnparsed', locale, { id: node.id, refs })
      : tFormat('engine.inspector.flowNode.idRefsAmbiguous', locale, { name: refusal.name, refs });
  };
  const rename = (nextId: string) => {
    const built = renamePatch(nextId);
    if (!built || !('patch' in built)) return;
    onPatch(built.patch);
    onSelectionChange?.({ kind: 'node', id: nextId, label: flowNodeDisplayName({ ...node, id: nextId }, locale) });
  };

  // objectui#11778 — the palette's list (it once was a hand list here that
  // missed `notify` and showed raw type names). A stored type the palette does
  // not offer (`start`, a designer alias like `for_each`, a plugin type whose engine
  // is not answering) is added for THIS node only, under its display name, so
  // the select still shows what the node is; no other node is offered it.
  const typeOptions = paletteTypeOptions(paletteItems, locale);
  if (node.type && !typeOptions.some((o) => o.value === node.type)) {
    typeOptions.push({ value: node.type, label: defaultNodeLabel(node.type, locale) });
  }

  // A nested node has no structural editing this phase (no delete, id is
  // read-only — those live on the container's Advanced JSON).
  const nested = !!loc?.nested;

  return (
    <InspectorShell
      kindLabel={t('engine.inspector.flowNode.kind', locale)}
      title={node.label || node.id}
      onClose={onClearSelection}
      closeLabel={t('engine.inspector.flowNode.close', locale)}
      footer={
        nested ? undefined : (
          <div className="space-y-1.5">
            {removalSites && (
              <p className="text-[11px] leading-snug text-destructive" role="alert">
                {describeNodeRemovalRefusal(node.id, removalSites, locale)}
              </p>
            )}
            <InspectorRemoveButton label={t('engine.inspector.flowNode.remove', locale)} onClick={remove} disabled={readOnly} />
          </div>
        )
      }
    >
      {nested && (
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground" aria-label={t('engine.inspector.flowNode.nestedLocation', locale)}>
          <span className="max-w-[45%] truncate font-medium">{loc?.container ? flowNodeDisplayName(loc.container, locale) : null}</span>
          <span aria-hidden>›</span>
          {/* The region's English structural fallback (`Try` / `Catch` / `Branch N`,
              and a loop body's `Body`) reads its catalogue row through the same
              `displayRegionLabel` the canvas header reads; an authored branch
              name passes through (objectui#10696, objectui#10748). */}
          <span className="truncate">
            {loc?.regionKey ? displayRegionLabel({ key: loc.regionKey, label: loc.regionLabel }, locale) : loc?.regionLabel}
          </span>
          <span aria-hidden>›</span>
          <span className="max-w-[45%] truncate font-medium text-foreground">{flowNodeDisplayName(node, locale)}</span>
        </div>
      )}
      <FlowNodeIdField
        label={t('engine.inspector.flowNode.id', locale)}
        id={node.id}
        refusalOf={idRefusal}
        onRename={rename}
        disabled={readOnly || nested}
      />
      {nested && (
        <p className="-mt-1 text-[11px] leading-snug text-muted-foreground">{t('engine.inspector.flowNode.nestedIdHint', locale)}</p>
      )}
      <InspectorTextField label={t('engine.inspector.flowNode.label', locale)} value={node.label ?? ''} onCommit={(v) => patchNode({ label: v })} disabled={readOnly} />
      <InspectorSelectField
        label={t('engine.inspector.flowNode.type', locale)}
        value={node.type}
        options={typeOptions}
        onCommit={(v) => patchNode({ type: v })}
        disabled={readOnly}
      />
      {fields.length === 0 ? (
        <p className="pt-1 text-xs italic text-muted-foreground">
          {t('engine.inspector.flowNode.noConfig', locale)}
        </p>
      ) : (
        visibleFields.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('engine.inspector.flowNode.configuration', locale)}
            </span>
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>
        )
      )}

      {visibleFields.map((field) => {
        const branchTarget = isBranchTargetField(field);
        // objectui#12672 — a start node that stores no `triggerType` still has
        // the trigger the spec resolves from its descriptors, and the Trigger
        // select READS it: handed to the select's placeholder slot, which shows
        // what the runtime applies while the node stores nothing and writes
        // nothing. Render-only — the gates read `fields`, never this copy.
        const triggerReading = unsetTriggerReading(field, node, flowKind);
        // objectui#12779 — an interval or once cadence is shown as what it is,
        // through the same `disabled` control a read-only flow draws, and is
        // never offered as a cron: the designer edits cron cadences only.
        const cadence = readOnlyScheduleCadence(node, field);
        // A NESTED node can't wire top-level edges, so drop the virtual Target
        // column from its Branches editor and skip the withBranchTargets augment
        // (its region routing is out of scope this phase).
        const effField =
          nested && branchTarget
            ? { ...field, columns: (field.columns ?? []).filter((c) => c.key !== 'target') }
            : triggerReading !== undefined
              ? { ...field, defaultValue: triggerReading }
              : cadence
                ? {
                    ...field,
                    label: t('engine.inspector.flowNode.cadenceLabel', locale),
                    help: t('engine.inspector.flowNode.cadenceReadOnly', locale),
                    placeholder: undefined,
                  }
                : field;
        // The Branches editor's Target column (#1942) is virtual: derived from the
        // node's out-edges, never stored on the branch rows (top-level only).
        const value = cadence
          ? describeCadence(cadence, locale)
          : branchTarget && !nested
            ? withBranchTargets(
                node.id,
                getFieldValue(node, field),
                Array.isArray((draft as { edges?: unknown }).edges) ? ((draft as { edges: FlowEdge[] }).edges) : [],
              )
            : effField.omitKeys
              // #4305 — show this repeater only the keys the typed sibling
              // fields do not own; `setField` merges its commit back.
              ? connectorInputExtras(getFieldValue(node, effField), effField.omitKeys)
              // objectui#11660 — `readFieldValue`: a block switch over an
              // absent block draws OFF, not its declared default.
              : readFieldValue(node, effField);
        const required = requiredness.get(field.id)?.required;
        return (
          <React.Fragment key={field.id}>
            <FlowNodeConfigField
              field={effField}
              value={value}
              onCommit={(v) => setField(field, v)}
              disabled={readOnly || !!cadence}
              locale={locale}
              context={{ draft, node }}
              scopeGroups={scopeGroups}
              approvalScopeGroups={approvalExpressionGroups}
              triggerScope={triggerScope}
              // objectui#6499 — a gated field that survived the filter above ONLY
              // because it holds a stored value is inert config wearing a live
              // control's clothes. Name it, and offer the deliberate clear.
              // Computed from `field` (not `effField`): the read is by `path`,
              // which the nested-branch rewrite above does not touch.
              inactiveRetained={inactiveRetainedKind(field, node, fields, flowKind)}
              onClearInactive={readOnly ? undefined : () => setField(field, undefined)}
              required={required}
              requiredColumns={requiredness.get(field.id)?.columns}
            />
            {/* objectui#11786 — a required input the node leaves out is what holds
                Studio's autosave of this step (and what the server refuses), so
                it says so under the marker. Absent, not blank: the spec's judges
                refuse the key's absence. */}
            {required && getFieldValue(node, field) === undefined && (
              <p data-testid="flow-field-held-hint" className="-mt-1 text-[11px] leading-snug text-muted-foreground">
                {t('engine.studio.held.inputHint', locale)}
              </p>
            )}
          </React.Fragment>
        );
      })}

      {isScreen && <ScreenPreview node={node} variables={screenVars} className="mt-1" locale={locale} />}

      {hasExtras || advReveal ? (
        <details
          className="group rounded border bg-muted/20"
          open={advOpen}
          onToggle={(e) => setAdvOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer select-none px-2 py-1.5 text-xs font-medium text-muted-foreground">
            {t('engine.inspector.flowNode.advanced', locale)}
          </summary>
          <div className="space-y-1 border-t p-2">
            <p className="text-[11px] leading-snug text-muted-foreground">{t('engine.inspector.flowNode.advancedHint', locale)}</p>
            <textarea
              value={advText}
              onChange={(e) => setAdvText(e.target.value)}
              onBlur={commitAdvanced}
              disabled={readOnly}
              rows={6}
              placeholder="{ }"
              className="w-full rounded border bg-background px-2 py-1.5 font-mono text-xs"
            />
            {advError && <div className="text-xs text-destructive">{advError}</div>}
          </div>
        </details>
      ) : (
        !readOnly && (
          <button
            type="button"
            onClick={() => {
              setAdvReveal(true);
              setAdvOpen(true);
            }}
            className="inline-flex items-center gap-1 self-start text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            {t('engine.inspector.flowNode.advanced', locale)}
          </button>
        )
      )}
    </InspectorShell>
  );
}
