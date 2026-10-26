// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-required-keys — which flow-inspector fields hold a key the installed
 * `@objectstack/spec` refuses the node without (objectui#10948).
 *
 * Since spec 17.5.0 the flow parse refuses a node whose executor could not run
 * it: a key its config contract requires, left out (a CRUD node with no
 * `objectName`, an `http` node with no `url`, a `notify` with neither `title`
 * nor `template`, …), a decision branch with no `label`, a screen field with no
 * `name`, a `connector_action` whose `connectorConfig` names nothing. The
 * designer's live `FlowSchema` pass (`clientValidation.ts`) reports each one at
 * the node's config path once the author has left it out. The inspector marks
 * the same keys BEFORE that happens, with the metadata form's own required
 * marker (`RequiredMarker`, the `SchemaForm` `FieldRow` idiom).
 *
 * ⛔ No list of required keys lives in this repo. Every verdict here is the
 * installed spec's own, asked at render time of the node being edited: "would
 * the spec refuse this node if the key held no value?" The node is PROBED —
 * the key is removed from a copy — and handed to the same judges the flow parse
 * runs, and the key is required exactly when one of them then names it:
 *
 *  - `flowNodeConfigRefusals` — the ONE config judge `FlowSchema.parse`,
 *    `registerFlow` and `objectstack validate` share: a key the executor
 *    contract requires (or a rule of it requires in this configuration), and a
 *    decision branch `label`;
 *  - `resolveFlowNodeExpressions` + `predicateSlotRefusal` — the flow parse's
 *    predicate-slot walk, which refuses the absent value of a slot the
 *    expression ledger marks `required` (a decision branch `expression`);
 *  - `FlowNodeSchema` — the node contract: the spec-structured sibling blocks
 *    (`connectorConfig`, `waitEventConfig`, `boundaryConfig`) and the `end`
 *    node's config.
 *
 * Probing rather than reading a key list is also what keeps a RULE-dependent
 * requirement honest: `notify` requires `title` only while it has no
 * `template`, so removing the key from the node as it stands asks the question
 * in the configuration the author actually has.
 *
 * Presence only. The flow parse also refuses a BLANK decision label or
 * connector id; a marker says a value is required, and what counts as a value
 * stays the spec's call at save time.
 */

import {
  FlowNodeSchema,
  flowNodeConfigRefusals,
  predicateSlotRefusal,
  resolveFlowNodeExpressions,
} from '@objectstack/spec/automation';
import type { FlowConfigField } from './flow-node-config.js';

type Segment = string | number;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A config path in the spec's ledger spelling — `fields[0].name`, `url` — the
 * `path` both `flowNodeConfigRefusals` and `resolveFlowNodeExpressions` report.
 */
function ledgerPath(segments: readonly Segment[]): string {
  let out = '';
  for (const segment of segments) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out ? `.${segment}` : segment;
  }
  return out;
}

/** A copy of `obj` with the value at `path` removed; a missing parent object is created empty. */
function withoutPath(obj: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const [head, ...rest] = path;
  const next: Record<string, unknown> = { ...obj };
  if (rest.length === 0) {
    delete next[head];
    return next;
  }
  next[head] = withoutPath(isRecord(obj[head]) ? obj[head] : {}, rest);
  return next;
}

/** Do the flow parse's config judges refuse `config` for leaving `ledger` out? */
function configJudgesName(nodeType: string, config: Record<string, unknown>, ledger: string): boolean {
  if (flowNodeConfigRefusals(nodeType, config).some((refusal) => refusal.path === ledger)) return true;
  return resolveFlowNodeExpressions(nodeType, config).some(
    (found) =>
      found.path === ledger &&
      found.entry.role === 'predicate' &&
      found.entry.required === true &&
      found.value == null &&
      predicateSlotRefusal(found.value) !== undefined,
  );
}

/** Does the node contract refuse `node` with an issue addressed exactly to `path`? */
function nodeContractNames(node: Record<string, unknown>, path: readonly string[]): boolean {
  const result = FlowNodeSchema.safeParse(node);
  if (result.success) return false;
  return result.error.issues.some(
    (issue) => issue.path.length === path.length && issue.path.every((segment, i) => String(segment) === path[i]),
  );
}

/**
 * Would the installed spec refuse `node` if `field.path` held no value?
 *
 * `false` for a node with no string `type` — there is no contract to ask.
 */
export function specRequiresField(
  node: Record<string, unknown> | null | undefined,
  field: Pick<FlowConfigField, 'path'>,
): boolean {
  if (!node || typeof node.type !== 'string' || field.path.length === 0) return false;
  const probe = withoutPath(node, field.path);
  if (field.path[0] === 'config' && field.path.length >= 2) {
    const config = isRecord(probe.config) ? probe.config : {};
    if (configJudgesName(node.type, config, ledgerPath(field.path.slice(1)))) return true;
  }
  return nodeContractNames(probe, field.path);
}

/**
 * The columns of a config-rooted list field (a decision's `conditions`, a
 * screen's `fields`) the installed spec requires on every row.
 *
 * Asked of a probe holding one EMPTY row, so the answer does not depend on
 * which rows the author has written yet — it is what the column header states
 * for all of them. A column the spec requires only under a rule of another
 * column's value is not stated here; the save-time error still names it.
 */
export function specRequiredColumns(
  node: Record<string, unknown> | null | undefined,
  field: Pick<FlowConfigField, 'path' | 'columns'>,
): ReadonlySet<string> {
  const required = new Set<string>();
  if (!node || typeof node.type !== 'string') return required;
  if (field.path.length !== 2 || field.path[0] !== 'config') return required;
  const listKey = field.path[1];
  const config = { ...(isRecord(node.config) ? node.config : {}), [listKey]: [{}] };
  for (const column of field.columns ?? []) {
    if (configJudgesName(node.type, config, ledgerPath([listKey, 0, column.key]))) required.add(column.key);
  }
  return required;
}
