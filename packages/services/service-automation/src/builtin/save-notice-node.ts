// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `save_notice` — tell the person who made the triggering write what the save
 * set in motion (#28251).
 *
 * The flow face of the save `notice` the create / update answer carries. The
 * record-change trigger runs a flow INSIDE the write that fired it and hands
 * the run that write's channel (`AutomationContext.saveNotice`), which wraps
 * the hook face of the write's own listener (`HookContext.notice`): this node
 * renders its message and sets it there. One channel, never a second.
 *
 * - **Rendered and translated where it is rendered** (the #22507 rule): the
 *   engine picks `flows.<flow>.notices.<node_id>.message`
 *   (`flowNoticeMessageKey`) in the WRITER's locale — the channel's, since a
 *   record-change run carries no locale of its own — and fills the `{{ }}`
 *   holes through the one text renderer the refusing `end` node and a screen
 *   share. With no translation, the authored template renders.
 * - **Refused, never dropped, where no write waits.** The flow parse refuses
 *   the node outside a create / update record trigger
 *   (`saveNoticePlacementRefusals`). What the parse cannot see is refused
 *   here by name: a run holding no channel (a leg restored from storage after
 *   an approval or a wait, a direct `execute`), and a channel the trigger has
 *   closed because the write already answered (a resumed leg still held in
 *   memory).
 */

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, SaveNoticeConfigSchema } from '@objectstack/spec/automation';
import type { SaveNoticeConfigParsed } from '@objectstack/spec/automation';
import { flowNoticeMessageKey } from '@objectstack/spec/system';
import type { AutomationEngine } from '../engine.js';
import { refuseNode } from '../guard-refusal.js';
import { parseNodeConfig } from './parse-config.js';
import { renderTextSlot } from './template.js';

export function registerSaveNoticeNode(engine: AutomationEngine, _ctx: PluginContext): void {
    engine.registerNodeExecutor({
        type: 'save_notice',
        descriptor: defineActionDescriptor({
            type: 'save_notice', version: '1.0.0', name: 'Save notice',
            description:
                'Tell the person who made the record write that started this flow what the save set in motion. '
                + 'The create/update answer carries the message, and the console shows it with the save.',
            icon: 'message-circle', category: 'io', source: 'builtin',
            configSchema: {
                type: 'object',
                properties: {
                    message: {
                        type: 'string',
                        format: 'multiline',
                        title: 'Message',
                        description:
                            'The sentence the saver reads. Renders {{ }} placeholders (e.g. Sent {{ record.name }} '
                            + 'to your manager for approval). Only in a flow a record create or update starts, and '
                            + 'before any node that suspends the run.',
                    },
                },
                required: ['message'],
            },
        }),
        async execute(node, variables, context) {
            const parsed = parseNodeConfig<SaveNoticeConfigParsed>('save_notice', node.id, SaveNoticeConfigSchema, node.config);
            if (!parsed.ok) return parsed.refusal;
            const channel = context?.saveNotice;
            if (!channel || typeof channel.set !== 'function') {
                return refuseNode(
                    `save_notice '${node.id}': this run holds no record write to answer — a save notice is set only by `
                    + 'a flow a record create or update starts, while the run is still inside that write. A leg resumed '
                    + 'after an approval or a wait, or a run started any other way, has no save to tell anyone about. '
                    + 'Move the node ahead of the node that suspends the run, or tell the person with a notify node.',
                );
            }
            const flowName = typeof context.flowName === 'string' && context.flowName.length > 0
                ? context.flowName
                : undefined;
            // The writer's locale, not the run's: a record-change run carries
            // none of its own, and the reader of this sentence is the writer.
            const renderContext = channel.locale ? { ...context, locale: channel.locale } : context;
            const message = flowName === undefined
                ? renderTextSlot(parsed.config.message, variables, context.currency)
                : engine.renderFlowTextSlot(
                    {
                        key: flowNoticeMessageKey(flowName, node.id),
                        authored: parsed.config.message,
                        subject: `flow '${flowName}' save_notice '${node.id}'`,
                        shownAs: 'the save notice',
                    },
                    variables,
                    renderContext,
                );
            if (typeof message !== 'string' || message.trim() === '') {
                return {
                    success: false,
                    error:
                        `save_notice '${node.id}': the message rendered to nothing — every {{ }} hole in it came out `
                        + 'empty, so there is no sentence to show. Give the holes a default '
                        + '(`{{ record.name | default: "this record" }}`) or route around the node with a decision.',
                };
            }
            try {
                channel.set(message);
            } catch (err) {
                return refuseNode(`save_notice '${node.id}': ${(err as Error)?.message ?? String(err)}`);
            }
            return { success: true };
        },
    });
}
