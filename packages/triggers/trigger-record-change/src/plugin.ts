// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { RecordChangeTrigger } from './record-change-trigger.js';
import type { FlowTrigger, RecordChangeDataEngine } from './record-change-trigger.js';

/**
 * The slice of the automation engine this plugin needs: register a trigger on
 * its `FlowTrigger` extension point. Declared structurally so the plugin does
 * not take a build dependency on `@objectstack/service-automation`.
 */
interface AutomationTriggerRegistry {
    registerTrigger(trigger: FlowTrigger): void;
    unregisterTrigger?(type: string): void;
}

/**
 * RecordChangeTriggerPlugin
 *
 * Makes record-change-triggered flows actually fire. The automation engine
 * ships the `FlowTrigger` wiring (it parses each flow's start node into a
 * binding and calls `trigger.start(...)`), but the *concrete* record-change
 * trigger — the one that subscribes to ObjectQL lifecycle hooks — lives here as
 * a plugin. This mirrors the connector split (engine baseline + connector-rest
 * plugin) and reuses plugin-audit's `kernel:ready` → `getService('objectql')`
 * pattern to reach the data engine's hook surface.
 *
 * With this plugin installed, a flow whose start node declares
 * `config: { objectName, triggerType: 'record-after-update', condition }`
 * auto-launches on the matching mutation — no manual `engine.execute()`.
 */
export class RecordChangeTriggerPlugin implements Plugin {
    name = 'com.objectstack.trigger.record-change';
    type = 'standard' as const;
    version = '7.3.0';
    dependencies = ['com.objectstack.engine.objectql'];

    async init(ctx: PluginContext): Promise<void> {
        ctx.logger.info('Record-change trigger plugin initialized');
    }

    async start(ctx: PluginContext): Promise<void> {
        // ObjectQL engine + the automation service are only resolvable once the
        // kernel is ready (kernel:ready fires after AutomationServicePlugin.start()
        // has pulled flows into the engine, so binding order is correct).
        ctx.hook('kernel:ready', async () => {
            const automation = this.resolveService<AutomationTriggerRegistry>(ctx, 'automation');
            if (!automation || typeof automation.registerTrigger !== 'function') {
                ctx.logger.warn(
                    'RecordChangeTriggerPlugin: automation service not available — record-change trigger NOT installed',
                );
                return;
            }

            const engine = this.resolveDataEngine(ctx);
            if (!engine || typeof engine.registerHook !== 'function') {
                ctx.logger.warn(
                    'RecordChangeTriggerPlugin: ObjectQL engine not available — record-change trigger NOT installed',
                );
                return;
            }

            const trigger = new RecordChangeTrigger(engine, ctx.logger);
            automation.registerTrigger(trigger);
            ctx.logger.info('RecordChangeTriggerPlugin: record-change trigger registered');
        });
    }

    private resolveService<T>(ctx: PluginContext, name: string): T | null {
        try {
            return ctx.getService<T>(name) ?? null;
        } catch {
            return null;
        }
    }

    private resolveDataEngine(ctx: PluginContext): RecordChangeDataEngine | null {
        // Primary alias 'objectql', fallback 'data' (some kernels register the
        // engine under both) — same lookup plugin-audit uses.
        return (
            this.resolveService<RecordChangeDataEngine>(ctx, 'objectql') ??
            this.resolveService<RecordChangeDataEngine>(ctx, 'data')
        );
    }
}
