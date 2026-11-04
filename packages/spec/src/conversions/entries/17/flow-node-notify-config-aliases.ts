// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `flow-node-notify-config-aliases` conversion (`toMajor:
// 17`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helper
// `liftNotifySourceShape` is read by this conversion alone). A LEAF: it imports
// neither `registry.ts` nor another conversion's module. `registry.ts` imports
// `flowNodeNotifyConfigAliases` and lists it where it stood.

import type { ConversionApplication, MetadataConversion } from '../../types.js';
import { mapFlowNodes } from '../../walk.js';
import { deepEqualAuthored } from '../../../shared/deep-equal.js';
import { type Dict, type Emit, isDict, renameFlowConfigAliases } from '../shared.js';

/**
 * Lift `notify`'s nested `config.source: { object, id }` onto the canonical flat
 * `sourceObject` / `sourceId` keys (#4045).
 *
 * The fifth notify alias, and the only one that is not a 1:1 rename — it is a
 * 1→2 destructuring, so {@link renameFlowConfigAliases}' pair mechanism cannot
 * express it. It nevertheless follows {@link renameConfigKey}'s rule for a
 * shadowed alias, which #4923 settled **by value**:
 *
 *  - a nested part whose flat counterpart is ABSENT is lifted (a notice each);
 *  - a nested part that merely REPEATS the value already on its flat key is
 *    redundant — nothing to lift, but the part is accounted for, and the notice
 *    still fires so the removal is loud;
 *  - a nested part that DISAGREES with its flat key is genuine author
 *    ambiguity. The node is then left **entirely** untouched — no partial lift,
 *    no notice — so `source` survives to the strict `notify` contract, which
 *    refuses naming both the nested key and the flat pair. Choosing here would
 *    mean rewriting a click-through target the author never agreed to.
 *
 * `source` is dropped only when every part it carries was lifted or found
 * redundant, so nothing observable is lost. Leaving the ambiguous node whole
 * rather than half-converted also keeps the pass idempotent: a replay of the
 * unresolved shape re-derives the same verdict and emits nothing.
 *
 * A `source` that is not a dict, or carries neither key, is left untouched
 * rather than silently deleted.
 */
function liftNotifySourceShape(stack: Dict, emit: Emit): Dict {
  return mapFlowNodes(stack, (node, path) => {
    if (node.type !== 'notify') return node;
    const config = node.config;
    if (!isDict(config)) return node;
    const source = config.source;
    if (!isDict(source)) return node;

    const nextConfig: Dict = { ...config };
    const pending: ConversionApplication[] = [];
    let ambiguous = false;
    for (const [from, to] of [['object', 'sourceObject'], ['id', 'sourceId']] as const) {
      if (source[from] == null) continue;
      if (nextConfig[to] == null) {
        nextConfig[to] = source[from];
      } else if (!deepEqualAuthored(source[from], nextConfig[to])) {
        ambiguous = true;
        break;
      }
      pending.push({ from: `source.${from}`, to, path: `${path}.config.${to}` });
    }
    // The author named one slot twice, differently — hand the whole shape to
    // the strict gate rather than resolving part of it (#4923).
    if (ambiguous || pending.length === 0) return node;
    for (const application of pending) emit(application);
    delete nextConfig.source;
    return { ...node, config: nextConfig };
  });
}

