// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-sibling-block-loose-keys
 *
 * **The loose `config` keys of the two node types whose contract is a SIBLING
 * block** — `wait` (`waitEventConfig`) and `connector_action`
 * (`connectorConfig`) — and the one refusal an author meets for writing one
 * (#23543 F3).
 *
 * Neither node type has a `config` contract: each executor reads its sibling
 * block and nothing else (`service-automation`'s `wait-node.ts`,
 * `connector-nodes.ts`). Through 17 the ADR-0087 D2 conversions
 * `flow-node-wait-event-config-lift` and `flow-node-connector-config-lift`
 * lifted these keys from `config` into the block at load. At 18 both left the
 * load path, so an authored loose key would be read by nobody — a loose `input`
 * beside a complete `connectorConfig` would dispatch the action with no input.
 * The flow parse refuses each one instead, naming the block key it belongs on.
 *
 * ONE table, two readers, so they cannot drift: the refusal below, and the two
 * lifts in `conversions/registry.ts`, which still run at every stored-row
 * rehydration seam (`includeRetired`) and delete a loose key the block already
 * shadows, so a stored flow the refusal would reject keeps loading. The keys are
 * exactly the ones the lifts move — ⛔ never a key outside them: an unknown
 * `config` key on these node types was never lifted and is not this refusal's.
 *
 * Not exported from the automation barrel: it is a leaf both readers import.
 */

/**
 * The loose `config` keys the `wait` executor used to also accept, in the exact
 * precedence order of the `??` chains it carried, keyed by the declared
 * `waitEventConfig` property each one feeds.
 *
 * `duration` and `signal` are not declared names anywhere in the spec — they
 * only ever existed as the tail of an executor fallback, which is why the
 * declared spelling is listed first in each group.
 */
export const WAIT_EVENT_CONFIG_LOOSE_KEYS: ReadonlyArray<readonly [target: string, candidates: readonly string[]]> = [
  ['eventType', ['eventType']],
  ['timerDuration', ['timerDuration', 'duration']],
  ['signalName', ['signalName', 'signal']],
  ['timeoutMs', ['timeoutMs']],
];

/** The `config` keys a mis-taught `connector_action` node carries, in declared-block order. */
export const CONNECTOR_CONFIG_LOOSE_KEYS = ['connectorId', 'actionId', 'input'] as const;

/** The house sentence for an edit `os migrate meta --from 16` lists (both lifts are step-17 members). */
const MIGRATE_META_SENTENCE =
  'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

/** A plain object (not an array, not `null`). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `loose key → the block key it belongs on`, per node type. */
function looseKeyTargets(type: unknown): ReadonlyMap<string, string> | undefined {
  if (type === 'wait') {
    return new Map(WAIT_EVENT_CONFIG_LOOSE_KEYS.flatMap(([target, candidates]) => candidates.map((c) => [c, target] as const)));
  }
  if (type === 'connector_action') return new Map(CONNECTOR_CONFIG_LOOSE_KEYS.map((k) => [k, k] as const));
  return undefined;
}

/**
 * Every named loose key under a `wait` / `connector_action` node's `config`,
 * each refused at `config.<key>` with the prescription naming the sibling block
 * key it belongs on. Judged by the `FlowSchema` superRefine for every node the
 * `collectFlowGraphs` walk reaches, beside `connectorActionConfigRefusals`, so a
 * node in an ADR-0031 region body is refused where the author wrote it.
 *
 * A key is refused when it is PRESENT, whatever its value: the block is the only
 * place the executor reads, so a loose key carries nothing either way.
 */
export function siblingBlockLooseConfigRefusals(node: unknown): Array<{ path: PropertyKey[]; message: string }> {
  if (!isRecord(node)) return [];
  const targets = looseKeyTargets(node.type);
  if (targets === undefined || !isRecord(node.config)) return [];
  const block = node.type === 'wait' ? 'waitEventConfig' : 'connectorConfig';
  const out: Array<{ path: PropertyKey[]; message: string }> = [];
  for (const key of Object.keys(node.config)) {
    const target = targets.get(key);
    if (target === undefined || node.config[key] === undefined) continue;
    const rename = target === key ? '' : ` (the key is \`${target}\` there; \`${key}\` was only ever an executor fallback)`;
    out.push({
      path: ['config', key],
      message:
        `A \`${String(node.type)}\` node's \`config.${key}\` was removed in @objectstack/spec 18 (ADR-0087 D2) — this `
        + `node type has no \`config\` contract: its executor reads only the \`${block}\` block, and the loader lifted `
        + `this key into it until this release. Move it to \`${block}.${target}\`${rename}; the value is unchanged. If `
        + `\`${block}.${target}\` is already set, it is the one the node runs with — delete \`config.${key}\`. `
        + MIGRATE_META_SENTENCE,
    });
  }
  return out;
}