/**
 * Notify flow-node config key aliases → canonical (protocol 17, #3796 / #4045).
 *
 * The `notify` executor carried five open-coded `??` fallbacks that never went
 * through the deprecation shim — an author who wrote the email-idiom keys got
 * a flow that worked forever and was never steered to the canonical spelling.
 * Four are pure key renames with unchanged values; the fifth
 * (`source: { object, id }`, #4045) is a destructuring handled by
 * {@link liftNotifySourceShape}.
 *
 * `actionUrl` is the deliberate canonical of its pair (the executor's own
 * `configSchema` used to claim the opposite): the entire downstream chain
 * already uses it — `sys_notification.action_url`, the channel-dispatch
 * contract, the REST notification read model — and `url` elsewhere in the
 * platform means "HTTP endpoint to call" (`http` node, webhooks), a different
 * concept from this in-app click-through target. The executor precedence
 * already put `actionUrl` first, so the choice is behaviour-preserving.
 *
 * **Retired from the load path at 18** — its one-major window (protocol 17)
 * has run (#23487). The authoring funnel no longer rewrites the old
 * spelling, so an author meets the `notify` contract (`NOTIFY_KEY_GUIDANCE`), whose refusal names the rename and
 * this release, at every door that judges a flow: `os validate` /
 * `os build` / `os lint`. Stored flows keep healing: the automation
 * engine's flow rehydration and stored-row rehydration
 * (`applyConversionsToStoredItem`) replay the full chain, this entry
 * included, and so do the artifact-ingestion door (inside its window) and
 * `os migrate meta --from 16`.
 */
const flowNodeNotifyConfigAliases: MetadataConversion = {
  id: 'flow-node-notify-config-aliases',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'flow.node.notify.config',
  summary:
    "notify flow-node config keys 'to' → 'recipients', 'subject' → 'title', 'body' → 'message', 'url' → 'actionUrl' (executor `??` fallbacks graduated into this layer; `actionUrl` is canonical because the notification chain downstream already uses it), " +
    "and nested 'source: {object, id}' → 'sourceObject' / 'sourceId' (a shape the executor read that no config schema declared)",
  apply(stack, emit) {
    const renamed = renameFlowConfigAliases(
      stack,
      new Set(['notify']),
      [
        ['to', 'recipients'],
        ['subject', 'title'],
        ['body', 'message'],
        ['url', 'actionUrl'],
      ],
      emit,
    );
    return liftNotifySourceShape(renamed, emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'task_assigned',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'notify',
              config: {
                to: ['{record.assignee}'],
                subject: 'New task: {record.title}',
                body: 'You have been assigned "{record.title}".',
                url: '/task/{record.id}',
                channels: ['inbox'],
                // #4045 — the nested click-through target, lifted to the flat pair.
                source: { object: 'showcase_task', id: '{record.id}' },
              },
            },
            // `source.object` DISAGREES with the flat `sourceObject` (#4923).
            // The node is left whole — not even the unambiguous `id` is
            // lifted — so `source` reaches the strict `notify` contract and is
            // refused there, naming both the nested key and the flat pair.
            {
              id: 'n3',
              type: 'notify',
              config: {
                recipients: ['{record.owner}'],
                sourceObject: 'showcase_project',
                source: { object: 'crm_account', id: '{record.project}' },
              },
            },
            // `source.object` merely REPEATS the flat `sourceObject`: redundant,
            // so it counts as accounted for, `id` lifts, and `source` is
            // dropped — two notices, nothing observable lost.
            {
              id: 'n4',
              type: 'notify',
              config: {
                recipients: ['{record.reviewer}'],
                sourceObject: 'showcase_task',
                source: { object: 'showcase_task', id: '{record.task}' },
              },
            },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'task_assigned',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'notify',
              config: {
                recipients: ['{record.assignee}'],
                title: 'New task: {record.title}',
                message: 'You have been assigned "{record.title}".',
                actionUrl: '/task/{record.id}',
                channels: ['inbox'],
                sourceObject: 'showcase_task',
                sourceId: '{record.id}',
              },
            },
            {
              id: 'n3',
              type: 'notify',
              config: {
                recipients: ['{record.owner}'],
                sourceObject: 'showcase_project',
                source: { object: 'crm_account', id: '{record.project}' },
              },
            },
            {
              id: 'n4',
              type: 'notify',
              config: {
                recipients: ['{record.reviewer}'],
                sourceObject: 'showcase_task',
                sourceId: '{record.task}',
              },
            },
          ],
        },
      ],
    },
    // 4 renames on n2 + `source.object`/`source.id` lifted on n2 = 6; n3 is the
    // ambiguous pair and converts nothing; n4 adds 2 (the redundant `object`
    // and the lifted `id`).
    expectedNotices: 8,
  },
};

export { flowNodeNotifyConfigAliases };
